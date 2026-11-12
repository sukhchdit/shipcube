# W00 — App shells and the six shared screen states

Screens: web shell (all web routes), admin shell (all admin routes), S-W06 / S-D09 Not found, shared states · Stories: **US-019, US-020, US-070, US-102, US-103, US-104, US-105, US-107, US-108, US-110, US-113, US-117, US-120, US-273 (Should), US-032** · US-033 (Should: admin idle-timeout dialog §2.1) · Flows: [F10](../flows/F10-session-guards-and-errors.md), [F06 §4](../flows/F06-staff-signin-totp-audit.md)

Wireframe conventions used in every W-file: `X` at the start of a message line marks an error alert, `!` a warning, `(i)` information, `✓` success; `[Button]` is a button, `[Field______]` is a text input, `[Select v]` is a select or combobox, `( )` / `(o)` are radio buttons, `[ ]` / `[x]` are checkboxes, `<link>` is a link, `{...}` is dynamic data, `#` marks a heading level (`#` h1, `##` h2). Widths are not to scale. **360** = mobile baseline, **1280** = desktop baseline.

## 1. Customer web shell (US-108)

### 360 px
```
+--------------------------------------+
|[Skip to content]  (visible on focus) |
| [=]  {Logo} {BRAND_NAME}   [Sign in] |  header 56px, sticky
+--------------------------------------+
| ! You're offline. We'll keep what   |  OfflineBanner (only when offline)
|   you've entered.                    |
+--------------------------------------+
| <main id="main">                     |
|                                      |
|   ...route content...                |
|                                      |
+--------------------------------------+
| <Help> <Track> <Prohibited items>    |  footer
| <Terms> <Privacy> <Cookie settings>* |
| Language [English v]                 |
| Theme    [System v]                  |
| © 2026 {BRAND_NAME}  [TEST ENV]**    |
+--------------------------------------+
 * Should (US-114)  ** environment chip, non-production only
```

Menu drawer (opened by `[=]`, `aria-expanded`, focus trapped, Escape closes and returns focus to `[=]`):
```
+--------------------------------------+
| {BRAND_NAME}                    [X]  |
|--------------------------------------|
| Get a quote                          |
| Track a shipment                     |
| Prohibited items                     |
| Help                                 |
|--------------------------------------|
| Language  [English v]                |
| Show prices in [USD v]  (Should)     |
| Theme     (o)System ( )Light ( )Dark |
|--------------------------------------|
| [Sign in]   [Create account]         |   signed out
|  -- or, signed in --                 |
| Signed in as Ana Silva (Acme)        |
| Overview / Shipments / Drafts / ...  |
| [Sign out]                           |
+--------------------------------------+
```

### 1280 px
```
+------------------------------------------------------------------------------------------------+
| {Logo} {BRAND_NAME}   Get a quote  Track  Prohibited items  Help    [TEST ENV] [English v] [USD v]* [Sign in] |
+------------------------------------------------------------------------------------------------+
| main (max 1280, gutters 32)                                                                     |
+------------------------------------------------------------------------------------------------+
| Help · Track · Prohibited items · Terms · Privacy · Cookie settings*   Language [v] Theme [v]  |
| © 2026 {BRAND_NAME}                                                                             |
+------------------------------------------------------------------------------------------------+
```
Signed in, `[Sign in]` is replaced by an account menu button `[(AS) Ana v]`. The menu has: the organisation name (with "Switch organisation" when there are 2 or more memberships, Should US-081), Overview, Shipments, Drafts, Security (Must from M1 for the sessions list, US-027), (Should items), Theme submenu and Sign out. Items needing missing permissions are not rendered (US-070, US-108).

### Account area layout (signed in)
```
1280:
+------------------+-------------------------------------------------------------+
| Account          |  PageHeader: breadcrumbs / # Title / [actions]              |
|  > Overview      |                                                             |
|    Shipments     |  content                                                    |
|    Drafts        |                                                             |
|    Security      |  (Must from M1: US-027 sessions, D-UX-030)                  |
|    (Should ...)  |                                                             |
+------------------+-------------------------------------------------------------+
360:
+--------------------------------------+
| [Account: Shipments v]               |  DropdownMenu replaces the side nav
| # Shipments                          |
| ...                                  |
+--------------------------------------+
```
The unverified-email banner (US-016, US-208) sits at the top of every account page until verification: "Verify your email to pay for bookings. [Resend email]".

## 2. Admin shell (US-110, US-032)

