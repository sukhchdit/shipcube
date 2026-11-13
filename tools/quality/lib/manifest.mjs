// @ts-check
/**
 * Required-suite manifest reader and suite selection (ADR-0023 amendments C and G items 2-4; TEST-STRATEGY section 4.3
 * and 9.2; D-QA-001, SEC-P3-07, SEC-P3-31). Shared by the lane B runner (`heavy.mjs`) and the verifier
 * (`check-evidence.mjs`); pure functions except `loadManifest`, which reads one file.
 *
 * Glob dialect (anchored at the repository root, `/`-separated, case-sensitive):
 * - `**` as a whole segment matches zero or more segments;
 * - `*` inside a segment matches any run of characters except `/`;
 * - a leading `!` negates the glob; callers (`globsMatch`) apply negations, `matchGlob` never sees them.
 * Matching uses a two-pointer wildcard algorithm (no regular expression is built from manifest text), so a hostile
 * glob cannot cause catastrophic backtracking: the cost is bounded by O(path segments x glob segments x segment
 * length squared).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Manifest location relative to the repository root (canonical since T-QA-01, D-QA-001). */
export const MANIFEST_PATH = 'tools/quality/required-suites.json';

/** Profiles in ascending strength: evidence of a stronger profile satisfies a weaker one. */
export const PROFILES = /** @type {const} */ (['pr', 'wave', 'gate']);

const SUITE_STATUSES = new Set(['planned', 'active', 'opt-in']);
const PROFILE_MIN = new Set(['none', 'pr', 'wave', 'gate']);
const SUITE_ID = /^[a-z0-9][a-z0-9-]*$/;
const CASE_ID = /^SEC-TC-[0-9]{2,3}$/;
const DECISION_ID = /^D-[A-Z0-9][A-Z0-9-]*$/;
const ENV_PREFIX = /^[A-Z][A-Z0-9_]*$/;
const GLOB_TEXT = /^!?[A-Za-z0-9._*/-]+$/;
const MAX_GLOB_LENGTH = 200;
const MAX_PATH_LENGTH = 4096;

/**
 * @typedef {'pr' | 'wave' | 'gate'} Profile
 * @typedef {{ status: 'planned' | 'active' | 'opt-in', security: boolean, zero_skip: boolean, min_tests: number,
 *   required_cases: string[], lane: string[], journeys_required_at_gate?: string[] }} Suite
 * @typedef {{ id: string, globs: string[], exclude: string[], profile_min: 'none' | Profile, suites: string[] }} PathRule
 * @typedef {{ suite: string, decision: string }} Deferral
 * @typedef {{
 *   manifest_version: 1,
 *   rules: { invalid_env_prefixes: string[], recorded_env_prefixes: string[], clean_tree_paths: string[] },
 *   tooling_inputs: string[],
 *   security_critical_paths: string[],
 *   deferred_at_gate: Deferral[],
 *   suites: Record<string, Suite>,
 *   profiles: Record<Profile, { always: string[] }>,
 *   path_rules: PathRule[],
 * }} Manifest
 */

export class ManifestError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {(item: string) => boolean} [accept]
 * @returns {string[]}
 */
