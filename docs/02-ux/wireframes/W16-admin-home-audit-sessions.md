# W16 — Admin welcome, audit viewer, entry detail, entity history, my sessions (S-D04..S-D08)

Routes (admin) `/`, `/audit`, `/audit/entries/{id}`, `/audit/entities/{entity}/{id}`, `/account/sessions` · Permission `audit:read` (audit routes), staff session (others) · Stories: **US-032, US-097, US-098, US-093, US-110, US-070** · US-099, US-027, US-111 (Should) · Flow: [F06 §2](../flows/F06-staff-signin-totp-audit.md#2-audit-viewer) · D-008 (read-only; no export or regulator report in this run)

**Data needed (list):** a keyset page of entries (occurred-at, actor display name + actor type, role names at the time, organisation name, on-behalf organisation, action, entity name + ID, outcome, IP, source app); filter option lists (users: type-ahead; roles; organisations: operator scope; entity names; actions enum; outcomes enum); the latest chain-verification result (status OK/BROKEN/FAILED/none, verified-at, first broken entry ID). **Detail:** every stored field (REQ-AUDIT entry fields), old/new diff with redaction markers, reason (if any), previous hash and entry hash, user agent raw + parsed, correlation ID and session ID.

## 1. Audit list (S-D05)

### 1280 px (comfortable density)
```
+-------------------+----------------------------------------------------------------------------------+
| sidebar           | Audit log                                       [TEST ENV] [English v] [theme] [Sam v]|
| > Audit log       |----------------------------------------------------------------------------------|
|   My sessions     | # Audit log                                   (shield-check) Chain verified 14:00 CET |
|                   | Read-only record of every action. Viewing this log is also recorded.             |
|                   | +------------------------------------------------------------------------------+ |
|                   | | From [12/11/2026 14:30] To [13/11/2026 14:30] (CET)  [Last 24 h][7 days][31 days] |
|                   | | User [type a name v]  Role [All v]  Organisation [All v]  Outcome [All v]      | |
|                   | | Action [All v]  Entity [All v]  Entity ID [________]  IP [__________]          | |
|                   | | [Apply filters]  <Clear filters>                                    Density [Comfortable v]* |
|                   | +------------------------------------------------------------------------------+ |
|                   | 50 entries shown · newest first                                                  |
|                   | | Time (CET)        | Actor              | Action      | Entity              | Outcome  | IP           | Org        |   |
|                   | | 13 Nov 14:28:03   | Ana Silva (Owner)  | LOGIN       | session 0193…c1     | Success  | 203.0.113.7  | Acme Exp.  | > |
|                   | | 13 Nov 14:27:55   | Anonymous          | CREATE      | quote 0193…9a       | Success  | 198.51.100.2 | —          | > |
|                   | | 13 Nov 14:27:40   | System job (book)  | STATE_TRANS.| shipment 0193…77    | Success  | —            | Acme Exp.  | > |
|                   | | 13 Nov 14:26:10   | Ana Silva (Viewer) | PERM._DENIED| audit_entry         | Denied   | 203.0.113.7  | Acme Exp.  | > |
|                   | | ...                                                                                 |   |
|                   | [‹ Newer]                                                     [Older ›]  Rows [50 v] |
+-------------------+----------------------------------------------------------------------------------+
* Should (US-111)
```
- The sticky header row (`position: sticky`) and the Time column stay visible. Action and Outcome values are shown as text badges: Outcome Success (success), Denied (warning), Failed (danger), each with an icon.
- Each row links to `/audit/entries/{id}` (the Time cell is the link; the whole row is clickable for pointer users). At ≥ 1280, an optional "Preview" quick action (Should, D-UX-023) opens a side panel; the canonical view remains the detail route.
- Shortened IDs show the first 4 and last 2 characters with the full ID in a tooltip and the accessible name. A Copy action is in the row's quick actions.

### 360 px (cards)
```
| [=] Admin   Audit log      [Sam v]   |
| # Audit log                          |
| (shield-check) Chain verified 14:00  |
| [Filters (3)]   Last 24 hours        |  BottomSheet with the same filter set
| 50 entries · newest first            |
| +----------------------------------+ |
| | 13 Nov 14:28:03 CET              | |
| | LOGIN · [✓ Success]              | |
| | Ana Silva (Owner) · Acme Exports | |
| | session 0193…c1                  | |
| | IP 203.0.113.7                   | |
| | <View entry>                     | |
| +----------------------------------+ |
| [‹ Newer]            [Older ›]       |
```
Field order matches the table priority: Time, Action + Outcome, Actor + Org, Entity, IP (US-097).

### Chain verification chip (US-093, PRD §6.1 "verified hash chain")
| Status | Chip |
|---|---|
| OK | success (shield-check) "Chain verified {time}" |
| BROKEN | danger (shield-alert) "Chain break detected at entry {id}" + link to the entry; also an InlineAlert at the top of the list |
| FAILED | warning "Verification couldn't run at {time}" |
| none | neutral "Not verified yet" |

## 2. Entry detail (S-D06)

### 1280 px
```
| Audit log / Entry 0193…a7                                                                 |
| # UPDATE on address 0193…5e                         [Success]                              |
| 13 Nov 2026, 14:20:11 CET (13:20:11 UTC)                                                  |
| <View history of this record>                       Read-only. Entries can't be changed.   |
| +---------------------------------------+ +---------------------------------------------+ |
| | ## Who                                | | ## Change                                   | |
| | User      Ana Silva (0193…11)         | | | Field       | Before        | After         | |
| | Roles     Owner                       | | | line1       | 12 Main St    | 14 Main St    | |
| | Actor     User                        | | | phone       | [REDACTED]    | [REDACTED]    | |
| | Org       Acme Exports                | | | postcode    | 10001         | 10002         | |
| | On behalf —                           | | Reason for change: —                         | |
| | ## Where                              | +---------------------------------------------+ |
| | IP        203.0.113.7                 | | ## Integrity                                | |
| | Device    Chrome 131 on Windows 11    | | Previous hash  9f2c…41e0  [Copy]            | |
| | User agent <Show raw v>               | | Entry hash     a3f1…9c0e  [Copy]            | |
| | Source    web                         | +---------------------------------------------+ |
| | Correlation 01J9…F3K2 [Copy]          |                                                 |
| | Session    0193…c1                    |                                                 |
| +---------------------------------------+                                                 |
```
### 360 px
One column: Who, Where, Change (stacked: per field "line1 — Before: 12 Main St / After: 14 Main St"), Integrity. Long hashes wrap in a CodeBlock (US-098).

- Non-UPDATE actions show "Details" instead of "Change" (for example the LOGIN entry shows the outcome and reason).
- `[REDACTED]` uses a lock icon plus text (not colour, US-098).
- VIEW entries for the audit log itself show "Filters used" (the parameter list) and "Results: 12" (US-098).
- No edit, delete or restore controls exist (US-098).

## 3. Entity history (S-D07; route Must via US-032, content Should US-099)
```
| Audit log / shipment 0193…77 / History                                   |
| # History of shipment 0193…77                                            |
| Oldest first · 9 entries                                                 |
| | Time            | Action           | Actor              | Outcome | Summary                 |
| | 12 Nov 10:01:02 | CREATE           | Ana Silva          | Success | Created                 |
| | 12 Nov 10:01:40 | STATE_TRANSITION | Ana Silva          | Success | DRAFT → QUOTED          |
| | 12 Nov 10:03:10 | STATE_TRANSITION | System job (book)  | Success | PAID → BOOKING          |
```
When US-099 is not built, the route still exists (US-032 deep link) and renders the list endpoint filtered by entity name and ID: the same table with the default newest-first order and the heading "Entries for shipment 0193…77". No placeholder.

## 4. My sessions (S-D08)
Uses the "Where you're signed in" component (W13 §1) inside the admin shell. Columns: Device, Location (coarse IP), Signed in, Last active, Action. The current session is labelled "This device". Actions: "Sign out" per row, "Sign out of all other devices" (AlertDialog).

## 5. States

| State | Audit list | Entry detail | Entity history | My sessions |
|---|---|---|---|---|
| Loading | 10 skeleton rows / 3 skeleton cards; filter bar renders immediately | Section skeletons | Skeleton rows | Skeleton rows |
| Empty | "No entries match these filters." + [Clear filters] (resets to the last 24 h) (US-097) | n/a | "No history for this record." | n/a (the current session always exists, US-027) |
| Error | ErrorState + Try again + reference. `AUDIT_UNAVAILABLE`: "The audit log is temporarily unavailable. Try again shortly." (fail-closed) | same | same | same |
| Partial | Filter option lists failed (for example organisations): those filters disabled with "Couldn't load options", the list still works. Chain status failed: chip "Verification status unavailable". | n/a | n/a | n/a |
| Permission-denied | No `audit:read`: PermissionDeniedState inside the shell, **no request issued**, no sidebar entry (US-097, US-070) | same | same | n/a |
| Not found | n/a | Unknown or cross-tenant ID: NotFoundState (US-098) | NotFoundState for an unknown entity name | n/a |
| Offline | Banner; current page stays; Apply and paging disabled with reason | Banner | Banner | Banner |
| Validation | `RANGE_TOO_LARGE`: inline on the date range "Choose a range of 31 days or less". An invalid URL value (`from=not-a-date`): dropped, InlineAlert "We ignored an invalid filter in the link: From date" (US-032). `INVALID_CURSOR`: "This page link has expired. [Go to the newest entries]". | | | |

## 6. Accessibility

- Landmarks: admin shell. The filter bar is `form role="search" aria-label="Filter audit entries"`. The results table has a caption "Audit entries, newest first" and a polite announcement "{count} entries shown" after Apply.
- **Apply model:** filters apply on "Apply filters" (not on every change), so screen-reader users are not interrupted, keyboard users can set several filters, and there are fewer audit VIEW entries.
- Time zone: column header "Time (CET)" plus the full zone name in the `th` `abbr`/description. Detail shows both local and UTC.
- Diff table: `th scope="col"` Field/Before/After. Stacked view: each field is an `h3` with a `dl`.
- Keyboard: Tab order is filter bar, results (each row has one link), pagination. The row quick actions are reachable via the row's "More" button. No keyboard shortcuts are added in this slice (D-UX-022).
- Density (Should): a Select, persisted per user. Not shown under 768 px (cards).
