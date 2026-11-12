# Component inventory (packages/ui)

Version 1.0 · 2026-11-12 · owner ux-designer · stories US-101 to US-110, US-113, US-115 to US-120, plus every screen story

All components live in `packages/ui`, consume only tokens ([tokens.md](tokens.md)) and are shared by `apps/web` and `apps/admin`. They are built on the fixed stack: **Tailwind** (token preset), **Radix UI primitives** for behaviour and ARIA, **TanStack Table** for data grids, **React Hook Form + Zod** for forms, and **react-i18next** for every string. No other UI library is introduced (D-UX-016). Domain components such as `ResultCard` and `PriceBreakdown` are composites of the base components and live in the app or in `packages/ui/domain`.

## 0. Rules that apply to every component

### 0.1 Interaction state matrix

Every interactive component implements all of these states. The visual treatment is consistent across components:

| State | Trigger | Treatment |
|---|---|---|
| Default | — | Token colours as specified per component |
| Hover | Pointer over, **only inside `@media (hover: hover)`** | Background or border steps one level (`bgHover`, `border.strong`). Cards lift `motion.lift` with `shadow.e2` and get a `border.selected` 1 px accent on the start edge. Transition `duration.fast`. |
| Focus-visible | Keyboard focus (`:focus-visible`) | 2 px `focus.ring` outline, 2 px `focus.offset` gap. Never removed. Never only a colour change. Not shown for mouse focus. |
| Active / pressed | Pointer down or Enter/Space held | `bgActive` + `shadow.pressed` |
| Disabled | `disabled` or `aria-disabled` | `text.disabled`, `bg.subtle`, no hover, `cursor: not-allowed`. Native `disabled` for form controls. Use `aria-disabled="true"` (still focusable) when a reason must be discoverable, as for "Continue" blocked by a prohibited item, with the reason linked via `aria-describedby`. |
| Loading | Async action in flight | The label stays visible. An inline 16 px spinner replaces the start icon (spinners appear **only inside buttons**, US-104). `aria-busy="true"`. Repeat activation is ignored (US-103). Width is locked so there is no shift. |
| Error | Validation or server error | 2 px `border.danger`, danger icon and message text below, linked with `aria-describedby`; `aria-invalid="true"` |
| Success | Confirmed outcome where useful (copy, save) | Success icon and text for 2 s (copy) or a persistent inline success message. Never colour only. |

### 0.2 Pointer and touch sizing

- `@media (pointer: fine)`: control height 36 px (`size.control.fine`); icon buttons 36 × 36.
- `@media (pointer: coarse)`: every interactive target is at least 44 × 44 (`size.control.coarse`), including checkboxes (via label hit area), chips, table row actions and close buttons.
- Spacing between adjacent targets is at least 8 px on coarse pointers.

### 0.3 Accessibility baseline

- Every control has a visible, programmatically associated `<label>`. A placeholder is never the only label (US-106).
- Icon-only buttons have an accessible name from an i18n key (`aria-label={t('…')}`) and a tooltip showing the same text.
- Components use logical CSS properties only (`margin-inline-start`, `padding-block`, `inset-inline-end`, `text-align: start`), per US-120.
- No component conveys meaning by colour alone.
- Strings come from props that the caller passes through `t()`. Components never hard-code text. Shared default labels such as "Close" come from the `common` namespace.

### 0.4 Variant naming

`variant` (visual role) × `size` (`md` default, `lg` page-primary) × `tone` (`neutral | info | success | warning | danger`, where applicable).

---

## 1. Foundations and layout

