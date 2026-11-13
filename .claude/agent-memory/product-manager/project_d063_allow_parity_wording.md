---
name: d063-allow-parity-wording
description: P5 Wave 0 ruling D-063 — AT-US-007-02 Allow header now "GET, HEAD, OPTIONS" + OPTIONS 204 parity line after PR #21 R1-m3; which convention a PR-driven AC wording fix follows (D-059/D-060 style: PRD 1.8, REQUIREMENTS 1.8, story note; traceability untouched)
metadata:
  type: project
---

D-063 (2026-11-13): AT-US-007-02 (US-007, M0 Must, non-DC) amended from `Allow` = "GET, HEAD" to "GET, HEAD, OPTIONS", plus an "And OPTIONS on the same route returns 204, no body, same Allow" parity line inside the same scenario (title unchanged so gherkin-test-map row stays valid). REQ-PLAT-010 note now carries the rule ("Allow lists every supported method including OPTIONS; OPTIONS on a known route is 204 with the same Allow"). Versions: REQUIREMENTS.md 1.8, PRD 1.8; NFR 1.5 and traceability 1.6 untouched. api/README §3 line belongs to api-designer (D-ORCH-023), not PM.

**Why:** PR #21 code review R1-m3 made the 405 `Allow` and the OPTIONS 204 `Allow` agree per RFC 9110 §15.5.6/§9.3.7; the story literal contradicted reviewed code. Sharpened the REQ note too because "carries an Allow header" let a reader infer Express's default list again.

**How to apply:** When a code review finding makes an AC literal wrong (not a scope or ownership question), classify it as a *wording amendment*: PRD §11 row + header version, REQUIREMENTS.md version/date bump if a REQ note changes, story Notes line citing the D-0xx and review item, traceability untouched. Do NOT use the delivery-split form ([[d061-us049-delivery-split]], [[d062-us008-delivery-split]]) — that one bumps traceability and touches sheets. Keep scenario titles stable (gherkin-test-map.md keys on them). Prefer putting the general rule in the REQ note and the literal fixture value in the AC. Related: [[p3-alignment-decisions]].
