# W13 — Account settings: security and sessions (Must section), preferences, address book, saved quotes, payment methods, organisation (Should)

Routes `/account/security`, `/account/preferences`, `/account/addresses`, `/account/quotes`, `/account/payment-methods`, `/account/organisation` · **Must:** the "Where you're signed in" section of `/account/security` (**US-027**, promoted by D-047) and its use of the ReauthDialog pattern (US-291, W03 §8) · Should or Could in M1: everything else (US-026, US-028, US-259, US-262..US-272). The Should screens are specified compactly so the build can pick them up without another UX pass. A screen or section that is not built has **no** navigation entry, no route and no placeholder (US-273 rule, brief §13 rule 5). The file name is kept for link stability.

All screens use the account layout (W00 §1), the six shared states and the table-to-card collapse.

## 1. Security (`/account/security`, S-C07; **US-027 Must**; US-267, US-026, US-028 Should)

`/account/security` is a Must route from M1 because it hosts the sessions list (D-UX-030). The account nav shows "Security" to every signed-in user (own sessions need no permission). The Password and Two-step verification sections render only when US-028 and US-026/US-267 are built; until then the page holds the intro and the sessions section alone.

### 1.1 Layout

```
1280 (account layout)
| # Security                                                                       |
| ## Password                                    (Should, US-028; only if built)    |
| Last changed 3 Oct 2026            [Change password]                             |  Dialog: new password (Show); ReauthDialog first (scope auth.password.change)
| ## Two-step verification                       (Should, US-026/US-267)            |
| [Off]  Add a code from an authenticator app when you sign in.                    |
| [Turn on]                                                                        |  -> F09 §2 (re-auth, QR, code, recovery codes)
|   when on: [On] Recovery codes left: 8   [Generate new codes] [Turn off]         |
|   ! You have 2 recovery codes left. Generate new codes.                          |  warning at 2 or fewer (US-023)
| ## Where you're signed in                      (Must, US-027)                     |
| These are the devices signed in to your account. Sign out any you don't recognise.|
| | Device              | IP address range | Signed in      | Last active | Action                   |
| | Chrome on Windows   | 203.0.113.0/24   | 2 Nov, 09:14   | Now         | This device · [Sign out] |
| | Safari on iOS       | 198.51.100.0/24  | 28 Oct, 18:03  | 3 h ago     | [Sign out]               |
| [Sign out of all other devices]                                                  |  AlertDialog confirm

360 (sessions section; CardList)
| ## Where you're signed in              |
| These are the devices signed in to     |
| your account. Sign out any you don't   |
| recognise.                             |
| +------------------------------------+ |
| | Chrome on Windows   [This device]  | |  card title + neutral badge
| | IP address range 203.0.113.0/24    | |
| | Signed in 2 Nov, 09:14             | |
| | Last active now                    | |
| | [            Sign out            ] | |  full width, 44 px
| +------------------------------------+ |
| | Safari on iOS                      | |
| | ...                                | |
| | [            Sign out            ] | |
| +------------------------------------+ |
| [  Sign out of all other devices   ]   |
```

### 1.2 Sessions list behaviour (US-027; component `SessionList`, shared with S-D08)

- **Fields** (US-027 notes): parsed browser and OS ("Chrome on Windows"; unparseable → "Unknown device"), coarse IP exactly as the API returns it (IPv4 /24 such as `203.0.113.0/24`, IPv6 /48 such as `2001:db8:12::/48`; D-UX-030 replaces the earlier `203.0.113.x` rendering so the screen matches the acceptance example), created ("Signed in"), last used ("Last active", relative with the absolute time in the accessible name and a tooltip), current flag. The session ID is not shown; it is the row key.
- **Order:** current session first, then by last active, newest first. All own sessions in one list (the API returns at most the active sessions of one user; no paging control is shown unless the API returns a next cursor, in which case the standard Pagination appears).
- **Sign out one session:** no confirmation (the effect is limited and reversible by signing in again). The button shows loading; on success the row is removed, toast "Signed out of Safari on iOS.", focus to the next row's action or, if none, to the section heading. Takes effect within 5 s server side (REQ-AUTH-022).
- **Current session:** its action reads "Sign out" (US-027 AC) and performs the normal sign-out (US-019, F05 §4).
- **Sign out of all other devices:** AlertDialog "Sign out of all other devices?" / "You'll stay signed in on this device." with "Cancel" (initial focus) and "Sign out other devices". On success the list keeps only "This device" and a toast "Signed out of {count} other devices." When the current session is the only one, the button is replaced by the text "This is the only device signed in."
- **No re-authentication** is required for listing or remote sign-out (the API declares no `x-reauth-scope` on these operations).
- **Audit:** opening the page writes one `VIEW` of entity `session` (server side); the UI does not re-fetch on focus, so revisiting the tab does not add audit noise (refetch on window focus is disabled for this query).

### 1.3 States (US-027 "Six states and locales"; same for S-D08)

