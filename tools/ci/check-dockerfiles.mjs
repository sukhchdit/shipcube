// @ts-check
/**
 * Static Dockerfile rules (TASK-014, US-004; platform.md §3.2 "Rules for every Dockerfile" and §3.4 "Dockerfile lint";
 * WAVE-00 sheet lines 530, 531, 537, 543; ADR-0022 am. 13/14, ADR-0023 am. I/J). hadolint covers the generic shell
 * and Dockerfile lint; this gate holds the project rules, as a pure function over Dockerfile text:
 *
 *   from-digest        every FROM is `name:tag@sha256:<64 hex>` or an earlier stage name
 *   final-user         the final stage sets a non-root USER (a name other than root, or a UID other than 0)
 *   healthcheck        service images (api, worker, web, admin) have a HEALTHCHECK in the final stage
 *   node-flags         an api/worker ENTRYPOINT/CMD/HEALTHCHECK carries no `--conditions` and no `--experimental-vm-modules`
 *   copy-explicit      no COPY/ADD of `.`, `./`, `*` or the bare `prisma` directory (sheet line 543)
 *   copy-env           no COPY/ADD of `.env*`
 *   npm-rebuild        no `npm rebuild` (ADR-0023 am. J item 6)
 *   npx                no `npx` (ADR-0023 am. I item 3)
 *   ignore-scripts     every npm install (any alias) carries `--ignore-scripts` and no npm call re-enables scripts
 *                      (`--ignore-scripts false`, `--no-ignore-scripts`, ...). The predicate is `npmInvocations` of
 *                      npm-command.mjs, the one check-install-flags (owner of the repository-wide install-flags rule)
 *                      uses, so the two gates cannot disagree (PR #39 R1-n2).
 *   secret-name        no ARG/ENV name that looks like a secret (PASSWORD, SECRET, TOKEN, KEY, CREDENTIAL)
 *   telemetry-env      a Node stage that installs has CHECKPOINT_DISABLE=1 and SCARF_ANALYTICS=false (own or inherited)
 *   node-env           a Node final stage sets NODE_ENV=production
 *   runtime-codename   (D-ARCH-116; PR #39 R3) for a Dockerfile with a `node:<version>-<codename>-slim@sha256:...` base
 *                      and a `debian:<codename>-slim@sha256:...` stage:
 *                      (a) every node and debian codename is the same (the copied Node binary links against the glibc
 *                          of its own Debian release); a node/debian FROM without a readable codename is a finding;
 *                      (b) repository mode: every `node:` FROM reference, and every `debian:` FROM reference, is
 *                          byte-identical across all scanned Dockerfiles (so one Dependabot group PR moves them all);
 *                      (c) a stage built FROM debian takes from the node stage (a stage built directly FROM the node
 *                          image, or the node image itself) exactly `COPY --from=<it> /usr/local/bin/node
 *                          /usr/local/bin/node` and nothing else, and mounts nothing from it (`RUN --mount=...from=`).
 *   entrypoint         an api/worker final stage has `ENTRYPOINT ["/app/entrypoint.sh"]` as its last ENTRYPOINT and
 *                      `COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh` (PR #39 fix cycle 1).
 *   node-major         (repository mode; PR87-SEC-01 (a), PR-0087 R1-m1, D-DEVOPS-005) every `node:<version>-...` FROM
 *                      has the major of `.node-version` and a version that satisfies `engines.node` of the root
 *                      package.json (ADR-0001: Node 24 LTS). Fails closed: an unreadable `.node-version`, a missing or
 *                      unparsable `engines.node`, or a node tag without a numeric version is a finding. Dependabot #50
 *                      and #90 moved all five FROM lines to Node 26; lane B --profile pr builds no image, so before this
 *                      rule only an image `npm ci` (engine-strict) noticed.
 *
 *   node tools/ci/check-dockerfiles.mjs [--root <dir>]   scans every Dockerfile of the repository; exit 1 on findings
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { npmInvocations } from './npm-command.mjs';

/** @typedef {{ rule: string, message: string, line: number }} Finding */
/** @typedef {{ instruction: string, args: string, line: number }} Instruction */
/** @typedef {{ name: string | undefined, from: string, node: boolean, env: Map<string, string>, instructions: Instruction[], line: number }} Stage */

