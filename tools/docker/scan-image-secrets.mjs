// @ts-check
/**
 * No secrets in image layers (TASK-014; US-004 AT-US-004-02; platform.md §3.2 "Rules for every Dockerfile";
 * REQ-SEC-013, NFR-SEC-002):
 *
 *   node tools/docker/scan-image-secrets.mjs <image> [--gitleaks-image <ref>]
 *
 * 1. `docker save <image>` into a private temporary directory; the image manifest names the layers in order.
 * 2. Every layer is unpacked (regular files only; whiteouts, links and devices skipped; paths confined to the layer
 *    directory) and scanned by Gitleaks in its digest-pinned container (`dir`, `--network none`, `--redact`), so a
 *    secret that a later layer deletes is still found in the layer that added it.
 * 3. `docker history --no-trunc` (the build commands, ARG/ENV values included) is matched against secret shapes.
 *
 * Exit 0 = clean, 1 = findings, 2 = usage or tool failure. A finding names the layer (index and digest), the file and
 * the rule, never the matched value. The pure parts (tar reader, path confinement, manifest and report mapping, history
 * patterns) are exported for tools/docker/scan-image-secrets.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

/** Same pin as GITLEAKS_IMAGE in .github/workflows/ci.yml (PD-09; the unit test compares them). */
export const GITLEAKS_IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';

/** @typedef {{ name: string, type: string, size: number, data: Buffer }} TarEntry */
/** @typedef {{ layer: number, digest: string, file: string, rule: string }} LayerFinding */
/** @typedef {{ step: number, rule: string }} HistoryFinding */

const BLOCK = 512;

/** @param {Buffer} buf @param {number} start @param {number} length */
const cString = (buf, start, length) => {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8');
};

/**
 * Numeric tar header field: octal text, or GNU base-256 when the high bit of the first byte is set.
 * @param {Buffer} buf @param {number} start @param {number} length
 */
export function tarNumber(buf, start, length) {
  const first = buf[start] ?? 0;
  if ((first & 0x80) !== 0) {
    let value = first & 0x7f;
    for (let i = 1; i < length; i += 1) value = value * 256 + (buf[start + i] ?? 0);
    return value;
  }
  const text = cString(buf, start, length).trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/**
 * PAX extended header records (`<len> key=value\n`); returns the `path` record when present.
 * @param {Buffer} data
 */
export function paxPath(data) {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(offset, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1 && record.slice(0, eq) === 'path') return record.slice(eq + 1);
    offset += length;
  }
  return undefined;
}

/**
 * Reads a (ustar / PAX / GNU long-name) tar archive held in memory. Entry data are views into `buf`.
 * @param {Buffer} buf
 * @returns {TarEntry[]}
 */
export function parseTar(buf) {
  /** @type {TarEntry[]} */
  const entries = [];
  /** @type {string | undefined} */
  let longName;
  let offset = 0;
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = cString(header, 345, 155);
    const base = cString(header, 0, 100);
    const name = longName ?? (prefix !== '' && cString(header, 257, 6).startsWith('ustar') ? `${prefix}/${base}` : base);
    const data = buf.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (type === 'L') {
      longName = cString(data, 0, data.length);
      continue;
    }
    if (type === 'g') continue;
    longName = undefined;
    entries.push({ name, type: type === '\0' ? '0' : type, size, data });
  }
  return entries;
}

/**
 * A layer member's path relative to the layer root, or undefined when it must not be written: absolute after
 * normalisation, escaping with `..`, a whiteout marker, or empty.
 * @param {string} name
 */
export function confinedPath(name) {
  const normalised = posix.normalize(name.replace(/^(\.\/)+/, '').replace(/^\/+/, ''));
  if (normalised === '' || normalised === '.' || normalised.startsWith('..') || posix.isAbsolute(normalised)) return undefined;
  if (posix.basename(normalised).startsWith('.wh.')) return undefined;
  return normalised;
}

/**
 * Layer blob bytes as an uncompressed tar (docker save may emit gzip or zstd blobs with the containerd image store).
 * @param {Buffer} blob
 */
export function decompressLayer(blob) {
  if (blob[0] === 0x1f && blob[1] === 0x8b) return gunzipSync(blob);
  if (blob[0] === 0x28 && blob[1] === 0xb5 && blob[2] === 0x2f && blob[3] === 0xfd) return zstdDecompressSync(blob);
  return blob;
}

