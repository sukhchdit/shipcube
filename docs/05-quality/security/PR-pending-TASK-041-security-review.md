# PR-pending: TASK-041 (Valkey-backed rate limiting per class, RateLimit headers, trusted proxy chain and the T-39 per-actor denial budget), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-041-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control S4).

Order (D-ORCH-136, D-ORCH-138):
1. Open the PR as a draft.
2. Rename the record on main.
3. Confirm that the PR's merge ref contains the renamed record: `git fetch origin refs/pull/<n>/merge`, then `git ls-tree` it. Its first parent must be the rename commit or later.
4. Mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-041-valkey-backed-rate-limiting-per`, three commits on `f8e9086`: `0d87b1a` (implementation), `56cf335` (merge of main `29fe2a1`, a pure union per the code review twin §1), `e6f484a` (loopback test transport, README §13 row, revert of the `eslint.config.mjs` allow-list edit; net change to that file: none) |
| Head | e6f484a5b11f8357b82adef20889154d96199ee6 |
| Merge base with main | `29fe2a1`. Main has moved since by docs only (eight commits, tip `71a2d36` when this round was written, including the D-SD-003 plan fold `77ac6d2`); none touches a path of this PR |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base 2ec81df --head e6f484a`) gives `security_paths=true` (22 security-critical paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None for `e6f484a` at review time. `rate-limit.int.test.ts` (the only proof of the Lua scripts against a real Valkey) runs there for the first time |
| Owned paths changed | 19, as main's checker counts them (`--base origin/main --head e6f484a`): 17 under `/apps/api/src/platform/` (`audit/capture.ts` + api test, `authz/authorise.ts`, `logging/security-events.test.ts`, `rate-limit/**` 12 files, `routing/pipeline.ts`) and 2 under `/packages/audit/` (`network.ts` + test). So this record is a merge condition |
| Unowned paths changed | 9: `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/start-api.denial-budget.api.test.ts`, `packages/config/src/{index,schema}.ts`, `packages/config/src/rate-limit-keys.test.ts`, `packages/shared/src/logging/security-event{,.test}.ts`, `docs/03-architecture/api/README.md` (§13 row) |
| Binding items checked | The TASK-041 card (`docs/04-plan/tasks/WAVE-01.md`, T-39 line and PR61-SEC-12 line); D-SECT39-01 items 1-6 and its card lines (`docs/sdlc/DECISIONS.md`); threat model T-39; ADR-0016 §8 and amendment 1; api/README §7 and §13; REQ-SEC-006 / A-053 / EC-A32; platform.md §2.2 (Valkey ACL, `noeviction`), §4.3, §4.4 (CloudFront + ALB, `X-Origin-Verify`), §6 (`TRUST_PROXY_HOPS=2`); ADR-0010 amendment items 2-3 (carrier admission). Code review twin on main: `docs/05-quality/reviews/PR-pending-TASK-041-code-review.md` (`7d24349`, APPROVED_WITH_NITS, R1-m1..m8, SECURITY-FLAGS S1-S4) |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule (lane B owns the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node 24 probes on a `git archive` extract of `e6f484a`, sources type-stripped by a resolve/load hook, bare packages (Express 5, express-rate-limit 8.7.3) resolved from the main checkout. Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Line numbers come from single-file reads at `e6f484a`. Disclosure: a tree-wide `git grep TRUST_PROXY_HOPS` also printed the one matching line of `.env.example` (a non-secret placeholder value, `1`); no other part of that file was opened |

## 1. Summary

The T-39 denial budget is implemented as D-SECT39-01 rules, item by item, and the probes found no way around it:

- **Closed shapes.** `capture.denied` takes a closed `DenialMark` and maps it itself; the crossing entry carries `required_permission`, `aggregated`, `threshold`, `window_seconds`, `window_ends_at` and no count; the opener adds `suppressed_in_previous_window` only for a carry in 1..2^31-1 (range-checked twice, in the budget and in the capture). The api suite deep-equals all three stored shapes.
- **Keys and TTL.** `rl:authz-denial:{org|system}:{actor | credential kind}` with every segment checked against `^[A-Za-z0-9_-]{1,64}$` (empty becomes `system`, anything else `unknown`). One constant Lua script per denial (`INCR`; on 1 `PEXPIRE` + `GETDEL` of the carry; above N+1 `INCR` + `EXPIRE` of the carry; a TTL repair branch), so no budget key is ever left without a TTL. Keys and scripts never carry request data, and the scripts are constants: keys and arguments travel as `KEYS`/`ARGV`, so there is no script injection.
- **Answers.** Denials 1..N write and answer 403; N+1 writes one aggregated entry and answers 429 with `Retry-After`, `RateLimit-Limit` N, `RateLimit-Remaining` 0 and `RateLimit-Reset`; later denials write nothing and answer 429. A failed write answers 500/503; a failed opener write restores the claimed carry; only the AUTHZ_DENIED path spends the budget. The problem handler keeps the four headers (`RATE_LIMITED` carries no `retryAfterSeconds` of its own).
- **Outage.** A store error or timeout uses the per-instance fallback with the same threshold, shape and carry, and emits `rate_limit_store_unavailable` (`store`, `scope`; no host, no key) at most once a minute per scope. The counter's only denial label is `authz-denial`, which is not a `RateLimitClass`.
- **Composition.** `defaultPipelineSlots` builds the budget whenever it builds the capture; the startApi composition test answers 429 at N+1 with the real `startApi`.
- **PR61-SEC-12 is closed.** 120,000 generated spellings of IPv4-mapped addresses (dotted and hex tails, compressed and expanded zero runs, padded groups, mixed case, zones) unmap to the IPv4 address in `canonicalIp`, `coarseNetwork` and the limiter key alike; 7 near misses (`::ffff:0:a.b.c.d`, `::fffe:`, `1::ffff:`, `::1:ffff:`, NAT64, `2001:db8::ffff:`) are not unmapped by the audit functions (section 4.2).
- **Trusted proxy chain.** Express 5 with `trust proxy` = `TRUST_PROXY_HOPS`: a matrix of hops 0..5 against real chains of 0..3 proxies gives the real client exactly when hops equals the chain, a spoofed address whenever hops exceeds it, and one shared proxy address whenever it falls short (section 4.3).

Two LOW findings and six INFO items, none blocking:

- **PR041-SEC-01 (LOW, = code review R1-m5):** the per-instance fallback stores scan every entry on each new key once they hold 50,000 windows: 1.2-1.6 ms per request instead of 0.013 ms. A client with a /48 (65,536 distinct /64 keys) can saturate an instance during a Valkey outage. A fix (bounded sweep, O(1) eviction of the oldest window) is validated on a scratch copy at 0.013 ms.
- **PR041-SEC-02 (LOW, = code review R1-m1 / S1):** the step-0 rule is chosen by header presence. Any `Authorization`, refresh cookie or `X-Quote-Token` moves an IP from 120/min to 6,000/min. Today this widens only the paths step 0 alone guards (docs, 404, OPTIONS) and the log volume of `rate_limit_auth`; once the real authenticators land it lets forged credentials reach verification work 50 times faster than ADR-0016 amendment 1 intends.

## 2. Findings

| ID | Severity | CWE / OWASP 2021 | Where (`e6f484a`) | Title | Owner, due |
|---|---|---|---|---|---|
| PR041-SEC-01 | LOW | CWE-407 / A04 | `rate-limit/store.ts:108`, `:115-123`, `:130`; `rate-limit/denial-budget.ts:132`, `:146-153`, `:159`, `:170` | The fallback stores are O(n) per new key at their bound | This PR's fix cycle (with R1-m5); at the latest before TASK-049 (first `auth` route) merges |
| PR041-SEC-02 | LOW | CWE-770 / A04 | `rate-limit/limits.ts:80-84`, `:116`; `rate-limit/policy.ts:148-155` | A self-declared credential lifts the step-0 per-IP budget 50 times | (a) comment and docs-path rule: this PR's fix cycle; (b) the failed-authentication budget: principal-architect ruling (code review C1), implemented before TASK-052 (first real authenticator) merges |
| PR041-SEC-03 | INFO | CWE-636 / A04 | `rate-limit/policy.ts:80-114`; `rate-limit/limiter.ts:95-101`; `rate-limit/limits.ts:83` | Fail-open classes rely on the carrier layer's own admission, whose store-failure mode is not yet decided | principal-architect (ADR-0010 am. items 2-3), before the first `public-quote` / `public-tracking` route |
| PR041-SEC-04 | INFO | CWE-770 / A04 | `rate-limit/policy.ts:46-49`; `limiter.ts:62` | Per-/64 keys give a /48 holder 65,536 budgets and grow the `noeviction` key space | data-architect / devops (platform OI-15), TASK-214 alarms |
| PR041-SEC-05 | INFO | CWE-348 / A05 | `app.ts:188`; `packages/config/src/schema.ts:287` | `TRUST_PROXY_HOPS` must equal the real chain in every environment; the default fails silently in the spoofing direction | devops (IaC and deploy smoke before G4); default change: this PR or devops |
| PR041-SEC-06 | INFO | CWE-223 / A09 | `rate-limit/denial-budget.ts:93`, `:220-229` | A late Valkey reply on a window opener loses the claimed carry | Residual: threat model §10.4 H (security-analyst); no code change required |
| PR041-SEC-07 | INFO | CWE-359 / A04 | `rate-limit/policy.ts:46-49`, `:80-114`; `limiter.ts:62` | Client IPs (IPv4 in full) live in Valkey keys for up to one hour and in the daily ElastiCache snapshots | data-architect (data inventory, platform.md §4.3 snapshot retention); keyed hash optional |
| PR041-SEC-08 | INFO | CWE-1188 / A05 | `app.ts:141-145`, `:185`, `:193` | A live composition without `rateLimit` is not refused at boot | This PR's fix cycle with R1-m6, or TASK-289 |

## 3. Findings in detail

### PR041-SEC-01 (LOW): the fallback stores are O(n) per new key at their bound

**Where.** `createMemoryStore` (`store.ts`) calls `prune()` (`:115-123`) whenever a new key arrives and the map already holds `MEMORY_MAX_ENTRIES` (50,000, `:108`; call at `:130`). `prune` iterates every window to delete expired ones, then deletes the oldest-inserted ones until the size is at most 50,000, which leaves 50,000 entries; the insert makes 50,001, and the next new key scans everything again. `memoryDenialStore` (`denial-budget.ts:146-153`, call `:159`) has the same shape, and its `carries` map (`:170`, `:177`) has no bound of its own.

**Exploitability and impact.** The limiter's fallback store serves the `auth` and `email-send` classes during a Valkey outage (`limiter.ts:86-93`), and one store holds all their rules. Probe P4 (the PR's real store and limiter, 50,000 live windows, a new IPv6 /64 per request):

| Store state | Cost per request with a new key |
|---|---|
| 1,000 live windows (control) | 0.0115 ms |
| 50,000 live windows, head `e6f484a` | 1.2-1.6 ms |
| 50,000 live windows, candidate fix below | 0.013 ms |

So roughly 700 new-key requests per second saturate one instance's event loop, for every route it serves. Keys are per IPv6 /64, so a client with one /48 has 65,536 of them; the `email-send:ip` rule's one-hour window lets it fill the shared store at about 14 requests a second before the costly phase. The fallback is active only while Valkey fails, and step 0 fails open meanwhile (section 4.5), so nothing stops the flood earlier. The denial store needs 50,000 distinct denied actors, which is not reachable. Not reachable in production today either: `moduleRegistry` is empty at `e6f484a`, and the first `auth` and `email-send` routes arrive with TASK-049. Impact Medium (one instance per attacker stream, all routes), likelihood Low (needs an outage, which PR041-SEC-04 shows can be pushed towards, plus IPv6 prefix diversity): LOW.

**Remediation (code).** Keep the bound, make eviction O(1) amortised, and keep the `Map` in window-opening order:

```ts
/** A bounded sweep of the oldest entries, then evict the oldest-opened window while full. */
function makeRoom(t: number): void {
  let swept = 0;
  for (const [key, window] of windows) {
    if (swept >= 64 || windows.size < MEMORY_MAX_ENTRIES) break;
    swept += 1;
    if (window.endsAt <= t) windows.delete(key);
  }
  while (windows.size >= MEMORY_MAX_ENTRIES) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}
// in hit(): when the window is missing or expired
windows.delete(key); // re-insert, so Map order = window opening order
if (windows.size >= MEMORY_MAX_ENTRIES) makeRoom(t);
```

Apply the same to `memoryDenialStore`, and bound `carries` and the limiter's `slots` the same way (R1-m5). Evicting the oldest window under a flood resets that key's count, which is no weaker than today: the current `prune` also drops the oldest-inserted windows.

**Verification test.** Fill a store with 50,000 live windows and assert both the size bound (at most 50,000 after N more new keys) and a scaling ratio: the mean cost of a new-key hit at 50,000 live windows over the cost at 1,000 is below 10 (head: about 120). Measure a ratio, not an absolute time.

### PR041-SEC-02 (LOW): a self-declared credential lifts the step-0 per-IP budget 50 times

**Where.** `ipLimiter` (`limits.ts:80-84`) picks `stepZeroRule(ip, presentsCredential(req.headers))` (`policy.ts:151-155`): `step0:anonymous` at `RATE_LIMIT_PUBLIC_PER_MIN` (120) or `step0:credentialed` at `RATE_LIMIT_AUTHENTICATED_PER_MIN × 10` (6,000, `:148`). `presentsCredential` reports presence, not validity.

**Exploitability and impact.** Any client adds `Authorization: Bearer x` and gets 6,000 requests a minute per IP at step 0. The PR's own api test shows it (`limits.api.test.ts`, "a credentialed request has a per-IP ceiling…", a junk bearer). What that buys today:
- Paths with no step-5 slot (`/api/docs/*`, the 404 fallback, OPTIONS preflights) are guarded by step 0 alone, so PR21-SEC-01 step 5's "limited like every other public route" holds for anonymous clients only.
- On anonymous routes the foreign credential is ignored (D-ARCH-109) and the step-5 class limits still apply, including `auth:ip` before bcrypt (AT-US-040-06). But every refused `auth`-class request emits one `rate_limit_auth` WARN line (`limits.ts:116`), so one IP can drive about 100 lines a second instead of about 2 (CWE-779 aspect; code review S1).
- The authentication slot is still the TASK-020 stub: a declared credential fails with a cheap 401. And `moduleRegistry` is empty at `e6f484a`, so in production only the docs, fallback and OPTIONS paths are reachable at all.

What it buys once TASK-052/055/091 land: every forged bearer, refresh cookie or quote token reaches verification (ES256 verification; a refresh-token lookup) at 100 a second per IP, before any step-5 limit (DR-A08). ADR-0016 amendment 1 states the purpose of the pre-authentication limiter as "unauthenticated floods never reach bcrypt/JWT verification". Impact Low today (Medium once lookups sit behind verification), likelihood High (trivial): LOW now, MEDIUM if still open when the first real authenticator merges.

**Remediation (code).** The code twin's options (R1-m1) need an architect ruling (its C1). My recommendation combines two:
- (a) **This PR:** paths outside the module mount (`/api/docs`, the fallback, OPTIONS) always use the anonymous rule, and the two comments that overclaim ("cannot flood", "never reaches bcrypt or JWT verification") are reworded.
- (b) **Before TASK-052:** a failed-authentication budget checked at step 0. The authn slot hits `rl:step0:authn-failed:<ip key>` (limit `RATE_LIMIT_PUBLIC_PER_MIN`, 60 s) whenever a presented credential of a declared kind fails; `ipLimiter` refuses a credentialed request with 429 while that key is over its limit, before authentication. NAT neighbours keep their per-user budgets (AT-US-040-11), because valid credentials do not spend it. Sketch:

```ts
// store.ts: a read without a hit
peek(key: string): Promise<WindowHit | undefined>; // GET + PTTL in one script; undefined when absent
// limits.ts, ipLimiter, credentialed branch
const failed = await kit.limiter.peek({ name: 'step0:authn-failed', key: ip });
if (failed !== undefined && failed.count >= kit.settings.RATE_LIMIT_PUBLIC_PER_MIN) {
  res.setHeader('Retry-After', String(Math.max(Math.ceil(failed.resetMs / 1000), 1)));
  return next(new AppError('RATE_LIMITED'));
}
// authenticate.ts (TASK-052): on a failed declared credential
await kit.limiter.consume([rule('step0:authn-failed', ip, s.RATE_LIMIT_PUBLIC_PER_MIN, MINUTE_MS)], { onStoreFailure: 'fallback', scope: 'rate-limit' });
```

Separately, emit `rate_limit_auth` on the first refusal of a window per key and count the rest (the counter exists), if product-manager agrees that AT-US-040-10 ("a security log event … is emitted and counted") allows it.

**Verification test.** 121 requests from one IP with a junk bearer to `/api/docs/` get a 429 at the 121st (a); after 120 failed authentications in a minute, a credentialed request from that IP gets 429 before the authn slot runs (spy on the verifier), while a valid credential from a second IP is unaffected (b).

### PR041-SEC-03 (INFO): fail-open classes rely on the carrier layer's own admission

**Where.** `public`, `public-quote`, `public-tracking`, `authenticated`, `webhook`, `csp-report` fail open on a store error (`policy.ts:80-114`); so do step 0 (`limits.ts:83`) and the SSE slots (`limiter.ts:95-101`). `auth` and `email-send` fall back per instance.

**Assessment.** This is what REQ-SEC-006 / A-053 / api/README §7 specify, so it is not a defect of this PR, and I accept it for this PR. Two consequences need an owner:
- `public-quote` and `public-tracking` drive carrier calls. When they fail open, the remaining egress guard is the carrier layer's anonymous token bucket and daily quota guard (ADR-0010 amendment items 2-3), which also live in Valkey. If that guard fails open as well, a Valkey outage turns into unbounded anonymous carrier traffic and the carrier-side penalties PR6 recorded (FedEx IP penalty; DHL shared origin). The carrier admission must fall back per instance or refuse (`LOCAL_REJECT`) on a store failure.
- A store failure includes `OOM command not allowed` under `noeviction` (platform.md §2.2), which key growth can push towards (PR041-SEC-04).

The per-instance fallback is cheap once PR041-SEC-01 is fixed, so extending it to `public-quote` and `public-tracking` would be an inexpensive amendment of A-053 (product-manager, principal-architect).

### PR041-SEC-04 (INFO): per-/64 keys give a /48 holder 65,536 budgets and grow the `noeviction` key space

Per README §7, IPv6 clients are keyed by their /64 (`policy.ts:46-49`). A client with a /48 therefore has 65,536 independent budgets per rule, and every request from a new /64 creates keys: step 0 (60 s), the class rule(s), and for `public-quote`, `public-tracking` and `email-send` keys that live one hour. Valkey is shared with BullMQ under `noeviction` (platform OI-15), so a sustained flood of new /64s grows memory until writes fail, which fails the limiter open (PR041-SEC-03) and refuses enqueues. Recommendation for the OI-15 owners: a `rl:*` key-count metric with an alarm next to the TASK-214 memory alarms, and an optional /48 aggregate rule for the anonymous classes at a multiple of the /64 limit.

### PR041-SEC-05 (INFO): `TRUST_PROXY_HOPS` must equal the real chain; the default fails silently

Probe P1 (real Express 5, section 4.3) confirms the textbook behaviour: hops above the chain make `req.ip` the client's forged `X-Forwarded-For` entry (every per-IP limit key and the audit IP chosen by the client); hops below it make `req.ip` a proxy address (one shared bucket: any client 429s everyone). The PR sets `trust proxy` from the configuration (`app.ts:188`), and the schema default is 1 (`schema.ts:287`):
- Compose: the `edge` proxy is one hop and `api` publishes no port (`compose.debug.yaml` publishes `127.0.0.1:3000` only): correct.
- AWS: platform.md §6 sets `TRUST_PROXY_HOPS=2` (CloudFront + ALB), and that is safe only while `sg-alb` admits the CloudFront origin-facing prefix list and the ALB rule refuses requests without `X-Origin-Verify` (§4.4). A directly reachable ALB with hops 2 lets any client choose `req.ip`.
- Misconfiguration in the "too low" direction is loud (everyone shares one bucket); in the "too high" direction it is silent.

Recommendation: default 0 in the schema (explicit 1 in `compose.env`, which already sets it, and 2 in the IaC), so a missing setting fails loudly; a Terraform/ECS test that pins `TRUST_PROXY_HOPS=2` together with the `sg-alb` prefix list and the `X-Origin-Verify` rule; a post-deploy smoke check that the audit IP of a request is not an ALB or CloudFront address. This covers code review S2.

### PR041-SEC-06 (INFO): a late Valkey reply on a window opener loses the claimed carry

`TAKE_SCRIPT` claims the carry with `GETDEL` (`denial-budget.ts:93`). When the script runs on the server but its reply arrives after the 250 ms bound, `step` uses the in-memory fallback (`:220-229`): the denial is still written and answered correctly, but the claimed count is gone. Probe P5 A: two suppressed denials claimed by a late opener never reach the trail; the next opener carries nothing. The aggregated entry of the earlier window exists, so the trail still shows that aggregation happened. I accept this as a residual next to D-ARCH-142's 24 h residual and will add it to threat model §10.4 H at the next threat-model revision; no code change is required.

### PR041-SEC-07 (INFO): client IPs in Valkey keys and snapshots

Rate-limit keys hold the full IPv4 address or the IPv6 /64 (`rl:public:ip:203.0.113.7`) for up to one hour (code review S3, R1-n2). TTLs bound them in memory, but ElastiCache takes a daily snapshot with 7-day retention (platform.md §4.3), so snapshots hold client IPs for up to 7 days. This is a legitimate security purpose and the store is encrypted with access by ACL user, so I accept it, provided the data inventory says so (Valkey: client IP or /64, rate limiting, TTL at most 1 h, snapshots 7 days). A keyed hash of the IP key would remove it from snapshots at the price of a shared key; optional.

### PR041-SEC-08 (INFO): a live composition without `rateLimit` is not refused

Without `deps.rateLimit`, step 0 passes everything through and step 5 is the TASK-020 stub, which refuses only `auth` and `email-send` routes at mount (`app.ts:185`, `:193`). That is the RBAC-matrix seam (PR48-SEC-06), and the production half is pinned by the startApi test. The `authenticate` seam is refused in live mode (`AuthenticateSeamError`, `app.ts:141-145`); the rate-limit seam is not. Defence in depth, cheap: refuse `apiMode === 'live'` without `rateLimit` in `assertBootable`, and list the seam in the matrix app (R1-m6).

## 4. Verification of the focus items

### 4.1 D-SECT39-01 conditions

| Condition | Evidence | Result |
|---|---|---|
| Closed details shapes; no count | `capture.ts` `DenialMark` + `denialDetails`; api test deep-equals plain, crossing and opener (`toEqual`) | Holds |
| `vault` / `ip_hash` rows for N+1 entries only | Suppressed denials return before `capture.denied` (`authorise.ts` `refuseDenied`); api test N+5 denials from distinct IPs: N+1 entries, N+1 × vault rows, last IP absent | Holds |
| Key grammar; no IP, user agent or route | `denialKeys` segment regex; api test scans every key against the grammar and for IP/UA/permission text; P5 hostile replies | Holds |
| TTL 1..60000, never TTL-less | `TAKE_SCRIPT` `PEXPIRE` on 1 plus the `ttl < 0` repair; JS clamps PTTL to 1..60000; P5 C: PTTL 60000 at the first take; carry `EXPIRE 86400` on every increment and restore; `HIT_SCRIPT` and `ACQUIRE_SCRIPT` set TTLs too. Real-Valkey proof: `rate-limit.int.test.ts` (lane B, C1) | Holds (Lua read, emulated; real run pending C1) |
| Atomic Lua; no script injection | Four constant scripts, keys and values as `KEYS`/`ARGV`; Valkey ACL `api` allows `EVAL`, `GETDEL`, `TIME` and `~rl:*` (code twin §1); cluster mode is disabled (platform.md §4.3), so the two-key script cannot hit `CROSSSLOT` (hash tags needed only at the 100× cluster-mode step, platform.md §11) | Holds |
| Carry claim and restore after a failed opener write | `authorise.ts` restores before `next(error)`; P5 C: claim 2, restore 2; P5 B: a failed restore logs `rate_limit.carry_restore_failed` with `{class}` only, no host | Holds (late-reply residual PR041-SEC-06) |
| 429 + `Retry-After` + `RateLimit-*` | `refuseOverBudget`; the problem handler drops only `ETag`, `Last-Modified`, `Content-Disposition`, `Content-Language` and sets `Retry-After` only for an error that carries `retryAfterSeconds` | Holds |
| Failed write answers 5xx | `refuseDenied` `catch` → `next(error)`; api test | Holds |
| Per-instance outage fallback; event once a minute | `step` catch → memory store; `createOutageReporter` per scope; P5 D: seven malformed replies (`'x'` carry, 2^40 carry, PTTL -1, count 0, string count, Infinity, null) all give a safe verdict, malformed ones report `authz-denial` | Holds |
| Counter label only `authz-denial`; not a `RateLimitClass` | `counter.ts` label union; `define-route.ts` unchanged; api test asserts the snapshot | Holds |
| startApi answers 429 at N+1 | `start-api.denial-budget.api.test.ts` drives the real `startApi` with the authenticate seam only | Holds |

### 4.2 PR61-SEC-12 (IPv4-mapped unmapping)

Probe P2 generated 120,000 valid spellings of `::ffff:a.b.c.d` over 3,000 random addresses: dotted or hex tail, `::`, `0::`, `0:0::` … and fully expanded zero groups with 1-4 digits, `::0:` forms, mixed-case `ffff`, zero-padded hex, and a zone on one in seven. 0 failures across `canonicalIp`, `coarseNetwork` (`a.b.c.0/24`) and the limiter's `clientIpKey`. Positive control: the pre-PR regex leaves `::ffff:7f00:1` mapped; the head gives `127.0.0.1`. Near misses stay IPv6 in the audit functions. One divergence without consequence: `express-rate-limit` 8.7.3 also unmaps the deprecated IPv4-compatible `::a.b.c.d` for the limiter key, which merges it with the real IPv4 client's bucket (the conservative direction). **Closed.**

### 4.3 Trusted proxy chain (AT-US-087-04, EC-A12)

Probe P1: a real Express 5 app per hops value 0..5, real loopback sockets, `X-Forwarded-For` built as a chain of k proxies would build it (k = 0..3), with and without a forged leading entry.

| | k = 0 (direct) | k = 1 | k = 2 | k = 3 |
|---|---|---|---|---|
| hops 0 | socket | shared proxy | shared proxy | shared proxy |
| hops 1 | forged → **spoof** | client | shared proxy | shared proxy |
| hops 2 | **spoof** | **spoof** | client | shared proxy |
| hops 3 | **spoof** | **spoof** | **spoof** | client |
| hops 4-5 | **spoof** | **spoof** | **spoof** | **spoof** |

Hops equal to the chain never yields a forged value (0 of 6 rows); 14 of 14 hops-above-chain rows with a forged entry are spoofed (positive control). Garbage `X-Forwarded-For` values (`not-an-ip`, `1.2.3.4:5678`, `[2001:db8::1]`, 4,000 characters) all become the one `unknown` key; a zone is stripped. Probe P6: `clientIpKey` is linear over 16 KiB hostile values (ratio 2k → 16k between 4.8 and 7.3). The PR's api test covers hops 1 with one proxy and hops 0. Deployment conditions: PR041-SEC-05.

### 4.4 The 10× per-IP ceiling for credentialed requests

PR041-SEC-02. The ceiling bounds a forged-credential flood at 6,000/min per IP; it does not tell forged from valid credentials.

### 4.5 Fail-open versus fallback per class

Implemented as REQ-SEC-006 / README §7 specify: `auth` and `email-send` fall back per instance with the same limits; all other classes, step 0 and the SSE slots fail open; one `rate_limit_store_unavailable` per scope per minute. Acceptable for this PR (PR041-SEC-03 names what the fail-open classes rely on). Note that during an outage step 0 is open, so the fallback stores are the only per-IP limit; hence PR041-SEC-01.

### 4.6 Valkey timeouts

Every store call is raced against 250 ms (`withStoreTimeout`, timer `unref`ed, cause never logged); the shared client keeps `commandTimeout` 2 s, `maxRetriesPerRequest` 1 and a capped reconnect backoff, so pending commands are bounded by request rate × about 2 s. A consume makes at most one timed-out call before it switches to the fallback for all its rules. A synchronous throw from `eval` becomes a rejection inside the async store methods. A Valkey brownout adds up to 250 ms per store stage (code review R1-m4, breaker; availability, not a security defect).

### 4.7 Other checks

- **Logging.** `rate_limit_store_unavailable` (`store`, `scope`), `rate_limit_auth` (`class`, `key_type`), `rate_limit.carry_dropped` and `rate_limit.carry_restore_failed` (`class`) carry allow-listed values only; the api test asserts that the Valkey host text is absent. R1-m2 (no `rate_limit_auth` for `email-send`) and R1-m3 (the event wiring and field allow-list unpinned) are security-logging gaps I concur with (A09); no new ID.
- **IDOR / mass assignment / injection / XSS.** Not applicable: no new route, no request body read, no HTML; header values are integers.
- **R1-n3** (`.then(answer, next)`): a throw inside `answer` would be an unhandled rejection, which the process handlers turn into an exit; not reachable today (nothing responds before step 0 or step 5). I concur with the NIT.

## 5. Earlier items

| Item | State |
|---|---|
| PR56-SEC-03 (MEDIUM, T-39; D-SEC-PR56-01) | Implemented as D-SECT39-01 rules (section 4.1). **Closed at merge.** The card's deadline (before the first route with a catalogued permission) is met by this task |
| PR61-SEC-12 (INFO) | **Closed** (section 4.2) |
| PR21-SEC-01 step 5 | **Closed** for anonymous clients (the docs path is limited at step 0, api test); the header-presence residual is PR041-SEC-02 (a) |
| PR48-SEC-06 | Production half pinned (startApi test); listing half open with R1-m6; PR041-SEC-08 adds the live-mode refusal |
| PR61-SEC-04 (LOW, CODEOWNERS) | Still open with devops. This PR adds two more load-bearing unowned files to its list: `packages/config/src/schema.ts` (the `TRUST_PROXY_HOPS` range and every rate-limit bound) and `packages/shared/src/logging/security-event.ts` (the runtime event catalogue and field allow-lists), next to `apps/api/src/{app,start-api}.ts` already listed |

## 6. Code review twin

`7d24349` (APPROVED_WITH_NITS, C1-C6). Its SECURITY-FLAGS, rated:
- **S1 / R1-m1** → PR041-SEC-02 (LOW). I recommend options (a) now and (b) before TASK-052; the architect rules (its C1).
- **S2** → PR041-SEC-05 (INFO), with the full hops matrix and the AWS prefix-list dependency.
- **S3 / R1-n2** → PR041-SEC-07 (INFO).
- **S4 / R1-m4** → availability, not a security defect; I support the breaker.
- **R1-m5** → PR041-SEC-01 (LOW), with a validated fix.
- **R1-m2, R1-m3** → concur (security logging), section 4.7.
- **R1-m8** (ADR-0016 §8 / amendment 1 contradicted) → concur; the architect's amendment should also record the step-0 design that PR041-SEC-02 (b) changes.

## 7. Record binding and simulation

- **The binding.** The single `Head` row names `e6f484a`. The PR changes 19 owned paths.
- **When the fix cycle voids the binding.** Any later change to one of the 19 owned paths (for example `rate-limit/store.ts` for PR041-SEC-01) voids it (S5). Changes to the unowned `app.ts`, `start-api.ts` or `packages/config/**` do not void it for the checker (S6), although `app.ts` carries the trust-proxy setting and the composition; the orchestrator should ask for a delta round in that case too (C3).

**Simulation.** Main's real `tools/ci/check-security-owned-paths.mjs` in a `--shared` sparse clone of this repository, with scenario commits built by plumbing (never checked out in the main checkout), this record placed as `PR-9999-TASK-041-security-review.md`, `--pr 9999 --base 29fe2a1` (the event base is the merge base). Results:

| Scenario | Expected | Result |
|---|---|---|
| S1 Merge ref: the record committed on main (tip `71a2d36` when this round was written), merged with the head | pass | pass |
| S2 The record committed on the branch after the head | pass | pass |
| S3 Control: no record (main merged with the head) | fail | fail (`missing`) |
| S4 Control: the placeholder name `PR-pending-TASK-041-…` | fail | fail (`missing`) |
| S5 Control: an owned path (`rate-limit/store.ts`) changed after the head | fail | fail (`missing`) |
| S6 An unowned path (`app.ts`) changed after the head | pass | pass (the checker does not void the binding; C3 asks for the delta round anyway) |
| S7 Control: a later `FAIL` verdict row | fail | fail (`missing`) |
| S8 Control: the `Head` row names a main commit | fail | fail (`missing`) |
| S9 Control: the `Head` row names `0d87b1a` (owned tests changed after it) | fail | fail (`missing`) |
| S10 Control: the `Head` row names the merge base | fail | fail (`missing`) |

10 of 10 as expected. The record has exactly one `Head` row and one `Verdict` row (the last table row of the file).

## 8. Merge conditions and routes

**Conditions.**
- **C1.** Lane B evidence at the pushed head, including the first run of `rate-limit.int.test.ts` (the Lua scripts against a real Valkey: TTL 1..60000, carry claim and restore, concurrency) and the api suites; the hosted `security-integration` job green.
- **C2.** Rename the record, then confirm that the merge ref contains it (D-ORCH-136/138).
- **C3.** A security delta round on the fix-cycle head if it changes any owned path, `app.ts`, `start-api.ts` or `packages/config/src/schema.ts`. The code twin's C1 (architect ruling on R1-m1) and the MINOR fixes make such a cycle likely.

**Routes.**
- **PR041-SEC-01:** this PR's fix cycle with R1-m5; at the latest before TASK-049 merges.
- **PR041-SEC-02:** (a) this PR's fix cycle; (b) principal-architect ruling (code twin C1), implemented before TASK-052 merges; the AT-US-040-10 emission rule to product-manager if (b)'s once-per-window emission is wanted.
- **PR041-SEC-03:** principal-architect (ADR-0010 amendment items 2-3 store-failure mode), product-manager (A-053), before the first `public-quote` / `public-tracking` route.
- **PR041-SEC-04:** data-architect and devops (OI-15), with the TASK-214 alarms.
- **PR041-SEC-05:** devops (IaC pin and post-deploy smoke before G4); the schema default 0 in this PR or by devops.
- **PR041-SEC-06:** security-analyst, threat model §10.4 H at the next revision.
- **PR041-SEC-07:** data-architect (data inventory).
- **PR041-SEC-08:** this PR's fix cycle with R1-m6, or TASK-289.

| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium. D-SECT39-01 items 1-6 hold as implemented; PR61-SEC-12 closed; PR56-SEC-03 closed at merge. New: PR041-SEC-01 LOW (O(n) fallback-store eviction, fix validated on a scratch copy), PR041-SEC-02 LOW (self-declared credential lifts the step-0 budget 50 times), PR041-SEC-03..08 INFO. Conditions: C1 lane B (first real-Valkey run of the Lua scripts) and hosted `security-integration` at the pushed head, C2 rename and merge-ref confirmation, C3 security delta round on a fix head that touches owned paths, `app.ts`, `start-api.ts` or the configuration schema |

---

# Round 2: delta review of part 041-A at `3a6b4c8b` (2026-11-20)

| Field | Value |
|---|---|
| Head | 3a6b4c8bf5e05bb1ca8c74f391745bc314c0f44d |
| Range | `ba4d0aaa` (merge of main `6ab40f28` into `e6f484a`) + `3a6b4c8b` (fix, 29 files, +473/-86). `git merge-tree --write-tree e6f484a 6ab40f28` gives exactly the tree of `ba4d0aaa`, so the merge is a pure union; main's changes from `29fe2a1` to `6ab40f28` and from `6ab40f28` to its tip are docs only |
| Merge base with main | `6ab40f28` (the event base once the PR exists). Main tip when this round was written: `cb2ed535` |
| Owned paths changed | 27 at this head (`--base 6ab40f28 --head 3a6b4c8b`, main's checker), up from 19: the round-1 set plus `apps/api/package.json`, `package-lock.json`, `packages/config/src/guards.ts`, `rate-limit/bounded-map.ts`, `rate-limit/tests/settings.ts` and three test files under `platform/openapi` and `platform/routing`. Main's classifier: `security_paths=true` (32 paths; the lockfile is a production-closure change) |
| Lane A / lane B evidence | None at review time (branch not pushed) |
| Binding items checked | ADR-0016 amendment 12 and `rulings/wave-1-task-041-rulings.md` (D-ARCH-173..179, change list A1-A8, part 041-B list B1-B5 for the concurrence items); D-ARCH-181; D-QG-001 (QG-041-C4 addressed to me); D-API-003; D-ORCH-140; risks.md R-ARCH-36; ADR-0006 amendment 1 (refresh cookie `Path=/`, same host). Code review round 2 on main: `cb2ed535` (APPROVED_WITH_NITS, R2-n1, R2-n2) |
| Reviewer / date | security-analyst, 2026-11-20, round 2 (delta), pre-push. Same host rule and method as round 1: static review plus single-process Node 24 probes on a `git archive` extract of `3a6b4c8b`, with the round-1 extract of `e6f484a` as the positive control. Nothing ran in either PR worktree; commits were read from the main checkout's object store |

## R2.1 Summary

Part 041-A implements A1-A8 as ruled, and the probes confirm the four security items it closes:

- **PR041-SEC-01 is closed.** `BoundedMap` sweeps at most 8 head entries per new key and evicts the oldest at the bound; windows, slots, denial windows and carries all use it. Probe P4 at 50,000 live windows, a new IPv6 /64 per request through the limiter's fallback path: 0.0165 ms at `3a6b4c8b` against 1.12 ms at `e6f484a` (control: 0.0158 ms with 1,000 windows). The size never exceeds the bound.
- **PR041-SEC-02 (a) is closed.** Probe P8 (the real `ipLimiter` on Express 5, raw request targets): 19 of 19 shapes take the expected rule. `OPTIONS`, `/api/docs/`, `/nope`, `/api/v10/…`, `/API/V1/…`, `/api/%761/…`, `//api/v1/…` and `/api/v1%2fx` with a junk bearer all take the anonymous budget; `/api/v1`, `/api/v1/…`, `HEAD`, absolute-form targets and a cookie or quote token under `/api/v1` take the ceiling; the probes stay uncounted. The same probe at `e6f484a` puts 8 of those shapes under the ceiling (positive control). Part (b) moves to part 041-B as D-ARCH-175.
- **PR041-SEC-05 is closed in the code.** Default 0 and a guard for the API in staging and production. Probe P9 through the real `loadConfig`, 15 spellings × 3 environments: unset and `""` give `missing`; `0`, `00` and `-0` give `forbidden-in-environment` (`trustProxy.hops`); `1`, ` 1`, `1.0`, `+1`, `1e0`, `2` and `5` load as integers; `0x1`, a non-ASCII digit and `6` are invalid; local accepts unset and 0; the worker is exempt. The IaC pin and the post-deploy smoke check stay with TASK-215 and devops (D-ARCH-179 items 5 and the "not a card" line).
- **PR041-SEC-08 is closed.** Probe P10: `createApp` throws `RateLimitMissingError` for `apiMode: 'live'` without `rateLimit`, and accepts it with `rateLimit`, in `test` mode, or with no mode; `startApi` passes `rateLimit: { settings: config, valkey: services.valkey }`. Note: `resolveApiMode` gives `live` for `production` only, so in staging the refusal does not apply and the startApi composition test is the control. That is enough for defence in depth; no new item.

Also verified: the lockfile delta of the fix commit is exactly two paths (`packages/apps/api/dependencies/rate-limit-redis` and `packages/node_modules/rate-limit-redis` removed; deep JSON diff, with the merge's lockfile equal to main's `6ab40f28` as the control). `rate_limit_auth` is emitted once per key and window from the store's own count (`first = count === limit + 1`), for `auth` and `email-send`, and the counter still counts every refusal. Both slots now use `.then(...).catch(next)` (round-1 R1-n3).

One new LOW, PR041-SEC-09, on part 041-B's design and not on this head's code: the lock of the failed-authentication budget reaches further than ADR-0016 amendment 12 item 4 and R-ARCH-36 (b) say (section R2.4). It does not block part 041-A.

## R2.2 Round-1 findings at `3a6b4c8b`

| ID | State |
|---|---|
| PR041-SEC-01 (LOW) | **Closed** (A8, probe P4) |
| PR041-SEC-02 (LOW) | (a) **closed** (A1/A3, probe P8). (b) open, part 041-B (D-ARCH-175, B1), due before TASK-052 is dispatched |
| PR041-SEC-03 (INFO) | **Routed and ruled:** carrier admission refuses on a store failure (ADR-0010 amendment 13, TASK-190); `public-quote`, `public-tracking` and `quote-create` fall back per instance in part 041-B (B4). I check B4 in the 041-B round |
| PR041-SEC-04 (INFO) | Open with data-architect and devops; the `rl:` key-count gauge is now a TASK-214 card line (rulings §6 line 8) |
| PR041-SEC-05 (INFO) | **Closed in the code** (A6, probe P9); IaC pin TASK-215, smoke check devops before G4 |
| PR041-SEC-06 (INFO) | Open, mine: threat model §10.4 H, due before G3 together with the R-13, T-11, T-39 and T-93 alignment that QG-041-C4 asks for |
| PR041-SEC-07 (INFO) | Open with data-architect (data inventory); the architect ruled no keyed hash (rulings §7) |
| PR041-SEC-08 (INFO) | **Closed** (A8, probe P10) |

## R2.3 QG-041-C4: concurrence on ADR-0016 amendment 12

D-QG-001 asks for explicit concurrence or findings on items 2, 3, 5, 6 and 9 in this round, and on items 4, 7 and 8 in the 041-B round. The coordinator also asked for my position on two parts of item 4 now.

| Item | Position |
|---|---|
| 2. Step 0 is route-agnostic, two per-IP rules, factor 10 as a constant, counter label `step0-credentialed` | **Concur.** A limiter mounted before routing cannot apply route classes; the label gives the tuning signal |
| 3. Which rule a request takes | **Concur**, verified by P8. Residual R-ARCH-36 (c), an unknown path under `/api/v1` answered at the ceiling rate, is accepted: its 404 or 405 costs no more than a 429. The signature headers join in part 041-B (B2) |
| 5. Class rules at step 5 for every class; no third stage | **Concur for now**, on two conditions that already sit on the cards: the authenticator cost rules of item 4 are pinned by the forged-credential tests of TASK-052, -055, -091, -171 and -261 (rulings §6 lines 2-5), and I rate R-ARCH-36 (a) at TASK-055. If an authenticator needs I/O before its credential has verified, I will ask for the third stage (rulings §8, first option) |
| 6. `rate_limit_auth` once per key and window, plus a counter | **Concur.** It was my proposal. During a store outage it is once per instance, which is acceptable |
| 9. Client IP: default 0, guard, Compose 1, AWS 2 with a Terraform pin, `CloudFront-Viewer-Address` not read | **Concur**, verified by P9 (code). One mechanism for the client IP is the right call. The `compose.debug.yaml` loopback residual is accepted |
| 4, first point: the session authenticator reads `exp` from the unverified payload before the signature, and 401 `ACCESS_TOKEN_EXPIRED` spends nothing | **Concur, with conditions E1-E5 below** (rulings §6 line 2 / TASK-052 and the B1 wrapper) |
| 4, second point: 120 bad credentials a minute stop all credentialed traffic of the IP for the window | **Partial concurrence:** the budget, its key, its size and its signal are right; the scope of the lock is broader than recorded. Finding PR041-SEC-09 (LOW) below |

**Why the `exp` exception is safe.** An early refusal based on an unverified claim can only reject, never accept, so it cannot authenticate anyone. A forged token with a past `exp` gets the same 401 a genuine expired token gets, so the answer is no signature oracle. And skipping the spend buys an attacker nothing: probe P7 on this host rejected a forged ES256 bearer through `jose.jwtVerify` in about 400 µs, and refused a forged expired token with the pre-check in about 4.6 µs, so an expired token costs less than the 429 the budget would answer. The step-0 ceiling still bounds its rate. Conditions for TASK-052 and the B1 wrapper:

- **E1.** The unverified `exp` is used for one decision only, an early refusal. Every token that passes the pre-check is verified in full (`algorithms: ['ES256']`, issuer, audience, the same clock tolerance as the pre-check). Nothing else from the unverified payload is read or logged.
- **E2.** Only a well-formed token whose `exp` is a finite number in the past is "expired". A missing, non-numeric, non-finite or out-of-range `exp`, or a malformed structure, is a refused credential and spends.
- **E3.** The pre-check is bounded: a length cap on the token, three base64url segments, the header's `alg` equal to `ES256` before the payload is decoded.
- **E4.** `ACCESS_TOKEN_EXPIRED` is raised only by that pre-check (or by `jose`'s own expiry check inside the tolerance), emits no security event and adds no log line beyond the access log. The wrapper's exemption keys on that code alone.
- **E5.** Tests in TASK-052: 200 forged tokens with a past `exp` give 200 × 401 `ACCESS_TOKEN_EXPIRED`, zero signature verifications, zero store and database calls, no security event and no 429; a forged token with a future `exp` causes one verification and spends one unit.

## R2.4 New finding

| ID | Severity | CWE / OWASP 2021 | Where | Title | Owner, due |
|---|---|---|---|---|---|
| PR041-SEC-09 | LOW | CWE-410 / A04 | ADR-0016 amendment 12 item 4 (accepted property); rulings B1 ("Answer when the budget is spent"); R-ARCH-36 (b); step-0 selector `limits.ts` (`presentsCredential` counts the refresh cookie) | The failed-authentication lock refuses every credentialed request of the IP, including the sign-in of every browser that holds a refresh cookie | principal-architect, before part 041-B merges |

**What the lock reaches.** Under B1, while an IP's failed budget is spent, step 0 answers 429 to every request from that IP that takes the credentialed rule. Three facts make that wider than item 4 and R-ARCH-36 (b) state:

1. **Returning browsers are always credentialed.** `__Host-rt_web` has `Path=/` and the API shares the app's host (ADR-0006 amendment 1, PD-01), so every browser that has signed in sends the cookie on every `/api/v1` request, sign-in included. `presentsCredential` counts the cookie, and P8 confirms that a cookie-only request under `/api/v1` takes the ceiling. "Sign-in without a credential header still works" therefore holds only for browsers that never signed in or cleared their cookies.
2. **Valid credentials are refused, not only forged ones.** Every signed-in user and every guest with a quote token behind that IP (an office NAT, a carrier-grade NAT, a VPN exit, an IPv6 /64) gets 429 until the window ends. My own round-1 sketch said that "NAT neighbours keep their per-user budgets, because valid credentials do not spend it". That was incomplete: they do not spend it, but they are refused while it is spent. QG-041-C4 is right that the comparison with the `auth` class understates this, since that class stops sign-in routes only.
3. **It is cheap to sustain.** One client on the shared address keeps the lock with 2 bad credentials a second, 50 times less than exhausting the 6,000/min ceiling. Non-malicious triggers exist too: a client that keeps retrying a revoked or rotated token.

**Rating.** Impact Medium (authenticated service denied to everyone behind one address, renewable every minute); likelihood Low (the client must share the victims' address; non-malicious loops are possible but the SPA signs out after a failed refresh): **LOW**. Nothing is reachable until part 041-B and TASK-052 land.

**Remediation (design, for the architect).**

- **R1 (recommended, cheap).** The refresh cookie selects the credentialed rule, and therefore the lock, only on the paths of routes that declare `refresh-cookie` (`refreshSession`, `logoutSession`, `getCsrfToken`). `createApp` derives that path set from route metadata and passes it to `ipLimiter`, as it passes `API_PREFIX` now. A passive cookie on sign-in and on public reads then counts as an unauthenticated request, so returning users can still sign in during a lock. It also makes the ceiling more accurate.
- **R2 (choose one).**
  - (i) Keep the lock for every presented credential, and record its true scope. That means ADR-0016 amendment 12 item 4 and R-ARCH-36 (b) without the `auth`-class comparison, a B1 test row in which a valid bearer from a locked IP gets 429 with `Retry-After` (an accepted property, pinned), and an alert on `rate_limit_auth` class `authn-failed` when TASK-214 exports it.
  - (ii) Or narrow the lock to the kinds whose refusal can cost I/O (the refresh cookie). Bearer, quote-token and signature requests verify with CPU only under the item 4 rules, so they would continue under the ceiling, still spending and still logged. This trades about 400 µs per forged bearer (P7, this host: at most about 4 % of a core per attacking address at 6,000/min) for no collateral on valid bearers.
- **My preference: R1 plus R2 (i).** It keeps the bound on verification CPU and is honest about the collateral.

**Verification test (part 041-B).** With the budget spent for IP A:
- a request from A that carries only `__Host-rt_web` to the sign-in route is not refused at step 0 (R1);
- a valid bearer from A gets 429 with `Retry-After`, if R2 (i) is chosen;
- a credentialed request from IP B is served.

## R2.5 Probes

| Probe | What | Result |
|---|---|---|
| P4 (re-run) | Fallback cost at 50,000 live windows, head vs `e6f484a` | 0.0165 ms vs 1.12 ms per new-key request (control 0.0158 ms) |
| P7 | ES256: `jose.jwtVerify` valid and forged, against an `exp` pre-check | about 400 µs either way for full verification; 4.6 µs for the pre-check; a forged expired token is classified as expired |
| P8 | Step-0 rule selection, 19 request shapes, head vs `e6f484a` | 19/19 at the head; 11/19 at `e6f484a` (8 shapes under the ceiling: positive control) |
| P9 | `TRUST_PROXY_HOPS` through `loadConfig`, 15 spellings × production / staging / local, plus the worker | As listed in R2.1; no spelling reaches 0 in a hardened environment without an issue |
| P10 | `createApp` live without `rateLimit` | Refused (`RateLimitMissingError`); the other three cases accepted |
| Lockfile | Deep JSON diff `ba4d0aaa` → `3a6b4c8b` | Two paths, both `rate-limit-redis`, removed; nothing added |
| Merge | `merge-tree` of `e6f484a` and `6ab40f28` | Tree equals `ba4d0aaa`; no non-docs drift on main |

## R2.6 Record binding and simulation

- **The binding.** This round's `Head` row names `3a6b4c8b`. Round 1's row (`e6f484a`) is voided by the owned paths the fix changes, so it only produces a note.
- **Later commits.** The user will add a `.env.example` commit and a lane-B evidence commit after the head. Neither path is security-owned: CODEOWNERS owns `/compose.env` and `/compose*.yaml` but no `.env*` file, and evidence goes under `docs/05-quality/tests/runs/`. So the binding to `3a6b4c8b` survives both (S2). I did not open `.env.example`. The simulation uses a synthetic placeholder blob at that path.

**Simulation.** Main's real `tools/ci/check-security-owned-paths.mjs` in a `--shared` sparse clone, scenario commits by plumbing, this record (rounds 1 and 2) placed as `PR-9999-TASK-041-security-review.md`, `--pr 9999 --base 6ab40f28`:

| Scenario | Expected | Result |
|---|---|---|
| S1 Merge ref: rounds 1 and 2 committed on main, merged with the head | pass | pass |
| S2 The head plus a `.env.example` commit and an evidence commit (`docs/05-quality/tests/runs/`) | pass | pass |
| S3 Control: the round-1 record only (as on main before this round) | fail | fail (`missing`) |
| S4 Control: no record | fail | fail (`missing`) |
| S5 Control: the placeholder name only | fail | fail (`missing`) |
| S6 Control: an owned path (`rate-limit/store.ts`) changed after the head | fail | fail (`missing`) |
| S7 An unowned path (`app.ts`) changed after the head | pass | pass |
| S8 Control: a later `FAIL` verdict row | fail | fail (`missing`) |
| S9 Control: the round-2 `Head` row names a main commit | fail | fail (`missing`) |
| S10 Control: after the user and evidence commits, an owned path (`guards.ts`) changes | fail | fail (`missing`) |

10 of 10 as expected. S3 shows that the round-1 record alone no longer passes at this head, so this appended round is required. The record has two `Head` rows (one per round) and the last `Verdict` row is this round's.

## R2.7 Conditions and routes

**Conditions (part 041-A).**
- **C1.** Lane B at the pushed head, including the first run of `rate-limit.int.test.ts` (real-Valkey Lua, now with a 5 s bound), and the hosted `security-integration` job green. The lockfile change makes the production-closure part of the lane-A dependency gates apply.
- **C2.** The rename of this record and the merge-ref check (D-ORCH-136/138), as in round 1.
- **C3.** A security delta round if anything after `3a6b4c8b` changes an owned path, `app.ts`, `start-api.ts` or `packages/config/src/schema.ts`. The `.env.example` and evidence commits do not need one.

**Routes.**
- **PR041-SEC-09:** principal-architect, R1 and the R2 choice before part 041-B merges; the B1 test rows in part 041-B.
- **E1-E5:** TASK-052 (card line 2) and part 041-B (B1 wrapper). I check them in the 041-B round and at TASK-052.
- **Part 041-B round (QG-041-C4 second half):** items 4 (with PR041-SEC-09 and E1-E5), 7 (breaker) and 8 (fallback set, closes PR041-SEC-03 on the HTTP side), before TASK-052 is dispatched.
- **Mine, before G3:** threat model R-13, T-11, T-39 and T-93 aligned with ADR-0016 amendment 12, plus PR041-SEC-06 in §10.4 H.
- Code review R2-n1 (README §13 wording) and R2-n2 (the default prefix argument): no security effect; I agree with both.

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 2 (delta, part 041-A) at `3a6b4c8b`: 0 Critical, 0 High, 0 Medium. Closed: PR041-SEC-01, PR041-SEC-02 (a), PR041-SEC-05 (code), PR041-SEC-08. QG-041-C4 first half: concurrence on ADR-0016 amendment 12 items 2, 3, 5, 6 and 9; on item 4, concurrence with the `exp` pre-check under conditions E1-E5, and new PR041-SEC-09 LOW (the failed-authentication lock refuses every credentialed request of the IP, including returning browsers' sign-in), routed to principal-architect before part 041-B merges. Conditions: C1 lane B and hosted `security-integration` at the pushed head, C2 rename and merge-ref confirmation, C3 delta round only if a later commit touches owned paths, `app.ts`, `start-api.ts` or the configuration schema; the `.env.example` and evidence commits keep the binding |
