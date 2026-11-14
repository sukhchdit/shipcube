// @ts-check
/**
 * No secrets in image layers (TASK-014; US-004 AT-US-004-02; platform.md §3.2 "Rules for every Dockerfile";
 * REQ-SEC-013, NFR-SEC-002):
 *
 *   node tools/docker/scan-image-secrets.mjs <image> [--gitleaks-image <ref>]
 *
 * 1. `docker save <image>` into a private temporary directory; the image manifest names the layers in order and the
 *    image config their diff_ids.
 * 2. Every layer is unpacked (regular files only; whiteouts, links and devices skipped; paths confined to the layer
 *    directory) and scanned by Gitleaks in its digest-pinned container (`dir`, `--network none`, `--redact`) with the
 *    repo-pinned config tools/docker/gitleaks-image.toml (all v8.30.1 default rules), so a secret that a later layer
 *    deletes is still found in the layer that added it.
 * 3. `docker history --no-trunc` (the build commands, ARG/ENV values included) is matched against secret shapes.
 *
 * Coverage of the AT-US-004-02 claim "no secret in any layer" (PR39-SEC-03, review R1-n8):
 * - node_modules IS scanned: each `node_modules` path segment is unpacked as `node_modules.scan` (and `.gitleaksignore`
 *   as `.gitleaksignore.scan`), because the inherited default global path allow-list would skip it; findings name the
 *   real path. The other default path allow-list entries still apply (images and fonts, `*.bin`/`*.exe`/`*.dll`,
 *   lockfiles, `swagger-ui*`/`jquery*`/`bootstrap*` bundles, Python `site-packages`/`dist-info`, Go/Ruby vendor trees).
 * - Size limit: a file over SCAN_FILE_LIMIT_BYTES (64 MiB) is not scanned. Every such file is reported on stderr by
 *   path and size; it fails the scan unless it is a KNOWN_LARGE_BINARIES path holding an ELF binary (reported as
 *   "skipped (known binary)"). Gitleaks itself gets a higher bound, so it never skips a file silently.
 * - Exceptions: only the exact, reviewed IMAGE_SCAN_ALLOW_LIST entries (rule + full path + base-image layer binding or
 *   one third-party package file); each allowed finding is still listed on stderr.
 * - Two layer members that would overwrite each other while unpacking (the same path twice, a file that is also a
 *   directory, or on a case-insensitive host paths that differ only in case) fail the scan with exit 2, naming both.
 *
 * Exit 0 = clean, 1 = findings, 2 = usage or tool failure. A finding names the layer (index and digest), the file and
 * the rule, never the matched value. The pure parts (tar reader, path confinement and renaming, manifest, config and
 * report mapping, allow-list, size and collision checks, history patterns) are exported for
 * tools/docker/scan-image-secrets.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * The layers' uncompressed digests (`rootfs.diff_ids`, in layer order) from the image config. Base-image allow-list
 * entries bind to them: they are identical in every image built FROM the pinned base, whatever the blob compression.
 * @param {string} configText
 * @returns {string[]}
 */
export function diffIdsFromConfig(configText) {
  const config = /** @type {{ rootfs?: { diff_ids?: unknown } }} */ (JSON.parse(configText));
  const ids = config.rootfs?.diff_ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && /^sha256:[0-9a-f]{64}$/.test(id))) {
    throw new Error('image config has no rootfs.diff_ids list');
  }
  return /** @type {string[]} */ (ids);
}

/** The image config path from the `docker save` manifest.json. @param {string} manifestText */
export function configFromManifest(manifestText) {
  const manifest = /** @type {unknown} */ (JSON.parse(manifestText));
  const config = Array.isArray(manifest) ? /** @type {{ Config?: unknown }} */ (manifest[0] ?? {}).Config : undefined;
  if (typeof config !== 'string') throw new Error('manifest.json names no image config');
  return config;
}

/**
 * Path segments that are renamed while a layer is unpacked, so that the Gitleaks defaults cannot skip them
 * (PR39-SEC-03): `node_modules` (the default global path allow-list skips `(?:^|/)node_modules(?:/.*)?$`) and
 * `.gitleaksignore` (Gitleaks loads `<source>/.gitleaksignore`, so a layer could suppress its own findings).
 * The mapping is injective: a segment that already reads `<name>.scan[.scan...]` gains one more `.scan`.
 */
