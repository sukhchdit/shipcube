# Accessibility specification (WCAG 2.2 AA)

Version 1.0 · 2026-11-12 · owner ux-designer · Stories **US-102, US-103, US-104, US-105, US-106, US-107, US-113, US-120** and every screen story · NFR-A11Y-001..006 · Both apps

This page is the cross-cutting accessibility contract. The per-screen notes live in each wireframe (§ "Accessibility"). §10 is the per-screen checklist that qa-lead uses as the manual audit sheet for NFR-A11Y-001.

## 1. Conformance target and test approach

- **Target:** WCAG 2.2 Level AA on both apps, including the 2.2 additions: 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum), 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication (Minimum).
- **Automated:** axe on every route and every reachable state, light and dark, 360 and 1280 px (US-113, NFR-A11Y-002).
- **Manual:** keyboard-only journeys (NFR-A11Y-003), screen-reader spot checks (NVDA + Firefox, VoiceOver + Safari/WebKit) on sign-in, quote, booking, tracking, staff sign-in and the audit viewer, plus the checklist in §10.
- **Out of the Platform's control:** gateway-hosted card fields and the 3DS challenge. These are tested end to end and recorded as third-party findings if they fail (W08 §4).

## 2. Page structure

| Rule | Spec |
|---|---|
| Landmarks | Web: `header` (banner), `nav` (labelled: "Main", "Account", "Booking steps", "Footer"), `main#main`, `aside` (labelled summaries), `footer` (contentinfo). Admin: banner, `nav` "Admin", main. One `main` per page. |
| Headings | Exactly one `h1` per page (US-106), with no level skipped. Visually hidden headings are used where the visual design has none (results "Options"). |
| Page title | `{page} · {BRAND_NAME}`, updated on every client navigation. State-specific prefixes are added ("Not found ·", "Error ·"). |
| Language | `<html lang>` = active locale (US-106). Language names in switchers carry `lang` (3.1.2). |
| Skip link | First focusable element, targets `main` (US-108) |
| Route change | Focus moves to the page `h1` (`tabindex=-1`) and the title is announced politely. Query-only changes (filters, sort, paging) do not move focus; they announce result counts instead. |
| Reading order | DOM order equals visual order. The sticky summary (`aside`) follows `main` content in the DOM even though it is visually on the side, so the mobile and desktop orders agree. |

## 3. Keyboard and focus

- **Everything operable by keyboard.** Tab for navigation between controls. Arrow keys within composite widgets (RadioGroup, ToggleGroup, menus, tabs, the Calendar grid, the Combobox listbox). Enter/Space to activate. Escape closes overlays and comboboxes.
- **Focus indicator:** 2 px `focus.ring` + 2 px offset. Contrast ≥ 3:1 against adjacent colours in both themes (tokens.md §3.3). It is never suppressed. `:focus-visible` drives it.
- **Focus not obscured (2.4.11):** `scroll-padding-block-start` = header height + 8 px; `scroll-padding-block-end` = sticky bar height + 8 px on pages with a sticky bar. Toasts never cover the focused element: toasts are placed at the block-end and pushed above the sticky bar, and a toast never takes focus.
- **No keyboard traps** except modal dialogs and drawers, which trap intentionally and release on Escape or close, returning focus to the trigger (US-113).
- **Focus management on dynamic updates:**

| Event | Focus |
|---|---|
| Form submit with errors | First invalid field (US-106) |
| Blocking alert inserted after an action (checkout gate, sign-in failure, payment failure) | The alert's heading or container (`tabindex=-1`) |
| Item removed from a list | Next item, else the list heading or the "Add" control |
| Dialog open | First field, or the dialog title when there is no field. AlertDialog: the least destructive action. |
| Wizard step change | Step `h1` |
| Booking success | "Your shipment is booked" `h1` |
| Streaming results arrive | No change (US-161) |
| Disclosure toggled | Stays on the toggle |

## 4. Live regions and status messages (4.1.3)

One `Announcer` per app provides a polite and an assertive region (components.md §1). Rules (D-UX-010):

