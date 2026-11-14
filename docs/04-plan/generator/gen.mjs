// P4 plan generator and validator (senior-developer). Usage from the repo root (Node 24 PATH prefix, CLAUDE.md §2):
//   node docs/04-plan/generator/gen.mjs .           validate only (exit 1 on any violation)
//   node docs/04-plan/generator/gen.mjs . --write   regenerate docs/04-plan/task-map.csv and tasks/WAVE-*.md
// Reads the story files for REQ links, DC flags and scenario counts; task data lives in plan-data.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { tasks as rawTasks, waves } from './plan-data.mjs';

const REPO = process.argv[2];
const OUT = path.join(REPO, 'docs/04-plan');
const STORIES_DIR = path.join(REPO, 'docs/01-requirements/stories');
const write = process.argv.includes('--write');

// ---------- parse stories
const stories = new Map();
for (const f of fs.readdirSync(STORIES_DIR).filter(f => /^EPIC-\d+/.test(f))) {
  const epic = f.slice(0, 7);
  const txt = fs.readFileSync(path.join(STORIES_DIR, f), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\| (US-\d{3}) \| (.+?) \| (M\d) \| (Must|Should|Could) \| (S|M) \| (.*?) \| (.*?) \| *(DC)? *\|$/);
    if (m) stories.set(m[1], { id: m[1], title: m[2], ms: m[3], moscow: m[4], size: m[5], reqs: m[7].split(',').map(s => s.trim()).filter(Boolean), dc: !!m[8], epic, nfrs: [] });
  }
  // Linked NFRs per story section
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const h = line.match(/^### (US-\d{3})/); if (h) cur = h[1];
    const n = line.match(/\*\*Linked NFRs[^:]*:\*\*\s*(.*)$/);
    if (n && cur && stories.has(cur)) stories.get(cur).nfrs.push(...(n[1].match(/NFR-[A-Z0-9]+-\d{3}/g) || []));
  }
}

