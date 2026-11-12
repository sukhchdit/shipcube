# W17 — Transactional emails and the customs invoice document (S-E01..S-E05)

Stories: **US-282, US-283, US-279, US-280, US-186, US-016, US-021, US-117** · US-218, US-228, US-286, US-287 (Should) · Brief §4.13 · D-018 (email only; local mail catcher)

Emails are rendered from versioned templates in en, es and fr. The recipient's locale is captured on the event (US-117, US-280). This file defines layout, content blocks and accessibility. Template mechanics belong to the architecture.

## 1. Email layout (all templates)

```
+--------------------------------------------------+   max width 600 px, single column, fluid down to 320 px
| {Logo or BRAND_NAME wordmark}                    |   logo has alt="{BRAND_NAME}"
|--------------------------------------------------|
| [TEST ENVIRONMENT] (non-production only)         |   text banner, not image
| # {Heading}                                      |
| {Intro paragraph}                                |
| [ Primary action ]   (bulletproof button: a link |   44 px tall, text link fallback below
|                       styled as a button)        |
| If the button doesn't work, copy this link:      |
| https://…                                        |
| {Details block (tables only for data)}           |
|--------------------------------------------------|
| Why you got this email · Help · Privacy          |
| {BRAND_NAME} · {operator postal address config}  |
| (Marketing and tracking emails only: Manage email preferences) |
+--------------------------------------------------+
```
Rules:
- `<html lang="{locale}">` and `dir="ltr"`. A plain-text part is always included, with the same content.
- Real text only, never text in images. Images are decorative (`alt=""`) except the logo.
- Contrast uses the light-theme tokens (inlined hex). Links are underlined. The button is a link with at least 44 px height and 16 px text.
- No tracking pixels in M1 (no analytics, GAP-A-16).
- Subjects are short, front-loaded and localised (`email.<template>.subject`). The order number goes in the subject where relevant.
- Times are shown in the recipient's zone (from the profile; else the sender address zone) with the zone label. Pickup dates are date-only plus the location zone.
- Personal data is minimised: no full receiver address in emails, only city and country, plus the receiver name for the sender's own confirmation.

## 2. Templates in M1 Must scope

| ID | Template | Trigger | Heading (en) | Primary action | Details block | Preference-immune |
|---|---|---|---|---|---|---|
| S-E01 | EMAIL_VERIFICATION | Register, resend | "Confirm your email address" | "Confirm email" → `/verify-email#token=…` | "This link expires in 24 hours. If you didn't create an account, ignore this email." plus (US-292, D-050) "If you don't confirm within {days} days, this account is removed and the address can be used to register again." (`{days}` from `AUTH_UNVERIFIED_TTL`, never a literal) | Yes (US-282) |
| S-E02 | PASSWORD_RESET | Forgot password | "Reset your password" | "Choose a new password" → `/reset-password#token=…` | "This link expires in 60 minutes and works once. If you didn't ask for this, you can ignore it. Your password won't change." | Yes |
| S-E03 | SECURITY_NOTICE (variants: new device sign-in, password changed, MFA on, MFA off, account locked, recovery code used) | Security events | Variant-specific, e.g. "Your password was changed" | "Review where you're signed in" → `/account/security` (web; the sessions section is Must from M1, US-027) or `/account/sessions` (staff, admin origin); signed-out recipients pass through `/sign-in?returnUrl=` | Event time and zone, device ("Chrome on Windows"), coarse location (IP /24), "If this wasn't you, reset your password now." with link, and the event reference (correlation ID) | Yes |
| S-E04 | BOOKING_CONFIRMATION | Saga notify step | "Your shipment is booked" (subject "Booked: order US-000000123") | "View your order" → `/orders/{id}/confirmation` | Per shipment: carrier, service, tracking number (with public tracking link), pickup date and window + reference, or the drop-off point + latest drop-off time; "What to do next" list; attachments note "Your label is attached." and, for the customs invoice, an attachment only when the document is not `SENSITIVE`; a `SENSITIVE` invoice (it carries a `FULL` identity reference, D-051) is never attached and the e-mail says "Download your customs invoice from your shipment page." with a link to `/account/shipments/{id}`. Over 10 MB: "Download your documents from your account" | n/a (transactional) |

Should templates (when built): PAYMENT_RECEIPT (US-218), PICKUP_SCHEDULED/CANCELLED, TRACKING_MILESTONE (US-287, preference-controlled), CANCELLATION_REFUND, DOCUMENTS (US-228).

### S-E04 layout detail
```
| # Your shipment is booked                        |
| Order US-000000123 · Paid USD 65.00 [TEST MODE]  |
| [ View your order ]                              |
| ---------------------------------------------    |
| DHL Express · Express Worldwide                  |
| To Ravi Kumar, Mumbai, IN                        |
| Tracking 1234567890 (Track it: link)             |
| Pickup Tue 17 Nov 2026, 13:00–17:00 EST          |
| Reference PRN-55821                              |
| ---------------------------------------------    |
| What to do next                                  |
| 1. Print the attached label …                    |
| Attachments: US-000000123-SHIPPING_LABEL-v1.pdf  |
| Customs invoice: <Download it from your          |
| shipment page>   (SENSITIVE: link only, D-051;   |
| a non-SENSITIVE invoice is attached instead)     |
```

## 3. S-E05 Commercial or pro-forma invoice (PDF document, US-186)

English only (US-186 note). A4 or US Letter by the origin country (US → Letter). Generated server-side. Layout:
```
+------------------------------------------------------------------+
| COMMERCIAL INVOICE  (or PRO FORMA INVOICE)        Page 1 of 1    |
| Invoice date 12 Nov 2026   Order US-000000123   Shipment ref …   |
| Carrier DHL Express  Tracking 1234567890   Incoterm DAP          |
| Reason for export: Gift                Currency: USD             |
+-------------------------------+----------------------------------+
| Exporter / Sender             | Consignee / Receiver             |
| name, company, address, phone | name, address, phone, ID type +  |
| tax ID (if any)               | number (full, required by customs)|
+-------------------------------+----------------------------------+
| # | Description | HS code | Origin | Qty | Unit value | Unit wt | Line value |
| 1 | Cotton shirts | 610910 | IN    | 3   | 12.50      | 0.20 kg | 37.50      |
| …                                                                |
|                                     Total declared value  62.50  |
|                                     Total net weight      0.81 kg|
|                                     Packages 1 · Gross weight 2 kg|
+------------------------------------------------------------------+
| I declare that the information on this invoice is true and       |
| correct and that the contents of this shipment are as stated.    |
| Name: Ana Silva          Signature: ________   Date: 12 Nov 2026 |
+------------------------------------------------------------------+
```
- Tagged PDF with a logical reading order, a document title and language `en` (accessibility of generated documents is best effort in M1 and tracked by qa-lead; the brief's WCAG obligation applies to the apps).
- Numbers are formatted in en-US style regardless of UI locale (customs document convention). Units are as entered, with metric equivalents in brackets for imperial input.
- The receiver ID number appears in full **only** on this customs document, as customs require (US-177 restricted data). It never appears in emails or on screen unmasked.