| Source | Politeness | Message pattern | Throttle |
|---|---|---|---|
| Streaming quote results (S-W02) | polite | "{done} of {total} carriers responded, {count} options" | ≥ 2 s between messages; a final summary on completion |
| Re-sort / filter / paging (lists, results, audit) | polite | "Sorted by cheapest" / "{count} results" | debounced 500 ms |
| Live billable weight (S-W01) | polite | "Total billable weight {value}" | 1 s |
| Address re-layout on country change | polite | "Address fields updated for {country}" | none |
| Prohibited/restricted/HS messages | polite (via `aria-describedby` + a field-scoped live region) | Entry name and status | on result |
| Booking saga step done (S-B07) | polite | "{step}: done" | none (6 steps max) |
| Booking failure (S-B07) | assertive | Failure title | once |
| Toasts | `role="status"` (success, info) / `role="alert"` (error) | Toast text | n/a |
| Offline / back online | `role="status"` | Banner text | n/a |
| Copy actions | polite | "Copied" | n/a |
| Countdown timers (cut-off, lockout) | **none** | The text contains the absolute time; no per-tick announcements | — |
| Rate-limit and `ACCOUNT_DELAYED` countdowns (F10 §1.1, D-UX-037) | message: its alert role after the user's own action, otherwise the route `h1`; end: polite | Once when the message appears (with the retry time); once when the control becomes available: "You can try again now." No focus move at the end | no per-tick announcements; 2 messages per refusal |
| API client's silent repeats of a `RATE_LIMITED` answer with `Retry-After: 1` (F10 R19) | none | The loading state keeps `aria-busy`; nothing else | — |
| Admin idle warning (W00 §2.1) | alertdialog on open (role-based announcement); then polite | Open: title + "we'll sign you out at {time}"; at 1 minute left: "1 minute left before you're signed out."; after Extend: "Session extended" | 2 timed messages per warning |
| CVC field appears after the server flag (W08 §5) | polite (`role="status"` notice) | "For your security, enter the security code for {card}." | once |
| Track result (S-W03) | polite | "{status}. Estimated delivery {date}" | once per lookup |

Never use `aria-live` on large containers that re-render. Announcements go through the Announcer only.

## 5. Forms, validation and the error summary

- **Labels:** every control has a visible label associated with `for`/`id`. Groups use `fieldset` + `legend`. Placeholder text is never the label (US-106). Optional fields say "(optional)" and required ones are the default; asterisk-only marking is not used (D-UX-013). `aria-required` is set on required fields.
- **Instructions:** format hints sit under the label and are linked with `aria-describedby` (for example "e.g. 400001", "At least 12 characters").
- **Validation timing:** on blur first, then live while the error is shown, and on submit. Never on the first keystroke.
- **Error message:** below the field, icon + text in `status.danger.fg`, linked with `aria-describedby`, and `aria-invalid="true"` on the control. The text says what is wrong and how to fix it (§ content-and-i18n.md §4).
- **Error summary pattern** (forms with 2 or more fields, 2 or more errors): on submit, render an `ErrorSummary` above the form (`role="region"`, `aria-labelledby` its heading "There are 3 problems to fix"), with each item a link to its field. **Focus goes to the first invalid field** (US-106). The summary updates as errors are fixed. Server errors without a field pointer are listed first, without links.
- **Server mapping:** `errors[].pointer` → field. Unknown pointers → summary. Messages from `errors:<CODE>` / `validation:<SUB_CODE>`. The raw API text is never shown (US-115).
- **Disabled vs aria-disabled:** submit actions blocked for a business reason (prohibited item, offline, incomplete steps, rate limit) use `aria-disabled="true"` with `aria-describedby` → the reason, so they stay discoverable. Native `disabled` is only for controls that are irrelevant in the current state.
- **Autocomplete (1.3.5):** names, emails, phone numbers and addresses use `autocomplete` tokens with `section-sender` / `section-receiver` scoping. Passwords use `current-password` / `new-password`. OTP uses `one-time-code`.
- **Redundant entry (3.3.7):** quote inputs carry into the wizard (postcode, residential flag, packages). Sender details are remembered within a session and from the default sender (Should). The sign-in email carries to "Forgot password" and "Register". The review step summarises rather than re-asks. Confirm-password fields are not used; show/hide is provided instead.
- **Character counters:** shown when within 10% of the limit or always for limits ≤ 200, announced only when within 10% of the limit.

## 6. Authentication (3.3.8, NFR-A11Y-001)