| State | Rendering |
|---|---|
| Loading | Section heading and intro render immediately; 2 skeleton rows (1280) or 2 skeleton cards (360); `aria-busy` on the list region with "Loading your sessions" |
| Empty | Not applicable: the current session is always present (US-027 AC "empty-not-applicable"). If the API ever returns no rows, treat as an error (ErrorState) because the request itself proves a session exists |
| Error | ErrorState inside the section: "We couldn't load your sessions." + Try again + reference. The Should sections above still render (section-level error, not page-level) |
| Partial | Not applicable (one request) |
| Permission-denied | Not applicable for the list (own data). Unauthenticated: redirect to sign-in with `returnUrl=/account/security` (F10). |
| Offline | OfflineBanner; list stays visible; every Sign out button and "Sign out of all other devices" are `aria-disabled` with the reason "You're offline" |
| Sign-out errors | 404 (session already ended): row removed, info toast "That session had already ended." 5xx or `AUDIT_WRITE_FAILED`: error toast with reference, row kept, button back to idle. 401 on the call: F10 sign-in redirect. |

Verified in en, es and fr at 360 and 1280 px (US-027 AC; pseudo-locale overflow check, NFR-I18N-003).

### 1.4 Other sections (Should)

- Re-authentication for the Should actions on this page uses the **ReauthDialog** (W03 §8): password, or the TOTP code when MFA is on. Scopes: `auth.password.change` (Change password), `mfa.totp.disable` (Turn off; TOTP only), `mfa.recovery_codes.regenerate` (Generate new codes; TOTP only). When a proof has expired or was already used, the dialog re-opens once with "That took too long. Confirm it's you again." (F10 §4).

### 1.5 Accessibility

- `h2` "Where you're signed in"; the table has a caption "Devices signed in to your account" (visually hidden, the heading is visible). Header "IP address range" is visible text, not a hidden suffix.
- Each Sign out button has a unique accessible name: "Sign out of Safari on iOS"; the current row: "Sign out of this device". "This device" is a text badge, not colour.
- Toasts use `role="status"`; the removed row's focus move follows accessibility §3 ("Item removed from a list").

## 2. Admin "My sessions" (S-D08, D-008, **Must** via US-027) reuses `SessionList` inside the admin shell, with the same states and copy (W16 §4). Staff cannot turn off two-step verification. A staff security page beyond sessions is out of scope; recovery-code regeneration for staff (US-026, Should) is a "Generate new recovery codes" button on S-D08 behind the ReauthDialog (TOTP), only if US-026 is built.

## 3. Preferences (`/account/preferences`, US-272, US-266)
```
| # Preferences                                        |
| ## Language and region                               |
| Language [Español v]  · Prices shown in [USD v]      |
| Units (o) Metric (kg, cm)  ( ) Imperial (lb, in)     |
| [Save preferences]                                   |
| ## Emails                                            |
| [on]  Tracking updates (picked up, out for delivery, delivered) |
| [off] News and offers                                |
| Account and security emails are always sent.         |
```
Switches apply immediately with a polite "Saved" status. The language change re-renders the page in the new language and announces the change in it.

## 4. Address book (`/account/addresses`, US-262, US-263, US-264 Could)
Table or cards: Label, Name, Address (city, country), Default sender badge, actions Edit/Delete. "Add address" opens a full-page form (AddressForm). Search box. Empty: "No saved addresses" + [Add address]. CSV import (Could) is a separate Dialog with a client-side preview and per-row errors.

## 5. Saved quotes (`/account/quotes`, US-259, US-164)
List: route, packages, best price, saved date, expiry state (Active until … / Expired). Actions: Open, Delete (`quote:delete`). Expired rows: [Get new prices].

## 6. Payment methods (`/account/payment-methods`, US-265, US-217)
Cards list: brand (text), •••• last 4, expiry, Default badge, [Set as default], [Remove] (AlertDialog). No add form outside checkout ("Add a card when you next pay"). Listing needs no proof. **Set as default** and **Remove** (after its AlertDialog) open the ReauthDialog with scope `payment_method.manage` immediately before the request (always required, no age exemption; D-046). "Save this card" at checkout (W08) also needs the proof: the ReauthDialog opens when Pay is pressed with the box ticked, before any gateway call, so the proof is fresh (5 min) for the save request. Cancelling the dialog unticks the box and continues the payment without saving; the payment never depends on the save succeeding (a failed save shows "Your card wasn't saved" on the confirmation, payment unaffected).

## 7. Organisation and team (`/account/organisation`, US-268, US-269, US-082..US-085)
Profile form (name, address, tax ID), Members table (name, email, role Select, status, [Remove]), [Invite member] Dialog (email, role). Invite, resend, role change, suspend and remove carry `org.member.manage` with `x-reauth-max-age` 12 h: the UI sends the request without a proof and opens the ReauthDialog only on 401 `REAUTH_REQUIRED` (the "It's been more than 12 hours…" variant), then retries once (F10 §4). Last-Owner protection: the role Select is disabled for the last Owner with the reason "An organisation needs at least one owner" (`LAST_OWNER`). Users cannot change their own role (the control is disabled with the reason).