### 1280 px (sidebar expanded 240 px; collapsed 64 px)
```
+-------------------+----------------------------------------------------------------------------+
| {Logo} Admin  [<<]| Audit log / Entry 0193…a7   [TEST ENV] [English v] [theme] [(SA) Sam v]  |  header 64
|-------------------+----------------------------------------------------------------------------|
| [list] Audit log <|  <main>                                                                    |
| [clock] My sessions|                                                                           |
|                   |                                                                            |
|                   |                                                                            |
+-------------------+----------------------------------------------------------------------------+
```
- `[<<]` collapse toggle: `aria-expanded`, `aria-controls`, label "Collapse navigation" / "Expand navigation". State persisted per user.
- Collapsed: icons only, tooltips plus `aria-label` give the names, and the current item keeps `aria-current="page"`.
- Only "Audit log" (`audit:read`) and "My sessions" exist. No entries or placeholders for unimplemented modules.

### 360 px (< 1024: drawer)
```
+--------------------------------------+
| [=] Admin   Audit log      [(SA) v]  |
+--------------------------------------+
| <main>                               |
+--------------------------------------+
Drawer: same nav as the sidebar, plus language and theme, focus trapped, Escape closes.
```
Breadcrumbs under 768 px collapse to "‹ Audit log" (a back link to the parent).

### 2.1 Idle-timeout warning (US-033 Should; REQ-ADMIN-004; ADR-0026 am. 8, ADR-0006 am. 13; D-UX-025 extended by D-UX-032)

Applies to every **authenticated** admin route (including `/mfa/enrol`). The web app has no idle timeout.

**Idle clock.** One clock per browser for the admin origin, shared by all admin tabs: each tab writes the time of the last user input to `localStorage` key `admin:lastInput` (a timestamp only, no identifiers) and posts it on a same-origin `BroadcastChannel("admin-session")`. Only `pointerdown`, `keydown`, `touchstart` and `wheel` count (throttled to one write per 5 s). Focus, visibility changes, timers, silent refresh and TanStack Query background refetches never reset it. A tab that wakes from sleep recomputes idle time from the shared timestamp before rendering anything.

| Idle time | What happens |
|---|---|
| 0 – 27:59 | Normal. Silent refresh runs as usual. |
| 28:00 | The warning `alertdialog` opens in every open admin tab. Background refetches are paused. Silent refresh may still run until 30:00. |
| 28:00 – 29:59 | The dialog shows the absolute sign-out time and a visual countdown. At 29:00 one polite announcement: "1 minute left before you're signed out." |
| 30:00 | Silent refresh stops; `logoutSession` is called (best effort, `keepalive`); in-memory state and the query cache are cleared; the event is broadcast so every tab does the same; route to `/sign-in?reason=idle&returnUrl=<current path and query>` (validated same-origin, REQ-ADMIN-001). |
| Wake from sleep at ≥ 30:00 | No dialog: the sign-out path runs immediately. The server has already expired the refresh token (30-minute sliding TTL), so the outcome is the same. |

```
360 (full-width minus 16 px gutters; buttons stacked, primary first)
+--------------------------------------+
| (clock) # Are you still there?       |
|                                      |
| You haven't used the admin app for a |
| while. For security, we'll sign you  |
| out at 14:32.                        |
| Time left: 1:47                      |   visual only (aria-hidden), updates every second
|                                      |
| [         Extend session          ]  |   primary, initial focus
| [            Sign out             ]  |   secondary
+--------------------------------------+

1280 (centred, max 440 px, shadow.e4, overlay bg.overlay)
+---------------------------------------------------+
| (clock) # Are you still there?                    |
| You haven't used the admin app for a while. For   |
| security, we'll sign you out at 14:32.            |
| Time left: 1:47                                   |
|                       [Extend session] [Sign out] |
+---------------------------------------------------+
```

**Actions**

| Action | Result |
|---|---|
| "Extend session" (button, or Escape) | Immediate `POST /auth/refresh`; button loading (`aria-busy`). OK: shared clock reset, dialog closes in every tab, background refetches resume, polite announcement "Session extended", focus returns to the element that had it before the dialog opened (else the page `h1`). |
| Extend → 401 `SESSION_EXPIRED` / `SESSION_REVOKED` (absolute 12 h cap reached, or the server idle window already passed) | Run the 30:00 sign-out path; the sign-in page shows the matching notice (W15 §1). |
| Extend → network failure or offline | Dialog stays open. InlineAlert in the dialog: "We couldn't extend your session. Check your connection and try again." Extend remains available; the countdown continues. At 30:00 the local sign-out path runs. |
| "Sign out" | Standard sign-out (US-019): `logoutSession`, all tabs cleared, `/sign-in` with "You signed out." |
| Click on the overlay | Ignored (the dialog stays open; it is not a dismissal). |
| Any other key or pointer input while the dialog is open | Does **not** reset the clock. Only Extend does, so the extension is always a deliberate, announced action. |

