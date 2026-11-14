---
name: d066-image-size-mib
description: D-066 (2026-11-14) image-size budget unit fixed to binary MiB per D-ARCH-118; NFR-OPS-002 / A-039 wording; NFR 1.7, PRD 1.11; where the stale "300 MB" still lives
metadata:
  type: project
---

D-066: container image-size budgets are binary MiB, measured as the sum of uncompressed `docker history` layer sizes: api/worker ≤ 300 MiB (314,572,800 bytes), Nginx web/admin ≤ 60 MiB, WARN at ≥ 90 % (270 / 54 MiB), fail only above 100 %; tooling image reported, not gated. Written into NFR-OPS-002 (NFR.md 1.7), A-039 and PRD change log 1.11.

**Why:** architect ruling D-ARCH-118 (rulings/wave-0-task-014-rulings.md §4). The original "300 MB (default)" had no unit; the measured worker (296.0 MiB = 310.4 MB) passes in MiB and fails in SI MB. Binary chosen because the stack suite compares bytes against `300 * 1024 * 1024` and every other byte budget in the architecture is binary. Headroom is tracked as work (`imgheadroom` task: worker ≤ 270 / api ≤ 255 MiB; R-ARCH-31), not a pass.

**How to apply:** if a change request asks to raise the budget, the ruling says that is PM's call only once the WARN threshold is crossed after the prunes; the alternative lever is `cc-debian13` + static busybox (≈ 58 MiB, needs a spike + superseding ADR amendment). Do not switch to SI MB unless worker ≤ 286 MiB first. ADR-0002 l. 39 and ADR-0019 l. 14 still say "300 MB" (architecture-owned; routed to TASK-282 docs drift). NFR.md 1.6 (D-ARCH-088) was never logged in the PRD change log; 1.11 notes it. Pattern: a wording-only NFR change still gets a PRD §11 line and an NFR header Version bump; ASSUMPTIONS.md has no change log, so the D-reference goes into the row's Source column.