- No cognitive function test: no CAPTCHA, no puzzles, no "type the characters".
- Paste is allowed in all password, code and recovery-code fields. Password managers work (correct `autocomplete`, `type`, stable `name`/`id`).
- The TOTP code is a single field (D-UX-026). Recovery codes are an alternative path.
- Show/hide password toggle (`aria-pressed`).
- Email-link flows (verify, reset) need no transcription. The token is in the link.
- Time limits: the MFA challenge (5 min) and enrolment (15 min) are restartable without losing anything (2.2.1 satisfied by a simple restart, the same as extending).
- **Re-authentication (ReauthDialog, US-291, W03 §8):** the same rules apply: password with show/hide and a hidden `username` field for password managers, or the single TOTP field; paste allowed; no cognitive test. The 5-minute proof is requested at the last step and used at once; an expired proof re-prompts at no cost.
- **Staff enrolment e-mail code (W15 §3 Step 0):** single `one-time-code` field, paste allowed; the code is in the e-mail, so no transcription test beyond copying (3.3.8 "object recognition / copy" alternative is satisfied by paste).
- **CVC re-collection (W08 §5):** entering a card's security code is not a cognitive function test under 3.3.8 (it is a known value, like a password); the hosted field supports paste and browser card autofill where the gateway allows it.

## 7. Target size and pointer (2.5.5 AAA not claimed; 2.5.8 AA plus the brief's stricter rule)

- `pointer: coarse`: all interactive targets ≥ 44 × 44 CSS px (brief §8, NFR-A11Y-004). The only exception list is inline text links within sentences.
- `pointer: fine`: controls ≥ 36 px tall. Icon buttons are 36 × 36. Spacing between targets ≥ 8 px. This exceeds 2.5.8's 24 px minimum.
- Hover affordances exist only under `@media (hover: hover)`. Every hover-revealed action (row quick actions) has a permanently visible keyboard and touch equivalent ("More actions" button).
- **Dragging (2.5.7):** no function requires dragging. Bottom sheets and toasts can be swiped, and each has a close button. The calendar has no range dragging. Reordering is not used in M1. The map (Could) is not built.
- Pointer cancellation (2.5.2): actions fire on `click` (up event), never on `pointerdown`.

## 8. Visual design

- **Contrast:** all token pairs computed in tokens.md §3.3 (light and dark). Text ≥ 4.5:1, large text and UI components ≥ 3:1. The CI pair test is the gate (NFR-A11Y-005).
- **Colour not alone (1.4.1):** status badges, validation, outcomes, badges ("Cheapest"), the Test mode label, the diff (Before/After labels) and redaction markers all carry text and icons.
- **Reflow (1.4.10):** no two-dimensional scrolling at 320 CSS px (400% zoom), except CodeBlocks (US-107). Tables become cards under 768 px.
- **Text spacing (1.4.12):** no fixed heights on text containers. Line-height and letter-spacing overrides must not clip (tested with the text-spacing bookmarklet styles in Playwright).
- **Resize text (1.4.4):** rem-based type with `html { font-size: 100% }`. Layouts work at 200% text size.
- **Reduced motion (2.3.3 is AAA; 2.2.2 AA):** all transitions resolve to 0 ms under `prefers-reduced-motion: reduce` (NFR-A11Y-006). Skeletons are static. Nothing auto-plays or blinks. The countdown text updates once a minute, which is not considered motion.
- **Images and icons:** decorative icons `aria-hidden`. Informative images have alt text (QR code, logo). No text in images.
- **Dark mode:** a full token theme, with contrast verified separately.

## 9. Component ARIA patterns (summary)

| Component | Pattern |
|---|---|
| Dialog, AlertDialog, Drawer, BottomSheet | Radix Dialog / AlertDialog: `role="dialog"`/`alertdialog`, `aria-modal`, labelled by the title, focus trap, Escape, return focus |
| Menu (account, row actions) | Radix DropdownMenu: `menu`/`menuitem`, type-ahead |
| Select | Radix Select (listbox) |
| Combobox | ARIA 1.2 combobox + listbox (in-house, D-UX-017) |
| RadioCard, SegmentedControl, DateChipList | Radix RadioGroup / ToggleGroup: roving tabindex, arrow keys |
| Calendar | Date grid: `grid`, `gridcell`, `aria-selected`, `aria-disabled` with reasons |
| Disclosure (price details, sections) | `button[aria-expanded][aria-controls]` |
| Tabs (only where used) | Radix Tabs |
| Toast | Radix Toast with `role="status"`/`alert` |
| Tooltip | Radix Tooltip: hover + focus, Escape dismiss, supplementary only |
| Data table | Native `table`, `caption`, `th[scope]`, `aria-sort` on sortable headers |
| Progress (wizard) | `role="progressbar"` + `aria-valuetext`; step list `aria-current="step"` |
| Status badge | Plain text + `aria-hidden` icon (no role) |
| Copy button | Button + polite announcement |
| CodeBlock | `role="region"` + label + `tabindex="0"` (scrollable) |

