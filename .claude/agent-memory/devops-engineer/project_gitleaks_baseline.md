# gitleaks-full baseline changes

- Count pins to change together: `BASELINE_COUNT` in tools/quality/gitleaks-full.mjs; tools/ci/sec-static.test.ts
  (PR25-SEC-01 test: length, Set size, sorted 7-char commit prefixes, openapi=15, plus exact-line pins);
  tools/quality/gitleaks-full.test.ts (`toHaveLength`, comments); gitleaks-full.int.test.ts (test names, comments).
- Entries must be exact `<40-hex>:<path>:generic-api-key:<line>` (D-SEC-PR45-01). Never a .gitleaks.toml path allowlist.
- Trap: gitleaks-full.test.ts reads the baseline via `git show HEAD:`, so the unit tests fail ("holds N, exactly M
  expected") until the change is committed. Commit first, then run the tools unit tests.
- Prettier on the .txt needs `--ignore-unknown`. commitlint (config-conventional) caps body lines at 100 chars, so wrap
  long fingerprints in the commit body.
- Unit run of tools/quality + tools/ci with --runInBand takes over 3 min (45 suites, ~1557 tests at 19-line baseline).
- 2026-11-21: PR #85 raised the count from 17 to 19 (PR080-SEC-07).
- Merge-commit trap (D-DEVOPS-001): gitleaks scans merges as first-parent diffs, so a branch that merged main while a
  flagged line was on main gets its OWN fingerprint `<merge sha>:<same path>:<same line>`; re-merging main never clears
  it. Main's baseline alone can't fix such branches (TASK-044 c33e5e92, 040-B 0ccdd009, 041-B aade2672).
- Without Docker: emulate the v8.30.1 rule in Node (regex from config/gitleaks.toml at the tag, entropy STRICTLY > 3.5,
  secret allowlist ^[a-zA-Z_.-]+$, match-target allowlist, stopwords). Narrow the range with `^<last passing heads>`.
- 2026-11-21 (D-DEVOPS-002): #85 at 72249e40 holds 22 (adds c33e5e9/0ccdd00/aade267 merge lines). Baseline lines only fix
  lane B (reads base ref); lane A range scans of those branches still need PR080-SEC-07 route (c).
- 2026-11-21 (D-DEVOPS-003): PR #88 (head 641ff03c) = lane A route (c): three commit-bound .gitleaks.toml tables
  (c33e5e9/0ccdd00/aade267, DECISIONS.md:7697, phrase as [a-z=]{12}); sec-static pins five descriptions.
- Traps: Bash heredocs here drop double backslashes (write regex-bearing scripts with the Write tool); the shared
  scratchpad holds other agents' pr-body.md: always use a unique subdir before `gh pr create --body-file`.