/** `[registry[:port]/]repository:tag@sha256:<64 hex>`; a tag is required next to the digest (reviewability). */
const DIGEST_REF = /^[a-z0-9][a-z0-9._/:-]*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/;
const SECRET_NAME = /PASSWORD|PASSWD|SECRET|TOKEN|KEY|CREDENTIAL/i;
/**
 * ARG/ENV names that match SECRET_NAME but hold no secret. Empty today: every name the Dockerfiles use passes, and a
 * future entry needs a one-line justification here (reviewed with the Dockerfile change).
 */
export const NON_SECRET_NAMES = Object.freeze(/** @type {string[]} */ ([]));
/** Dockerfiles whose final stage is a long-running service (healthcheck rule) and the Node services among them. */
export const SERVICE_DOCKERFILES = Object.freeze([
  'apps/api/Dockerfile',
  'apps/worker/Dockerfile',
  'apps/web/Dockerfile',
  'apps/admin/Dockerfile',
]);
export const NODE_SERVICE_DOCKERFILES = Object.freeze(['apps/api/Dockerfile', 'apps/worker/Dockerfile']);

/**
 * Logical instructions: continuations joined, comment lines (also inside a continuation) dropped.
 * @param {string} text @returns {Instruction[]}
 */
export function instructions(text) {
  /** @type {Instruction[]} */
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = i + 1;
    let logical = lines[i] ?? '';
    if (/^\s*#/.test(logical) || logical.trim() === '') continue;
    while (/\\\s*$/.test(logical) && i + 1 < lines.length) {
      i += 1;
      const next = lines[i] ?? '';
      if (/^\s*#/.test(next)) continue;
      logical = `${logical.replace(/\\\s*$/, ' ')}${next}`;
    }
    const match = /^\s*([A-Za-z]+)\s*(.*)$/.exec(logical);
    if (match) out.push({ instruction: (match[1] ?? '').toUpperCase(), args: (match[2] ?? '').trim(), line });
  }
  return out;
}

/** `--flag=value` options in front of an instruction's arguments are dropped. @param {string} args */
const withoutFlags = (args) => args.replace(/^(?:--\S+\s+)*/, '');

/** Sources of a COPY/ADD (shell or JSON form). @param {string} args @returns {string[]} */
export function copySources(args) {
  const rest = withoutFlags(args);
  /** @type {string[]} */
  let tokens;
  if (rest.startsWith('[')) {
    try {
      const parsed = /** @type {unknown} */ (JSON.parse(rest));
      tokens = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      tokens = [];
    }
  } else tokens = rest.split(/\s+/).filter(Boolean);
  return tokens.slice(0, -1);
}

/** `KEY=value` pairs (or the legacy `KEY value`) of an ENV/ARG. @param {string} args @returns {[string, string][]} */
export function assignments(args) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(args)) {
    const [name = '', ...value] = args.split(/\s+/);
    return [[name, value.join(' ')]];
  }
  return [...args.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g)].map((m) => [
    m[1] ?? '',
    (m[2] ?? '').replace(/^["']|["']$/g, ''),
  ]);
}

/** @param {Instruction[]} list @returns {Stage[]} */
export function stages(list) {
  /** @type {Stage[]} */
  const out = [];
  for (const item of list) {
    if (item.instruction === 'FROM') {
      const m = /^(\S+)(?:\s+AS\s+(\S+))?/i.exec(withoutFlags(item.args));
      const from = m?.[1] ?? '';
      const parent = out.find((stage) => stage.name !== undefined && stage.name === from.toLowerCase());
      out.push({
        name: m?.[2]?.toLowerCase(),
        from,
        node: parent ? parent.node : /^(?:docker\.io\/)?(?:library\/)?node:/.test(from),
        env: new Map(parent ? parent.env : []),
        instructions: [],
        line: item.line,
      });
    } else {
      const current = out.at(-1);
      if (current === undefined) continue;
      current.instructions.push(item);
      if (item.instruction === 'ENV') for (const [key, value] of assignments(item.args)) current.env.set(key, value);
    }
  }
  return out;
}

/** Command text of RUN/CMD/ENTRYPOINT/HEALTHCHECK (JSON form joined with spaces). @param {string} args */
function commandText(args) {
  const rest = withoutFlags(args).replace(/^CMD\s+/i, '');
  if (!rest.startsWith('[')) return rest;
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(rest));
    return Array.isArray(parsed) ? parsed.map(String).join(' ') : rest;
  } catch {
    return rest;
  }
}

