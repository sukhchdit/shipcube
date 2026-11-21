---
name: dpm071-acceptance-created-by
description: D-PM-071 (2026-11-19, from D-ARCH-157) — membership created at invitation acceptance has created_by = the accepting user, inviter = invitations.created_by; corrects one point of D-067; REQUIREMENTS 1.12, PRD 1.13; when a Gherkin step may be amended versus explained in notes
metadata:
  type: project
---

D-PM-071: at `POST /invitations/accept` the membership's `created_by` is the accepting user (the actor of the transaction), `invitation_id` names the accepted invitation, and the inviter is the creator of the invitation (`invitations.created_by`), not copied onto the membership. "`created_by` = the inviter" from [[d067-invitation-pending-state]] is withdrawn; the rest of D-067 stands. Edits: REQ-ORG-011 note (shall-text unchanged), US-084 Notes plus the Then-steps of "Accept" (AT-US-084-01) and "Audit" (AT-US-084-08); titles, order and count (8) unchanged. REQUIREMENTS 1.12, PRD 1.13 (its §11 row also back-logs REQUIREMENTS 1.10 / D-067, which never had a row). Counts unchanged 434 / 91 / 293 / DC 134; traceability untouched.

**Why:** `platform.std_columns_guard()` (D-ARCH-091, merged with PR #65) refuses an insert whose `created_by` is not the transaction's actor, so the old wording asked for a row the database refuses. No user-visible loss: "who invited" is read from the invitation (`Invitation.invited_by` in the API). The edit was the dispatch gate on TASK-227 (D-SD-002).

**How to apply:**
- Any requirement or story text that sets `created_by` to someone other than the acting user is wrong by construction: `created_by` is always the transaction's actor. A path where an organisation enrols a user who is not the actor needs an ADR-0005 amendment first (D-ARCH-156 consequence).
- Rule for Gherkin edits on an architecture-driven correction: if the step still holds as written, keep it and explain in Notes (D-PM-069 form); if the step asserts a value that is now false, amend that step only, keep the title and position, and say so in the D-entry (this entry's form, same convention as [[d063-allow-parity-wording]] and [[d065-gherkin-append-only]]).
- When the architect proposes replacement wording that drops an assertion, keep a positive assertion of the corrected value if the task card tests it.
- Routed lines can undercount: the ruling named two US-084 lines, the Notes line was a third. Grep the whole story for the withdrawn phrase.
- Left for others at the time: `openapi.yaml` `acceptInvitation` description still said "The membership `created_by` is the inviter" (api-designer). Verify before repeating.
- DECISIONS.md is appended by several agents at once; an entry may land before a concurrent one, which is fine. The "next entry is D-PM-0xx" pointer lives in the D-PM-068 entry (D-PM-073 after [[dpm072-job-payload-v2-wording]]).
