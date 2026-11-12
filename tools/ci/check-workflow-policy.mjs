// @ts-check
/**
 * Workflow policy (lane A; ADR-0023 amendments F item 4, H, I item 3, J items 2 (e) and 5; D-ARCH-041, D-ARCH-044;
 * SEC-TC-32, SEC-TC-51, SEC-TC-64; PR1-SEC-02/-08/-12, PR4-SEC-08, PR5-SEC-07; AT-US-005-04/-05).
 *
 * Reads every `.github/workflows/*.{yml,yaml}` with the strict subset parser (`yaml-subset.mjs`; a construct outside
 * the subset is itself a finding) and enforces:
 *   pinned-action         `uses:` is `./local`, `docker://…@sha256:<64 hex>` or `owner/repo[/path]@<40 hex>` with a
 *                         trailing `# vX.Y.Z` comment.
 *   forbidden-trigger     no `pull_request_target`, no `workflow_run`.
 *   permissions           top-level `permissions` present and read-only (`{}` or scopes set to read/none); job-level
 *                         `write` only for the (workflow, job, scope) triples in JOB_WRITE_ALLOWLIST.
 *   workflow-env          NPM_CONFIG_IGNORE_SCRIPTS="true", CHECKPOINT_DISABLE="1", SCARF_ANALYTICS="false" at workflow level.
 *   forbidden-env         Prisma engine redirects (FORBIDDEN_ENV) and PLAYWRIGHT_*DOWNLOAD_HOST in any env map or run script.
 *   ignore-scripts        npm_config_ignore_scripts (any case) set to anything but true; `--ignore-scripts=false`.
 *   node-options-preload  NODE_OPTIONS with --require/-r/--import/--loader/--experimental-loader/--env-file.
 *   tls-verify-disabled   NODE_TLS_REJECT_UNAUTHORIZED=0.
 *   platform-registry     `--@platform:registry=` anywhere but on `npm audit signatures`; any npm_config_@platform:registry env.
 *   audit-signatures-masked  `npm audit signatures … || …`.
 *   continue-on-error     no job or step may set it to anything but false.
 *   npx                   no `npx`/`bunx`/`pnpm dlx`/`yarn dlx`; `npm exec` only as `npm exec --no -- <bin>`.
 *   pr-secrets            pull_request workflows reference no secret except GITHUB_TOKEN and never `secrets: inherit`.
 *   sandbox-secrets       secrets.CARRIER_* / secrets.STRIPE_* only in jobs with `environment: carrier-sandbox`; no
 *                         pull_request/push workflow references that environment (SEC-TC-51).
 *   secrets-dump          no `toJSON(secrets)`.
 *   image-digest          `*_IMAGE` env values, `container`/`services` images and `docker run` images are pinned by digest.
 *   job-timeout           every job (except reusable-workflow calls) sets `timeout-minutes`.
 *   ci-no-release         in ci.yml: no `npm publish`, no `terraform apply|destroy`, no AWS role or deploy, no
 *                         `id-token: write`; image pushes only in a job `images` gated on dispatch/main/tags.
 *
 * CLI: node tools/ci/check-workflow-policy.mjs [--root <dir>] [--summary <file>] [--json] [files...]
 * Exit 0 pass, 1 findings, 2 usage/internal error.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { YamlSubsetError, deepStrings, isMap, parseYamlSubset } from './yaml-subset.mjs';

/** @typedef {import('./yaml-subset.mjs').YamlNode} YamlNode */
/** @typedef {import('./yaml-subset.mjs').YamlMap} YamlMap */
/** @typedef {{ rule: string, message: string, location: string }} Finding */

/** Engine-redirecting variables (ADR-0023 am. J item 2 (c); superset of tools/deps/prisma-engines.mjs FORBIDDEN_ENGINE_ENV). */
export const FORBIDDEN_ENV = Object.freeze([
  'PRISMA_ENGINES_MIRROR',
  'PRISMA_BINARIES_MIRROR',
  'PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING',
  'BINARY_DOWNLOAD_VERSION',
  'PRISMA_SCHEMA_ENGINE_BINARY',
  'PRISMA_MIGRATION_ENGINE_BINARY',
  'PRISMA_CLI_BINARY_TARGETS',
  'PRISMA_QUERY_ENGINE_LIBRARY',
  'PRISMA_QUERY_ENGINE_BINARY',
  'PRISMA_FMT_BINARY',
]);