const NPM_INSTALL = /\bnpm\s+(?:ci|clean-install|install|i|add|isntall)\b/;

const IMAGE_PREFIX = String.raw`^(?:docker\.io\/)?(?:library\/)?`;
const NODE_CODENAME = new RegExp(`${IMAGE_PREFIX}node:\\d+(?:\\.\\d+)*-([a-z]+)-slim@sha256:[0-9a-f]{64}$`);
const DEBIAN_CODENAME = new RegExp(`${IMAGE_PREFIX}debian:([a-z]+)-slim@sha256:[0-9a-f]{64}$`);
/** The one file a debian runtime stage may take from the node stage (runtime-codename (c)). */
export const NODE_BINARY = '/usr/local/bin/node';

/**
 * Which pinned base image a FROM names: `node`, `debian` or undefined (a stage name or another image).
 * @param {string} from @returns {'node' | 'debian' | undefined}
 */
export function baseImageKind(from) {
  if (new RegExp(`${IMAGE_PREFIX}node:`).test(from)) return 'node';
  if (new RegExp(`${IMAGE_PREFIX}debian:`).test(from)) return 'debian';
  return undefined;
}

/**
 * The Debian codename of `node:<version>-<codename>-slim@sha256:…` or `debian:<codename>-slim@sha256:…`.
 * @param {string} from @returns {string | undefined}
 */
export function baseCodename(from) {
  return (NODE_CODENAME.exec(from) ?? DEBIAN_CODENAME.exec(from))?.[1];
}

/**
 * The `--from=` value, sources and destination of a COPY (shell or JSON form).
 * @param {string} args @returns {{ from: string | undefined, sources: string[], destination: string | undefined }}
 */
export function copyParts(args) {
  const flags = /^(?:--\S+\s+)*/.exec(args)?.[0] ?? '';
  const from = /(?:^|\s)--from=(\S+)/.exec(flags)?.[1];
  const rest = withoutFlags(args);
  /** @type {string[]} */
  let tokens;
  if (rest.startsWith('[')) {
    try {
      const parsed = /** @type {unknown} */ (JSON.parse(rest));
      tokens = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      tokens = [];
    }
  } else tokens = rest.split(/\s+/).filter(Boolean);
  return { from, sources: tokens.slice(0, -1), destination: tokens.at(-1) };
}

/**
 * runtime-codename (a) and (c) over one Dockerfile's stages (D-ARCH-116; PR #39 R3). Applies only when the file has
 * both a node-image stage and a debian-image stage.
 * @param {Stage[]} all @returns {Finding[]}
 */
