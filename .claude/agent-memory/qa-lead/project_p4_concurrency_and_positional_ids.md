---
name: p4-concurrency-and-positional-ids
description: Shipqube QA docs are co-edited by other agents mid-session; AT- test IDs are positional so the Gherkin map must be regenerated after any story edit
metadata:
  type: project
---

During P4 (2026-11-12) product-manager, ux-designer and principal-architect edited story files, ADR-0023 and nfr-traceability.md while qa-lead was writing. Story Gherkin changed mid-session (Must scenarios went 1,592 → 1,599), which shifted positional `AT-US-NNN-nn` IDs.

**Why:** `AT-` IDs are the 1-based scenario position in each story (D-QA-002), and `docs/05-quality/tests/gherkin-test-map.md` is generated, not hand-written. The generator lived only in a session scratchpad; Wave 0 task T-QA-02 is supposed to commit it as `tools/quality/gen-gherkin-map.mjs`.

**How to apply:**
- Regenerate the Gherkin map as the last step of any QA session and after every story change; check whether T-QA-02 has landed the generator before rebuilding one.
- In shared files (nfr-traceability.md, DECISIONS.md, traceability.md) make Edit calls strictly one at a time, never two in the same batch, and re-read before each edit. Append to DECISIONS.md via a scratch file + `cat >>` (heredocs with backticks failed in this shell).
- Related: [[qa-strategy-artifacts]]