export const RENAMED_SEGMENTS = Object.freeze(['node_modules', '.gitleaksignore']);
const SCAN_SUFFIX = '.scan';
const renamedAlternation = RENAMED_SEGMENTS.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const RENAMED_REAL = new RegExp(`^(?:${renamedAlternation})(?:\\.scan)*$`);
const RENAMED_SCAN = new RegExp(`^(?:${renamedAlternation})(?:\\.scan)+$`);

/** A layer-relative path as it is written for Gitleaks. @param {string} relative */
export const toScanPath = (relative) =>
  relative
    .split('/')
    .map((part) => (RENAMED_REAL.test(part) ? `${part}${SCAN_SUFFIX}` : part))
    .join('/');

/** The real image path of a path that Gitleaks reported (inverse of toScanPath). @param {string} scanned */
export const toRealPath = (scanned) =>
  scanned
    .split('/')
    .map((part) => (RENAMED_SCAN.test(part) ? part.slice(0, -SCAN_SUFFIX.length) : part))
    .join('/');

/**
 * Findings of one Gitleaks JSON report, reduced to the real image path and the rule (the report is written with
 * --redact; the matched value is dropped here anyway).
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
  return report.map((item) => {
    const record = /** @type {{ File?: unknown, RuleID?: unknown }} */ (item);
    const file = typeof record.File === 'string' ? toRealPath(record.File.replace(new RegExp(`^${scanRoot}/?`), '/')) : '?';
    return { layer, digest, file, rule: typeof record.RuleID === 'string' ? record.RuleID : 'unknown' };
  });
}

/**
 * @typedef {{ kind: 'base-layer', rule: string, path: RegExp, baseLayers: ReadonlyArray<ReadonlyArray<string>>, reason: string }} BaseLayerEntry
 *   A file that a pinned third-party base image ships. `path` is anchored to the full path; the finding must sit in
 *   layer i of the scanned image with i < the base's layer count and diff_ids[0..i] equal to the base's (one ordered
 *   diff_id list per platform of the pinned index), so the same path added by any later layer is still reported.
 * @typedef {{ kind: 'package-file', rule: string, file: string, reason: string }} PackageFileEntry
 *   One exact file of a third-party npm package below a node_modules directory.
 * @typedef {BaseLayerEntry | PackageFileEntry} AllowListEntry
 */

/**
 * One-line form of a base-image entry.
 * @param {string} rule @param {RegExp} path @param {ReadonlyArray<ReadonlyArray<string>>} baseLayers @param {string} reason
 * @returns {BaseLayerEntry}
 */
export const baseLayer = (rule, path, baseLayers, reason) => Object.freeze({ kind: 'base-layer', rule, path, baseLayers, reason });

/**
 * One-line form of a third-party package file entry.
 * @param {string} rule @param {string} file @param {string} reason
 * @returns {PackageFileEntry}
 */
export const packageFile = (rule, file, reason) => Object.freeze({ kind: 'package-file', rule, file, reason });

/**
 * rootfs.diff_ids of node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
 * (the build-stage pin of apps/* and prisma/Dockerfile), one ordered list per platform. Re-read them whenever that pin
 * changes: `docker buildx imagetools inspect <ref> --format '{{json .Image}}'` (rootfs.diff_ids of each platform).
 */
export const NODE_BASE_DIFF_IDS = Object.freeze([
  // linux/amd64
  Object.freeze([
    'sha256:dd57f90311a2567b55ff22eeacff1602fd04ad7566e315957731359eab173b90',
    'sha256:0f079896db8a96ffbc8221713a7fb493fccb5a74b804897d2be032c383b4aa39',
    'sha256:243faa29328ab266e203cb09c063ffb1c15432a9e63f53bc3d33f5e10b543b2b',
    'sha256:8fda72e5950aa765515dc2d28a14fc875b095ebf5db380d89e1d599df6832aaf',
    'sha256:fcd44f416dbc8525ccc3a3647fcfcd70f461b2cb0675abe51fb5227c0f62318a',
  ]),
  // linux/arm64
  Object.freeze([
    'sha256:04e61ff9ed2c84e88795bf7562d69d0980188e2bb6d6152d6fe721383e10db9e',
    'sha256:bfc2cfeca76a6283c5c50be4667dd826035a07d0d02dae947a7ceb124218e6e4',
    'sha256:34f85d2d70ca7d7913def71bf67c298d970616ee9afc5bd95b490d3254b2f116',
    'sha256:8af18a6c0a7e878642e58f3a6d0d3aac3725a485e6431d6340132d0cbfc32e91',
    'sha256:0b667c8babf9955ae908cb7bcb3a232aea490c5847a0043fcc88ecb8615c8a51',
  ]),
]);