export function runtimeCodenameFindings(all) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {number} */ line, /** @type {string} */ message) => findings.push({ rule: 'runtime-codename', line, message });
  const nodeStages = all.filter((stage) => baseImageKind(stage.from) === 'node');
  const debianStages = all.filter((stage) => baseImageKind(stage.from) === 'debian');
  if (nodeStages.length === 0 || debianStages.length === 0) return findings;

  // (a) one codename for the node build base and the debian runtime base.
  /** @type {Set<string>} */
  const codenames = new Set();
  for (const stage of [...nodeStages, ...debianStages]) {
    const codename = baseCodename(stage.from);
    if (codename === undefined) {
      add(
        stage.line,
        `FROM ${stage.from} names no Debian codename (node:<version>-<codename>-slim@sha256:… / debian:<codename>-slim@sha256:…)`,
      );
    } else codenames.add(codename);
  }
  if (codenames.size > 1) {
    for (const stage of debianStages) {
      add(
        stage.line,
        `node and debian base codenames differ (${[...codenames].sort().join(', ')}): the copied Node binary needs the glibc of its own Debian release`,
      );
    }
  }

  // (c) a debian-based stage takes exactly the Node binary from the node stage, and mounts nothing from it.
  const nodeSources = new Set(nodeStages.map((stage) => stage.name).filter((name) => name !== undefined));
  const fromNode = (/** @type {string} */ ref) => nodeSources.has(ref.toLowerCase()) || baseImageKind(ref) === 'node';
  /** @type {Set<string>} */
  const debianNames = new Set();
  for (const stage of all) {
    const debian = baseImageKind(stage.from) === 'debian' || debianNames.has(stage.from.toLowerCase());
    if (!debian) continue;
    if (stage.name !== undefined) debianNames.add(stage.name);
    for (const { instruction, args, line } of stage.instructions) {
      if (instruction === 'COPY') {
        const { from, sources, destination } = copyParts(args);
        if (from === undefined || !fromNode(from)) continue;
        if (sources.length !== 1 || sources[0] !== NODE_BINARY || destination !== NODE_BINARY) {
          add(
            line,
            `COPY --from=${from} into a debian stage must copy exactly ${NODE_BINARY} to ${NODE_BINARY} (got ${sources.join(' ')} -> ${destination ?? ''})`,
          );
        }
      } else if (instruction === 'RUN') {
        const flags = /^(?:--\S+\s+)*/.exec(args)?.[0] ?? '';
        for (const [, mountFrom = ''] of flags.matchAll(/--mount=(?:\S*?,)?from=([^,\s]+)/g)) {
          if (fromNode(mountFrom))
            add(line, `RUN --mount from the node stage (${mountFrom}) into a debian stage; copy ${NODE_BINARY} only`);
        }
      }
    }
  }
  return findings;
}

/**
 * runtime-codename (b), repository mode: every `node:` FROM reference, and every `debian:` FROM reference, is
 * byte-identical across the given Dockerfiles. A reference that differs from the most used one (ties: the lowest in
 * sort order) is reported where it occurs.
 * @param {readonly { file: string, text: string }[]} files
 * @returns {{ file: string, finding: Finding }[]}
 */
export function crossFileBaseFindings(files) {
  /** @type {{ file: string, finding: Finding }[]} */
  const out = [];
  for (const kind of /** @type {const} */ (['node', 'debian'])) {
    /** @type {{ file: string, line: number, ref: string }[]} */
    const uses = [];
    for (const { file, text } of files) {
      for (const stage of stages(instructions(text)))
        if (baseImageKind(stage.from) === kind) uses.push({ file, line: stage.line, ref: stage.from });
    }
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const { ref } of uses) counts.set(ref, (counts.get(ref) ?? 0) + 1);
    if (counts.size <= 1) continue;
    const [expected = ''] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0] ?? [];
    for (const { file, line, ref } of uses) {
      if (ref === expected) continue;
      out.push({
        file,
        finding: {
          rule: 'runtime-codename',
          line,
          message: `FROM ${ref} differs from ${expected} used by the other Dockerfiles: every ${kind}: base must be byte-identical (one Dependabot group PR moves them together)`,
        },
      });
    }
  }
  return out;
}

/** The numeric version of a `node:` tag (`node:24.22.3-trixie-slim@…` gives `24.22.3`); undefined for `node:lts-…`. */
const NODE_TAG_VERSION = new RegExp(`${IMAGE_PREFIX}node:(\\d+(?:\\.\\d+){0,2})(?=[-@]|$)`);

/** @param {string} from @returns {string | undefined} */
export function nodeTagVersion(from) {
  return NODE_TAG_VERSION.exec(from)?.[1];
}

/**
 * `MAJOR[.MINOR[.PATCH]]` (an optional leading `v`) as numbers; undefined for anything else (no pre-release, no `x`).
 * @param {string} text @returns {number[] | undefined}
 */
export function versionParts(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return undefined;
  return match
    .slice(1)
    .filter((part) => part !== undefined)
    .map(Number);
}

