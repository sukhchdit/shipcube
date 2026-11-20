# PR-pending: TASK-075 (CarrierAdapter contract, CarrierContext, capability guard, normalisation and egress contract), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-075-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control S6).

Order (D-ORCH-136, D-ORCH-138):
1. Open the PR as a draft.
2. Rename the record on main.
3. Confirm that the PR's merge ref contains the renamed record: `git fetch origin refs/pull/<n>/merge`, then `git ls-tree` it. Its first parent must be the rename commit or later.
4. Mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-075-carrieradapter-contract-carriercontext-capability-guard`, one commit `c2eaa47` on `5145d52` (an ancestor of main; main has moved by docs, `tools/db`, `tools/quality` and `prisma/tests` commits, none of which touch this PR's paths) |
| Head | c2eaa47dfafc6ac230e332a55bdbc4e8d7a1ebc9 |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs`, run from the main checkout on `5145d52..c2eaa47`) gives `security_paths=true`: the one trigger path is `packages/config/src/carrier-environment.test.ts` (`packages/config/**`), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None for `c2eaa47` at review time. The code review twin quotes the developer's report (167/167 unit tests, 99.87 % lines / 99.04 % branches on `packages/carriers`); I did not read run files |
| Owned paths changed | 1, as main's checker counts them (`--base 5145d52 --head c2eaa47`): `tools/lint/carrier-wire-boundary.test.ts` (`/tools/lint/`). So this record is a merge condition |
| Unowned paths changed | 25: `packages/carriers/src/**` (24 files: contract, context, capabilities, guard, registry, errors, labels, egress, canonical codes and types, normalise, test doubles, tests) and `packages/config/src/carrier-environment.test.ts` |
| Binding items checked | The TASK-075 card (`docs/04-plan/tasks/WAVE-02.md`); ADR-0010 §Interface and am. 11 items 2, 3, 6 and 8 (D-ARCH-057, D-ARCH-068); PR6-SEC-01, PR6-SEC-06, PR6-SEC-11, PR6-SEC-12 (PR #6 record) and the TASK-113 card text for SEC-TC-66; CLAUDE.md §5 (production carrier endpoints not before G4, Mock until sandbox credentials exist); `packages/config/src/schema.ts:237`; the platform error serializer (`packages/shared/src/logging/serializers/error.ts`). The code review twin on main: `docs/05-quality/reviews/PR-pending-TASK-075-code-review.md` (`29fe2a1`, CHANGES_REQUESTED, section 6) |
| Reviewer / date | security-analyst, 2026-11-19, round 1, pre-push. Host rule (lane B owns the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node 24 probes on `git archive` extracts of `c2eaa47` and `5145d52`, with the sources type-stripped by a resolve/load hook and bare packages resolved from the main checkout. Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Line numbers come from single-file reads at `c2eaa47` |

## 1. Summary

The contract is sound where the PR's tests look, and the focus items hold in their direct form:

- **Egress rules are exact.** 33 origin shapes and 17 prefix shapes went through `egressIssues`. IP literals in six notations, IPv6, wildcards (also `%2A`), IDN, upper case, ports (also `:443`), credentials (also an empty userinfo), backslash, TAB/LF, query, fragment, single-label hosts, dot segments, `%`, `//` and relative prefixes are all refused. `deriveCarrierEgressRules` reads no configuration, fails closed for a carrier without `EGRESS` (also `__proto__`/`constructor`), and refuses a production account or rule outside `APP_ENV=production`.
- **`packages/config`** refuses `CARRIER_<X>_ENVIRONMENT=production`, and 8 other non-`sandbox` spellings, under all four APP_ENVs (PR075-SEC-09, section 4.7).
- **`CarrierError`** takes its message from the canonical code and serialises a safe subset; unknown carrier codes are logged in a safe shape only; every mapping lookup goes through a `Map`.
- **Labels** are inline bytes; URL and base64 strings are refused and PDF formats need `%PDF-`. Nothing in `src` performs I/O (no `fetch`, `http`, `undici` or `process.env` outside tests).
- **The guard** refuses an unsupported operation before the context check and before the adapter, with zero I/O.

Four LOW findings, all cheap now and costly after four adapters:

- **PR075-SEC-01:** the guard validates the caller's context object and then hands that same object to the adapter. A getter, a Proxy or a mutation after the adapter's first `await` makes the adapter see `production` where the guard checked `sandbox`, and `egressBase` then yields the production base. A snapshot fix is validated on a scratch copy.
- **PR075-SEC-02:** tier separation on a shared origin is one-directional and not validated. `egressIssues` accepts a sandbox list that covers production paths (a DHL `/mydhlapi/` or FedEx `apis.fedex.com` copied into `sandbox`), and such a rule is then a *sandbox-tier* rule that neither the start-up refusal nor TASK-113's tier check can see. The reverse direction (production reaching `/mydhlapi/test/`) is the code twin's S1. A cross-tier check is validated on a scratch copy.
- **PR075-SEC-03:** ZPL content is not checked at all (PNG, GIF, JPEG, PDF, HTML and EPL bytes pass as ZPL), and the guard does not re-check the labels that `createShipment`/`recoverLabel` return.
- **PR075-SEC-04:** raw carrier text reaches the logs through `CarrierError.cause` and through non-`CarrierError` failures, which the guard passes unchanged (security rating of code review R1-m5 and R1-n7).

Five INFO items: PR075-SEC-05 to -09.

## 2. Findings

| ID | Severity | CWE / OWASP 2021 | Where (`c2eaa47`) | Title | Owner, due |
|---|---|---|---|---|---|
| PR075-SEC-01 | LOW | CWE-367 / A04 | `packages/carriers/src/guard.ts:85-89`, `:101-112`; `context.ts:96-107` | The guard checks one read of the context and passes the live object on | This PR's fix cycle; at the latest before the first real adapter (TASK-135/139/140) merges |
| PR075-SEC-02 | LOW | CWE-183 / A05 | `egress.ts:82-103` (tier check `:99`), `:132-158`; ADR-0010 am. 11 items 6 and 8 | Tier separation on a shared origin is one-directional and not validated | (a) this PR; (b) TASK-113; (c) orchestrator, CODEOWNERS before TASK-135 |
| PR075-SEC-03 | LOW | CWE-20 / A04 | `labels.ts:26`; `labels.test.ts:53-62`; `guard.ts:102`, `:112` | ZPL content is unchecked, and returned labels are not re-checked | This PR's fix cycle; at the latest before TASK-135/139/140 |
| PR075-SEC-04 | LOW | CWE-532 / A09 | `normalise/normalise.ts:135`; `errors.ts:1-6`, `:21`, `:40`; `guard.ts:89` | Raw carrier text reaches logs through `cause` and unconverted failures | `normaliseError`: this PR; conversion: TASK-132 (code review R1-n7) |
| PR075-SEC-05 | INFO | CWE-20 / A04 | `errors.ts:39-48` | `CarrierError` keeps a runtime-invalid code, carrier or operation | This PR (with R1-n2) |
| PR075-SEC-06 | INFO | CWE-20 / A05 | `egress.ts:91-100`, `:109`, `:157` | `EGRESS` rules are an open schema; unknown keys reach the allow-list | This PR (with R1-n1, R1-n10) |
| PR075-SEC-07 | INFO | CWE-779 / A09 | `normalise/normalise.ts:77-85`, `:161-169` | One warn line per distinct unmapped code, unbounded per call | This PR or TASK-132 |
| PR075-SEC-08 | INFO | CWE-117 / A09 | `registry.ts:41` | `registry.get` echoes the caller's code into the error message | This PR |
| PR075-SEC-09 | INFO | CWE-1188 / A05 | `egress.ts:136`; config `schema.ts:237` | Before G4, "sandbox only" holds for configuration, not for database accounts | TASK-128 (carrier_accounts), TASK-113 (assembly) |

## 3. Findings in detail

### PR075-SEC-01 (LOW): the guard checks one read of the context and passes the live object on

**Where.** `run` (`guard.ts:85-89`) validates `ctx` with `contextIssues(ctx, code)` (`:87`) and then returns `call()`. Each facade closure (`:101-112`) calls the adapter with the caller's original `ctx`. `contextIssues` (`context.ts:96-107`) reads each field once.

**Probe P2** (`p2-guard.mjs`, head extract; an adapter that records `ctx.environment`, `ctx.account.environment` and `new URL('rates', egressBase(EG, ctx))` before and after an `await`; `EG` = sandbox `/v1/test/`, production `/v1/` on one origin):

| Context handed to the guard | Guard | Adapter sees (sync / after await) |
|---|---|---|
| Control: `fakeContext()` (frozen) | accepted | sandbox, `/v1/test/rates` / same |
| Control: `{ ...fakeContext(), environment: 'production' }` | refused | not reached |
| Control: another carrier's account | refused | not reached |
| `environment` getter: `sandbox` on the first read, `production` after | accepted | **production, `/v1/rates`** / same |
| Getters on `account.environment` and `environment` | accepted | **production, `/v1/rates`** / same |
| Plain object, mutated by the caller after the call starts | accepted | sandbox / **production, `/v1/rates`** |
| Proxy whose `environment` flips after the first read | accepted | **production, `/v1/rates`** / same |
| Hand-built: `deadlineAt: 'not a date'`, `locale` with CRLF, a 100,000-character `mockScenario` | accepted | reaches the adapter (code review R1-n5) |

**Exploitability and impact.**
- **Who.** In-process code that builds or reuses a mutable context, by mistake (a context object reused across accounts or retried calls) or by a hostile dependency. No external input reaches it directly; contexts made by `createCarrierContext` are frozen and safe.
- **What breaks.** The guard's documented property ("every call's context must belong to the adapter's carrier, with the account's own environment"; `context.ts:93-95` "a context assembled by hand cannot split the two") does not hold for the object the adapter uses. The adapter picks the other tier's base for a call the guard accepted for this tier. TASK-113's `rule.tier === ctx.environment` reads the same live object later, so it agrees with the adapter, not with the guard.
- **Before G4** the start-up refusal keeps production-tier rules out of the allow-list, so such a call is blocked by TASK-113. After G4, with both tiers enabled, it reaches the other tier.
- **Rating.** Impact Medium × likelihood Low = **LOW**.

**Remediation (code level, `guard.ts`).** Read every field once into a frozen, fully validated copy and give the adapter that copy. Validated on a scratch copy of `c2eaa47` (`apply-fix.mjs`): with it, every row above sees `sandbox` and `/v1/test/rates` or is refused, the three controls are unchanged, and the hand-built row is refused with the factory's messages. The PR's `guard.test.ts:113-124` uses `toEqual`, so it still passes with a copy.
```ts
import { type CarrierAccountRef, type CarrierContext, contextIssues, createCarrierContext } from './context.js';

const snapshotContext = (ctx: unknown, operation: CarrierOperation): CarrierContext => {
  const refuse = (problems: string[]): never => {
    throw new CarrierContractError(`invalid CarrierContext for ${code}.${operation}`, problems);
  };
  if (typeof ctx !== 'object' || ctx === null) return refuse(['context must be an object']);
  // One read per field: getters and Proxy traps run once, later mutation cannot reach the copy.
  const { account, environment, correlationId, locale, deadlineAt, mockScenario } = ctx as Partial<Record<keyof CarrierContext, unknown>>;
  if (typeof account !== 'object' || account === null) return refuse(['account must be an object']);
  const { id, code: accountCode, carrierCode, environment: accountEnvironment } = account as Partial<Record<keyof CarrierAccountRef, unknown>>;
  let copy: CarrierContext;
  try {
    copy = createCarrierContext({
      account: { id, code: accountCode, carrierCode, environment: accountEnvironment } as CarrierAccountRef,
      correlationId: correlationId as string,
      deadlineAt: deadlineAt as Date,
      ...(locale === undefined ? {} : { locale: locale as string }),
      ...(mockScenario === undefined ? {} : { mockScenario: mockScenario as string }),
    });
  } catch (error) {
    return refuse(error instanceof CarrierContractError ? [...error.issues] : ['context could not be read']);
  }
  const problems = contextIssues({ ...copy, environment }, code); // the caller's environment, read once
  return problems.length > 0 ? refuse(problems) : copy;
};
const run = async <R>(operation: CarrierOperation, ctx: unknown, call: ((ctx: CarrierContext) => Promise<R>) | undefined): Promise<R> => {
  if (!supported(operation) || call === undefined) throw new CarrierError('CAPABILITY_NOT_SUPPORTED', { carrier: code, operation });
  return call(snapshotContext(ctx, operation));
};
// each operation passes the copy, e.g.:
getRates: (req, ctx) => run('getRates', ctx, (c) => adapter.getRates(req, c)),
validateAddress: (address, ctx) => run('validateAddress', ctx, validateAddress && ((c) => validateAddress(address, c))),
```
This also closes code review R1-n5: one validator for the factory and the guard.

**Verification test (`guard.test.ts`).** For a getter-flipping context, a Proxy, and a plain context mutated after the call starts, the adapter receives a frozen context whose `environment` and `account.environment` are both `sandbox` on every read, and an `egressBase` built inside the adapter is the sandbox base. A hand-built context with an invalid `deadlineAt`, `locale` or `mockScenario` is refused before the adapter, with zero network attempts.

### PR075-SEC-02 (LOW): tier separation on a shared origin is one-directional and not validated

**(a) Sandbox lists may cover production paths.** `egressIssues` (`egress.ts:82-103`) checks that a rule's `tier` equals the list it sits in (`:99`). That is a label check: it never compares a table's sandbox list with its production list. Probe P6 (`p6-fix-tables.mjs`):

| Table | Head: issues | Candidate: issues |
|---|---|---|
| The PR's `FAKE_EGRESS` (one origin, sandbox `/v1/test/`, a shared exact `/oauth/token`) | 0 | 0 |
| The PR's `OTHER_EGRESS` | 0 | 0 |
| ADR rows: UPS, FedEx (with ETD), DHL Express | 0, 0, 0 | 0, 0, 0 |
| Mock (empty lists) | 0 | 0 |
| DHL with sandbox prefix `/mydhlapi/` (= production) | **0** | 1 |
| DHL with sandbox prefix `/` | **0** | 1 |
| FedEx with `https://apis.fedex.com` copied into `sandbox` | **0** | 1 |
| UPS with `https://onlinetools.ups.com` `/api/` in `sandbox` | **0** | 1 |

`deriveCarrierEgressRules` serves such a rule as a **sandbox-tier** rule under `APP_ENV=local`. So neither its production refusals (`:136`, `:153`) nor TASK-113's `rule.tier === ctx.environment` see a production endpoint, and a sandbox account reaches production paths before G4 (CLAUDE.md §5). The per-adapter test that ADR item 6 requires ("a sandbox context never emits a URL outside its sandbox prefixes") reads the same wrong table and still passes. The tables live in `packages/carriers/src/adapters/<carrier>/egress.ts`, which is not a security-owned path, so a later edit needs no security record.

**(b) Production may reach the sandbox prefix (code review S1 / R1-m4, concurred).** In the real DHL table, production `/mydhlapi/` covers sandbox `/mydhlapi/test/`. ADR item 6's tier equality and ADR item 8's `carrierUrl` (`URL_ESCAPE` when the URL leaves the base *prefix*) both let a production context reach `/mydhlapi/test/...`. After G4, a paid production booking that lands in the DHL test system is a captured payment without a real shipment (a CLAUDE.md §1 guardrail).

**Exploitability and impact.** Both need a defect, not an attacker: (a) a wrong static table, (b) a production path built to include `test/`. Impact: production carrier endpoints reached with sandbox credentials before G4 (whether they authenticate there is carrier-specific), or a test booking for a paying customer after G4. Impact Medium × likelihood Low = **LOW**.

**Remediation.**
- **(a) This PR, `egress.ts`.** Refuse a sandbox *prefix* that covers a production entry on the same origin. An identical exact path in both lists (a token endpoint shared by both tiers, as the PR's own `FAKE_EGRESS` has) stays allowed, because the credentials decide its tier. Validated on the scratch copy: the 6 valid tables give 0 issues, the 4 misfiled ones 1 each.
  ```ts
  /** A sandbox prefix (an entry ending in `/`) must not cover any production entry on the same origin. */
  function crossTierIssues(egress: CarrierEgress): string[] {
    const issues: string[] = [];
    egress.sandbox.forEach((sandboxRule, s) => {
      for (const productionRule of egress.production) {
        if (productionRule.origin !== sandboxRule.origin) continue;
        for (const entry of sandboxRule.pathPrefixes.filter((p) => p.endsWith('/'))) {
          for (const other of productionRule.pathPrefixes) {
            if (other.startsWith(entry)) issues.push(`EGRESS.sandbox[${String(s)}] ${entry} reaches the production entry ${other} on ${sandboxRule.origin}`);
          }
        }
      }
    });
    return issues;
  }
  // at the end of egressIssues, once the shapes are valid:
  if (issues.length === 0) issues.push(...crossTierIssues(egress as CarrierEgress));
  ```
- **(b) TASK-113, `egressAllowed`.** Decide the tier by the most specific matching entry across **all** tiers of the origin (an exact path beats a prefix, a longer prefix beats a shorter one), and refuse when that entry's tier differs from `ctx.environment`. Add to SEC-TC-66: a production context to `https://express.api.dhl.com/mydhlapi/test/rates` is blocked; a sandbox context to `…/mydhlapi/rates` is blocked; an exact path present in both tiers is allowed for both.
- **(c) Orchestrator / devops.** Add `/packages/carriers/src/egress.ts` and `/packages/carriers/src/adapters/*/egress.ts` to `.github/CODEOWNERS` (a CODEOWNERS-only PR with a security record), before TASK-135 merges, so that every change to the allow-list carries a security record.

**Verification test.** `egress.test.ts`: the four misfiled tables above are refused at `defineCarrierEgress`; the ADR rows and `FAKE_EGRESS` stay valid. TASK-113: the SEC-TC-66 rows in (b).

### PR075-SEC-03 (LOW): ZPL content is unchecked, and returned labels are not re-checked

**Where.** `createLabelDocument` (`labels.ts:26`) checks the `%PDF-` magic for the PDF formats only; for `ZPL` any non-empty bytes pass. `labels.test.ts:53-62` pins exactly that ("any non-PDF byte string is ... accepted as ZPL"). The guard returns `createShipment` (`guard.ts:102`) and `recoverLabel` (`:112`) results unchanged.

**Probes.**
- P3 and P7: PNG, GIF, JPEG, PDF, HTML and EPL bytes are all accepted as `ZPL` (6 of 6).
- P2: an adapter that builds its answer by hand (not through `createLabelDocument`) gets these through the guard unchanged: a `PNG` format; raster bytes labelled `PDF_4X6`; a `{ format: 'PDF_A4', url: … }` object; and a `recoverLabel` answer of `GIF` with string content for a `PDF_4X6` request. `createLabelDocument` refuses all four (control). TypeScript rejects the literal shapes, but not `as` casts or JSON-decoded values.

**Exploitability and impact.** Carrier responses are semi-trusted input. ADR-0010 am. 11 items 3 and 6 make "raster output never leaves the adapter" and "carrier-supplied URLs are never offered" contract rules. As built they are each adapter's convention. A raster or markup payload stored as a ZPL label is offered to users as a download. It is harmless while the serving route (a later label task) sends `Content-Type` from the format with `nosniff` and `attachment`, and unprintable otherwise. Impact Low-Medium × likelihood Low = **LOW**.

**Remediation.**
- **(a) `labels.ts`.** Check that ZPL looks like ZPL, and flip the property at `labels.test.ts:53` (non-ZPL bytes are refused as ZPL). The candidate below was validated on the scratch copy (P7: 0 mismatches against the wanted policy; the head control has 6). It accepts plain `^XA…^XZ`, a CR/LF lead, the Zebra `CT~~CD,~CC^~CT~` prefix, lower-case `^xa` and a `~DG` graphic before `^XA`, and refuses PNG, GIF, JPEG, PDF, HTML and EPL. Before merging, re-check it against the real ZPL in the TASK-101 contract fixtures.
  ```ts
  /** Raster/document magics that are never ZPL: %PDF-, PNG, GIF8, JPEG, BMP, and markup (<). */
  const NOT_ZPL: readonly (readonly number[])[] = [[0x25, 0x50, 0x44, 0x46], [0x89, 0x50, 0x4e, 0x47], [0x47, 0x49, 0x46, 0x38], [0xff, 0xd8, 0xff], [0x42, 0x4d], [0x3c]];
  /** ZPL: no foreign magic, and a ^XA start-of-format command (any case) within the first 1 KiB. */
  const isZpl = (bytes: Uint8Array): boolean => {
    if (NOT_ZPL.some((magic) => startsWith(bytes, magic))) return false;
    const head = bytes.subarray(0, 1024);
    for (let i = 0; i + 2 < head.length; i += 1) {
      if (head[i] === 0x5e && (head[i + 1] | 0x20) === 0x78 && (head[i + 2] | 0x20) === 0x61) return true;
    }
    return false;
  };
  // in createLabelDocument, after the PDF check:
  else if (format === 'ZPL' && !isZpl(content)) issues.push('ZPL content must be ZPL (a ^XA command, no PDF or raster header)');
  ```
- **(b) `guard.ts`.** Re-check what leaves the adapter.
  - `recoverLabel` is idempotent: map each result through `createLabelDocument` and refuse a format that was not requested.
  - `createShipment` must **never throw after the carrier has accepted the shipment**. Code review D-TASK075-03 has the gateway treat `CarrierContractError` as local and non-ambiguous, so a throw here would invite a retry and a duplicate label (a CLAUDE.md §1 guardrail). Instead, drop a label that fails `createLabelDocument` from `labels`, keep `ref`, and log `{ carrier, operation, format }` (codes only). The saga then obtains the missing format through `recoverLabel` (REQ-DOC-002), or raises `EXCEPTION` for DHL, which has no recovery (ADR am. 11 item 9).
  The guard has no logger today: give `guardAdapter(adapter, { logger })` the same `Pick<PlatformLogger, 'warn'>` port the normalisers take.
  ```ts
  const loggableFormat = (value: unknown): string => (typeof value === 'string' && /^[A-Za-z0-9_]{1,16}$/u.test(value) ? value : '(unprintable)');
  const checkedLabels = (operation: CarrierOperation, labels: unknown, requested?: readonly DocumentFormat[]): LabelDocument[] =>
    (Array.isArray(labels) ? labels : []).flatMap((label: unknown) => {
      const { format, content } = (typeof label === 'object' && label !== null ? label : {}) as { format?: unknown; content?: unknown };
      try {
        const doc = createLabelDocument(String(format), content);
        if (requested !== undefined && !requested.includes(doc.format)) throw new CarrierContractError('label not requested', [doc.format]);
        return [doc];
      } catch {
        if (requested !== undefined) throw new CarrierContractError(`${code}.${operation} returned an invalid label`, [loggableFormat(format)]);
        options.logger?.warn('carrier.label.dropped', { carrier: code, operation, format: loggableFormat(format) }); // codes only
        return [];
      }
    });
  createShipment: (req, ctx) => run('createShipment', ctx, async (c) => {
    const result = await adapter.createShipment(req, c);
    return Object.freeze({ ...result, labels: checkedLabels('createShipment', result.labels) });
  }),
  recoverLabel: (ref, formats, ctx) => run('recoverLabel', ctx, recoverLabel && (async (c) => checkedLabels('recoverLabel', await recoverLabel(ref, formats, c), formats))),
  ```

**Verification test.** `labels.test.ts`: the six foreign payloads are refused as ZPL, and real carrier ZPL from the fixtures is accepted. `guard.test.ts`:
- an adapter whose `createShipment` returns a `PNG` label, a raster `PDF_4X6` and a URL object resolves with `ref` intact and those labels dropped, writes one warn line per dropped label, and does not throw;
- `recoverLabel` returning `GIF` for a `PDF_4X6` request is refused.

### PR075-SEC-04 (LOW): raw carrier text reaches logs through `cause` and through unconverted failures

This is the security rating of code review R1-m5 (cause) and R1-n7 (pass-through). Fix forms and owners follow the twin.

**Where.**
- `normaliseError` forwards `failure.cause` unchanged (`normalise/normalise.ts:135`), and `CarrierError` stores it (`errors.ts:40`). The JSDoc says "for the server log only. Never serialised" (`:21`), and the module header says nothing downstream, logs included, "can echo raw carrier text" (`:1-6`).
- The guard returns `call()` without a catch (`guard.ts:89`).

**Probes.**
- P3, through the real platform logger (`createLogger` from the head extract):
  - a random sentinel inside a cause message (`Receiver <sentinel> at 12 Baker St`) appears in the JSON log line under `err.cause.message`;
  - `util.inspect` of the error (what Express's final handler prints to stderr) shows it too;
  - the `CarrierError`'s own `message` and `toJSON()` never carry it (4 of 4);
  - control: a plain `Error` with the sentinel is logged.
- P5: an `Error`, a `TypeError` and a thrown string, each with carrier text, leave the guard unchanged (3 of 3; the `CarrierError` control is unchanged).

**Exploitability and impact.**
- **What.** Carrier error texts echo submitted data: names, address lines, postcodes, phone numbers. The platform redactor masks credential and contact patterns, not names or street addresses.
- **What breaks.** ADR-0010 am. 11 item 8 ("bodies are never logged at any level"; "error mapping drops any `cause.message` containing a URL") and the CLAUDE.md §1 guardrail "secrets/PII in logs = 0".
- **Likelihood.** It depends on what each adapter passes as `cause`. An adapter that wraps a parsed 4xx body into an `Error` is a natural form.
- **Rating.** Impact Medium × likelihood Low = **LOW**.

**Remediation.**
- **(a) This PR, `normaliseError`.** Never forward a free-text cause; keep a safe record only:
  ```ts
  const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
  /** The part of a carrier failure's cause that may be logged: its class name and a safe code, never its message. */
  function safeCause(cause: unknown): { readonly name: string; readonly code?: string } | undefined {
    if (typeof cause !== 'object' || cause === null) return undefined;
    const name = typeof (cause as { name?: unknown }).name === 'string' && SAFE_NAME.test((cause as { name: string }).name) ? (cause as { name: string }).name : 'Error';
    const code = (cause as { code?: unknown }).code;
    return Object.freeze({ name, ...(typeof code === 'string' && LOGGABLE_CODE.test(code) ? { code } : {}) });
  }
  // normaliseError:
  ...(failure.cause === undefined ? {} : { cause: safeCause(failure.cause) }),
  ```
  Then correct the JSDoc at `errors.ts:21`: a `cause` must never carry carrier text.
- **(b) TASK-132, per code review R1-n7.** The gateway converts every non-`CarrierError` adapter failure to `CARRIER_UNKNOWN_ERROR` with `safeCause`. Correct the module header at `errors.ts:1-6` to say who converts.

**Verification test.** `normalise.test.ts`: a cause carrying a sentinel. `serializeThrown(normaliseError(...))` and the `util.inspect` output lack the sentinel, and `err.cause` is `{ name, code? }` only. TASK-132: an adapter throwing `new Error(<sentinel>)` yields `CarrierError(CARRIER_UNKNOWN_ERROR)`, and the log line lacks the sentinel.

### PR075-SEC-05 (INFO): `CarrierError` keeps a runtime-invalid code, carrier or operation

P3 shows what typed callers cannot pass but a JavaScript caller or an `as` cast can:
- `new CarrierError('NOT_A_CODE')` has the message `""`;
- `'toString'` gets the message `function toString() { [native code] }`;
- `'__proto__'` gets the message `[object Object]`;
- `carrier: 'DHL\r\ninjected'` and `operation: 'x y'` are kept and emitted by `toJSON()`, which may reach a problem body (TASK-036 mapping) or a log line.

**Fix (`errors.ts:39-48`).**
- `this.code = isCarrierErrorCode(code) ? code : 'CARRIER_UNKNOWN_ERROR'`, with the message taken from that code;
- keep `carrier` only when `isCarrierCode(carrier)`, and `operation` only when it is in `CARRIER_OPERATIONS`;
- add `typeof … === 'string'` to the `carrierErrorCode` check (code review R1-n2).

### PR075-SEC-06 (INFO): `EGRESS` rules are an open schema

P1 shows that unknown rule keys (`allowRedirects`, `insecure`, `methods`) pass `egressIssues` and are copied into the frozen allow-list by `defineCarrierEgress` (`egress.ts:109`) and `deriveCarrierEgressRules` (`:157`). An unknown list (`staging`) is ignored silently. Today nothing reads those keys. If TASK-113's client ever reads an optional rule field, an adapter table could widen egress without the validator noticing.

**Fix.** Refuse unknown keys on a rule and on the table, and copy only `origin`, `pathPrefixes` and `tier` (`({ origin, pathPrefixes, tier }) => Object.freeze({ origin, pathPrefixes: Object.freeze([...pathPrefixes]), tier })`). Concurred: R1-n1 (the `ENCODED_SEPARATOR` branch is unreachable, so it fails closed) and R1-n10 (an out-of-union `account.environment` throws a `TypeError`, not a named issue, so it also fails closed).

### PR075-SEC-07 (INFO): one warn line per distinct unmapped code, unbounded per call

P3: one carrier answer with 5,000 distinct unmapped service codes writes 5,000 warn lines (`normalise/normalise.ts:77-85`); tracking events behave the same (`:161-169`). The carrier is semi-trusted, and the log pipeline is shared.

**Fix.** Log at most 20 distinct codes per call, then one line `{ carrier, account, unmappedCount }`.

### PR075-SEC-08 (INFO): `registry.get` echoes the caller's code

`registry.ts:41` puts the requested code verbatim into the `CarrierContractError` message. In P5, a code holding CRLF and a JSON fragment is kept. Platform log lines escape it, but `util.inspect` paths do not. If the code ever comes from a request (a carrier chosen in a booking), the message is attacker text.

**Fix.** `isCarrierCode(code) ? code : '(invalid code)'` in the message, or have callers check `has()` first.

### PR075-SEC-09 (INFO): before G4, "sandbox only" holds for configuration, not for database accounts

P4: `packages/config` refuses `CARRIER_<X>_ENVIRONMENT` = `production`, `Production`, `PRODUCTION`, ` production`, `production `, `prod`, `live`, `Sandbox` and `sandbox ` under all four APP_ENVs. `sandbox` and the empty default load cleanly (the control). The new test pins this for three carriers × four APP_ENVs.

`deriveCarrierEgressRules` takes `carrier_accounts` rows (TASK-128), however, and admits a production account under `APP_ENV=production` (P1, by design for after G4). Before G4 the CLAUDE.md §5 property therefore rests on the database content.

**Route.**
- TASK-128: `carrier_accounts` refuses `environment = 'production'` (a CHECK, or the account service) until the G4-approved change (OI-24).
- Or TASK-113: the assembly refuses an enabled account whose environment differs from that carrier's `CARRIER_<X>_ENVIRONMENT`.

## 4. Verification of the focus items

### 4.1 Egress rule validation (P1, `p1-egress.mjs`)

- **Origins, 33 shapes.**
  - Refused: `10.0.0.1`, `2130706433`, `0x7f.0.0.1`, `0177.0.0.1`, `127.1`, `[::1]`, `[::ffff:127.0.0.1]`, a trailing dot, `*.`, `%2A.`, a Unicode IDN, upper-case host or scheme, `:8443`, `:443`, `@host`, `u:p@`, backslash, an embedded TAB or LF, `?x`, `#x`, `localhost`, an underscore, a leading hyphen, an empty label, `wss:`.
  - Accepted: the control, a punycode host, `1.2.3.4a` (a DNS name under WHATWG), and DNS names that may resolve internally (`metadata.google.internal`, `localhost.localdomain`, `127.0.0.1.nip.io`). The tables are static and reviewed against the ADR. Resolution-time IP checks are TASK-113's (undici dispatcher with DNS pinning).
- **Prefixes, 17 shapes.** Refused: `./`, `../`, a trailing `..`, `%2e%2e`, `%2f`, `//`, empty, relative, `?`, `;`, `\`, Unicode, `*`. Accepted: `/v1/`, `/`, the exact `/oauth/token`, and `/.../` (not a dot segment).
- **Tiers.** `gateway-test` and `production` under `sandbox` are refused.
- **Derivation.**
  - It reads no configuration: there is no `process.env` in `packages/carriers/src` outside tests, and the PR's property mutates six env names.
  - Disabled accounts contribute nothing.
  - A carrier without `EGRESS` is refused, and so are the inherited names (`Object.hasOwn`).
  - A production account is refused under `local`, `test`, `staging` and `prod`.
  - `APP_ENV=production` with both DHL tiers gives both rules (AT-US-121-04; the per-call binding is TASK-113's).
  - New: PR075-SEC-02 (a) and PR075-SEC-06.

### 4.2 A sandbox context never builds a production URL

- **`egressBase` reads only `ctx.environment`.** It takes the first prefix rule of `EGRESS[ctx.environment]` and re-checks `rule.tier`.
- **The base is right; the join is not contained.** Joining relative paths onto the sandbox base of a DHL-like shared origin (13 joins):
  - the controls (`rates`, an encoded tracking number) stay inside `/mydhlapi/test/`;
  - `../shipments`, `%2e%2e/shipments`, `.%2E/shipments`, an absolute `/mydhlapi/shipments`, `encodeURIComponent('..') + '/label'` and two encoded `..` segments land on **production paths**;
  - `//evil.example/x`, an absolute URL and `\\evil.example\x` leave the origin;
  - `encodeURIComponent` of `%2e%2e` and of `../..` stays inside.
- **Where containment is planned.** It is ADR item 8's `carrierPath` identifier allow-pattern and `carrierUrl` `URL_ESCAPE` (TASK-132, SEC-TC-67), plus TASK-113's `egressAllowed`. Nothing in this PR claims it.
- **The PR's property (`egress.test.ts:95-104`) cannot see any escaping input.** Its generator `^[a-z][a-z0-9/-]{0,30}$` produces neither `.`, `%` nor a leading `/`. I concur with code review R1-m4 on making it honest. When fixed, add the escaping joins above as examples that must fail through the future `carrierUrl`.
- **PR075-SEC-01** is the guard-side half of this item.

### 4.3 `CarrierError` never carries raw carrier text (CWE-209)

- The `message` is canonical in every probe.
- `toJSON()` is the safe subset `{ code, carrier?, operation?, carrierErrorCode? }`.
- A `carrierErrorCode` with CRLF is dropped.
- A carrier message maps by lookup only (`Invalid  POSTAL code` gives `POSTCODE_INVALID`) and is never kept.
- The CWE-209 response side holds. The log side is PR075-SEC-04, and runtime-invalid inputs are PR075-SEC-05.

### 4.4 Log-injection-safe logging of unknown codes (CWE-117)

- An unmapped code with CRLF plus a JSON fragment, an ESC sequence, U+2028, 65 characters, a number or an object is logged as `(unprintable)`.
- `__proto__` and `constructor` are logged as they are (a safe shape).
- There is one line per distinct code. The other fields are the validated carrier code and the account id and code.
- Volume is PR075-SEC-07.

### 4.5 Prototype-pollution safety of mapping lookups

- `__proto__`, `constructor`, `toString`, `hasOwnProperty` and `__PROTO__` resolve to nothing in the service and tracking maps, and to `CARRIER_UNKNOWN_ERROR` in the error map (15 of 15).
- The tables are `Map`s built from validated own entries.
- `lookupKey` bounds keys at 200 characters before normalisation; 200 white-space characters take 0.008 ms.
- The surcharge `raw` label strips Cc/Zl/Zp but keeps U+202E (code review R1-n3, concurred; add `\p{Cf}`).
- A 20 MB label is cut to 120 characters in 18 ms.
- A `null` label throws a `TypeError` (fails closed).

### 4.6 Label document handling

- `createLabelDocument` was run over 15 shapes:
  - bytes only, and `Buffer` is accepted;
  - a URL string, a base64 string, an `ArrayBuffer`, a `Uint8ClampedArray` and empty content are refused;
  - `PNG` and `pdf_4x6` formats are refused;
  - PDF formats need `%PDF-` at offset 0;
  - the content is copied and the document frozen.
- No code path dereferences a URL.
- Gaps: PR075-SEC-03.

### 4.7 Context and carrier binding in the guard; `packages/config`

- **Guard.**
  - `cancelShipment` and `recoverLabel` declared unsupported answer `CAPABILITY_NOT_SUPPORTED` with 0 adapter calls, even with a `null` context (the capability check runs first).
  - Another carrier's context and a split environment are refused.
  - The capability snapshot is deep-frozen. Validate-then-clone is code review R1-m1: a non-cloneable declaration is a raw `DOMException` at registration, which fails closed.
  - Gap: PR075-SEC-01.
- **`createCarrierContext`:**
  - copies only the four account fields (an extra `secret` key is dropped);
  - reads no environment variable (with `CARRIER_ENVIRONMENT` and `APP_ENV` both set to `production`, a sandbox account gives `sandbox`);
  - freezes the result;
  - refuses `PRODUCTION`, a CRLF locale and a non-string `mockScenario`.
- **Config.** See PR075-SEC-09: production is refused in every APP_ENV. In-process, before G4, only DB-sourced accounts can carry `production`.

### 4.8 The owned path, `tools/lint/carrier-wire-boundary.test.ts`

- It is test-only.
- It runs the repository's real `eslint.config.mjs` in one child process.
- The probe sources are embedded with `JSON.stringify`, so they cannot inject into the script, and it runs from the repository root.
- It adds no suppression and changes no gate or config.
- The type-only deep import that lints clean is code review R1-m2 / S3. I concur: `tsc` refuses it (TS2307), so nothing leaks, and the fix belongs in `eslint.config.mjs` (section 7).

### 4.9 Secrets

I ran an over-approximating Gitleaks scan over the 3,342 added lines:
- **Configuration.** The pinned v8.30.1 `config/gitleaks.toml`, with the keyword prefilter and rule regexes only (no entropy, no allowlists). 222 rules, 220 compiled. The runtime PAT and AWS-id controls fired.
- **Result.** One hit, `generic-api-key`, on the `egress.test.ts` line (derive test, expected rules) that pairs the RFC 2606 test origin with the tier word. It is a false positive: no secret. The real rule's entropy threshold drops it.
- **The test origin `https://user:pw@…`** matches no rule.
- **Not scanned.** `.env*` files: the PR changes none.

## 5. Earlier items

- **PR6-SEC-01 (ADR am. 11 item 6, EGRESS shape).** The contract half is in place. Tier binding and matching remain TASK-113's, now with PR075-SEC-02 (b).
- **PR6-SEC-06 (carrier URLs never dereferenced).** The type has no URL field and `createLabelDocument` refuses strings. The guard-side re-check is PR075-SEC-03 (b).
- **PR6-SEC-12 (b)(f) (matching rule).** Not in this PR's scope (TASK-113). `egressIssues` refuses `%` outright in prefixes, which is stricter than the ADR.
- **D-ARCH-106 (T-83 lint names).** Due "in the PR that first wires the port into module code". This PR wires nothing (code review D-TASK075-09, concurred).

## 6. Code review twin

The record is on main at `29fe2a1`: CHANGES_REQUESTED, one MAJOR (R1-M1, unmapped tracking events dropped against REQ-TRACK-001/US-241), 7 MINOR, 11 NIT. Its security flags:

- **S1 (production reaches the sandbox prefix).** Concurred; rated in PR075-SEC-02 (b), with the TASK-113 form.
- **S2 (cause logged).** Concurred; rated in PR075-SEC-04, which also covers the guard's pass-through (R1-n7).
- **S3 (type-only deep import passes lint).** Concurred; no security finding, because `tsc` holds it. Its fix touches `eslint.config.mjs` (owned): see section 7.
- **S4 (R1-M1 adds `description`, which is PER).** Concurred; a round-2 check. The raw description must not reach public tracking (DR-B31, city level at most), and it must not reach the unmapped-event warn line, where only `loggableCode` may appear.

I also concur with R1-m1, R1-n2, R1-n3, R1-n5 (closed by the PR075-SEC-01 fix), R1-n7 and R1-n10. None of the twin's rulings conflicts with this record. One addition to its D-TASK075-03 ruling (`CarrierContractError` is local and non-ambiguous): it holds only for errors thrown **before** the adapter is reached. PR075-SEC-03 (b) therefore never throws after `createShipment` returns.

## 7. Record binding and simulation

- **The binding.** The single `Head` row names `c2eaa47`. The PR changes one owned path, `tools/lint/carrier-wire-boundary.test.ts`.
- **When the fix cycle voids the binding.** The checker voids it only when that owned set changes after `c2eaa47`:
  - fixes limited to `packages/carriers/src/**` keep it valid for the checker (scenario S4 below);
  - an `eslint.config.mjs` change for R1-m2 adds an owned path and voids it (S5).
- **Delta round requested anyway.** The PR075-SEC-01/03/04 fixes and the R1-M1 fix sit in the reviewed controls, so I ask for a security delta round on the fix head even where the checker would not demand one.

**Simulation.** I used main's real `tools/ci/check-security-owned-paths.mjs` in a `--shared` sparse clone, with scenario commits built by plumbing on top of `c2eaa47` and this record placed as `PR-9999-TASK-075-security-review.md` (`--pr 9999 --base 5145d52`). The results are in the table below.

| Scenario | Expected | Result |
|---|---|---|
| S1 The record at the head `c2eaa47` | pass | pass |
| S2 Merge ref: the record committed on main (tip `29fe2a1` when this round was written), merged with the head; `--base` = merge base `5145d52` | pass | pass |
| S3 Control: no record | fail | fail (`missing`) |
| S4 A commit after the head that changes `packages/carriers/src/guard.ts` only | pass | pass (the checker does not void the binding; C3 asks for the delta round anyway) |
| S5 Control: `eslint.config.mjs` changed after the head (the R1-m2 fix) | fail | fail |
| S5b Control: the owned lint test changed after the head | fail | fail |
| S6 Control: the placeholder name `PR-pending-TASK-075-…` | fail | fail |
| S7 Control: a later `FAIL` verdict row | fail | fail |
| S8 Control: the `Head` row names the base `5145d52` | fail | fail |
| S9 Control: the `Head` row names a main commit | fail | fail |

10 of 10 as expected. The record has exactly one `Head` row and one `Verdict` row (the last table row of the file).

## 8. Merge conditions and routes

**Conditions.**
- **C1.** Lane B evidence at the pushed head: `unit` with the new carriers, config and lint tests, and the coverage gate. The hosted `security-integration` job must be green (selected through `packages/config/**`).
- **C2.** Rename the record, then confirm the merge ref contains it (D-ORCH-136/138).
- **C3.** A security delta round on the fix-cycle head, if the fix cycle changes `packages/carriers/src/**`, `packages/config/**` or any owned path. The code review's CHANGES_REQUESTED makes such a cycle certain.

**Routes.**
- **PR075-SEC-01, -02 (a), -03, -04 (a), -05, -06, -07, -08:** this PR's fix cycle, with R1-M1. Otherwise they are due, at the latest, before the first real adapter merges (TASK-135/139/140); TASK-079 (Mock) should already build on the fixed guard and labels.
- **PR075-SEC-02 (b):** TASK-113 (SEC-TC-66 rows).
- **PR075-SEC-02 (c):** orchestrator, CODEOWNERS before TASK-135.
- **PR075-SEC-04 (b):** TASK-132.
- **PR075-SEC-09:** TASK-128 and TASK-113.

| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium. New: PR075-SEC-01 LOW (the guard checks one read of the context and passes the live object on), PR075-SEC-02 LOW (one-directional, unvalidated tier separation on shared origins), PR075-SEC-03 LOW (ZPL unchecked, returned labels not re-checked), PR075-SEC-04 LOW (raw carrier text to logs through `cause` and pass-through), PR075-SEC-05..09 INFO. Fixes for 01, 02 (a), 03 and 04 (a) validated on a scratch copy and preferred in this PR's fix cycle with code review R1-M1. Conditions: C1 lane B and hosted `security-integration` at the pushed head, C2 rename and merge-ref confirmation, C3 security delta round on the fix head |

## Round 2 (delta, pre-push): `c2eaa47..dde830b`

| Field | Value |
|---|---|
| Head | dde830bee361f4f91a7a0bff7c2d322d44bda5d7 |
| Range | `7de6ec8` merges main `2ec81df` into `c2eaa47`. The merge is clean: its tree equals `git merge-tree --write-tree c2eaa47 2ec81df` (`a97d882`). Main's non-docs changes since `5145d52` are in `tools/db`, `tools/quality` and `prisma/tests`, none of them a path of this PR. `dde830b` (the fix commit) changes 19 files, all under `packages/carriers/src/` |
| Owned paths changed | Still one: `tools/lint/carrier-wire-boundary.test.ts`, unchanged since `c2eaa47` |
| Tip to push | `dde830b` plus evidence-only commits (lane B run files under `docs/05-quality/tests/runs/` only); section R2.5 |
| Lane A evidence | None: the branch is not pushed. The classifier still selects `security-integration` (through `packages/config/**`) |
| Lane B evidence | Queued on `dde830b` (coordinator). I read no run files |
| Code review twin | Round 2 on main, `6b843c0`: APPROVED_WITH_NITS. R2-m1 (label false negatives destroy the only copy for DHL/FedEx), R2-n1..n4. I concur with all five (section R2.3) |
| Decisions read | D-SD-003 (`77ac6d2`) routes PR075-SEC-02 (b) and -09 to TASK-113, -09 to TASK-128, and -04 (b) with ruling 2 to TASK-132. D-ARCH-168 (`71a2d36`) records the code review's C2 (`getRates` returns `RateResponse`) |
| Reviewer / date | security-analyst, 2026-11-20, round 2. Same host rule and method as round 1: no npm, Jest, type-check, build or Docker, and nothing run in the PR worktree. The scratchpad had been wiped since round 1, so I rebuilt the probes from this record and re-ran them on `git archive` extracts of `dde830b`, with `c2eaa47` as the control. Line numbers come from single-file reads at `dde830b` |

### R2.1 Round-1 findings

| ID | What `dde830b` does | Probe at `dde830b` (control `c2eaa47`) | Status |
|---|---|---|---|
| PR075-SEC-01 (LOW) | `snapshotContext` (`guard.ts:100-129`) reads every field once into a `createCarrierContext` copy and passes the copy to the adapter (`:144-147`) | 9 rows. A getter on `environment`, getters on `account.environment` plus `environment`, a getter on `account.carrierCode`, a mutation after the call starts and a Proxy each see `sandbox`, `/v1/test/rates` and a frozen context, before and after the `await`. The bad `deadlineAt`/`locale`/`mockScenario` row is refused. The 3 controls are unchanged. At the control, 5 rows saw `production` | **Closed**; also closes code review R1-n5 |
| PR075-SEC-02 (a) (LOW) | `crossTierIssues` (`egress.ts:91-103`), run once the shapes are valid (`:132`) | The PR's `FAKE_EGRESS` (shared exact token path) and the ADR rows for UPS, FedEx and DHL, plus the Mock: 0 issues. The four misfiled tables (DHL `/mydhlapi/` and `/`, the FedEx and UPS production hosts in `sandbox`): 1 issue each | **Closed** for prefixes. The exact-path form is code review R2-n4 (concurred); the cross-carrier form is PR075-SEC-11 (INFO) |
| PR075-SEC-02 (b), (c) | Not in this PR: (b) is TASK-113's per D-SD-003; (c) is the orchestrator's | | Open, routed |
| PR075-SEC-03 (a) (LOW) | `isZpl` (`labels.ts:37-44`): no foreign magic, and `^XA` within the first 1 KiB | 11 of 12 shapes as wanted. PNG, GIF, PDF, HTML, JPEG and EPL are refused; `^XA`, a CR/LF lead, the `CT~~CD` prefix, lower case and a 200-byte `~DG` preamble are accepted. A valid ZPL with a 4,800-byte `~DG` graphic before `^XA` is **refused** | **Closed** for the raster/markup class. The 1 KiB window came from my round-1 candidate and is code review R2-m1 (concurred, R2.3) |
| PR075-SEC-03 (b) (LOW) | `checkedLabels` (`guard.ts:150-166`) | `createShipment` keeps the valid PDF and drops raster-as-PDF, `PNG`, a URL object and a CRLF format. It writes 4 `carrier.label.dropped` lines with format codes only (`(unprintable)` for the CRLF one), keeps `ref`, freezes the result and never throws a contract error. `recoverLabel` refuses a `GIF` for a `PDF_4X6` request and an unrequested format | **Closed**; residuals PR075-SEC-10 (MEDIUM, R2.2), PR075-SEC-13 (INFO), code review R2-n1/R2-n2 |
| PR075-SEC-04 (a) (LOW) | `safeCause` (`errors.ts:31`), applied in the `CarrierError` constructor | Through the real `createLogger` from the extract: neither a random sentinel nor the DHL URL path in a cause appears in the log line or in `util.inspect`, and the cause is `{"name":"Error","code":"ERR_BAD_REQUEST"}`. Control: a plain `Error` with the sentinel is logged. A cause code holding CRLF is dropped. A cause with a throwing `name` getter makes the constructor throw (code review R2-n3, concurred) | **Closed** |
| PR075-SEC-04 (b) | Not in this PR. A plain `Error` with carrier text still leaves the guard unchanged; TASK-132 converts it (card, D-SD-003) | | Open, routed |
| PR075-SEC-05 (INFO) | Runtime field checks in the constructor (`errors.ts:68-79`) | `NOT_A_CODE`, `toString` and `__proto__` become `CARRIER_UNKNOWN_ERROR` with the canonical message. A CRLF `carrier`, the operation `x y` and a numeric `carrierErrorCode` are dropped from `toJSON()` | **Closed**; also R1-n2 |
| PR075-SEC-06 (INFO) | Closed schema and a three-field copy (`egress.ts:81-82`, `:127`, `:137-138`) | Refused: an unknown rule key, an unknown table key and an own `__proto__` rule key from `JSON.parse`. A defined rule has exactly `origin`, `pathPrefixes` and `tier`. The environments `live` and `constructor` are named issues (R1-n10), and so is an encoded separator (R1-n1) | **Closed** |
| PR075-SEC-07 (INFO) | `unmappedReporter` caps the lines at 20 per call plus one summary | 5,000 distinct unmapped codes give 21 lines; the last one is `{ unmappedCount: 5000, logged: 20 }` | **Closed** |
| PR075-SEC-08 (INFO) | `registry.get` echoes the code only in the carrier-code shape | A CRLF + JSON code gives `no adapter is registered for (invalid code)` | **Closed** |
| PR075-SEC-09 (INFO) | Not in this PR | | Open, routed by D-SD-003 to TASK-113 and TASK-128 |

**Code review S4 / R1-M1 (tracking events and `description`).**
- `normaliseTrackingEvents` now keeps every event. Three events in give three out: `PICKED_UP`/`false`, then `IN_TRANSIT`/`true` twice.
- A description holding a random sentinel never reaches a warn line. That includes an unmapped code that itself embeds the description after a CRLF, which is logged as `(unprintable)`. The warn lines carry `ZZ99` and `(unprintable)` only.
- The new `TrackingEvent.description` is documented as personal data. Its name, however, collides with the public schema's field: PR075-SEC-12 (INFO).

**Code review R1-n3.** The `CARRIER_OTHER` raw label drops U+202E, U+200B and a trailing lone surrogate, and stays well-formed. Closed.

### R2.2 New: PR075-SEC-10 (MEDIUM): a contract error from inside the adapter has the same class as a refusal before it

| | |
|---|---|
| CWE / OWASP 2021 | CWE-755 (improper handling of exceptional conditions) / A04 |
| Where (`dde830b`) | `guard.ts:144-147` (`run` returns the adapter's promise as it is); `errors.ts:6-9` (header: the gateway "treats a `CarrierContractError` thrown before the adapter is reached as local and non-ambiguous"); TASK-132 card (D-SD-003, ruling 2) |

**What happens.** The gateway (TASK-132) sees only what leaves the guard. Since `dde830b`, the guard throws `CarrierContractError` for its own refusals before the adapter (bad context), and for the `recoverLabel` re-check after it. Every `CarrierContractError` thrown inside the adapter also leaves the guard unchanged. The most likely source is `createLabelDocument` on carrier bytes: `types.ts` tells adapters to "build through `createLabelDocument`", so a `createShipment` that has already been accepted by the carrier throws it when the payload fails the label check. The class alone therefore cannot say whether the adapter was entered, and neither the gateway nor the card's ruling-2 rule can be applied from the error.

This differs from code review R2-n1. R2-n1 covers a `TypeError` after the call, which TASK-132 already treats as an unknown, ambiguous failure. A `CarrierContractError` after the call is instead the class the gateway is told to treat as **local**.

**Probe** (`r2-sec10.mjs`). An adapter whose `createShipment` counts one carrier call, then builds its label with `createLabelDocument('PDF_4X6', <PNG bytes>)`:

| Build | Refused before the adapter (bad context) | Thrown after the carrier accepted | Same class |
|---|---|---|---|
| `c2eaa47` | `CarrierContractError` | `CarrierContractError` | yes |
| `dde830b` | `CarrierContractError` | `CarrierContractError` | **yes** |
| Candidate (below) | `CarrierContractError` | `CarrierError` `CARRIER_UNKNOWN_ERROR` | no |

A valid ZPL label whose `~DG` preamble is longer than 1 KiB (R2-m1) does the same when an adapter checks it itself, so a correct carrier answer can trigger it.

**Exploitability and impact.** A gateway that follows the documented rule classifies a carrier-accepted shipment as a local, non-ambiguous failure, meaning "nothing happened at the carrier". The saga may then:
- release or refund the booking while an orphan carrier shipment exists, billed to the Platform's account; or
- create it again, giving a second shipment and a duplicate label. DHL Express has neither idempotent create nor void (ADR-0010 am. 11 items 2 and 9).

Both outcomes are CLAUDE.md §1 guardrails held at 0. The likelihood is Low: an adapter must throw a contract error after the carrier answered, and the gateway must apply the class rule as written. **Impact High × likelihood Low = MEDIUM.**

**Remediation (code level, `guard.ts`, this PR).** The guard is the only component that knows whether the adapter was entered, so it must encode that in the class. Validated on a scratch copy of `dde830b` (`apply-fix2.mjs`): the before and after rows now differ (table above), and the round-2 label, context and egress probes are otherwise unchanged.
```ts
const run = async <R>(operation: CarrierOperation, ctx: unknown, call: ((ctx: CarrierContext) => Promise<R>) | undefined): Promise<R> => {
  if (!supported(operation) || call === undefined) throw new CarrierError('CAPABILITY_NOT_SUPPORTED', { carrier: code, operation });
  const copy = snapshotContext(ctx, code, operation); // a CarrierContractError here: the adapter was not entered
  try {
    return await call(copy);
  } catch (error) {
    // Once the adapter is entered nothing is local: a contract error from inside it is a carrier-call failure.
    if (error instanceof CarrierContractError) throw new CarrierError('CARRIER_UNKNOWN_ERROR', { carrier: code, operation, cause: error });
    throw error;
  }
};
```
Two consequences:
- The `recoverLabel` re-check then surfaces as `CarrierError(CARRIER_UNKNOWN_ERROR)`. That is idempotent and retryable, so retrying is safe. To keep the refused format visible, log a `carrier.label.refused` line with the format code before throwing. `guard-hardening.test.ts:212-231` changes its expected class accordingly.
- Reword `errors.ts:6-9` (and the TASK-132 card text at the next fold): "a `CarrierContractError` that leaves the guard means the adapter was not entered; it is local and non-ambiguous. Anything else after a `createShipment` call is ambiguous."

**Verification test (`guard-hardening.test.ts`).** An adapter that records one carrier call, then throws `createLabelDocument`'s error from `createShipment`: the guard rejects with `CarrierError` `CARRIER_UNKNOWN_ERROR`, never `CarrierContractError`. A context refusal for the same adapter rejects with `CarrierContractError` and zero adapter calls. Property: for every operation, `CarrierContractError` leaves the guard only when the adapter recorded zero calls.

**Due.** Preferred before the push (about 8 lines plus one test). At the latest before TASK-132 merges (the gateway that applies the class rule), and before TASK-135/139/140.

### R2.3 Code review round 2 and the ZPL window

- **R2-m1 (label false negatives destroy the only copy for DHL/FedEx): concurred.** I add two things:
  - The 1 KiB `^XA` window was my round-1 candidate; I proposed it before I had checked `~DG` preambles. My probe confirms the false negative at 4,800 bytes (the twin's is 3.2 KB).
  - A validated fix: search the whole payload for `^XA` with native `indexOf` (four case variants over 20 MB: 7 ms on this host), or with a `Uint8Array.prototype.indexOf(0x5e, from)` loop. On the scratch copy, 12 of 12 shapes behave as wanted. Re-check against the carrier ZPL in the TASK-101 fixtures before merging, because for DHL and FedEx a false negative is unrecoverable.
- **R2-n1 (TypeError after the call): concurred.** With the PR075-SEC-10 fix, a `TypeError` keeps reaching TASK-132 as an unknown, ambiguous failure, which is the safe class.
- **R2-n2 (optional logger): concurred.** PR075-SEC-13 adds the non-array case.
- **R2-n3 (`safeCause` with a throwing getter): concurred**, and reproduced.
- **R2-n4 (sandbox exact path under a production prefix): concurred.** Its rule ("refuse unless the identical exact path is in production too") keeps the shared token path valid.

### R2.4 New INFO items

**PR075-SEC-11 (INFO, CWE-183): the cross-tier check is per table.**
- **What.** A carrier's sandbox list that names another carrier's production host (for example `https://apis.fedex.com` `/` in a new adapter's table) passes `egressIssues` and `deriveCarrierEgressRules`, and becomes a sandbox-tier rule.
- **Fix.** In `deriveCarrierEgressRules` (`egress.ts:183`), check each enabled table's sandbox list against the production lists of every table:
  ```ts
  const tableIssues = egressIssues({ sandbox: table.sandbox, production: Object.values(egress).flatMap((other) => (Array.isArray(other?.production) ? other.production : [])) });
  ```
  Validated on the scratch copy: the cross-carrier row is refused, and the 5 valid tables keep 0 issues.

**PR075-SEC-12 (INFO, CWE-359): the canonical `TrackingEvent.description` shares its name with the public field (`canonical/types.ts:210`).**
- **What.** The canonical field holds the carrier's free text (personal data, data-model `carrier_description`, never public under DR-B31). `openapi.yaml` `PublicTrackingEvent.description` is the *localised canonical* description, a `string` under `additionalProperties: false`. A public-tracking mapper that copies `event.description` into `description` passes the schema and leaks a signatory's name or street.
- **Fix (this PR, before any consumer exists).** Rename the canonical field `carrierDescription`, matching `carrier_description` and the authenticated `TrackingEvent` schema.
- **For the public tracking task.** A test that a sentinel carrier description is absent from the `getPublicTracking` and `lookupPublicTracking` bodies.

**PR075-SEC-13 (INFO, CWE-778): a non-list `labels` is dropped without a line.**
- **What.** A `createShipment` answer whose `labels` is not an array (for example a carrier `LabelURL` string, the `URL_ONLY` case of ADR-0010 am. 11 item 6) gives `labels: []` and writes no warn line even when a logger is given (`guard.ts:151`; probe: 0 lines). R2-n2 covers a missing logger.
- **Fix.** Log `{ carrier, operation, format: '(not a list)' }` once for a non-array `labels`.

### R2.5 Secrets, record binding and simulation

**Secrets.** The over-approximating Gitleaks scan (pinned v8.30.1 config, keyword prefilter and regexes only; 222 rules, 220 compiled; the PAT and AWS-id controls fired) found:
- **Fix commit (981 added lines).** 2 raw `generic-api-key` hits in `guard-hardening.test.ts`: Proxy-trap lines that compare the key with the field name `environment`. Both are false positives, and both drop out with an entropy-and-digit filter.
- **Merge `c2eaa47..7de6ec8` (first parent).** It brings main's lines since `5145d52` into lane A's range: 40 raw hits, 3 after the filter. All 3 are in `docs/05-quality/tests/runs/20261119T1550Z_c618d8a/unit.junit.xml`, which landed with PR #72 (`f723fef`) after lane A scanned it there.
- I quote no flagged value here.

**Binding.** The two `Head` rows of this file name `c2eaa47` (round 1) and `dde830b` (round 2); both are in the PR's range. The last `Verdict` row is this round's.

**Simulation.** I used main's real checker in a `--shared` sparse clone, with scenario commits built by plumbing. The record (both rounds) is committed on main's tip as `PR-9999-TASK-075-security-review.md` (`71a2d36` when this round was written) and merged with the head as GitHub's merge ref would be; `--base` is the event base (the merge base `2ec81df`), `--pr 9999`:

| Scenario | Expected | Result |
|---|---|---|
| T1 The merge ref: the record on main, merged with `dde830b` | pass | pass |
| T2 An evidence-only commit after `dde830b` (a run file under `docs/05-quality/tests/runs/`) | pass | pass |
| T3 Control: no `PR-9999-*` record (main's tip carries only the placeholder name) | fail | fail (`missing`) |
| T4 Control: a later `FAIL` verdict row | fail | fail |
| T5 Control: the owned lint test changed after `dde830b` | fail | fail |
| T6 Control: `eslint.config.mjs` changed after `dde830b` | fail | fail |
| T7 Control: the record only under the placeholder name | fail | fail |
| T8 `packages/carriers/src/guard.ts` changed after `dde830b` (as the PR075-SEC-10 fix would) | pass | pass: the checker does not demand a new round; C3 does |
| T9 Control: both `Head` rows name a main commit | fail | fail |

9 of 9 as expected.

### R2.6 Merge conditions and routes

**Conditions.**
- **C1.** Lane B at `dde830b` (queued): `unit`, including `guard-hardening`, `hardening-misc` and `tracking-and-logging` with the real `createLogger`, and the coverage gate. The hosted `security-integration` job must be green.
- **C2.** Rename the record, then confirm the merge ref contains it (D-ORCH-136/138).
- **C3.** A security delta round 3 on any later change to `packages/carriers/src/{guard,errors,labels,egress,context}.ts`, including the PR075-SEC-10 and R2-m1 fixes. The checker does not demand it (T8), so this is procedural.

**Routes.**
- **This PR, preferred before the push:** PR075-SEC-10 (MEDIUM; at the latest before TASK-132 and TASK-135/139/140 merge), -11, -12 and -13, together with the code review's R2-m1 and R2-n1..n4.
- **TASK-113:** PR075-SEC-02 (b) and -09.
- **TASK-132:** PR075-SEC-04 (b), plus the ruling-2 wording from R2.2.
- **TASK-128:** PR075-SEC-09.
- **Orchestrator:** PR075-SEC-02 (c).
- **The public tracking task:** the PR075-SEC-12 sentinel test.

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 2 at `dde830b`: PR075-SEC-01, -02 (a), -03 (a) and (b), -04 (a) (LOW) closed; -05 to -08 (INFO) closed; code review R1-M1/S4 (no event dropped, no description in logs), R1-n1, R1-n2, R1-n3, R1-n5 and R1-n10 confirmed; code review R2-m1 and R2-n1..n4 concurred. New: PR075-SEC-10 MEDIUM (a contract error thrown inside the adapter after the carrier accepted leaves the guard as `CarrierContractError`, the class the gateway treats as local and non-ambiguous; validated guard fix, preferred before the push, at the latest before TASK-132), PR075-SEC-11..13 INFO. Open and routed: -02 (b) TASK-113, -02 (c) orchestrator, -04 (b) TASK-132, -09 TASK-113/128. 0 Critical, 0 High. Conditions: C1 lane B and hosted `security-integration` at `dde830b`, C2 rename and merge-ref confirmation, C3 delta round on any later change to the guard, errors, labels, egress or context |