**Interplay with the 12 h absolute cap (US-033, D-UX-025).** The cap's non-modal banner (5 minutes before the cap) stays separate. If both are due, the idle dialog still opens; Extend then gets `SESSION_EXPIRED` from the server and the sign-in page explains it. No combined dialog is designed.

**Data loss.** None by design: the admin slice is read-only, and audit filters and paging are in the URL, so `returnUrl` restores the exact view after sign-in. The recovery-codes step of S-D03 is the exception: an idle sign-out there skips the leave prompt; the codes are already active and staff regenerate them through US-026 when it is built.

**Accessibility (WCAG 2.2.1 Timing Adjustable, "Extend" option)**
- The user is warned 120 s before the limit (more than the 20 s minimum) and extends with one simple action. Extension is unlimited within the 12 h cap (more than the 10 extensions 2.2.1 requires). The cap itself is covered by D-UX-025.
- Radix AlertDialog: `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby` → title, `aria-describedby` → the sentence with the **absolute** time only (a stable string, so screen readers announce it correctly on open). The per-second "Time left" text is `aria-hidden="true"`; the only timed announcement is the one at 29:00 through the Announcer (polite). No per-tick announcements (accessibility §4).
- Initial focus on "Extend session" (the least destructive action and the US-033 acceptance criterion). Focus is trapped. DOM, visual and focus order are the same at every width: Extend, then Sign out (stacked at 360, side by side at the inline end at 1280); no `row-reverse`.
- Buttons ≥ 44 px on coarse pointers. No animation under `prefers-reduced-motion`; the default enter transition is opacity only, 120 ms.
- The dialog renders in the active locale; `{time}` is formatted by the shared time helper in the viewer's zone (US-116).

**States**

| State | Rendering |
|---|---|
| Default | As drawn |
| Loading | Extend in loading state; Sign out stays enabled |
| Error | InlineAlert (danger) inside the dialog, above the buttons, `role="alert"`; focus stays on Extend |
| Offline | Same as Error with the offline text; the OfflineBanner behind the overlay is unchanged |
| Empty / Partial / Permission-denied | Not applicable (an overlay with no data) |

**i18n keys:** `shell:idle.title`, `shell:idle.body` (`{time}`), `shell:idle.timeLeft` (`{remaining}`, pre-formatted `m:ss`), `shell:idle.extend`, `shell:idle.signOut`, `shell:idle.oneMinuteLeft`, `shell:idle.extended`, `shell:idle.extendFailed`; sign-in notice `auth:signIn.signedOutIdle` (content-and-i18n §4.11).

### Admin welcome (S-D04, US-032)
```
1280:
| # Welcome, Sam                                                             |
| You're signed in as Operations. (role names, comma-separated, localised)   |
| <My sessions>                                                              |
| --- when the user has no permitted module: ---                             |
| (lock icon) ## Nothing to show yet                                         |
| Your account doesn't have access to any admin area.                        |
| Contact your administrator.                                                |
```
Auditors and anyone with `audit:read` never see this page. Sign-in lands them on `/audit`.

## 3. Shared screen states (US-104, US-105)

Every route renders through `RouteStates` with these variants. The per-route checklist test asserts all six exist (US-104).

### 3.1 Loading (skeleton after 150 ms, static, no spinner)
```
360                                   1280
+--------------------------------+    +-------------------------------------------------+
| ████████████  (title block)    |    | ██████████████████  (title)                     |
| ███████                        |    | ┌──────────┬──────────┬───────────┬──────────┐  |
| ┌────────────────────────────┐ |    | │██████    │████████  │██████     │████      │  |
| │ ██████████   ████          │ |    | │██████    │████████  │██████     │████      │  |
| │ ████████████████           │ |    | │ ... 10 rows sized like real rows ...        │  |
| └────────────────────────────┘ |    | └──────────┴──────────┴───────────┴──────────┘  |
| (x3 cards)                     |    |                                                 |
+--------------------------------+    +-------------------------------------------------+
aria-busy="true" on the region; visually hidden "Loading shipments".
```

### 3.2 Empty (explanation + next step)
```
+------------------------------------------+
|              (line icon)                 |
|        ## No shipments yet               |
|  When you book a shipment it shows here. |
|            [Get a quote]                 |
+------------------------------------------+
```