/**
 * Reviewed exceptions of the image scan (PR39-SEC-03 remediation 2-3). Exact entries only: rule + full-path match +
 * a base-image layer binding (`baseLayer`) or one third-party package file (`packageFile`); never a prefix alone.
 * One line per reviewed finding, with the decision id and the reason in the comment above it, for example
 *   packageFile('private-key', '/app/node_modules/<pkg>/test/fixtures/<file>', '<pkg> published test key'),
 * Removing the file from the image (PR39-SEC-04) is preferred to listing it.
 * @type {ReadonlyArray<AllowListEntry>}
 */
export const IMAGE_SCAN_ALLOW_LIST = Object.freeze([
  // D-TASK014-13, accepted by D-SEC-PR39-04 when bound to the base layers: the V8 C++ headers that the official node
  // image installs under /usr/local/include/node hold identifier constants that generic-api-key matches. Dead once no
  // final stage is FROM the node image (architect R6); delete the line then.
  baseLayer('generic-api-key', /^\/usr\/local\/include\/node\/(?:[\w-]+\/)*[\w.-]+\.h$/, NODE_BASE_DIFF_IDS, 'node base image V8 headers'),
]);

/**
 * Throws unless every entry is exact: an anchored full-path regex without flags bound to sha256 diff_id lists, or a
 * normalised absolute package file path below a node_modules directory.
 * @param {ReadonlyArray<AllowListEntry>} entries
 */
export function assertExactAllowList(entries) {
  entries.forEach((entry, index) => {
    const where = `allow-list entry ${String(index)} (${entry.rule})`;
    if (entry.rule === '' || entry.reason === '') throw new Error(`${where} needs a rule and a reason`);
    if (entry.kind === 'base-layer') {
      if (!entry.path.source.startsWith('^\\/') || !entry.path.source.endsWith('$') || entry.path.flags !== '') {
        throw new Error(`${where}: the path regex must be anchored to a full absolute path (^/...$, no flags)`);
      }
      const lists = entry.baseLayers.filter((list) => list.length > 0);
      if (lists.length === 0 || !lists.every((list) => list.every((id) => /^sha256:[0-9a-f]{64}$/.test(id)))) {
        throw new Error(`${where}: binds to no base-image diff_id list`);
      }
    } else if (!entry.file.startsWith('/') || !/\/node_modules\/[^/]/.test(entry.file) || posix.normalize(entry.file) !== entry.file) {
      throw new Error(`${where}: a package file is one normalised absolute path below node_modules/`);
    }
  });
}

/**
 * Whether a Gitleaks finding matches a reviewed allow-list entry.
 * @param {LayerFinding} finding
 * @param {readonly string[]} imageDiffIds rootfs.diff_ids of the scanned image
 * @param {ReadonlyArray<AllowListEntry>} entries
 */
export function isAllowListed(finding, imageDiffIds, entries = IMAGE_SCAN_ALLOW_LIST) {
  return entries.some((entry) => {
    if (entry.rule !== finding.rule) return false;
    if (entry.kind === 'package-file') return entry.file === finding.file;
    return (
      entry.path.test(finding.file) &&
      entry.baseLayers.some(
        (list) => finding.layer < list.length && list.slice(0, finding.layer + 1).every((id, index) => imageDiffIds[index] === id),
      )
    );
  });
}

/**
 * Size bound of one scanned file (64 MiB). A larger file is not handed to Gitleaks (which would skip it silently); it
 * is reported by path and size and fails the scan, unless it is a known large binary.
 */
export const SCAN_FILE_LIMIT_BYTES = 64 * 1024 * 1024;
/** Above SCAN_FILE_LIMIT_BYTES, so Gitleaks never skips a file that the scanner wrote. */
const GITLEAKS_MAX_TARGET_MEGABYTES = '128';

/** Known large binaries: exact path, and the file must start with the ELF magic (a large text file there still fails). */
export const KNOWN_LARGE_BINARIES = Object.freeze([
  // The Node.js runtime (about 120 MB), in the node base layers or copied by the slim runtime pattern.
  '/usr/local/bin/node',
]);
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

/** @typedef {{ layer: number, digest: string, file: string, size: number }} OversizeFile */

/** @param {OversizeFile} file @param {Buffer} data */
export const isKnownLargeBinary = (file, data) =>
  KNOWN_LARGE_BINARIES.includes(file.file) && data.subarray(0, ELF_MAGIC.length).equals(ELF_MAGIC);

