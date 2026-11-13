---
name: d065-gherkin-append-only
description: D-065 (2026-11-13) — scenario position in a story's Gherkin block is the AT number; new scenarios are appended at block end, never inserted; US-066/121/129/137/222 reordered; PRD 1.10
metadata:
  type: project
---

D-065: gherkin-test-map.md numbers AT-US-xxx-NN by scenario position (outline = one). D-058/D-060 and carrier edits inserted scenarios mid-block in US-066 (map 8 -> 12), US-121 (6 -> 7), US-129 (5 -> 10), US-137 (7 -> 8), US-222 (8 -> 10); moved verbatim to block end so map numbers keep meaning. Only wording touch: US-129 "Token never logged" "scenarios above" -> "all scenarios in this feature". PRD 1.10; REQUIREMENTS 1.9, NFR 1.5, traceability 1.6 untouched.

**Why:** tests carry AT IDs for the project's life; renumbering would break committed junit evidence IDs. Supersedes the "renumber US-066 tests" half of D-ORCH-049 (2).

**How to apply:** when adding a scenario to an existing story, append after the last scenario (after `@live-sandbox` ones too). Check for positional wording ("above", "previous"). qa-lead owns map regeneration and `KNOWN_DRIFT`. Related: [[d063-allow-parity-wording]].