| Component | Built on | Purpose and spec |
|---|---|---|
| `ThemeProvider` | context + `data-theme` | Reads the stored preference (user profile, else `localStorage` for guests), applies `light | dark | system`, listens to `prefers-color-scheme`. An invalid value resolves to `system` (US-102). |
| `SkipLink` | `<a href="#main">` | First focusable element on every page. Visually hidden until focused, then shown at the top-start with `zIndex.skipLink`. Moves focus to `<main id="main" tabindex="-1">`. Label: `shell:skipToContent`. |
| `VisuallyHidden` | Radix VisuallyHidden | Screen-reader-only text |
| `Announcer` | two `aria-live` regions (`polite`, `assertive`) mounted once per app | `announce(message, {politeness, throttleMs})`. Throttling coalesces bursts, for example streaming results (D-UX-010). |
| `RouteFocusManager` | router listener | On client navigation, moves focus to the page `<h1 tabindex="-1">`, updates `document.title` (`{page} · {BRAND_NAME}`) and announces the title politely. Skipped when navigation only changes query parameters (filters). |
| `Container` | `div` | Max width `containerMax` (web) or `containerWide` (admin), with responsive gutters |
| `Stack` / `Cluster` / `Grid` | `div` + flex/grid | Layout helpers with gap tokens only |
| `PageHeader` | `header` region inside main | Breadcrumbs (optional), `h1`, optional description, actions slot (wraps below the title under 768 px) |
| `Breadcrumbs` | `nav aria-label` + `ol` | The last item has `aria-current="page"`. Middle items collapse to "…" (a DropdownMenu) under 768 px. |
| `Card` | `section`/`article` | Variants: `plain` (border.control 1 px when no shadow), `elevated` (`shadow.e1`), `interactive` (whole card clickable through a single stretched primary link, never a nested button-in-button), `selected` (`border.selected` 2 px + `bg.selected`) |
| `Divider` | Radix Separator | `border.subtle`, decorative unless `decorative={false}` |
| `DescriptionList` | `dl` | Key-value pairs. Two columns at ≥ 768 px, stacked under 768 px. Used for addresses, entry fields and shipment facts. |
| `StickyActionBar` | fixed `div` at block-end | Under 768 px only. Height 64 px + safe area. Contains the summary slot (start) and the primary action (end). Hidden while an input is focused and the visual viewport height shrinks by > 150 px (on-screen keyboard). Adds `scroll-padding-block-end` so it never covers focus (US-109, WCAG 2.4.11). |
| `StickySummary` | `aside` | ≥ 1024 px only. `position: sticky`, top = header + 16 px. Collapses into the `StickyActionBar` summary slot plus a `BottomSheet` under 1024 px. |

## 2. Actions

### Button
- **Built on:** native `<button>`. Radix Slot for `asChild` links.
- **Variants:** `primary` (one per view region), `secondary`, `ghost`, `danger`, `link` (looks like a link, behaves as a button).
- **Sizes:** `md` (36 fine / 44 coarse), `lg` (44 fine / 48 coarse). Full-width option under 768 px.
- **Anatomy:** optional start icon, label, optional end icon, loading spinner (replaces the start icon).
- **States:** full matrix (0.1). The loading label can change to a progress label ("Paying…") only when the width stays locked.
- **A11y:** never a `div`. A toggle uses `aria-pressed`. A disclosure uses `aria-expanded` + `aria-controls`. Destructive actions open an `AlertDialog` first.
- **i18n:** labels wrap to two lines rather than truncating. A minimum width avoids layout shift across locales.

### IconButton
Square `Button` with an icon only. `aria-label` is required (a type-level requirement). A tooltip with the same text appears on hover and on focus.

### Link
`<a>` with `text.link`. Always underlined in running text. Navigation links are underlined on hover and focus. An external link gets an icon plus visually hidden "(opens in a new tab)" only when `target=_blank`, which is avoided in general.

### CopyButton
IconButton plus inline status. On success, the icon becomes a check and the status text reads "Copied" (`common:copied`) via the polite announcer. The copy is made with `navigator.clipboard.writeText`. If the clipboard is unavailable, the button selects the text and shows "Press Ctrl+C to copy" (`common:copyFallback`). Used for tracking numbers, order numbers, recovery codes, the manual TOTP key and share links.

## 3. Form controls (React Hook Form + Zod)

All fields are wrapped by `FormField`, which wires `id`, `<label for>`, the hint (`aria-describedby`), the error (`aria-describedby` + `aria-invalid`) and the required indicator. Zod schemas come from `packages/shared` constants, so the client and the server (Joi) share limits (brief §3.3). Server `errors[].pointer` values map to RHF field names through one adapter (US-106).

### FormField
- **Anatomy:** label (with "(optional)" text for optional fields; required fields are the default and are not marked with an asterisk alone, D-UX-013), hint text (`text.muted`, below the label), control, error message (icon + text, `status.danger.fg`), character counter where a max applies (`{count} of {max}`, announced politely only when within 10% of the max).
- **Validation timing:** on blur for the first validation, then on change once the field has an error (so the error clears as soon as it is fixed). Also on submit. Never on the first keystroke.
- **States:** default, focus, hover (border.strong), disabled, read-only (no border, `bg.subtle`, still focusable and selectable), error, success (only for async checks such as the HS code found).

### ErrorSummary
- **Use:** forms with 2 or more fields when submit fails with 2 or more errors (wizard steps, register, address forms). It is not used on single-purpose short forms (sign-in, OTP), which use inline errors plus a form-level alert.
- **Behaviour (US-106):** on failed submit, the summary renders above the form with heading "There are {count} problems to fix" (ICU plural). It lists each error as a link that focuses its field. **Focus moves to the first invalid field**, and the summary is a `role="region"` labelled by its heading, so it is not focused itself. Screen readers hear the first field's label and error through `aria-describedby`. The summary updates as errors are fixed and disappears when it is empty.
- **Server errors** that do not map to a field (for example `ADDRESS_COUNTRY_MISMATCH`) appear as non-link items at the top of the summary.