/** @param {OversizeFile} file */
export const formatKnownBinary = (file) =>
  `[scan-image-secrets] skipped (known binary): ${file.file} in layer ${String(file.layer)}, ${String(file.size)} bytes`;

/** An unscanned file as a failing finding. @param {OversizeFile} file @returns {LayerFinding} */
export const oversizeFinding = (file) => ({
  layer: file.layer,
  digest: file.digest,
  file: file.file,
  rule: `not scanned, ${String(file.size)} bytes over the ${String(SCAN_FILE_LIMIT_BYTES)}-byte limit`,
});

/**
 * Pairs of layer paths that would overwrite or merge into each other in the unpack directory: the same path twice, a
 * path that is both a file and a directory, and (with `foldCase`, on a case-insensitive host such as Windows) paths
 * that differ only in case. Both paths are returned, absolute.
 * @param {readonly string[]} paths layer-relative file paths
 * @param {boolean} foldCase
 * @returns {Array<[string, string]>}
 */
export function pathCollisions(paths, foldCase) {
  /** @param {string} path */
  const key = (path) => (foldCase ? path.toLowerCase() : path);
  /** @type {Map<string, string>} */
  const files = new Map();
  /** @type {Map<string, string>} */
  const dirs = new Map();
  /** @type {Map<string, [string, string]>} */
  const collisions = new Map();
  /** @param {string} first @param {string} second */
  const collide = (first, second) => {
    collisions.set(`${first}\0${second}`, [`/${first}`, `/${second}`]);
  };
  for (const path of paths) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth += 1) {
      const dir = parts.slice(0, depth).join('/');
      const file = files.get(key(dir));
      const seen = dirs.get(key(dir));
      if (file !== undefined) collide(file, path);
      else if (seen === undefined) dirs.set(key(dir), dir);
      else if (seen !== dir) collide(seen, dir);
    }
    const dir = dirs.get(key(path));
    const file = files.get(key(path));
    if (dir !== undefined) collide(dir, path);
    else if (file !== undefined) collide(file, path);
    else files.set(key(path), path);
  }
  return [...collisions.values()];
}

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

/** The repo-pinned Gitleaks config (tools/docker/gitleaks-image.toml), mounted read-only at /cfg. */
export const GITLEAKS_CONFIG_FILE = fileURLToPath(new URL('gitleaks-image.toml', import.meta.url));
const GITLEAKS_CONFIG_MOUNT = '/cfg/gitleaks-image.toml';

/**
 * docker argv for one Gitleaks run over an unpacked layer (no network, read-only input and config, redacted report).
 * `--config` is always passed, so a `.gitleaks.toml` inside the layer is scanned as a file, never loaded.
 * @param {string} layerDir @param {string} reportDir @param {string} reportName @param {string} image
 * @param {string} configFile
 */