## 10. Per-screen checklist

✓ = applies and must pass. "n/a" = not applicable. Columns: **L** landmarks and single `h1` · **K** keyboard path complete, no trap · **F** focus management per §3 · **LR** live regions per §4 · **E** error summary / inline errors per §5 · **T** targets per §7 · **D** no dragging required · **A** accessible authentication §6 · **R** reflow at 320 px / tables to cards · **M** reduced motion · **C** colour-not-alone and contrast.

| Screen | L | K | F | LR | E | T | D | A | R | M | C | Screen-specific checks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Web shell + states (W00) | ✓ | ✓ | ✓ | ✓ offline, toasts | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Skip link first; drawer trap and return; theme and locale switchers announced |
| S-W01 Home widget | ✓ | ✓ | ✓ | ✓ live weight | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Fieldsets for From/To and dimensions; works pre-hydration; swap button named |
| S-W02 Results | ✓ | ✓ | ✓ no jump on arrival | ✓ streaming, throttled | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ badges text | Cards in a list; disclosure; compare limit message; expired state |
| S-W03 Public tracking | ✓ | ✓ | ✓ | ✓ result summary | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Rate-limit countdown not announced per tick; timeline `ol` |
| S-W04 Prohibited items | ✓ | ✓ | ✓ | ✓ count | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Sample-data notice first in main |
| S-W05 Legal, help | ✓ | ✓ | n/a | n/a | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Draft banner first; prose ≤ 72ch |
| S-A01..A06 Customer auth | ✓ | ✓ | ✓ alerts focused | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Paste allowed; autocomplete tokens; OTP single field; countdown text |
| S-B01 Wizard shell + addresses | ✓ | ✓ | ✓ step h1 | ✓ re-layout | ✓ summary | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Sticky bar never covers focus; masked ID toggle; section autocomplete |
| S-B01a Choose service again | ✓ | ✓ | ✓ | ✓ streaming | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Price-change text, not colour |
| S-B02 Contents | ✓ | ✓ | ✓ remove-item focus | ✓ prohibited messages | ✓ | ✓ | ✓ | n/a | ✓ table→cards | ✓ | ✓ | `aria-disabled` Continue with reason; per-cell names in the table |
| S-B03 Collection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ chips ≥ 44 | ✓ no drag | n/a | ✓ | ✓ | ✓ | Disabled dates announce reasons; zone note described |
| S-B04 Extras (Should) | ✓ | ✓ | ✓ | ✓ price update | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | "Updating…" status for recomputation |
| S-B05 Review | ✓ | ✓ | ✓ gate alerts | ✓ resend status | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Edit links named by section; price table caption |
| S-B06 Checkout | ✓ | ✓ incl. gateway frame | ✓ outcome alerts | ✓ 3DS notice | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ Test mode text | Gateway iframe titled; amount in Pay label |
| S-B07 Progress + confirmation | ✓ | ✓ | ✓ success h1 | ✓ saga | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Codes visible, not toast-only; download names |
| S-C01 Account overview | ✓ | ✓ | ✓ | n/a | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Tiles are sections with h2 |
| S-C02 Shipments list | ✓ | ✓ | ✓ paging | ✓ counts | ✓ search | ✓ | ✓ | n/a | ✓ table→cards | ✓ | ✓ | `role="search"`; caption; `aria-sort` |
| S-C03 Shipment detail | ✓ | ✓ | ✓ | ✓ docs ready | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Section disclosures; menu semantics; masked ID name |
| S-C04 Drafts | ✓ | ✓ | ✓ delete focus | ✓ | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | AlertDialog default focus on Cancel |
| S-D01..D03 Admin auth | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Recovery codes as a list; leave prompt; QR alt + key |
| S-D04 Welcome | ✓ | ✓ | ✓ | n/a | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Empty state when no modules |
| S-D05 Audit list | ✓ | ✓ | ✓ | ✓ counts | ✓ range | ✓ | ✓ | n/a | ✓ table→cards | ✓ | ✓ outcome text | Apply model; sticky header; zone in header |
| S-D06 Entry detail | ✓ | ✓ | ✓ | n/a | n/a | ✓ | ✓ | n/a | ✓ diff stacks | ✓ | ✓ redaction text | Diff table headers; CodeBlock scroll region focusable |
| S-D07 Entity history | ✓ | ✓ | ✓ | n/a | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | — |
| S-D08 My sessions (Must, US-027) | ✓ | ✓ | ✓ row-removal focus | ✓ sign-out toasts | n/a | ✓ | ✓ | n/a | ✓ table→cards | ✓ | ✓ "This device" text | Current session labelled; per-row unique button names; IP range header visible |
| S-C07 Security, sessions section (Must, US-027) | ✓ | ✓ | ✓ row-removal focus | ✓ sign-out toasts | n/a | ✓ | ✓ | n/a | ✓ table→cards | ✓ | ✓ | Same as S-D08; AlertDialog default focus on Cancel; section-level error keeps the rest of the page |
| ReauthDialog (both apps, US-291) | ✓ dialog title | ✓ trapped, Escape | ✓ field on open, trigger on close | ✓ alerts | ✓ inline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Purpose + instruction as description; hidden `username` field; one automatic retry only |
| Admin idle dialog (US-033 Should, W00 §2.1) | ✓ alertdialog | ✓ trapped | ✓ Extend on open, restore on close | ✓ open + 1-minute announcement only | n/a | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | Absolute time in the description; per-second countdown `aria-hidden`; any key other than Escape/Enter on a button does not extend |
| S-B06 CVC re-collection (Should, W08 §5) | ✓ | ✓ incl. CVC frame | ✓ field focus only on server flag | ✓ notice | ✓ summary + inline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Label and hint outside the iframe; iframe titled; three named recovery actions |
| S-E01..E04 Emails | n/a | n/a | n/a | n/a | n/a | ✓ 44 px button | n/a | n/a | ✓ fluid | n/a | ✓ | `lang`, plain-text part, underlined links |

