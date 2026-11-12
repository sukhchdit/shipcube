# W13 — Account settings (Should): security, sessions, preferences, address book, saved quotes, payment methods, organisation

Routes `/account/security`, `/account/preferences`, `/account/addresses`, `/account/quotes`, `/account/payment-methods`, `/account/organisation` · All **Should** or **Could** in M1 (US-026, US-027, US-028, US-259, US-262..US-272). They are specified compactly so the build can pick them up without another UX pass. None is on the Must coverage list. A screen that is not built has **no** navigation entry and no route (US-273 rule, brief §13 rule 5).

All screens use the account layout (W00 §1), the six shared states and the table-to-card collapse.

## 1. Security (`/account/security`, US-267, US-026, US-027, US-028)

```
| # Security                                                        |
| ## Password                                                       |
| Last changed 3 Oct 2026            [Change password]              |  Dialog: re-auth (current password), new password (Show)
| ## Two-step verification                                          |
| [Off]  Add a code from an authenticator app when you sign in.     |
| [Turn on]                                                         |  -> F09 §2 (re-auth, QR, code, recovery codes)
|   when on: [On] Recovery codes left: 8   [Generate new codes] [Turn off] |
|   ! You have 2 recovery codes left. Generate new codes.           |  warning at 2 or fewer (US-023)
| ## Where you're signed in                                         |
| | Device                 | Location      | Signed in  | Last active |       |
| | Chrome on Windows      | 203.0.113.x   | 2 Nov      | Now         | This device · [Sign out] |
| | Safari on iOS          | 198.51.100.x  | 28 Oct     | 3 h ago     | [Sign out] |
| [Sign out of all other devices]                                    |  AlertDialog confirm
```
- Re-authentication: a Dialog asking for the password, or the TOTP code when MFA is on (US-026). A proof expired message "Confirm it's you again" re-prompts.
- The coarse IP is shown as `203.0.113.x` (/24) with a visually hidden "IP address range". Times are relative with the absolute time in the accessible name.
- Remote sign-out: the row is removed with the toast "Signed out of Safari on iOS". The current session's action reads "Sign out" and signs out this device (US-027).

## 2. Admin "My sessions" (S-D08, D-008) reuses the "Where you're signed in" component inside the admin shell, with the same states. Staff cannot turn off two-step verification. A staff security page beyond sessions is out of scope; recovery-code regeneration for staff (US-026) is a "Generate new recovery codes" button on S-D08 behind re-authentication, only if US-026 is built.

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
Cards list: brand (text), •••• last 4, expiry, Default badge, [Remove] (AlertDialog). No add form outside checkout ("Add a card when you next pay").

## 7. Organisation and team (`/account/organisation`, US-268, US-269, US-082..US-085)
Profile form (name, address, tax ID), Members table (name, email, role Select, status, [Remove]), [Invite member] Dialog (email, role). Last-Owner protection: the role Select is disabled for the last Owner with the reason "An organisation needs at least one owner" (`LAST_OWNER`). Users cannot change their own role (the control is disabled with the reason).