function stringArray(value, where, accept) {
  if (!Array.isArray(value)) throw new ManifestError(`${where} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== 'string' || (accept !== undefined && !accept(item)))
      throw new ManifestError(`${where}[${index}] is not an accepted string: ${JSON.stringify(item)}`);
    return item;
  });
}

/** @param {string} glob */
function isGlob(glob) {
  return glob.length <= MAX_GLOB_LENGTH && GLOB_TEXT.test(glob) && !glob.split('/').includes('..');
}

/**
 * Structural validation of a parsed manifest. Unknown suite references, statuses or profile names throw: a manifest the
 * verifier does not understand must never be read as "nothing required".
 * @param {unknown} raw
 * @returns {Manifest}
 */
export function parseManifest(raw) {
  if (!isRecord(raw)) throw new ManifestError('manifest must be a JSON object');
  if (raw.manifest_version !== 1) throw new ManifestError(`unsupported manifest_version ${JSON.stringify(raw.manifest_version)}`);
  const rules = raw.rules;
  if (!isRecord(rules)) throw new ManifestError('rules must be an object');
  const envPrefix = (/** @type {string} */ p) => p.length > 0 && ENV_PREFIX.test(p);
  const parsedRules = {
    invalid_env_prefixes: stringArray(rules.invalid_env_prefixes, 'rules.invalid_env_prefixes', envPrefix),
    recorded_env_prefixes: stringArray(rules.recorded_env_prefixes, 'rules.recorded_env_prefixes', envPrefix),
    clean_tree_paths: stringArray(rules.clean_tree_paths, 'rules.clean_tree_paths', isGlob),
  };
  if (!isRecord(raw.suites)) throw new ManifestError('suites must be an object');
  /** @type {Record<string, Suite>} */
  const suites = {};
  for (const [name, value] of Object.entries(raw.suites)) {
    if (!SUITE_ID.test(name)) throw new ManifestError(`suite id ${JSON.stringify(name)} is not [a-z0-9-]`);
    if (!isRecord(value)) throw new ManifestError(`suites.${name} must be an object`);
    const { status, security, zero_skip: zeroSkip, min_tests: minTests } = value;
    if (typeof status !== 'string' || !SUITE_STATUSES.has(status))
      throw new ManifestError(`suites.${name}.status ${JSON.stringify(status)} is not planned|active|opt-in`);
    if (typeof security !== 'boolean' || typeof zeroSkip !== 'boolean')
      throw new ManifestError(`suites.${name}.security and zero_skip must be booleans`);
    if (typeof minTests !== 'number' || !Number.isInteger(minTests) || minTests < 0)
      throw new ManifestError(`suites.${name}.min_tests must be a non-negative integer`);
    /** @type {Suite} */
    const suite = {
      status: /** @type {Suite['status']} */ (status),
      security,
      zero_skip: zeroSkip,
      min_tests: minTests,
      required_cases: stringArray(value.required_cases, `suites.${name}.required_cases`, (id) => CASE_ID.test(id)),
      lane: stringArray(value.lane, `suites.${name}.lane`),
    };
    if (value.journeys_required_at_gate !== undefined)
      suite.journeys_required_at_gate = stringArray(value.journeys_required_at_gate, `suites.${name}.journeys_required_at_gate`);
    suites[name] = suite;
  }
  const known = (/** @type {string} */ id) => Object.hasOwn(suites, id);
  if (!isRecord(raw.profiles)) throw new ManifestError('profiles must be an object');
  /** @type {Partial<Record<Profile, { always: string[] }>>} */
  const profiles = {};
  for (const profile of PROFILES) {
    const entry = raw.profiles[profile];
    if (!isRecord(entry)) throw new ManifestError(`profiles.${profile} is missing`);
    profiles[profile] = { always: stringArray(entry.always, `profiles.${profile}.always`, known) };
  }
  if (!Array.isArray(raw.path_rules)) throw new ManifestError('path_rules must be an array');
  const pathRules = raw.path_rules.map((rule, index) => {
    if (!isRecord(rule)) throw new ManifestError(`path_rules[${index}] must be an object`);
    if (typeof rule.id !== 'string') throw new ManifestError(`path_rules[${index}].id must be a string`);
    if (typeof rule.profile_min !== 'string' || !PROFILE_MIN.has(rule.profile_min))
      throw new ManifestError(`path_rules[${index}].profile_min ${JSON.stringify(rule.profile_min)} is not none|pr|wave|gate`);
    return {
      id: rule.id,
      globs: stringArray(rule.globs, `path_rules[${index}].globs`, isGlob),
      exclude: rule.exclude === undefined ? [] : stringArray(rule.exclude, `path_rules[${index}].exclude`, isGlob),
      profile_min: /** @type {PathRule['profile_min']} */ (rule.profile_min),
      suites: stringArray(rule.suites, `path_rules[${index}].suites`, known),
    };
  });
  const deferred = raw.deferred_at_gate ?? [];
  if (!Array.isArray(deferred)) throw new ManifestError('deferred_at_gate must be an array');
  const deferredAtGate = deferred.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.suite !== 'string' || !known(entry.suite))
      throw new ManifestError(`deferred_at_gate[${index}] must be { suite: <manifest suite>, decision: <D-...> }`);
    if (typeof entry.decision !== 'string' || !DECISION_ID.test(entry.decision))
      throw new ManifestError(`deferred_at_gate[${index}].decision must be a DECISIONS.md ID (D-...)`);
    return { suite: entry.suite, decision: entry.decision };
  });
  return {
    manifest_version: 1,
    rules: parsedRules,
    tooling_inputs: stringArray(raw.tooling_inputs, 'tooling_inputs', isGlob),
    security_critical_paths: stringArray(raw.security_critical_paths ?? [], 'security_critical_paths', isGlob),
    deferred_at_gate: deferredAtGate,
    suites,
    profiles: /** @type {Manifest['profiles']} */ (profiles),
    path_rules: pathRules,
  };
}

/**
 * Reads and validates a manifest file.
 * @param {string} file
 * @returns {Manifest}
 */
export function loadManifest(file) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ManifestError(`cannot read manifest ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseManifest(raw);
}

/**
 * The manifest of a repository root.
 * @param {string} root
 */
export function manifestFile(root) {
  return join(root, ...MANIFEST_PATH.split('/'));
}

/**
 * `*` wildcard match of one path segment (no `/` inside either argument).
 * @param {string} text
 * @param {string} pattern
 */
function matchSegment(text, pattern) {
  let t = 0;
  let p = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === text[t]) {
      t += 1;
      p += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      starP = p;
      starT = t;
      p += 1;
    } else if (starP !== -1) {
      p = starP + 1;
      starT += 1;
      t = starT;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/**
 * Anchored glob match of a repository-relative path (`\` is normalised to `/`). The glob must not carry a `!`.
 * @param {string} path
 * @param {string} glob
 */
export function matchGlob(path, glob) {
  if (glob.startsWith('!')) throw new ManifestError(`matchGlob does not take negated globs (${glob})`);
  if (path.length > MAX_PATH_LENGTH || glob.length > MAX_GLOB_LENGTH) return false;
  const text = path.replaceAll('\\', '/').split('/');
  const pattern = glob.split('/');
  let t = 0;
  let p = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '**' && matchSegment(/** @type {string} */ (text[t]), /** @type {string} */ (pattern[p]))) {
      t += 1;
      p += 1;
    } else if (p < pattern.length && pattern[p] === '**') {
      starP = p;
      starT = t;
      p += 1;
    } else if (starP !== -1) {
      p = starP + 1;
      starT += 1;
      t = starT;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '**') p += 1;
  return p === pattern.length;
}

/**
 * True when the path matches at least one positive glob and no `!` glob of the list.
 * @param {string} path
 * @param {readonly string[]} globs
 */
export function globsMatch(path, globs) {
  let positive = false;
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (matchGlob(path, glob.slice(1))) return false;
    } else if (!positive && matchGlob(path, glob)) positive = true;
  }
  return positive;
}

