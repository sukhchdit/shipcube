---
name: id-regex-must-allow-digits
description: When scripting traceability checks in this repo, REQ area codes can contain digits (REQ-I18N-*, NFR-A11Y-*); a [A-Z]+ pattern silently drops rows
metadata:
  type: feedback
---

Use `REQ-[A-Z0-9]+-\d{3}` and `NFR-[A-Z0-9]+-\d{3}` (not `[A-Z]+`) in every verification script for this project.

**Why:** At G1 my first pass parsed 416 REQs instead of 430 and flagged six EPIC-05 stories as having no linked REQs; all 14 missing rows were `REQ-I18N-*`. Reporting that would have been a false FAIL finding.
**How to apply:** Any gate script that counts or cross-links IDs: include digits in the area class, then sanity-check parsed totals against the document's own statistics table before trusting any "missing/orphan" result. Also note Markdown table cells with unescaped `|` inside code spans (seen in NFR-MAINT-002) break row parsing.