/** Playwright browser download redirects (PR4-SEC-08): PLAYWRIGHT_DOWNLOAD_HOST and the per-browser variants. */
const PLAYWRIGHT_HOST = /^PLAYWRIGHT_(?:[A-Z]+_)?DOWNLOAD_HOST$/;

export const REQUIRED_WORKFLOW_ENV = Object.freeze({
  NPM_CONFIG_IGNORE_SCRIPTS: 'true',
  CHECKPOINT_DISABLE: '1',
  SCARF_ANALYTICS: 'false',
});

/**
 * Job-level `write` grants that are allowed, as `<workflow file>:<job id>:<scope>`. ADR-0023 am. F item 4: `images` is the
 * only ci.yml job holding `packages: write`. Owning tasks extend this list in a reviewed change (CODEOWNERS on tools/ci).
 */
export const JOB_WRITE_ALLOWLIST = Object.freeze(['ci.yml:images:packages']);

const SANDBOX_ENVIRONMENT = 'carrier-sandbox';
const SANDBOX_SECRET = /secrets(?:\.|\[\s*['"])(?:CARRIER|STRIPE)_/;
const ANY_SECRET = /secrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])/g;
const PINNED_USES = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/;
const VERSION_COMMENT = /#\s*v?\d+(?:\.\d+){0,2}\S*\s*$/;
const DIGEST = /@sha256:[0-9a-f]{64}\b/;
const PRELOAD = /(?:^|\s)(?:--require|-r|--import|--loader|--experimental-loader|--env-file)(?:[=\s]|$)/;

/**
 * Splits a shell script into command segments: joins `\` continuations and splits on `&&`, `||`, `;` and `|`
 * outside quotes. Each segment keeps the operator that FOLLOWS it, so `x || true` is detectable.
 * @param {string} script
 * @returns {{ text: string, next: string }[]}
 */
export function shellSegments(script) {
  const joined = script.replace(/\\\r?\n/g, ' ');
  /** @type {{ text: string, next: string }[]} */
  const out = [];
  for (const line of joined.split(/\r?\n/)) {
    let current = '';
    /** @type {string | null} */
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line.charAt(i);
      if (quote !== null) {
        if (c === quote) quote = null;
        current += c;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        current += c;
        continue;
      }
      if (c === '#' && (i === 0 || /\s/.test(line.charAt(i - 1)))) break;
      const two = line.slice(i, i + 2);
      if (two === '&&' || two === '||') {
        out.push({ text: current.trim(), next: two });
        current = '';
        i += 1;
      } else if (c === ';' || c === '|') {
        out.push({ text: current.trim(), next: c });
        current = '';
      } else current += c;
    }
    out.push({ text: current.trim(), next: '' });
  }
  return out.filter((segment) => segment.text !== '' || segment.next !== '');
}

/** @param {YamlNode | undefined} node */
const asMap = (node) => (isMap(node) ? node : undefined);
/** @param {YamlNode | undefined} node */
const asString = (node) => (typeof node === 'string' ? node : undefined);

/**
 * @param {YamlNode | undefined} on
 * @returns {Set<string>}
 */