/** @param {readonly number[]} a @param {readonly number[]} b @returns {number} */
function compareParts(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * One comparator of an engines range against a full version; undefined for a syntax this check does not read.
 * @param {readonly number[]} v @param {string} comparator @returns {boolean | undefined}
 */
function comparatorHolds(v, comparator) {
  const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
  const operator = match?.[1] ?? '=';
  const parts = versionParts(match?.[2] ?? '');
  if (parts === undefined) return undefined;
  const full = parts.length === 3;
  // The first version above a partial one: 24 -> 25, 24.2 -> 24.3 (npm semver x-range semantics).
  const next = [...parts.slice(0, -1), (parts.at(-1) ?? 0) + 1];
  switch (operator) {
    case '>=':
      return compareParts(v, parts) >= 0;
    case '<':
      return compareParts(v, parts) < 0;
    case '>':
      return full ? compareParts(v, parts) > 0 : compareParts(v, next) >= 0;
    case '<=':
      return full ? compareParts(v, parts) <= 0 : compareParts(v, next) < 0;
    default:
      return full ? compareParts(v, parts) === 0 : compareParts(v, parts) >= 0 && compareParts(v, next) < 0;
  }
}

/**
 * Whether a release version satisfies an npm `engines` range, for the subset this repository writes: alternatives
 * joined by `||`, each a space-separated AND of comparators `>=`, `>`, `<=`, `<`, `=` or a bare (possibly partial)
 * version. Partial versions follow npm's semver (`<25` = `<25.0.0`, `>24` = `>=25.0.0`, `<=24` = `<25.0.0`,
 * `24` = `>=24.0.0 <25.0.0`). Returns undefined for any other syntax (`^`, `~`, `x`, `*`, hyphen ranges, pre-releases):
 * the caller fails closed instead of guessing.
 * @param {string} version full `x.y.z` @param {string} range @returns {boolean | undefined}
 */
export function satisfiesEngines(version, range) {
  const v = versionParts(version);
  if (v?.length !== 3 || range.trim() === '') return undefined;
  let any = false;
  for (const alternative of range.split('||')) {
    const comparators = alternative
      .trim()
      .replace(/([<>]=?|=)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean);
    if (comparators.length === 0) return undefined;
    let all = true;
    for (const comparator of comparators) {
      const holds = comparatorHolds(v, comparator);
      if (holds === undefined) return undefined;
      all &&= holds;
    }
    any ||= all;
  }
  return any;
}

/**
 * The Node policy of the repository root: `.node-version` and `engines.node` of package.json (undefined if unreadable).
 * @param {string} root @returns {{ nodeVersion: string | undefined, enginesNode: string | undefined }}
 */
export function readNodePolicy(root) {
  /** @type {string | undefined} */
  let nodeVersion;
  /** @type {string | undefined} */
  let enginesNode;
  try {
    nodeVersion = readFileSync(join(root, '.node-version'), 'utf8').trim();
  } catch {
    nodeVersion = undefined; // reported by nodeMajorFindings (fail closed)
  }
  try {
    const manifest = /** @type {{ engines?: { node?: unknown } }} */ (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    enginesNode = typeof manifest.engines?.node === 'string' ? manifest.engines.node : undefined;
  } catch {
    enginesNode = undefined; // reported by nodeMajorFindings (fail closed)
  }
  return { nodeVersion, enginesNode };
}

/**
 * node-major: every `node:` FROM of the given Dockerfiles has the major of `.node-version` and satisfies `engines.node`.
 * @param {readonly { file: string, text: string }[]} files
 * @param {{ nodeVersion: string | undefined, enginesNode: string | undefined }} policy
 * @returns {{ file: string, finding: Finding }[]}
 */
export function nodeMajorFindings(files, policy) {
  /** @type {{ file: string, finding: Finding }[]} */
  const out = [];
  const major = versionParts(policy.nodeVersion ?? '')?.[0];
  for (const { file, text } of files) {
    for (const stage of stages(instructions(text))) {
      if (baseImageKind(stage.from) !== 'node') continue;
      const add = (/** @type {string} */ message) => out.push({ file, finding: { rule: 'node-major', line: stage.line, message } });
      if (major === undefined) add('.node-version is missing or not MAJOR[.MINOR[.PATCH]]: the node base major cannot be checked');
      if (policy.enginesNode === undefined) add('package.json has no string engines.node: the node base version cannot be checked');
      const version = nodeTagVersion(stage.from);
      const parts = versionParts(version ?? '');
      if (version === undefined || parts === undefined) {
        add(`FROM ${stage.from} has no numeric node version in its tag`);
        continue;
      }
      if (major !== undefined && parts[0] !== major) {
        add(
          `FROM node:${version} is Node ${String(parts[0])} but .node-version is ${String(major)} (ADR-0001; a new major is a reviewed PR with a superseding ADR)`,
        );
      }
      if (policy.enginesNode !== undefined) {
        const holds = satisfiesEngines([0, 1, 2].map((i) => parts[i] ?? 0).join('.'), policy.enginesNode);
        if (holds === undefined) add(`engines.node "${policy.enginesNode}" uses a range syntax this check does not read`);
        else if (!holds)
          add(`FROM node:${version} does not satisfy engines.node "${policy.enginesNode}" (engine-strict rejects it in npm ci)`);
      }
    }
  }
  return out;
}

const ENTRYPOINT_COPY = /^--chmod=0555\s+tools\/docker\/entrypoint\.sh\s+\/app\/entrypoint\.sh$/;

/**
 * entrypoint: an api/worker final stage runs /app/entrypoint.sh (last ENTRYPOINT, exec form) copied read+exec only.
 * @param {Stage} final @returns {Finding[]}
 */
export function entrypointFindings(final) {
  /** @type {Finding[]} */
  const findings = [];
  const entry = final.instructions.filter((i) => i.instruction === 'ENTRYPOINT').at(-1);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(entry?.args ?? '');
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] !== '/app/entrypoint.sh') {
    findings.push({
      rule: 'entrypoint',
      line: entry?.line ?? final.line,
      message: 'the final stage must end with ENTRYPOINT ["/app/entrypoint.sh"]',
    });
  }
  if (!final.instructions.some((i) => i.instruction === 'COPY' && ENTRYPOINT_COPY.test(i.args))) {
    findings.push({
      rule: 'entrypoint',
      line: final.line,
      message: 'the final stage must COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh',
    });
  }
  return findings;
}

