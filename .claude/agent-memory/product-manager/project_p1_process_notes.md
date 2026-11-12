---
name: p1-process-notes
description: How the P1 requirements phase was run for this brief (parallel analysts + merge agent + 5 story-writers + Node verification agent), what the artefact conventions are, and the pitfalls to avoid on change requests / re-scoping.
metadata:
  type: project
---

P1 for run 1 (2026-11-12) was produced by: 2 requirements-analysts in parallel (Part A foundation areas / Part B commerce areas, separate files, spliced by a general-purpose agent with a Node script), 1 NFR analyst, 5 story-writers with disjoint REQ areas and reserved US-ID ranges, and 1 general-purpose agent that generated `docs/sdlc/traceability.md` and ran the G1 checks (orphans, dangling IDs, MoSCoW consistency, Must-story scenario coverage).

**Why:** product-manager has no Bash; 430 REQs / 290 stories are too large to merge or verify by hand. The story format in `docs/01-requirements/stories/README.md` (the `- **Linked REQs:**` line and `## Coverage check` tables) is what the generator parses — keep it when adding/changing stories.

**How to apply:**
- For a change request or re-scope, edit the REQ row and the story, then re-run a verification agent (Node, scratchpad) rather than trusting hand counts.
- Pitfalls seen: two analysts invented different names for the same thing (SSE event names, `org:member:manage` vs `org:manage_members`, order-number format, error codes) — always give parallel analysts a shared vocabulary (error catalogue, permission names, event names) or run a reconciliation pass. Story-writers follow "story MoSCoW ≤ max linked REQ MoSCoW" strictly, so demo-critical items must be Must at REQ level first.
- Must-story permission paths: README rule 3 requires an explicit `Permission path: not applicable — …` line for no-principal stories; keyword heuristics otherwise flag them.