### TextField / Textarea
Native input. Types: `text`, `email` (`autocomplete="email"`, `inputmode="email"`), `tel`, `search`. Supports start and end adornments (unit suffix, currency code). Textarea auto-grows up to 6 rows, then scrolls internally, and has a counter.

### DecimalField
- **Use:** weights, dimensions, money values and insured value.
- **Built on:** `<input type="text" inputmode="decimal">`, not `type=number` (D-UX-021: avoids locale decimal bugs, scroll-wheel changes and the spinner).
- **Parsing:** accepts the active locale's decimal separator and also "." in any locale. Grouping separators are stripped. Invalid characters show an inline error (US-157) and keep the last valid value for live calculations.
- **Display:** formatted on blur with the locale (`2,5` in es and fr). The unit is shown as an adornment and is part of the accessible name via `aria-describedby` (for example "kg").
- **Precision:** weight to 0.1 kg or 0.1 lb, dimensions to 0.1 cm or 0.1 in, money to the currency's minor-unit exponent.

### PasswordField
TextField with `type=password`. It has a "Show password" toggle (`aria-pressed`, label switches between `auth:password.show` and `auth:password.hide`). `autocomplete="current-password"` or `"new-password"`. **Paste is allowed** and password managers are supported (WCAG 3.3.8, NFR-A11Y-001). A new-password field shows rule hints ("At least 12 characters") as static text, not a strength meter that implies other rules.

### OneTimeCodeField
- **Use:** TOTP codes and recovery codes.
- **Built on:** a **single** `<input>` with `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength` 6 for TOTP or `text` mode for recovery codes. Never split boxes (D-UX-026: split boxes break paste, screen readers and autofill).
- **Behaviour:** whitespace and hyphens are stripped on paste. Auto-submit happens when 6 digits are entered (TOTP only), and the visible submit button remains. Monospace display.

### Select
- **Built on:** Radix Select. For lists of 15 items or fewer: reason for export, Incoterm, locale, currency, sort order, and states and provinces where there are few.
- **Mobile:** same Radix Select. The item list shows in a popover sized to the viewport. Items are 44 px on coarse pointers.

### Combobox (searchable select)
- **Use:** country (about 250 items), state or province (US/IN/CA), country of manufacture, commodity-code search (async), address-book picker.
- **Built on:** the ARIA 1.2 combobox pattern (input `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` + `role="listbox"` options) composed with **Radix Popover** for positioning. Radix has no combobox. This is an in-house component in `packages/ui` (D-UX-017).
- **Behaviour:** type-ahead filter with case- and accent-insensitive matching using `Intl.Collator` sensitivity `base` (US-116). Arrow keys move, Enter selects, Escape closes and restores the value, Tab selects the active option and moves on. Async variant: a 250 ms debounce, a minimum of 2 characters, a loading row ("Searching…"), an empty row ("No matches"), an error row with retry, and a result count announced politely ("12 results").
- **Country options:** names from `Intl.DisplayNames(locale, {type: 'region'})`, sorted with `Intl.Collator(locale)`. Only enabled countries are listed (reference data). Flags are not shown (no imagery; D-UX-018).

### Checkbox / CheckboxCard
Radix Checkbox. The 16 px box (20 px on coarse) has a full-label hit area of at least 44 px tall on coarse pointers. `CheckboxCard` is used for attestations (DG, restricted-item acknowledgement, recovery-codes acknowledgement). It is a bordered card with the label and supporting text. It is checkable by clicking anywhere and has the same focus ring.

### RadioGroup / RadioCard
Radix RadioGroup. `RadioCard` handles collection mode, drop-off points, saved cards and the pickup window presets: a bordered card, `selected` variant when checked, arrow-key navigation within the group (roving tabindex is native to Radix).

### Switch
Radix Switch. Only for settings that apply immediately: theme in the account, notification preferences (Should). Never inside forms that need a submit.

### SegmentedControl
- **Use:** unit system ("kg / cm" | "lb / in"), content type ("Parcel" | "Document"), table density (admin, Should).
- **Built on:** Radix ToggleGroup `type="single"`, with `aria-label` on the group. Each item is at least 36 or 44 px. The selected item uses `bg.surface` + `shadow.e1` on a `bg.subtle` track and has a check icon plus a bold label, so the selection is not shown by colour alone.

### DateChipList (mobile date picker)
- **Use:** pickup date under 1024 px (US-234: "date list and window chips").
- **Built on:** RadioGroup of chips in a wrapping grid (no horizontal scroll). Each chip shows the weekday (short) plus the day and month ("Tue 17 Nov"). The 14 selectable-horizon days are listed. Unavailable days are rendered disabled with the reason as visible text under the date ("Holiday", "Weekend", "Past cut-off") and in the accessible name.