/**
 * @param {string} text Dockerfile content
 * @param {{ service?: boolean, nodeService?: boolean, nonSecretNames?: readonly string[] }} [options]
 * @returns {Finding[]}
 */
export function checkDockerfileText(text, options = {}) {
  const allowed = new Set(options.nonSecretNames ?? NON_SECRET_NAMES);
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {string} */ rule, /** @type {number} */ line, /** @type {string} */ message) =>
    findings.push({ rule, line, message });
  const all = stages(instructions(text));
  if (all.length === 0) return [{ rule: 'from-digest', line: 1, message: 'no FROM instruction' }];

  all.forEach((stage, index) => {
    const earlier = all.slice(0, index).some((s) => s.name === stage.from.toLowerCase());
    if (!earlier && !DIGEST_REF.test(stage.from)) add('from-digest', stage.line, `FROM ${stage.from} is not name:tag@sha256:<digest>`);
    let installs = false;
    for (const { instruction, args, line } of stage.instructions) {
      if (instruction === 'COPY' || instruction === 'ADD') {
        for (const source of copySources(args)) {
          const s = source.replace(/\/+$/, '');
          if (s === '' || s === '.' || s === '*' || s === './*')
            add('copy-explicit', line, `${instruction} of the whole context (${source})`);
          if (/^(?:\.\/)?prisma$/.test(s)) add('copy-explicit', line, `${instruction} of the bare prisma directory`);
          if (/(?:^|\/)\.env/.test(s)) add('copy-env', line, `${instruction} of an environment file (${source})`);
        }
      }
      if (instruction === 'ARG' || instruction === 'ENV') {
        for (const [name] of assignments(args)) {
          if (SECRET_NAME.test(name) && !allowed.has(name)) add('secret-name', line, `${instruction} ${name} looks like a secret`);
        }
      }
      if (['RUN', 'CMD', 'ENTRYPOINT', 'HEALTHCHECK'].includes(instruction)) {
        const command = commandText(args);
        if (/(?:^|[\s"'(`;&|])npx(?:\s|$|["'])/.test(command)) add('npx', line, 'npx is not allowed; use npm exec --no -- <bin>');
        if (/\bnpm\s+(?:rebuild|rb)\b/.test(command)) add('npm-rebuild', line, 'npm rebuild is not allowed in Dockerfiles');
        for (const segment of command.split(/&&|\|\||;|\|/)) {
          if (NPM_INSTALL.test(segment)) installs = true;
          // The check-install-flags predicate (R1-n2): `--ignore-scripts false` and the other re-enabling spellings fail.
          for (const npm of npmInvocations(segment)) {
            if (npm.install) installs = true;
            if (npm.overrides.length > 0) {
              add(
                'ignore-scripts',
                line,
                `an npm call re-enables lifecycle scripts or spells ignore-scripts non-canonically (${npm.overrides.join(', ')})`,
              );
            } else if (npm.install && !npm.scriptsOff) add('ignore-scripts', line, 'npm ci/install without --ignore-scripts');
          }
        }
        if (options.nodeService && /--conditions|--experimental-vm-modules/.test(command) && instruction !== 'RUN') {
          add('node-flags', line, `${instruction} carries --conditions or --experimental-vm-modules`);
        }
      }
    }
    if (installs && stage.node && (stage.env.get('CHECKPOINT_DISABLE') !== '1' || stage.env.get('SCARF_ANALYTICS') !== 'false')) {
      add('telemetry-env', stage.line, `stage ${stage.name ?? index} installs without ENV CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false`);
    }
  });

  const final = /** @type {Stage} */ (all.at(-1));
  const user = final.instructions.filter((i) => i.instruction === 'USER').at(-1);
  const who = (user?.args ?? '').split(':')[0] ?? '';
  if (user === undefined || who === '' || who === 'root' || /^0+$/.test(who))
    add('final-user', user?.line ?? final.line, 'the final stage must set a non-root USER');
  if (options.service && !final.instructions.some((i) => i.instruction === 'HEALTHCHECK' && !/^NONE$/i.test(i.args))) {
    add('healthcheck', final.line, 'the final stage of a service image needs a HEALTHCHECK');
  }
  // A Node service runtime may start from a slim OS base plus the copied Node binary (R1-03); it is a Node stage too.
  if ((final.node || options.nodeService === true) && final.env.get('NODE_ENV') !== 'production') {
    add('node-env', final.line, 'a Node final stage must set NODE_ENV=production');
  }
  findings.push(...runtimeCodenameFindings(all));
  if (options.nodeService === true) findings.push(...entrypointFindings(final));
  return findings;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'dist', 'build', 'coverage']);
const SKIP_ROOTED = new Set(['tools/ci/fixtures', 'docs']);

/** Repository-relative paths of every Dockerfile (fixtures excluded). @param {string} root @returns {string[]} */
export function findDockerfiles(root) {
  /** @type {string[]} */
  const out = [];
  const visit = (/** @type {string} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = relative(root, join(dir, entry.name)).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !SKIP_ROOTED.has(rel)) visit(join(dir, entry.name));
      } else if (/^Dockerfile(?:\..+)?$|\.Dockerfile$/.test(entry.name)) out.push(rel);
    }
  };
  visit(root);
  return out.sort();
}

/**
 * Per-file rules plus the cross-file runtime-codename (b) and node-major checks over every scanned Dockerfile.
 * @param {string} root @returns {{ file: string, findings: Finding[] }[]}
 */
export function checkRepository(root) {
  const files = findDockerfiles(root).map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
  const results = files.map(({ file, text }) => ({
    file,
    findings: checkDockerfileText(text, {
      service: SERVICE_DOCKERFILES.includes(file),
      nodeService: NODE_SERVICE_DOCKERFILES.includes(file),
    }),
  }));
  for (const { file, finding } of [...crossFileBaseFindings(files), ...nodeMajorFindings(files, readNodePolicy(root))])
    results.find((result) => result.file === file)?.findings.push(finding);
  return results;
}

if (import.meta.main === true) {
  const rootFlag = process.argv.indexOf('--root');
  const root = resolve(rootFlag > -1 ? (process.argv[rootFlag + 1] ?? '.') : '.');
  const results = checkRepository(root);
  let count = 0;
  for (const { file, findings } of results) {
    for (const f of findings) process.stderr.write(`${file}:${f.line} [${f.rule}] ${f.message}\n`);
    count += findings.length;
  }
  process.stdout.write(`[check-dockerfiles] ${results.length} Dockerfile(s), ${count} finding(s)\n`);
  process.exitCode = count === 0 ? 0 : 1;
}