/**
 * Layer paths in order from the `docker save` manifest.json (Docker and OCI layouts both write it).
 * @param {string} manifestText
 * @returns {string[]}
 */
export function layersFromManifest(manifestText) {
  const manifest = /** @type {unknown} */ (JSON.parse(manifestText));
  if (!Array.isArray(manifest) || manifest.length !== 1) throw new Error('manifest.json must describe exactly one image');
  const layers = /** @type {{ Layers?: unknown }} */ (manifest[0]).Layers;
  if (!Array.isArray(layers) || !layers.every((layer) => typeof layer === 'string')) throw new Error('manifest.json has no layer list');
  return /** @type {string[]} */ (layers);
}

/** The digest-like id of a layer path (`blobs/sha256/<hex>` or `<hex>/layer.tar`). @param {string} layerPath */
export const layerDigest = (layerPath) => /([0-9a-f]{64})/.exec(layerPath)?.[1] ?? layerPath;

/**
 * Findings of one Gitleaks JSON report, reduced to file and rule (the report is written with --redact; the matched
 * value is dropped here anyway).
 * @param {string} reportText
 * @param {number} layer
 * @param {string} digest
 * @param {string} scanRoot the container path Gitleaks scanned
 * @returns {LayerFinding[]}
 */
export function gitleaksFindings(reportText, layer, digest, scanRoot = '/scan') {
  const trimmed = reportText.trim();
  if (trimmed === '') return [];
  const report = /** @type {unknown} */ (JSON.parse(trimmed));
  if (!Array.isArray(report)) throw new Error('gitleaks report is not a JSON array');
  return report
    .map((item) => {
      const record = /** @type {{ File?: unknown, RuleID?: unknown }} */ (item);
      const file = typeof record.File === 'string' ? record.File.replace(new RegExp(`^${scanRoot}/?`), '/') : '?';
      return { layer, digest, file, rule: typeof record.RuleID === 'string' ? record.RuleID : 'unknown' };
    })
    .filter((finding) => !isKnownBaseImageFalsePositive(finding));
}

/**
 * Known false positives of the pinned third-party base images, by exact (path prefix, rule) pair only (TASK-014 stack
 * run 1): the V8 C++ headers that the official node image installs under /usr/local/include/node hold identifier
 * constants that the generic-api-key rule matches. Only the tooling image keeps the full node image; a secret
 * anywhere else, or of any other rule, still fails.
 */
export const BASE_IMAGE_FALSE_POSITIVES = Object.freeze([
  Object.freeze({ pathPrefix: '/usr/local/include/node/', rule: 'generic-api-key' }),
]);

/** @param {{ file: string, rule: string }} finding */
export const isKnownBaseImageFalsePositive = (finding) =>
  BASE_IMAGE_FALSE_POSITIVES.some(
    (entry) =>
      finding.rule === entry.rule &&
      finding.file.startsWith(entry.pathPrefix) &&
      !finding.file.slice(entry.pathPrefix.length).includes('..'),
  );