/**
 * @param {string} path
 * @param {PathRule} rule
 */
export function ruleMatches(path, rule) {
  return globsMatch(path, rule.globs) && !rule.exclude.some((glob) => matchGlob(path, glob.replace(/^!/, '')));
}

/**
 * Clean-tree paths of ADR-0023 amendment G item 3 (`rules.clean_tree_paths`, `!` entries exclude).
 * @param {string} path
 * @param {Manifest} manifest
 */
export function isCleanTreePath(path, manifest) {
  return globsMatch(path, manifest.rules.clean_tree_paths);
}

/**
 * Staleness allow-list of ADR-0023 amendment G item 4: `docs/**` minus `docs/03-architecture/api/**` minus every
 * `tooling_inputs` glob. A change outside it between the evidence SHA and the head makes the evidence stale.
 * @param {string} path
 * @param {Manifest} manifest
 */
export function stalenessAllowed(path, manifest) {
  return (
    matchGlob(path, 'docs/**') &&
    !matchGlob(path, 'docs/03-architecture/api/**') &&
    !manifest.tooling_inputs.some((glob) => matchGlob(path, glob.replace(/^!/, '')))
  );
}

/**
 * @param {string} value
 * @returns {value is Profile}
 */
export function isProfile(value) {
  return /** @type {readonly string[]} */ (PROFILES).includes(value);
}

/**
 * @param {Profile} have
 * @param {Profile} need
 */
export function profileSatisfies(have, need) {
  return PROFILES.indexOf(have) >= PROFILES.indexOf(need);
}

/**
 * Suite selection.
 *
 * - `pr`: when every changed path is lane-A-only (it matches at least one path rule and every rule it matches has
 *   `profile_min: "none"`, i.e. `docs/**` minus the tooling inputs, or `.github/**`), nothing is selected. Otherwise
 *   the selection is `profiles.pr.always` plus the suites of every path rule (with `profile_min` `pr`) that matches at
 *   least one changed path (`!` globs and `exclude` respected).
 * - `wave`, `gate`: the profile's suite set (`profiles.<p>.always`); changed paths are not consulted.
 *
 * `required` = the selected suites whose status is `active`; `planned` = the selected suites still `planned`;
 * `opt-in` suites are never selected. Both lists are sorted and de-duplicated.
 * @param {Manifest} manifest
 * @param {{ profile: Profile, changedPaths: readonly string[] }} options
 * @returns {{ required: string[], planned: string[], rules: string[] }}
 */
export function selectSuites(manifest, { profile, changedPaths }) {
  /** @type {Set<string>} */
  const selected = new Set();
  /** @type {Set<string>} */
  const firedRules = new Set();
  if (profile === 'pr') {
    let laneB = false;
    for (const path of changedPaths) {
      const matching = manifest.path_rules.filter((rule) => ruleMatches(path, rule));
      if (matching.length === 0 || matching.some((rule) => rule.profile_min !== 'none')) laneB = true;
      for (const rule of matching) {
        if (rule.profile_min !== 'pr') continue;
        firedRules.add(rule.id);
        for (const suite of rule.suites) selected.add(suite);
      }
    }
    if (laneB) for (const suite of manifest.profiles.pr.always) selected.add(suite);
  } else {
    for (const suite of manifest.profiles[profile].always) selected.add(suite);
  }
  const sorted = [...selected].sort();
  return {
    required: sorted.filter((suite) => manifest.suites[suite]?.status === 'active'),
    planned: sorted.filter((suite) => manifest.suites[suite]?.status === 'planned'),
    rules: [...firedRules].sort(),
  };
}

/**
 * Gate rule 5 (TEST-STRATEGY section 9.2): suites of the gate profile that are not `active` and not deferred.
 * @param {Manifest} manifest
 * @returns {string[]}
 */
export function gateBlockers(manifest) {
  const deferred = new Set(manifest.deferred_at_gate.map((entry) => entry.suite));
  return manifest.profiles.gate.always.filter((suite) => manifest.suites[suite]?.status !== 'active' && !deferred.has(suite)).sort();
}