### 3.3 Error (retry + correlation ID)
```
+------------------------------------------+
| (octagon-x)  ## Something went wrong     |
| We couldn't load your shipments.         |
| [Try again]   <Go home>                  |
| Reference: 01J9…F3K2  [Copy]             |
+------------------------------------------+
```
The reference is the correlation ID in mono with a CopyButton. The text comes from `errors:<CODE>` (for example `AUDIT_UNAVAILABLE` gives "This page is temporarily unavailable"). A render exception inside the route also renders this state through the error boundary (US-104).

### 3.4 Partial (available data + a notice naming what failed)
```
+------------------------------------------+
| ! Tracking updates are unavailable right |
|   now. Other details are up to date.     |
|   [Try again]                            |
+------------------------------------------+
| ...rest of the page renders normally...  |
```

### 3.5 Permission-denied (403 or route guard; never confirms that the resource exists)
```
+------------------------------------------+
|              (lock icon)                 |
|  ## You don't have access to this page   |
|  Your role doesn't include this. Ask an  |
|  owner or administrator if you need it.  |
|  [Go home]  [Switch organisation]*       |
+------------------------------------------+
* only with 2 or more memberships (US-070); hidden in the admin app
```

### 3.6 Offline (banner; data and inputs kept)
```
+------------------------------------------+
| (wifi-off) You're offline. We'll keep     |   role="status"; appears within 3 s of going offline
| what you've entered.                      |
+------------------------------------------+
On reconnect: "You're back online. [Try again]" for 5 s, then the banner clears.
Network submit buttons get aria-disabled="true" + aria-describedby → "You're offline".
```

### 3.7 Not found (404 and cross-tenant IDs; S-W06 / S-D09)
```
+------------------------------------------+
|  ## Page not found                       |
|  The page may have moved, or the link    |
|  may be wrong.                           |
|  [Go home]  <View your shipments>*       |
+------------------------------------------+
* signed-in web users only
```
Out-of-scope paths (`/account/wallet`, `/orders` in admin) render this state (US-273, US-032).

### 3.8 Signed-out notice (US-020)
On the sign-in page after a revoked or expired session (`SESSION_REVOKED`, `AUTH_REQUIRED`, or `SESSION_EXPIRED` when the 30-day web cap or the 12 h admin cap is reached, ADR-0006 am. 12): a neutral InlineAlert "You were signed out. Sign in again to continue." in the active locale, above the form. Admin idle sign-out (`?reason=idle`) uses its own text, "You were signed out for inactivity. Sign in again to continue." (§2.1, W15 §1).

## 4. Toasts (US-105)
```
360 (bottom, above sticky bar)         1280 (block-end, inline-end)
+--------------------------------+                    +---------------------------+
| (check) Draft deleted     [X]  |                    | (check) Copied        [X] |
+--------------------------------+                    +---------------------------+
```
At most 3 toasts. Success and info dismiss after 5 s. Errors persist. Timers pause on hover and focus.

## 5. Interaction states (all shells)

| Element | Hover (hover:hover only) | Focus-visible | Active | Disabled | Loading |
|---|---|---|---|---|---|
| Header nav link | underline, `text.linkHover` | ring | `bg.subtle` | n/a | n/a |
| Account menu button | `bg.hover` | ring | pressed shadow | n/a | skeleton avatar while `me` loads |
| Sidebar item | `bg.hover` | ring (inset 2 px to fit the 64 px rail) | `bg.subtle` | n/a | n/a |
| Current nav item | — | ring | — | — | `bg.selected` + 3 px start border + `aria-current="page"` |
| Footer selects | border.strong | ring | — | — | — |

## 6. Accessibility notes (shells)

- **Landmarks:** `header` (banner), `nav` with an `aria-label` per nav ("Main", "Account", "Footer", "Admin"), `main#main`, `footer` (contentinfo). Admin: banner, navigation, main (US-110).
- **Focus order:** skip link, brand, primary nav, utilities, account menu, main, footer. Drawer focus is trapped and returns to the trigger.
- **Route change:** focus moves to the page `h1` (`tabindex=-1`) and the title is announced (RouteFocusManager).
- **`lang`:** `<html lang>` follows the active locale. Endonyms in the language switcher carry their own `lang` (WCAG 3.1.2).
- **Sticky header:** `scroll-padding-block-start` keeps focused elements visible (WCAG 2.4.11).
- **Theme switch:** a RadioGroup in a menu, announced as "Theme, System, selected" (US-102).

## 7. Responsive notes

- 360 to 767: drawer navigation, footer stacks, account DropdownMenu.
- 768 to 1023: web header shows full nav when it fits; if the localised labels overflow (pseudo-locale +30%), the nav collapses to the drawer. The collapse is measured, not fixed to a breakpoint. Admin still uses the drawer.
- ≥ 1024: account side nav, admin fixed sidebar.
- No horizontal page scroll at any width down to 320 px (US-107).