export function triggersOf(on) {
  if (typeof on === 'string') return new Set([on]);
  if (Array.isArray(on)) return new Set(on.filter((item) => typeof item === 'string'));
  if (isMap(on)) return new Set(Object.keys(on));
  return new Set();
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {{ rule: string, message: string }[]}
 */
function envEntryFindings(name, value) {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  if (FORBIDDEN_ENV.includes(name) || PLAYWRIGHT_HOST.test(name)) {
    out.push({ rule: 'forbidden-env', message: `${name} redirects a binary download or engine path and is not allowed in workflows` });
  }
  if (/^npm_config_ignore_scripts$/i.test(name) && value.trim().toLowerCase() !== 'true') {
    out.push({ rule: 'ignore-scripts', message: `${name} must stay "true" (got "${value}")` });
  }
  if (/^npm_config_@platform:registry$/i.test(name)) {
    out.push({ rule: 'platform-registry', message: `${name} overrides the @platform scope pin (PR1-SEC-12)` });
  }
  if (name === 'NODE_OPTIONS' && PRELOAD.test(value)) {
    out.push({ rule: 'node-options-preload', message: 'NODE_OPTIONS must not preload code (--require/--import/--loader/--env-file)' });
  }
  if (name === 'NODE_TLS_REJECT_UNAUTHORIZED' && value.trim() === '0') {
    out.push({ rule: 'tls-verify-disabled', message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification' });
  }
  if (/_IMAGE$/.test(name) && value !== '' && !DIGEST.test(value) && !value.includes('${{')) {
    out.push({ rule: 'image-digest', message: `${name} must pin its image by @sha256 digest` });
  }
  return out;
}

/**
 * Findings for one shell script (`run:`).
 * @param {string} script
 * @param {boolean} isCi
 * @returns {{ rule: string, message: string }[]}
 */
export function scriptFindings(script, isCi) {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  for (const name of FORBIDDEN_ENV) {
    if (new RegExp(`\\b${name}\\s*=`).test(script)) out.push({ rule: 'forbidden-env', message: `${name} is set in a run script` });
  }
  const playwright = /\b(PLAYWRIGHT_(?:[A-Z]+_)?DOWNLOAD_HOST)\s*=/.exec(script);
  if (playwright) out.push({ rule: 'forbidden-env', message: `${playwright[1] ?? 'PLAYWRIGHT_DOWNLOAD_HOST'} is set in a run script` });
  const ignore = /\bnpm_config_ignore_scripts\s*=\s*["']?([^\s"';]*)/i.exec(script);
  if (ignore && (ignore[1] ?? '').toLowerCase() !== 'true') {
    out.push({ rule: 'ignore-scripts', message: 'npm_config_ignore_scripts is overridden in a run script' });
  }
  if (/--ignore-scripts=(?:false|0|no)\b|--no-ignore-scripts\b/i.test(script)) {
    out.push({ rule: 'ignore-scripts', message: 'a command re-enables lifecycle scripts' });
  }
  if (/\bnpm_config_@platform:registry\s*=/i.test(script)) {
    out.push({ rule: 'platform-registry', message: 'npm_config_@platform:registry is set in a run script (PR1-SEC-12)' });
  }
  const nodeOptions = /\bNODE_OPTIONS\s*=\s*(["']?)([^\n]*)/.exec(script);
  if (nodeOptions && PRELOAD.test(nodeOptions[2] ?? '')) {
    out.push({ rule: 'node-options-preload', message: 'NODE_OPTIONS must not preload code (--require/--import/--loader/--env-file)' });
  }
  if (/\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0\b/.test(script)) {
    out.push({ rule: 'tls-verify-disabled', message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification' });
  }
  for (const segment of shellSegments(script)) {
    const text = segment.text;
    const signatures = /^(?:\S+=\S*\s+)*npm\s+audit\s+signatures\b/.test(text);
    if (/--@platform:registry\b/.test(text) && !signatures) {
      out.push({
        rule: 'platform-registry',
        message: `--@platform:registry= is allowed only on \`npm audit signatures\` (PR1-SEC-12): "${text.slice(0, 80)}"`,
      });
    }
    if (signatures && segment.next === '||') {
      out.push({ rule: 'audit-signatures-masked', message: '`npm audit signatures` must not be masked with `|| …` (PR1-SEC-12)' });
    }
    if (/(?:^|[\s(`$])(?:npx|bunx)(?:\s|$)|\b(?:pnpm|yarn)\s+dlx\b/.test(text)) {
      out.push({ rule: 'npx', message: `use \`npm exec --no -- <bin>\` instead of npx (SEC-TC-64): "${text.slice(0, 80)}"` });
    }
    if (/\bnpm\s+(?:exec|x|exe)\b/.test(text) && !/\bnpm\s+exec\s+--no\s+--\s/.test(text)) {
      out.push({ rule: 'npx', message: `\`npm exec\` must be \`npm exec --no -- <bin>\` (SEC-TC-64): "${text.slice(0, 80)}"` });
    }
    if (/\bdocker\s+run\b/.test(text) && !DIGEST.test(text) && !/\$\{?[A-Z0-9_]*_IMAGE\b/.test(text)) {
      out.push({
        rule: 'image-digest',
        message: `docker run must use an image pinned by digest or a *_IMAGE variable: "${text.slice(0, 80)}"`,
      });
    }
    if (isCi) {
      if (/\bnpm\s+publish\b/.test(text)) out.push({ rule: 'ci-no-release', message: 'ci.yml must not publish packages (AT-US-005-04)' });
      if (/\b(?:terraform|tofu)\b(?:\s+-\S+)*\s+(?:apply|destroy)\b/.test(text))
        out.push({ rule: 'ci-no-release', message: 'ci.yml must not run terraform apply/destroy (AT-US-005-05)' });
      if (/\baws\s+(?:sts\s+assume-role|ecs\s+(?:update-service|deploy)|deploy\b|cloudformation\s+deploy)/.test(text)) {
        out.push({ rule: 'ci-no-release', message: 'ci.yml must not deploy to AWS or assume an AWS role (AT-US-005-05)' });
      }
    }
  }
  return out;
}

/**
 * @param {YamlMap} job
 * @returns {boolean} true when the job's `if:` restricts it to dispatch, main or tags (lane C image publication).
 */
function imagePushGuarded(job) {
  const condition = asString(job.if) ?? '';
  if (/pull_request/.test(condition) && !/!=\s*'pull_request'/.test(condition)) return false;
  return /github\.event_name\s*==\s*'workflow_dispatch'|github\.ref\s*==\s*'refs\/heads\/main'|startsWith\(github\.ref,\s*'refs\/tags\/'\)/.test(
    condition,
  );
}

/**
 * @param {string} text workflow file content
 * @param {string} fileName base name, e.g. `ci.yml` (ci.yml gets the AT-US-005-04/-05 rules)
 * @returns {Finding[]}
 */
export function checkWorkflow(text, fileName) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {import('./yaml-subset.mjs').ParsedYaml} */
  let parsed;
  try {
    parsed = parseYamlSubset(text);
  } catch (error) {
    if (error instanceof YamlSubsetError) {
      return [{ rule: 'yaml-subset', message: error.message, location: `${fileName}:${error.line}` }];
    }
    throw error;
  }
  const rawLines = text.split(/\r?\n/);
  const lineOf = (/** @type {string[]} */ path) => {
    for (let n = path.length; n > 0; n -= 1) {
      const line = parsed.lines.get(path.slice(0, n).join('.'));
      if (line !== undefined) return line;
    }
    return 1;
  };
  const add = (/** @type {string} */ rule, /** @type {string} */ message, /** @type {string[]} */ path) =>
    findings.push({ rule, message, location: `${fileName}:${lineOf(path)}${path.length > 0 ? ` ${path.join('.')}` : ''}` });

  const doc = asMap(parsed.value ?? undefined);
  if (doc === undefined) return [{ rule: 'yaml-subset', message: 'workflow is not a mapping', location: `${fileName}:1` }];
  const isCi = fileName === 'ci.yml' || fileName === 'ci.yaml';
  const triggers = triggersOf(doc.on);
  const prTriggered = triggers.has('pull_request') || triggers.has('pull_request_target');

  for (const event of ['pull_request_target', 'workflow_run']) {
    if (triggers.has(event)) add('forbidden-trigger', `trigger "${event}" runs with elevated privileges and is not allowed`, ['on']);
  }

  // permissions
  const top = doc.permissions;
  if (top === undefined) add('permissions', 'top-level `permissions` is required (least privilege)', []);
  else if (typeof top === 'string')
    add('permissions', `top-level permissions "${top}" is too broad; use \`contents: read\` or \`{}\``, ['permissions']);
  else if (isMap(top)) {
    for (const [scope, level] of Object.entries(top)) {
      if (level !== 'read' && level !== 'none')
        add('permissions', `top-level permission ${scope}: ${String(level)} must be read or none`, ['permissions', scope]);
    }
  }

  // workflow-level env
  const workflowEnv = asMap(doc.env) ?? {};
  for (const [name, value] of Object.entries(REQUIRED_WORKFLOW_ENV)) {
    if (workflowEnv[name] !== value) add('workflow-env', `workflow-level env ${name}: "${value}" is required (D-ARCH-044)`, ['env']);
  }
  const checkEnvMap = (/** @type {YamlNode | undefined} */ node, /** @type {string[]} */ path) => {
    const map = asMap(node);
    if (map === undefined) return;
    for (const [name, value] of Object.entries(map)) {
      for (const f of envEntryFindings(name, typeof value === 'string' ? value : '')) add(f.rule, f.message, [...path, name]);
    }
  };
  checkEnvMap(doc.env, ['env']);
  for (const value of deepStrings(doc.env)) {
    if (SANDBOX_SECRET.test(value))
      add('sandbox-secrets', 'carrier/Stripe secrets must not be exposed at workflow level (SEC-TC-51)', ['env']);
  }
  if (deepStrings(doc).some((value) => /toJSON\(\s*secrets\s*\)/.test(value)))
    add('secrets-dump', 'toJSON(secrets) exposes every secret', []);

  const jobs = asMap(doc.jobs) ?? {};
  for (const [jobId, jobNode] of Object.entries(jobs)) {
    const job = asMap(jobNode);
    const jobPath = ['jobs', jobId];
    if (job === undefined) {
      add('yaml-subset', `job ${jobId} is not a mapping`, jobPath);
      continue;
    }
    const reusable = typeof job.uses === 'string';
    if (!reusable && job['timeout-minutes'] === undefined) add('job-timeout', `job ${jobId} must set timeout-minutes`, jobPath);
    if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== 'false') {
      add('continue-on-error', `job ${jobId} must not continue on error (gate jobs fail closed)`, [...jobPath, 'continue-on-error']);
    }

    const perms = job.permissions;
    if (typeof perms === 'string' && perms !== '')
      add('permissions', `job permissions "${perms}" is too broad`, [...jobPath, 'permissions']);
    if (isMap(perms)) {
      for (const [scope, level] of Object.entries(perms)) {
        if (level === 'write' && !JOB_WRITE_ALLOWLIST.includes(`${fileName}:${jobId}:${scope}`)) {
          add('permissions', `job ${jobId} must not hold ${scope}: write (not in JOB_WRITE_ALLOWLIST)`, [...jobPath, 'permissions', scope]);
        }
        if (isCi && scope === 'id-token' && level === 'write')
          add('ci-no-release', 'ci.yml must not request id-token: write (no AWS role, AT-US-005-05)', [...jobPath, 'permissions', scope]);
      }
    }

    // environment / secrets
    const environment = isMap(job.environment) ? asString(job.environment.name) : asString(job.environment);
    const jobStrings = deepStrings(job);
    if (environment === SANDBOX_ENVIRONMENT && (prTriggered || triggers.has('push'))) {
      add('sandbox-secrets', `a pull_request/push workflow must not reference environment ${SANDBOX_ENVIRONMENT} (SEC-TC-51)`, [
        ...jobPath,
        'environment',
      ]);
    }
    if (environment !== SANDBOX_ENVIRONMENT && jobStrings.some((value) => SANDBOX_SECRET.test(value))) {
      add('sandbox-secrets', `secrets.CARRIER_*/STRIPE_* only in jobs with environment ${SANDBOX_ENVIRONMENT} (SEC-TC-51)`, jobPath);
    }
    if (prTriggered) {
      if (job.secrets === 'inherit') add('pr-secrets', 'pull_request workflows must not pass `secrets: inherit`', [...jobPath, 'secrets']);
      for (const value of jobStrings) {
        for (const match of value.matchAll(ANY_SECRET)) {
          const name = match[1] ?? match[2] ?? '';
          if (name !== 'GITHUB_TOKEN')
            add('pr-secrets', `pull_request jobs use GITHUB_TOKEN only (found secrets.${name}; ADR-0023 am. H)`, jobPath);
        }
      }
    }

    checkEnvMap(job.env, [...jobPath, 'env']);
    const container = asMap(job.container);
    checkEnvMap(container?.env, [...jobPath, 'container', 'env']);
    const containerImage = typeof job.container === 'string' ? job.container : asString(container?.image);
    if (containerImage !== undefined && !DIGEST.test(containerImage))
      add('image-digest', 'job container image must be pinned by digest', [...jobPath, 'container']);
    for (const [serviceId, serviceNode] of Object.entries(asMap(job.services) ?? {})) {
      const service = asMap(serviceNode);
      checkEnvMap(service?.env, [...jobPath, 'services', serviceId, 'env']);
      const image = asString(service?.image);
      if (image !== undefined && !DIGEST.test(image))
        add('image-digest', `service ${serviceId} image must be pinned by digest`, [...jobPath, 'services', serviceId]);
    }

    /** @type {[YamlNode | undefined, string[]][]} */
    const usesSites = [[job.uses, [...jobPath, 'uses']]];
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const [index, stepNode] of steps.entries()) {
      const step = asMap(stepNode);
      const stepPath = [...jobPath, 'steps', String(index)];
      if (step === undefined) continue;
      usesSites.push([step.uses, [...stepPath, 'uses']]);
      checkEnvMap(step.env, [...stepPath, 'env']);
      if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== 'false') {
        add('continue-on-error', 'steps must not continue on error (gate steps fail closed)', [...stepPath, 'continue-on-error']);
      }
      const run = asString(step.run);
      if (run !== undefined) {
        for (const f of scriptFindings(run, isCi)) add(f.rule, f.message, [...stepPath, 'run']);
        if (isCi && /\bdocker\s+(?:push|buildx\s+build\b[^\n]*--push)\b/.test(run) && !(jobId === 'images' && imagePushGuarded(job))) {
          add('ci-no-release', 'ci.yml pushes images only from the `images` job gated on dispatch/main/tags (AT-US-005-04)', [
            ...stepPath,
            'run',
          ]);
        }
      }
      const uses = asString(step.uses) ?? '';
      const withMap = asMap(step.with) ?? {};
      if (isCi && /^aws-actions\/configure-aws-credentials@/.test(uses))
        add('ci-no-release', 'ci.yml must not assume an AWS role (AT-US-005-05)', [...stepPath, 'uses']);
      if (isCi && withMap['role-to-assume'] !== undefined)
        add('ci-no-release', 'ci.yml must not assume an AWS role (AT-US-005-05)', [...stepPath, 'with']);
      if (
        isCi &&
        /^docker\/build-push-action@/.test(uses) &&
        withMap.push !== undefined &&
        withMap.push !== 'false' &&
        !(jobId === 'images' && imagePushGuarded(job))
      ) {
        add('ci-no-release', 'ci.yml pushes images only from the `images` job gated on dispatch/main/tags (AT-US-005-04)', [
          ...stepPath,
          'with',
          'push',
        ]);
      }
    }

    for (const [usesNode, path] of usesSites) {
      const uses = asString(usesNode);
      if (uses === undefined) continue;
      const line = rawLines[lineOf(path) - 1] ?? '';
      if (uses.startsWith('./')) continue;
      if (uses.startsWith('docker://')) {
        if (!DIGEST.test(uses)) add('pinned-action', `${uses} must be pinned by @sha256 digest`, path);
        continue;
      }
      if (!PINNED_USES.test(uses)) add('pinned-action', `${uses} must be pinned by a full 40-character commit SHA`, path);
      else if (!VERSION_COMMENT.test(line))
        add('pinned-action', `${uses} needs a trailing "# vX.Y.Z" comment naming the pinned release`, path);
    }
  }
  return findings;
}

/**
 * @param {string} root
 * @param {string[]} [files] explicit workflow files (default: every .github/workflows/*.yml|yaml)
 * @returns {{ findings: Finding[], checked: string[] }}
 */
export function checkWorkflowPolicy(root, files) {
  const dir = join(root, '.github', 'workflows');
  const list =
    files && files.length > 0
      ? files.map((file) => resolve(root, file))
      : existsSync(dir)
        ? readdirSync(dir)
            .filter((name) => /\.ya?ml$/.test(name))
            .sort()
            .map((name) => join(dir, name))
        : [];
  /** @type {Finding[]} */
  const findings = [];
  for (const file of list) {
    const label = relative(root, file).replaceAll('\\', '/');
    for (const f of checkWorkflow(readFileSync(file, 'utf8'), basename(file))) {
      findings.push({ ...f, location: f.location.replace(basename(file), label) });
    }
  }
  return { findings, checked: list.map((file) => relative(root, file).replaceAll('\\', '/')) };
}

/**
 * @param {string[]} argv
 * @returns {{ root: string, summary?: string, json: boolean, files: string[] }}
 */
function parseArgs(argv) {
  /** @type {{ root: string, summary?: string, json: boolean, files: string[] }} */
  const options = { root: process.cwd(), json: false, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--root' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--root') options.root = resolve(value);
      else options.summary = value;
      i += 1;
    } else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

/** @param {string[]} argv */
export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-workflow-policy: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const { findings, checked } = checkWorkflowPolicy(options.root, options.files);
  if (options.json) console.log(JSON.stringify({ checked, findings }, null, 2));
  else for (const f of findings) console.log(`${f.rule}: ${f.message} (${f.location})`);
  if (options.summary) {
    const verdict = findings.length === 0 ? 'pass' : `**${findings.length} finding(s)**`;
    appendFileSync(
      options.summary,
      `\n### Workflow policy: ${verdict}\n\nChecked: ${checked.map((c) => `\`${c}\``).join(', ') || 'none'}\n`,
    );
  }
  if (checked.length === 0) console.log('check-workflow-policy: no workflow files found');
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-workflow-policy: internal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