### Calendar (desktop date picker)
- **Use:** pickup date at 1024 px and above. The audit viewer date range uses `DateRangeField` (below).
- **Built on:** in-house implementation of the WAI-ARIA date-grid pattern: `role="grid"`, roving tabindex, arrow keys move by day and week, Home/End go to the start or end of the week, PageUp/PageDown change the month. Month and weekday names come from `Intl.DateTimeFormat(locale)`. First day of week: Monday for es and fr, and Sunday for en-US per locale data (`Intl.Locale.weekInfo` where available, else a locale table). Disabled days show their reason in a tooltip and in the accessible name ("25 December, unavailable: Holiday").
- **Dragging:** none. Range selection is two clicks or two Enter presses (WCAG 2.5.7).

### DateRangeField (admin)
Two native `<input type="date">` fields (from, to) plus quick presets (Last 24 h, Last 7 days, Last 31 days) as buttons. The range is validated client-side at 31 days or less (US-097) with an inline message. Times use the viewer's zone, with the zone label shown next to the fields.

### TimeWindowPicker
- **Anatomy:** RadioCards for the preset windows from carrier capabilities ("Morning 09:00–13:00", "Afternoon 13:00–17:00"), plus "Custom". Custom shows two Selects ("From", "To") in 30-minute steps, bounded by the earliest and latest times. The rule hint "At least 2 hours" is shown statically, and inline errors follow US-234.
- **Zone:** "Times are local to the pickup address ({zoneAbbr})" is always visible.

### PhoneField
A country-calling-code Select plus a national-number TextField (`type=tel`, `autocomplete="tel-national"`). The value is composed to E.164 (US-175). The calling code defaults to the address country. The hint shows an example such as "+1 415 555 0100". No phone library: the format is validated with E.164 length and digits only, and the server validates too.

### AddressForm (country-driven, US-119)
- **Inputs:** `country` (fixed or selectable) and the reference-data address format for that country (field order, labels, required flags, postcode pattern, subdivision list).
- **Fields (max):** Full name, Company (optional), Address line 1, line 2 (optional), line 3 (optional), City or town, State/Province/County (per country; Select or Combobox when a list exists), Postcode/ZIP/PIN (per country label), Phone, Email, "This is a home address" (residential).
- **Re-layout:** when the country changes, fields re-order, shared values are kept and focus stays on the country control (US-119). The change is announced politely: "Address fields updated for India".
- **Autocomplete tokens:** `name`, `organization`, `address-line1..3`, `address-level2` (city), `address-level1` (state), `postal-code`, `country` (hidden), `tel`, `email`, all scoped with section tokens such as `section-sender` and `section-receiver`.
- **Rendering an address (read-only):** the `AddressBlock` component formats by the destination country's convention regardless of UI language (US-119).

### PackageRows (quote widget, US-157)
- **Anatomy per package row:** weight (DecimalField + unit), length × width × height (three DecimalFields in one fieldset, legend "Dimensions"), live "Volumetric x · Billable y" readout, and a remove button (from the second row). Below the rows: "Add another package" (up to 20) and a total line. The unit `SegmentedControl` applies to all rows.
- **Live readout:** recalculated after a 150 ms debounce from the shared helper. It is in an `aria-live="polite"` region that announces only the **total** billable weight, with a 1 s throttle, so screen-reader users do not hear every keystroke.
- **Document mode:** dimensions default to the seeded envelope size and are hidden behind "Edit size" (D-UX-019). Weight is still required.

### FileField
Not used in M1 (no uploads, D-025). Not built.

## 4. Feedback and status

### InlineAlert (Banner)
- **Tones:** info, success, warning, danger, neutral. Each has a fixed icon (info: circle-i, success: check-circle, warning: triangle, danger: octagon-x, neutral: dot) and optional title, body, actions and dismiss.
- **Roles:** static content uses no live role. Content inserted in response to a user action uses `role="status"` (non-error) or `role="alert"` (error). The page-level offline banner uses `role="status"`.
- **Placement:** top of the region it describes. A page-level banner sits below the header, inside `main`.

### Toast (US-105)
- **Built on:** Radix Toast. The viewport sits at the block-end, inline-end on ≥ 768 px, and at the bottom centre on mobile, offset above the `StickyActionBar`.
- **Timing:** success and info auto-dismiss after 5 s. Error stays until dismissed. Pause on hover and focus. A maximum of 3 are visible, and a 4th evicts the oldest. Swipe to dismiss is allowed, and an explicit close button always exists (WCAG 2.5.7).
- **Roles:** success and info use `role="status"`. Errors use `role="alert"`.
- **Rule:** a toast never carries the only copy of critical information (order numbers, codes, links). That information is also on the page (US-105).