## 11. Timing (2.2.1)

| Timer | Treatment |
|---|---|
| Quote validity 24 h, booking cut-off | Real-time events (exception). Absolute times are always shown. Expiry offers a one-action re-quote. |
| Access token 15 min | Silent refresh. No user-facing limit. |
| Customer session: 30-day sliding refresh inside a 30-day absolute cap (D-046, ADR-0006 am. 12) | No limit during use. The cap ends a session that has existed for 30 days regardless of activity (security essential); the result is the signed-out notice and `returnUrl` (no data in the SPA is lost that the server has not saved). Exceeds the 20-hour exception of 2.2.1. |
| Staff idle timeout 30 min of user input (Should US-033, REQ-ADMIN-004, W00 §2.1) | **Extend** option: `alertdialog` at 28 minutes (120 s notice, more than the 20 s minimum), one action "Extend session", unlimited extensions within the 12 h cap. Absolute sign-out time in the description; one announcement at 1 minute left. Read-only admin and URL state mean no data loss. |
| Staff absolute session cap (12 h, Should US-033) | Security essential. Warning banner 5 min before with "Sign in again now" (preserving the URL state). Read-only work means no data loss. |
| Re-authentication proof 5 min (US-291) | Requested at the last step and used immediately; if it lapses, the dialog re-prompts at no cost (restart = extend). The dialog itself has no timer. |
| Staff enrolment e-mail code 10 min (ADR-0006 am. 14) | Restartable: "Send a new code" (60 s cooldown) |
| MFA challenge 5 min, enrolment 15 min, reset link 60 min, verification 24 h | Restartable at no cost (equivalent to extending) |
| Unverified account 7 days (US-292) | Not an interaction time limit: the account is removed and the address can register again; the limit is stated in the verification e-mail (W17 §2) |
| Rate limits, lockouts | The retry time is shown. Not a time limit on content. |
| Toasts 5 s | Paused on hover and focus. Errors persist. Content duplicated on the page (US-105). |