// ---------- scenario counts per story (AT-US-xxx-nn, TEST-STRATEGY §6)
for (const f of fs.readdirSync(STORIES_DIR).filter(f => /^EPIC-\d+/.test(f))) {
  let cur = null;
  for (const line of fs.readFileSync(path.join(STORIES_DIR, f), 'utf8').split(/\r?\n/)) {
    const h = line.match(/^### (US-\d{3})/); if (h) { cur = h[1]; continue; }
    if (/^#{1,3} /.test(line)) cur = null;
    if (cur && stories.has(cur) && /^\s*Scenario( Outline)?:/.test(line)) stories.get(cur).scen = (stories.get(cur).scen || 0) + 1;
  }
}
// ---------- assign IDs
const order = [...rawTasks].map((t, i) => ({ us: [], part: [], x: [], nfr: [], dod: [], lk: [], f: [], a: [], kind: [], d: [], ...t, i })).sort((a, b) => a.w - b.w || a.b - b.b || a.i - b.i);
const byKey = new Map();
// Late tasks (late:true) are numbered after every planned task in ARRAY order (append-only), not by (wave, batch): a late task may be
// scheduled in any batch without moving an existing ID (D-ARCH-125, sheet-fold 7; TASK-276..282 keep their IDs because they are listed in that order).
let seq = 0; for (const t of [...order.filter(t => !t.late), ...order.filter(t => t.late).sort((a, b) => a.i - b.i)]) { t.id = `TASK-${String(++seq).padStart(3, '0')}`; byKey.set(t.k, t); }
const errors = [], warnings = [];
if (byKey.size !== rawTasks.length) errors.push('duplicate keys');

const slug = s => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !['and', 'the', 'a', 'of', 'with', 'to', 'in', 'on', 'for', 'via', 'by', 'from'].includes(w)).slice(0, 5).join('-');
for (const t of order) {
  t.branch = `feat/${t.id}-${slug(t.t)}`;
  t.deps = t.d.map(k => { const d = byKey.get(k); if (!d) errors.push(`${t.k}: unknown dep ${k}`); return d; }).filter(Boolean);
  t.allStories = [...new Set([...t.us, ...t.part])];
  for (const s of t.allStories) if (!stories.has(s)) errors.push(`${t.id}: unknown story ${s}`);
  t.reqs = [...new Set(t.allStories.flatMap(s => stories.get(s)?.reqs || []))];
  t.nfrAll = [...new Set([...t.nfr, ...t.allStories.flatMap(s => stories.get(s)?.nfrs || [])])].sort();
  t.dc = t.allStories.some(s => stories.get(s)?.dc);
  const pri = t.allStories.map(s => stories.get(s)?.moscow);
  t.priority = pri.includes('Must') ? 'Must' : pri.includes('Should') ? 'Should' : pri.includes('Could') ? 'Could' : 'Enabler';
  t.batchId = `${t.w}.${t.b}`;
  t.cuttable = t.w >= 8;
}

// ---------- validation
// 1. complexity, batches, deps ordering, locks
const batches = new Map();
for (const t of order) {
  if (!['S', 'M'].includes(t.c)) errors.push(`${t.id}: complexity ${t.c}`);
  if (!['sonnet', 'opus'].includes(t.m)) errors.push(`${t.id}: model ${t.m}`);
  if (!t.allStories.length && !t.x.length && !t.nfr.length) errors.push(`${t.id}: no story/NFR/ref`);
  (batches.get(t.batchId) || batches.set(t.batchId, []).get(t.batchId)).push(t);
  for (const d of t.deps) if (d.w > t.w || (d.w === t.w && d.b >= t.b)) errors.push(`${t.id} (${t.batchId}) depends on ${d.id} (${d.batchId}) not in an earlier batch`);
}
for (const [b, ts] of batches) {
  if (ts.length > 4) errors.push(`batch ${b} has ${ts.length} tasks`);
  const seen = new Map();
  for (const t of ts) for (const l of t.lk) { if (seen.has(l)) errors.push(`batch ${b}: lock ${l} shared by ${seen.get(l)} and ${t.id}`); seen.set(l, t.id); }
}
// 2. story coverage
const owner = new Map(), partials = new Map();
for (const t of order) { for (const s of t.us) (owner.get(s) || owner.set(s, []).get(s)).push(t); for (const s of t.part) (partials.get(s) || partials.set(s, []).get(s)).push(t); }
for (const s of stories.values()) {
  if (!owner.has(s.id)) errors.push(`${s.id} (${s.moscow}) has no completing task`);
  if ((owner.get(s.id) || []).length > 1) warnings.push(`${s.id} completed by ${owner.get(s.id).map(t => t.id).join(', ')}`);
}
// 3. wave placement policy
const pulled = [];
for (const s of stories.values()) {
  const t = (owner.get(s.id) || [])[0]; if (!t) continue;
  const last = Math.max(...(owner.get(s.id)).map(x => x.w));
  let allowed;
  if (s.moscow === 'Must' && s.ms === 'M0') allowed = s.dc ? [0, 2] : [0, 3];
  else if (s.moscow === 'Must' && s.ms === 'M1') allowed = s.dc ? [0, 6] : [0, 7];
  else allowed = [0, 9];
  if (last < allowed[0] || last > allowed[1]) errors.push(`${s.id} ${s.ms} ${s.moscow}${s.dc ? ' DC' : ''} completes in wave ${last}, allowed ${allowed}`);
  if (s.moscow !== 'Must' && last < 8) pulled.push(`${s.id} (${s.ms} ${s.moscow}) -> wave ${last}`);
  if (s.moscow === 'Must' && s.ms === 'M1' && last <= 3) pulled.push(`${s.id} (M1 Must${s.dc ? ' DC' : ''}) -> wave ${last} (M0)`);
  if (s.moscow === 'Must' && !s.dc && ((s.ms === 'M0' && last <= 2) || (s.ms === 'M1' && last >= 4 && last <= 6))) pulled.push(`${s.id} (${s.ms} non-DC Must, enabler) -> wave ${last}`);
}
// 4. critical path (longest chain of tasks; weight S=1.5, M=3 dev-days)
const W = { S: 1.5, M: 3 };
const memo = new Map();
const lp = (t, mode) => { const key = t.k + mode; if (memo.has(key)) return memo.get(key);
  let best = { len: 0, chain: [] };
  for (const d of t.deps) { const r = lp(d, mode); if (r.len > best.len) best = r; }
  const res = { len: best.len + (mode === 'n' ? 1 : W[t.c]), chain: [...best.chain, t] }; memo.set(key, res); return res; };
const cp = (filter, mode) => order.filter(filter).map(t => lp(t, mode)).sort((a, b) => b.len - a.len)[0];
const cpAll = cp(() => true, 'n'), cpM0 = cp(t => t.w <= 3, 'n'), cpMust = cp(t => t.w <= 7, 'n');
const cpMustD = cp(t => t.w <= 7, 'd'), cpM0D = cp(t => t.w <= 3, 'd');

// ---------- stats
const stats = {};
for (const t of order) { const s = stats[t.w] ||= { n: 0, S: 0, M: 0, opus: 0, sonnet: 0, days: 0, batches: new Set(), dc: 0, spec: {} }; s.n++; s[t.c]++; s[t.m]++; s.days += W[t.c]; s.batches.add(t.b); if (t.dc) s.dc++; s.spec[t.sp] = (s.spec[t.sp] || 0) + 1; }
const tot = { n: order.length, S: order.filter(t => t.c === 'S').length, M: order.filter(t => t.c === 'M').length, opus: order.filter(t => t.m === 'opus').length, days: order.reduce((a, t) => a + W[t.c], 0), batches: batches.size };
const mustStories = [...stories.values()].filter(s => s.moscow === 'Must');
const secPaths = /prisma|packages\/(authz|audit|config)|apps\/api\/src\/platform|modules\/identity/;
const secTasks = order.filter(t => t.f.some(f => secPaths.test(f)));

console.log(JSON.stringify({ errors, warnings, pulled, tot, perWave: Object.fromEntries(Object.entries(stats).map(([w, s]) => [w, { ...s, batches: s.batches.size }])),
  stories: { total: stories.size, must: mustStories.length, mustMapped: mustStories.filter(s => owner.has(s.id)).length, dc: [...stories.values()].filter(s => s.dc).length },
  secCritical: { all: secTasks.length, must: secTasks.filter(t => t.w <= 7).length },
  cp: { all: [cpAll.len, cpAll.chain.map(t => t.id + ':' + t.k).join(' > ')], m0: [cpM0.len, cpM0.chain.map(t => t.id + ':' + t.k).join(' > ')], must: [cpMust.len, cpMust.chain.map(t => t.id + ':' + t.k).join(' > ')], mustDays: [cpMustD.len, cpMustD.chain.map(t => t.id).join(' > ')], m0Days: [cpM0D.len, cpM0D.chain.map(t => t.id).join(' > ')] } }, null, 1));
if (errors.length) { console.error('VALIDATION FAILED'); process.exit(1); }
if (!write) process.exit(0);

// ---------- emit task-map.csv
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = ['task,story_ids,req_ids,nfr_ids,wave,specialist,complexity,model,depends_on,dc,batch,title,branch,refs,completes_stories,partial_stories,priority,cuttable'];
for (const t of [...order].sort((a, b) => a.id.localeCompare(b.id))) csv.push([t.id, q(t.allStories.join(';')), q(t.reqs.join(';')), q(t.nfrAll.join(';')), t.w, t.sp, t.c, t.m, q(t.deps.map(d => d.id).join(';')), t.dc ? 'DC' : '', t.batchId, q(t.t), t.branch, q(t.x.join(';')), q(t.us.join(';')), q(t.part.join(';')), t.priority, t.cuttable ? 'yes' : 'no'].join(','));
fs.writeFileSync(path.join(OUT, 'task-map.csv'), csv.join('\n') + '\n');

// ---------- emit WAVE files
const dodByKind = {
  api: 'Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.',
  db: 'Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.',
  fe: 'All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.',
  lib: 'Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).',
  worker: 'Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.',
  infra: 'No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.',
  ci: 'Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.',
  spike: 'Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.',
  test: 'Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.',
  perf: 'k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.',
};
const storyCell = s => { const st = stories.get(s); return `${s}${st.dc ? ' **DC**' : ''} (${st.ms} ${st.moscow}) ${st.title}`; };
for (const w of Object.keys(waves).map(Number)) {
  const wt = order.filter(t => t.w === w); if (!wt.length) continue;
  const meta = waves[w]; const s = stats[w];
  const L = [];
  L.push(`# WAVE-${String(w).padStart(2, '0')} — ${meta.name}`, '');
  L.push(`Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **${meta.ms}** · Priority band: **${meta.prio}**${w >= 8 ? ' · **CUTTABLE** (PRD §7.1 ladder rung ' + (w === 9 ? '1' : '2') + ')' : ''}`, '');
  L.push(`Tasks: **${s.n}** (S ${s.S} / M ${s.M}; opus ${s.opus} / sonnet ${s.sonnet}; demo-critical ${s.dc}) in **${s.batches.size}** batches of ≤ 4 parallel tasks. Estimated effort ≈ ${s.days} developer-days (human-equivalent: S = 1.5, M = 3).`, '');
  L.push(`**Exit check:** ${meta.exit}.`, '');
  const done = wt.flatMap(t => t.us).sort(); L.push(`**Stories completed in this wave (${done.length}):** ${done.map(x => x + (stories.get(x).dc ? ' (DC)' : '')).join(', ')}.`, '');
  if (meta.checkpoint) L.push(`> **★ CHECKPOINT ${meta.checkpoint}** — ${meta.checkpoint === 'v0.1.0-m0' ? 'when this wave exits, release-manager cuts the `v0.1.0-m0` pre-release through `release.yml` (D-006): lane C `release-candidate` green on the tagged SHA, lane B evidence, lightweight dossier, no gate. M1 waves start only after the tag (back-fill of Wave 4 tasks whose dependencies are met may start earlier, see PLAN.md §6).' : 'all Must stories merged; orchestrator hands over to P6 (qa-lead, security-analyst, performance-engineer) for G3 while Wave 8 continues.'}`, '');
  L.push('## Batches', '', '| Batch | Tasks (parallel) | Locks held |', '|---|---|---|');
  for (const b of [...s.batches].sort((a, b) => a - b)) { const bt = wt.filter(t => t.b === b); L.push(`| ${w}.${b} | ${bt.map(t => `${t.id} ${t.t.split(/ \(|: /)[0].trim()}`).join('<br>')} | ${bt.map(t => t.lk.join(', ')).join('<br>')} |`); }
  L.push('', 'Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).', '');
  L.push('## Task specifications', '');
  for (const t of wt) {
    L.push(`### ${t.id} — ${t.t}`, '');
    L.push('| Field | Value |', '|---|---|');
    L.push(`| Stories (completes) | ${t.us.length ? t.us.map(storyCell).join('<br>') : '—'} |`);
    if (t.part.length) L.push(`| Stories (partial; completed by ${t.part.map(p => (owner.get(p) || []).map(o => o.id).join('/')).join(', ')}) | ${t.part.map(storyCell).join('<br>')} |`);
    L.push(`| REQs | ${t.reqs.join(', ') || '— (enabler; see refs)'} |`);
    L.push(`| NFRs | ${t.nfrAll.join(', ') || '—'} |`);
    L.push(`| Spikes / security / decisions | ${t.x.join(', ') || '—'} |`);
    L.push(`| Specialist · model | ${t.sp} · ${t.m}${t.m === 'sonnet' ? ' (escalate to opus from fix cycle 2)' : ''} |`);
    L.push(`| Complexity | ${t.c} |`);
    L.push(`| Depends on | ${t.deps.length ? t.deps.map(d => d.id).join(', ') : '—'} |`);
    L.push(`| Batch · locks | ${t.batchId} · ${t.lk.join(', ')} |`);
    L.push(`| Branch | \`${t.branch}\` |`);
    L.push(`| Priority | ${t.priority}${t.dc ? ' · demo-critical' : ''}${t.cuttable ? ' · cuttable' : ''} |`);
    L.push('');
    if (t.pull) L.push(`> Scheduling note: ${t.pull}.`, '');
    L.push('**Files / modules**', ...t.f.map(f => `- ${f}`), '');
    L.push('**Acceptance tests to write**', ...t.a.map(a => `- ${a}`));
    for (const s2 of t.allStories) { const st = stories.get(s2); const n = st.scen || 0; const ids = n ? `AT-${s2}-01 … AT-${s2}-${String(n).padStart(2, '0')}` : `AT-${s2}-*`; L.push(t.us.includes(s2) ? `- ${ids}: all ${n} scenarios of ${s2}, with the IDs in the test titles (TEST-STRATEGY §6; map \`docs/05-quality/tests/gherkin-test-map.md\`)` : `- Covers the scenarios of ${ids} that belong to its layer; ${s2} closes in ${(owner.get(s2) || []).map(o => o.id).join("/")}`); }
    L.push('');
    L.push('**DoD notes**', ...t.kind.map(k => `- ${dodByKind[k]}`), ...(t.dod || []).map(d => `- ${d}`));
    if (t.f.some(f => secPaths.test(f))) L.push('- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).');
    L.push('- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.', '');
  }
  fs.writeFileSync(path.join(OUT, 'tasks', `WAVE-${String(w).padStart(2, '0')}.md`), L.join('\n'));
}
// summary json for PLAN.md authoring
if (process.argv.includes('--stats')) fs.writeFileSync(path.join(process.cwd(), 'stats.json'), JSON.stringify({ stats: Object.fromEntries(Object.entries(stats).map(([w, s]) => [w, { ...s, batches: s.batches.size }])), tot, pulled, cpAll: cpAll.chain.map(t => [t.id, t.k, t.batchId]), cpMust: cpMust.chain.map(t => [t.id, t.k, t.batchId]), cpM0: cpM0.chain.map(t => [t.id, t.k, t.batchId]), secTasks: secTasks.length, ids: Object.fromEntries(order.map(t => [t.k, t.id])) }, null, 1));
console.log('written');