### Badge / StatusBadge
- **Badge:** caption text, `radius.sm`, tone backgrounds (`status.*.bg` + `status.*.fg`) with an icon. Used for "Cheapest", "Fastest", "Test mode", "Unreviewed", "Sample data", "Provisional", "Current session" and "Void".
- **StatusBadge:** maps a canonical shipment or tracking status to tone, icon and an `status:` i18n key. One mapping table lives in `packages/ui`:

| Status | Tone | Icon |
|---|---|---|
| DRAFT, QUOTED | neutral | pencil |
| PENDING_PAYMENT, PAID, BOOKING | info | clock |
| BOOKED, LABEL_READY | success | check |
| PICKUP_SCHEDULED, DROPPED_OFF | info | truck / store |
| IN_TRANSIT, OUT_FOR_DELIVERY | info | arrow-route |
| CUSTOMS_HOLD | warning | shield-alert |
| DELIVERED | success | check-circle |
| EXCEPTION, RETURNED_TO_SENDER | danger | alert-octagon |
| CANCELLED, VOIDED, REFUNDED | neutral | x-circle / undo |

### Skeleton (US-104)
Static blocks (`bg.skeleton`, `radius.sm`) sized like the final content to keep CLS at or below 0.1. They appear only after a 150 ms delay. The skeleton container has `aria-busy="true"` and visually hidden text "Loading {thing}" (`common:loading.thing`). No shimmer animation (D-UX-012).

### Countdown
Shows the time remaining to a deadline (booking cut-off, quote expiry). Format: "2 h 14 min", or "14 min" under 1 h (ICU duration via `Intl.NumberFormat` units plus i18n keys). It ticks visually every 60 s and never announces automatically (no live region). The accessible text gives the absolute time: "Book by 17:00 EST today". When it reaches 0, it swaps to the after-deadline content (US-159).

### ProgressSteps (wizard and booking progress)
- **Wizard variant:** a vertical list ≥ 1024 px, and a compact header under 1024 px ("Step 2 of 7 · Contents" + a determinate bar with `role="progressbar"`, `aria-valuenow`, `aria-valuemax`, `aria-valuetext` "Step 2 of 7, Contents"). Each step is shown as complete (check icon + "Completed" in its accessible name), current (`aria-current="step"`), upcoming (not interactive until reachable) or blocked (warning icon + reason).
- **Saga variant:** an ordered list of steps with status icons (pending clock, in-progress spinner inside a 20 px slot with the text "In progress", done check, failed x, skipped dash) and text. It is used with the polite announcer (D-UX-010).

### Timeline
Ordered list (`ol`), newest first, used for tracking events and state history. Each item has a status icon, localised description, time (viewer zone + zone label) and location. A single column on all sizes. The time is in a `<time datetime>` element.

### EmptyState / ErrorState / PermissionDeniedState / NotFoundState / OfflineBanner / PartialNotice

These are the shared six-state components (US-104, US-105). Each route uses them through a `RouteStates` wrapper so the per-route checklist test can assert all six. Wireframes are in [W00](../wireframes/W00-shells-and-shared-states.md).

| Component | Content | Actions | Role |
|---|---|---|---|
| `EmptyState` | Neutral line icon, `h2` title, one-sentence explanation | One primary next step ("Get a quote", "Clear filters") | none |
| `ErrorState` | Danger icon, title "Something went wrong", localised `errors.<CODE>` text, **correlation ID** in mono with CopyButton | "Try again" (re-issues the request), secondary "Go home" | `role="alert"` when it replaces content after a user action |
| `PartialNotice` | Warning InlineAlert naming what failed ("Tracking updates are unavailable right now") | "Try again" scoped to the failed part | `role="status"` |
| `PermissionDeniedState` | Lock icon, title "You don't have access to this page", a non-revealing explanation (never confirms that the resource exists) | "Go home". "Switch organisation" only with 2 or more memberships (US-070). | none |
| `NotFoundState` | Title "Page not found", explanation | "Go home", plus a context link (for example "View your shipments") | none |
| `OfflineBanner` | Page-level warning banner "You're offline. We'll keep what you've entered." | "Try again" appears when the connection returns. Network submits are disabled with `aria-disabled` and a reason. | `role="status"` |
| `RateLimitedState` | Variant of `PermissionDeniedState` for 429 on public pages (US-248): "Too many lookups. Try again in {seconds} s." with a live countdown (no announcements per tick) | "Try again" enabled when the countdown ends | none |

## 5. Overlays

