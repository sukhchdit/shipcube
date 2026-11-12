---
name: verify-all-n-ids-claims-by-diff
description: Artefacts in this repo assert "all N IDs covered" in prose; set-diff the ID lists across files before accepting, because counts drift when a late decision adds IDs
metadata:
  type: feedback
---

Never accept a prose claim like "all 91 NFR IDs" or "132 ops" from a header or traceability note; compute the ID set in each file and diff them.

**Why:** At G2 (2026-11-12) `traceability.md` claimed nfr-traceability.md held all 91 NFRs incl. NFR-RES-007, but the file had 90 rows (NFR-RES-007 added by D-048 after the architect wrote the matrix). Likewise ARCHITECTURE.md §6 said "430 REQs" after v1.3 raised the total to 434 and STATUS.md said 132 OpenAPI ops when there were 133. Late P3 decisions (D-046..D-052) add IDs that upstream design docs do not absorb automatically.
**How to apply:** For every gate, script the set difference REQ/NFR/story/operation IDs between the source of truth (REQUIREMENTS.md, NFR.md, stories, openapi.yaml) and each derived artefact (ARCHITECTURE §6, nfr-traceability, traceability.md, UX README §3), and check `Design`/`Test` columns for actual fill rate rather than the header's statement. Related: [[id-regex-must-allow-digits]].