/** Secret shapes in build history (ARG/ENV values and RUN lines); rule ids are reported, never the match. */
export const HISTORY_RULES = Object.freeze(
  /** @type {ReadonlyArray<readonly [string, RegExp]>} */ ([
    ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ['stripe-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/],
    ['stripe-webhook-secret', /\bwhsec_[A-Za-z0-9]{8,}/],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
    ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
    ['url-credentials', /[a-z][a-z0-9+.-]*:\/\/[^/:@\s"']+:[^@\s"'$]{3,}@/i],
    [
      'secret-assignment',
      /\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*=(?!\s|$|"\s*"|''|\$)\S{6,}/,
    ],
  ]),
);

/**
 * @param {readonly string[]} steps `docker history --no-trunc --format {{.CreatedBy}}` lines
 * @returns {HistoryFinding[]}
 */
export function scanHistory(steps) {
  return steps.flatMap((step, index) => HISTORY_RULES.filter(([, pattern]) => pattern.test(step)).map(([rule]) => ({ step: index, rule })));
}

/** @param {LayerFinding[]} layers @param {HistoryFinding[]} history @returns {string[]} */
export function formatFindings(layers, history) {
  return [
    ...layers.map((f) => `[scan-image-secrets] layer ${f.layer} (sha256:${f.digest.slice(0, 12)}) ${f.file}: ${f.rule}`),
    ...history.map((f) => `[scan-image-secrets] history step ${f.step}: ${f.rule}`),
  ];
}

/**
 * docker argv for one Gitleaks run over an unpacked layer (no network, read-only input, redacted report).
 * @param {string} layerDir @param {string} reportDir @param {string} reportName @param {string} image
 */
export function gitleaksArgs(layerDir, reportDir, reportName, image = GITLEAKS_IMAGE) {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${layerDir}:/scan:ro`,
    '-v',
    `${reportDir}:/report`,
    image,
    'dir',
    '/scan',
    '--no-banner',
    '--redact',
    '--ignore-gitleaks-allow',
    '--max-target-megabytes',
    '10',
    '--report-format',
    'json',
    '--report-path',
    `/report/${reportName}`,
    '--exit-code',
    '0',
  ];
}

/** @param {readonly string[]} args @param {{ encoding?: 'utf8' | 'buffer' }} [options] */
function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: options.encoding ?? 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`docker ${args[0] ?? ''} failed (exit ${String(result.status)})`);
  }
  return result;
}

/** @param {Buffer} layerTar @param {string} dir */
function unpackLayer(layerTar, dir) {
  let written = 0;
  for (const entry of parseTar(layerTar)) {
    if (entry.type !== '0' && entry.type !== '7') continue;
    const relative = confinedPath(entry.name);
    if (relative === undefined) continue;
    const target = join(dir, ...relative.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data, { mode: 0o600 });
    written += 1;
  }
  return written;
}

/** @param {string} image @param {string} gitleaksImage @returns {{ layers: LayerFinding[], history: HistoryFinding[] }} */
export function scanImage(image, gitleaksImage = GITLEAKS_IMAGE) {
  const work = mkdtempSync(join(tmpdir(), 'scan-image-secrets-'));
  try {
    const archive = join(work, 'image.tar');
    docker(['save', '-o', archive, image]);
    const files = new Map(parseTar(readFileSync(archive)).map((entry) => [entry.name, entry.data]));
    rmSync(archive);
    const manifest = files.get('manifest.json');
    if (manifest === undefined) throw new Error('docker save output has no manifest.json');
    const reportDir = join(work, 'reports');
    mkdirSync(reportDir);
    /** @type {LayerFinding[]} */
    const layers = [];
    layersFromManifest(manifest.toString('utf8')).forEach((layerPath, index) => {
      const blob = files.get(layerPath);
      if (blob === undefined) throw new Error(`layer ${String(index)} is missing from the archive`);
      const layerDir = join(work, `layer-${String(index)}`);
      mkdirSync(layerDir);
      if (unpackLayer(decompressLayer(blob), layerDir) === 0) return;
      const reportName = `layer-${String(index)}.json`;
      docker(gitleaksArgs(layerDir, reportDir, reportName, gitleaksImage));
      layers.push(...gitleaksFindings(readFileSync(join(reportDir, reportName), 'utf8'), index, layerDigest(layerPath)));
      rmSync(layerDir, { recursive: true, force: true });
    });
    const steps = String(docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', image]).stdout)
      .split(/\r?\n/)
      .filter((line) => line !== '');
    return { layers, history: scanHistory(steps) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--gitleaks-image');
  const gitleaksImage = flag === -1 ? GITLEAKS_IMAGE : (args[flag + 1] ?? '');
  const positional = args.filter((_, index) => flag === -1 || (index !== flag && index !== flag + 1));
  if (positional.length !== 1 || gitleaksImage === '') {
    process.stderr.write('usage: scan-image-secrets.mjs <image> [--gitleaks-image <ref>]\n');
    process.exitCode = 2;
  } else {
    try {
      const { layers, history } = scanImage(positional[0] ?? '', gitleaksImage);
      const lines = formatFindings(layers, history);
      for (const line of lines) process.stderr.write(`${line}\n`);
      if (lines.length === 0) process.stdout.write('[scan-image-secrets] no secrets found\n');
      process.exitCode = lines.length === 0 ? 0 : 1;
    } catch (error) {
      process.stderr.write(`[scan-image-secrets] ${error instanceof Error ? error.message : 'failed'}\n`);
      process.exitCode = 2;
    }
  }
}