| Component | Built on | Spec |
|---|---|---|
| `Dialog` | Radix Dialog | Centred, max 560 px, `radius.lg`, `shadow.e4`. Full-screen under 768 px for forms with more than 2 fields. Focus moves to the first field, or to the title when there is no field. Escape closes, focus returns to the trigger, and focus is trapped while open (US-113). The title is required and is the accessible name. |
| `AlertDialog` | Radix AlertDialog | Destructive or irreversible actions (delete draft, sign out other sessions, leave recovery codes) and the admin idle-timeout warning (`IdleTimeoutDialog`). Focus starts on the **least destructive** button. Escape and outside clicks are blocked only where a decision must be recorded (recovery codes). In `IdleTimeoutDialog`, Escape performs "Extend session" and outside clicks are ignored (W00 §2.1). |
| `Drawer` | Radix Dialog (side) | Admin navigation under 1024 px and web mobile menu. It slides from the inline-start edge (inline-end for filters). 180 ms, 0 ms with reduced motion. |
| `BottomSheet` | Radix Dialog (bottom) | Price details on mobile, filters on mobile. It has a visible close button; drag-to-dismiss is optional and never required (WCAG 2.5.7). Max height 85vh with internal scroll. |
| `Popover` | Radix Popover | Inline help ("What is billable weight?"). Opened by a button; it does not open on hover. |
| `Tooltip` | Radix Tooltip | Supplementary text only (icon-button labels, truncated values). It opens on hover and focus, closes on Escape, and is never the only source of essential information. On touch, tooltips are not relied upon. |
| `DropdownMenu` | Radix DropdownMenu | Account menu, row overflow actions, breadcrumb overflow. Uses menu roles and type-ahead. |

## 6. Navigation

| Component | Spec |
|---|---|
| `WebHeader` | Brand (logo or wordmark from `BRAND_*`, linking home), primary nav (Get a quote, Track, Prohibited items, Help), LocaleSwitcher, CurrencySwitcher (Should, US-118), ThemeSwitcher (in the footer for guests, in the account menu for users), the "Sign in" link or `AccountMenu`, and the environment chip in non-production builds (D-UX-020). Under 768 px: brand, "Sign in" or account icon, and a menu button (`aria-expanded`, `aria-controls`) that opens a `Drawer` with the nav, switchers and account items. |
| `WebFooter` | Legal links (Terms, Privacy), Help, Prohibited items, "Cookie settings" (Should, US-114), language and theme switchers, © {year} {BRAND_NAME}. The "Help" link is in the same place on every page (WCAG 3.2.6). |
| `AccountNav` | ≥ 1024 px: vertical nav in the account area (224 px). Under 1024 px: a `DropdownMenu` button "Account: {current section}" at the top of account pages. Entries are filtered by permission and by what is implemented (US-070, US-273). The current item has `aria-current="page"`. |
| `AdminSidebar` | 240 px expanded or 64 px collapsed (icons + tooltips; labels still available via `aria-label`). The collapse toggle has `aria-expanded`. State is persisted per user (US-110). Under 1024 px it becomes a `Drawer`. It contains only permitted, implemented entries: "Audit log" (`audit:read`) and "My sessions". |
| `AdminHeader` | Breadcrumbs, environment chip, LocaleSwitcher, ThemeSwitcher, user menu (name, roles, "My sessions", "Sign out"). |
| `LocaleSwitcher` | Select listing **endonyms** ("English", "Español", "Français") with `lang` attributes on each option. The change applies immediately: it re-renders, sets `html lang`, persists (profile or cookie) and announces "Language changed to Español" in the new language. On pre-rendered pages it navigates to the same page under the new locale prefix. |
| `CurrencySwitcher` (Should) | Select of USD, INR, GBP, CAD, EUR. Display only. The label reads "Show prices in" and the amounts it changes are marked "approx." (US-118, US-169). |
| `ThemeSwitcher` | RadioGroup in a menu: System, Light, Dark (`shell:theme.*`). |
| `Pagination` (cursor) | "Previous" and "Next" buttons plus "Showing {from}–{to}" when counts are known (no total pages with cursor pagination). A page size Select (25/50/100, or 50/100/200 in admin). The list region is labelled and focus moves to the list heading after a page change. |
| `Tabs` | Radix Tabs. Used only where content panels are peers: the shipment detail on mobile ("Overview", "Tracking", "Documents", "Charges") and sign-in/register switch links (implemented as links, not tabs). |

## 7. Data display