export function gitleaksArgs(layerDir, reportDir, reportName, image = GITLEAKS_IMAGE, configFile = GITLEAKS_CONFIG_FILE) {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${layerDir}:/scan:ro`,
    '-v',
    `${configFile}:${GITLEAKS_CONFIG_MOUNT}:ro`,
    '-v',
    `${reportDir}:/report`,
    image,
    'dir',
    '/scan',
    '--config',
    GITLEAKS_CONFIG_MOUNT,
    '--no-banner',
    '--redact',
    '--ignore-gitleaks-allow',
    '--max-target-megabytes',
    GITLEAKS_MAX_TARGET_MEGABYTES,
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

/** Whether the file system under `dir` folds case (Windows, default macOS). @param {string} dir */
function foldsCase(dir) {
  const probe = join(dir, 'case-probe');
  writeFileSync(probe, '');
  const folds = existsSync(join(dir, 'CASE-PROBE'));
  rmSync(probe);
  return folds;
}

/**
 * Writes the regular files of one layer below `dir` (node_modules renamed, see toScanPath) and returns how many were
 * written plus the files over SCAN_FILE_LIMIT_BYTES, which are not written. Throws when two members would overwrite
 * or merge into each other on this host.
 * @param {Buffer} layerTar @param {string} dir @param {number} layer @param {string} digest @param {boolean} foldCase
 * @returns {{ written: number, oversize: Array<{ file: OversizeFile, data: Buffer }> }}
 */
function unpackLayer(layerTar, dir, layer, digest, foldCase) {
  /** @type {Array<{ scanPath: string, data: Buffer }>} */
  const members = [];
  /** @type {Array<{ file: OversizeFile, data: Buffer }>} */
  const oversize = [];
  for (const entry of parseTar(layerTar)) {
    if (entry.type !== '0' && entry.type !== '7') continue;
    const relative = confinedPath(entry.name);
    if (relative === undefined) continue;
    if (entry.size > SCAN_FILE_LIMIT_BYTES)
      oversize.push({ file: { layer, digest, file: `/${relative}`, size: entry.size }, data: entry.data });
    else members.push({ scanPath: toScanPath(relative), data: entry.data });
  }
  const collisions = pathCollisions(
    members.map((member) => member.scanPath),
    foldCase,
  );
  if (collisions.length > 0) {
    const named = collisions.map(([first, second]) => `${toRealPath(first)} and ${toRealPath(second)}`).join('; ');
    throw new Error(`layer ${String(layer)}: members would overwrite each other while unpacking on this host: ${named}`);
  }
  for (const member of members) {
    const target = join(dir, ...member.scanPath.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, member.data, { mode: 0o600 });
  }
  return { written: members.length, oversize };
}

/**
 * @typedef {{ layers: LayerFinding[], history: HistoryFinding[], allowed: LayerFinding[], skipped: OversizeFile[] }} ScanResult
 *   `layers` and `history` fail the scan; `allowed` matched a reviewed entry; `skipped` are known large binaries.
 */

/** @param {string} image @param {string} gitleaksImage @returns {ScanResult} */
export function scanImage(image, gitleaksImage = GITLEAKS_IMAGE) {
  assertExactAllowList(IMAGE_SCAN_ALLOW_LIST);
  if (!existsSync(GITLEAKS_CONFIG_FILE)) throw new Error('tools/docker/gitleaks-image.toml is missing');
  const work = mkdtempSync(join(tmpdir(), 'scan-image-secrets-'));
  try {
    const foldCase = foldsCase(work);
    const archive = join(work, 'image.tar');
    docker(['save', '-o', archive, image]);
    const files = new Map(parseTar(readFileSync(archive)).map((entry) => [entry.name, entry.data]));
    rmSync(archive);
    const manifest = files.get('manifest.json');
    if (manifest === undefined) throw new Error('docker save output has no manifest.json');
    const manifestText = manifest.toString('utf8');
    const config = files.get(configFromManifest(manifestText));
    if (config === undefined) throw new Error('the image config is missing from the archive');
    const diffIds = diffIdsFromConfig(config.toString('utf8'));
    const layerPaths = layersFromManifest(manifestText);
    if (diffIds.length !== layerPaths.length) throw new Error('the image config and manifest disagree on the layer count');
    const reportDir = join(work, 'reports');
    mkdirSync(reportDir);
    /** @type {ScanResult} */
    const result = { layers: [], history: [], allowed: [], skipped: [] };
    layerPaths.forEach((layerPath, index) => {
      const blob = files.get(layerPath);
      if (blob === undefined) throw new Error(`layer ${String(index)} is missing from the archive`);
      const digest = layerDigest(layerPath);
      const layerDir = join(work, `layer-${String(index)}`);
      mkdirSync(layerDir);
      const { written, oversize } = unpackLayer(decompressLayer(blob), layerDir, index, digest, foldCase);
      for (const { file, data } of oversize) {
        if (isKnownLargeBinary(file, data)) result.skipped.push(file);
        else result.layers.push(oversizeFinding(file));
      }
      if (written > 0) {
        const reportName = `layer-${String(index)}.json`;
        docker(gitleaksArgs(layerDir, reportDir, reportName, gitleaksImage));
        for (const finding of gitleaksFindings(readFileSync(join(reportDir, reportName), 'utf8'), index, digest)) {
          (isAllowListed(finding, diffIds) ? result.allowed : result.layers).push(finding);
        }
      }
      rmSync(layerDir, { recursive: true, force: true });
    });
    const steps = String(docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', image]).stdout)
      .split(/\r?\n/)
      .filter((line) => line !== '');
    result.history = scanHistory(steps);
    return result;
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
      const { layers, history, allowed, skipped } = scanImage(positional[0] ?? '', gitleaksImage);
      for (const file of skipped) process.stderr.write(`${formatKnownBinary(file)}\n`);
      for (const f of allowed) {
        process.stderr.write(`[scan-image-secrets] allowed (reviewed entry): ${f.file}: ${f.rule} in layer ${String(f.layer)}\n`);
      }
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