### DataTable (TanStack Table) + CardList collapse (US-107)
- **≥ 768 px:** semantic `<table>` with `<caption>` (visually hidden when a heading is present), sticky header row, sortable headers (`<button>` inside `<th aria-sort>`), row height comfortable 48 or compact 36 (admin, Should), a row hover that reveals the quick-actions column (`hover: hover`; the actions are always present for keyboard and touch through a visible overflow `IconButton`), optional selection checkbox column (not used in M1) and a column chooser (admin, Should).
- **< 768 px:** the same data renders as a `CardList` (`ul` of `li` cards). Fields appear in the **same priority order** as table columns. Each card has a primary link (the row's main action) and visible secondary actions. The sort control becomes a Select. Filters are in a BottomSheet.
- **Server-side:** sorting, filtering and pagination are driven by URL query state (brief §8 admin, US-097). Changes keep focus on the control used and announce "{count} results" politely.
- **Long values:** wrap. Hashes and IDs truncate in the middle with full text in a tooltip and through `title` + `aria-label`. Nothing causes horizontal page scroll (US-107).
- **States:** a skeleton row set (10 rows), and Empty, Error, Partial, PermissionDenied and Offline via `RouteStates`.

### MoneyAmount
Formats integer minor units plus an ISO 4217 code with `Intl.NumberFormat(locale, {style: 'currency'})` (US-116). Props: `approx` (prefix "approx." plus visually hidden "approximately"), `showCode` (forces `currencyDisplay: 'code'`, used at checkout "Amount to be charged" and on FX lines), `emphasis` (price style). Always `tabular-nums`. It never computes; it only formats.

### WeightValue / DimensionsValue
Format canonical grams and millimetres into the viewer's unit system with `Intl.NumberFormat` `style: 'unit'` (kilogram/pound, centimeter/inch). Dimensions use the i18n pattern `units:dimensions` "{l} × {w} × {h}". The unit symbol comes from Intl.

### DateTimeValue / DateValue
`<time>` element. Instants show in the viewer's IANA zone with the zone label (US-116). Date-only values (pickup date, holiday) are never shifted; the location's zone name is shown where relevant. Relative times ("5 min ago") are used only in sessions and audit lists, always with the absolute time in a tooltip and the accessible name.

### PriceBreakdown (domain)
- **Input:** stored charge lines, totals, tax rule metadata, FX line and the explanation codes. **No arithmetic in the browser** (US-159, US-191).
- **Layout:** a two-column `table` (label | amount) with grouped sections: Shipping (base freight, fuel, carrier surcharges), Protection (included cover, additional cover), Discounts (negative amounts with a minus sign and the "Discount" label), Subtotal before tax, Tax (pack label such as "Sales tax" or "VAT", and the rate; an `Unreviewed` badge when `unreviewed: true`), **Total**. Then the FX line: "Converted from EUR at 1 EUR = 1.0832 USD · rate of 12 Nov 2026, 09:00 UTC". Then "Why this price" (a disclosure listing localised explanation entries from rule codes).
- **Mobile:** the same table at full width. Long labels wrap and amounts stay end-aligned.

### AddressBlock
Read-only address formatted by country convention. It is used in the review step, shipment detail and confirmation. On public pages only city and country are shown.

### DiffView (admin, US-098)
- **≥ 1024 px:** a table with columns Field | Old value | New value. **< 1024 px:** stacked per field ("Field" heading, then "Before" and "After" blocks).
- Changes are marked by **text labels** ("Before", "After", "Added", "Removed") and icons, not colour only. Redacted values show `[REDACTED]` with a lock icon and the visually hidden text "redacted".
- Long or JSON values wrap inside a `CodeBlock`, which is the only region allowed to scroll horizontally (US-107).

### CodeBlock
Monospace, `bg.subtle`, with a CopyButton. The only component allowed to scroll horizontally. It is focusable (`tabindex="0"`, `role="region"` with a label) so keyboard users can scroll it (WCAG 2.1.1).

### QRCodeImage
Displays the TOTP provisioning QR. It is always paired with the manual key text and CopyButton. The alt text is "QR code for your authenticator app. If you can't scan it, use the setup key below." Rendered client-side by `<QrCode>` with `uqr` (ADR-0026 am. 2; README §5 resolved item 4).

### CarrierMark
The carrier's name as text in a neutral chip with a 24 px monogram (first letters, `radius.full`, `bg.subtle`). A logo image is used only when an operator-supplied asset URL is configured per carrier. The repository ships no third-party logos (D-UX-018). The accessible name is always the carrier name text.

## 7a. Domain components

| Component | Composition | Spec location |
|---|---|---|
| `QuoteWidget` | Combobox ×2, TextField (postcode/city) ×2, swap IconButton, SegmentedControl (content type), Checkbox (residential), PackageRows, Button lg | [W01](../wireframes/W01-home-quote-widget.md) |
| `ResultCard` | Card(interactive/selected), CarrierMark, Badge, MoneyAmount, DateValue, Countdown, PriceBreakdown in a Collapsible, Button | [W02](../wireframes/W02-quote-results.md) |
| `SearchSummary` | DescriptionList + "Edit search" Link | W02 |
| `BookingContextCard` | Summary of the selected option (carrier, service, price, quote expiry), shown on sign-in/register when coming from "Book" | [W03](../wireframes/W03-customer-auth.md) |
| `WizardShell` | ProgressSteps, StepSummary list, StickySummary, StickyActionBar, autosave indicator | [W04](../wireframes/W04-wizard-shell-and-addresses.md) |
| `CustomsLineEditor` | DataTable (≥ 768) or CardList (< 768) of editable lines, Combobox (HS code, country), DecimalField ×2, TextField | [W05](../wireframes/W05-wizard-contents-customs.md) |
| `ServicePointList` | RadioCard list with distance, hours disclosure and CarrierMark | [W06](../wireframes/W06-wizard-collection.md) |
| `SagaProgress` | ProgressSteps (saga variant) + Announcer | [W09](../wireframes/W09-booking-progress-confirmation.md) |
| `DocumentList` | DataTable/CardList, download Button with states (idle, preparing, ready, failed, void) | W09, [W12](../wireframes/W12-account-shipment-detail.md) |
| `TrackingTimeline` | Timeline + StatusBadge + stale notice | [W10](../wireframes/W10-public-tracking.md), W12 |
| `AuditFilterBar` | DateRangeField, Combobox (user, organisation), Select (role, entity, action, outcome), TextField (entity ID, IP), Apply/Clear | [W16](../wireframes/W16-admin-home-audit-sessions.md) |
| `RecoveryCodesPanel` | CodeBlock grid (2 columns), CopyButton (all), "Download as .txt" (client-side Blob, no server call), "Print", CheckboxCard acknowledgement | [W15](../wireframes/W15-admin-auth.md) |
| `TestModeBadge` | Badge warning + flask icon + "Test mode" text; tooltip "No real payment is taken" | W08, W09 |
| `ReauthDialog` (US-291) | Dialog; purpose sentence (per scope) + instruction (per variant); variants **password** (PasswordField + hidden `username` input) and **totp** (OneTimeCodeField); optional stale line (`max_age`); InlineAlert; Continue (loading) + Cancel. States: default, loading, field error, dialog alert, offline. Exposed as `useReauth().run(scope, request)` from the API client so every caller gets the proactive/reactive behaviour and the single retry | [W03 §8](../wireframes/W03-customer-auth.md), F10 §4 |
| `SessionList` (US-027) | DataTable (≥ 768) / CardList (< 768): Device, IP address range, Signed in, Last active (DateTimeValue relative), Action; "This device" Badge; per-row Sign out Button (loading); "Sign out of all other devices" + AlertDialog; Toasts. States: loading (2 skeleton rows), error (section-level), offline, sign-out errors. Shared by web S-C07 and admin S-D08 | [W13 §1](../wireframes/W13-account-settings-should.md), [W16 §4](../wireframes/W16-admin-home-audit-sessions.md) |
| `IdleTimeoutDialog` (admin, US-033 Should) | AlertDialog; title, description with the absolute sign-out time, `aria-hidden` countdown, Extend session (primary, initial focus, loading) + Sign out; in-dialog InlineAlert for extend failures; shared idle clock (`localStorage` timestamp + `BroadcastChannel`) in an `IdleProvider` at the admin app root | [W00 §2.1](../wireframes/W00-shells-and-shared-states.md) |
| `HostedCvcField` (US-217 Should) | Platform label + hint + InlineAlert notice around the gateway's CVC element (iframe, titled); error text outside the frame; reserved min-height; Mock gateway variant renders the simulated outcome control | [W08 §5](../wireframes/W08-checkout.md) |
| `UnreviewedBadge` / `SampleDataNotice` | Badge warning "Unreviewed" / InlineAlert warning "Sample data — not legal advice" | W02, W05, [W14](../wireframes/W14-prohibited-items-legal.md) |

## 8. Icon set

An in-house SVG icon set in `packages/ui/icons` is used: 24 × 24 grid, 1.5 px stroke, `currentColor`, original drawings with no third-party icon font (D-UX-018). Icons are `aria-hidden="true"` unless standalone, in which case the parent control carries the name. Required M0+M1 icons: menu, close, chevron (4 directions), check, check-circle, x-circle, alert-triangle, alert-octagon, info-circle, lock, unlock, eye, eye-off, copy, download, mail, printer, printer-off, truck, store, map-pin, package, document, globe (locale), sun, moon, monitor (system theme), user, users, log-out, search, filter, sort, calendar, clock, swap, plus, minus, trash, pencil, external, refresh, wifi-off, shield-alert, flask (test mode), arrow-route, history, key, qr.

## 9. Component test hooks (for qa-lead)

- Each component exposes `data-state` (`default|loading|error|success|disabled`) and stable `data-testid` values only where a role-based query is not possible. Tests prefer `getByRole` with the accessible name.
- A Storybook-style catalogue (in-repo, optional) is not required. Component tests use React Testing Library with axe, at both pointer emulations and in both themes.
