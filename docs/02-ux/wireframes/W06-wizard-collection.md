# W06 — Step 3 Collection: pickup date and window, or drop-off (S-B03)

Route `/book/{id}/collection` · Permission `shipment:create`, plus `pickup:schedule` to save a pickup · Stories: **US-189, US-232, US-233, US-234, US-109** · US-239 (Should since D-036: drop-off list and confirmation) · US-240 (Could: map, not built) · Flow: [F02 §5](../flows/F02-auth-gate-and-wizard.md#5-step-3-collection)

**Data needed:** the service's collection modes (pickup, drop-off); pickup rules evaluated by the server for the sender address (sender IANA zone, the selectable dates in the 14-day horizon with a reason per unavailable date, preset windows, earliest and latest times, lead time, minimum window length, instructions max length and carrier truncation length); service points (Should list: name, address, distance, opening hours, carrier, `printerless` support); the sender address snapshot (pickup address).

The UI renders server-provided availability. It never re-implements the cut-off, holiday or lead-time rules, so the results countdown and the picker always agree (US-232).

## 1. Layout

### 360 px
```
| # How should the carrier get it?     |
| +----------------------------------+ |
| | (o) Courier pickup               | |  RadioCard
| |     The driver collects from     | |
| |     your sender address.         | |
| +----------------------------------+ |
| +----------------------------------+ |
| | ( ) Drop off                     | |  only when the service supports it
| |     Take it to a nearby point.   | |
| +----------------------------------+ |
|                                      |
| ## Pickup date                       |
| Times are local to 10001 (EST).      |
| +--------+ +--------+ +--------+     |  DateChipList (wraps, no h-scroll)
| |Mon 16  | |Tue 17  | |Wed 18  |     |
| |Nov     | |Nov  ✓  | |Nov     |     |
| |Past    | |        | |        |     |
| |cut-off | |        | |        |     |
| +--------+ +--------+ +--------+     |
| +--------+ +--------+ +--------+     |
| |Thu 19  | |Fri 20  | |Sat 21  |     |
| |        | |        | |Weekend |     |
| +--------+ +--------+ +--------+     |
| ... (14-day horizon)                 |
|                                      |
| ## Pickup time                       |
| (o) Morning   09:00–13:00            |  RadioCards
| ( ) Afternoon 13:00–17:00            |
| ( ) Choose a time                    |
|     From [10:00 v]  To [12:00 v]     |  custom; 30-min steps
|     At least 2 hours.                |
|                                      |
| ## Pickup address                    |
| Ana Silva, 350 5th Ave, New York,    |
| NY 10001 · <Edit in Addresses>       |
| Instructions for the driver          |
| (optional)                           |
| [Ring the bell at reception______]   |  200 chars, counter near the limit
+--------------------------------------+
| $45.20 [Price details ^] [Continue] |
```

### 1280 px
```
| # How should the carrier get it?                                                 |
| [ (o) Courier pickup ............ ]  [ ( ) Drop off ........................ ]  |  RadioCards side by side
|                                                                                  |
| ## Pickup date                                Times are local to 10001 (EST)     |
| +------------------------------+   ## Pickup time                               |
| |  November 2026         < >   |   (o) Morning   09:00–13:00                    |
| | Mo Tu We Th Fr Sa Su         |   ( ) Afternoon 13:00–17:00                    |
| | 16 [17] 18 19 20 21 22       |   ( ) Choose a time  From [v] To [v]           |
| | 23  24  25  26 27 28 29      |                                                |
| +------------------------------+   ## Pickup address ... Instructions [____]   |
| Unavailable days are greyed with a reason on hover/focus (e.g. 26 Nov: Holiday) |
```

### Drop-off selected (US-239)
```
| ## Drop-off points near 10001                        |
| 6 points within 25 km                                |
| +--------------------------------------------------+ |
| | (o) Express Service Point — Chelsea              | |
| |     214 W 23rd St, New York · 1.2 km             | |  distance in the unit system (km or mi)
| |     (DH) DHL · Open today 08:00–19:00            | |
| |     <Opening hours v>                            | |
| +--------------------------------------------------+ |
| | ( ) ...                                          | |
| Latest drop-off for next-day dispatch: 17:00         |
| What to bring: printed label, customs invoice (2     |
| copies), photo ID.                                   |
```
The map view is not rendered (Could, US-240; no tile source agreed, D-014). There is no placeholder.

## 2. Interaction details

- **Default:** the earliest selectable date and the first preset window that is valid on that date are preselected, so the common path is one tap on "Continue".
- **Unavailable dates:** visibly disabled, with the reason as visible text (mobile chip) or a tooltip plus accessible name (desktop) (US-234). Reasons: Weekend, Holiday ({name} when available), Past today's cut-off, Beyond 14 days (not rendered at all).
- **Window rules:** presets come from the server. Custom "From" and "To" Selects list only times within the allowed range. A custom window shorter than 2 hours shows the inline error "Choose a window of at least 2 hours" (US-234). A same-day window that starts before the lead time is not listed.
- **Server rejection** (`PICKUP_DATE_INVALID`, `PICKUP_WINDOW_INVALID`, for example a holiday added since loading): the message shows beside the date or window: "This date is no longer available. Choose another date." Availability refreshes.
- **Switching modes with data entered:** an AlertDialog confirms that the other mode's data will be cleared (US-189).
- **Instructions:** plain text only, with a counter. When the carrier limit is shorter than 200, a hint says "The carrier receives the first 75 characters; we keep the full text." (US-233).
- **Time zone:** always "Times are local to {postcode or city} ({zoneAbbr})". The review step and confirmation show "13:00–17:00 EST" (US-234).

## 3. States

| State | Rendering |
|---|---|
| Loading | Mode cards render. Date and window skeletons (chip grid or calendar block). |
| Empty | Pickup: no selectable date in the horizon (rare): EmptyState "No pickup dates are available in the next 14 days" + "Choose drop-off" (if supported) or "Contact us" link to Help. Drop-off: "No drop-off points found near 10001" + "Use courier pickup" (US-239). |
| Error | Availability failed: InlineAlert "We couldn't load pickup times. Try again." + Try again; Continue disabled with reason. Service points failed: same text as empty plus Try again (US-239). |
| Partial | Points loaded but opening hours missing for some: "Opening hours not available" per point. |
| Permission-denied | Viewer: PermissionDeniedState. Without `pickup:schedule` (custom role): pickup option disabled with reason "You don't have permission to book pickups"; drop-off still selectable. |
| Offline | Banner; Continue disabled with reason; previous selections kept |

## 4. Accessibility

- Collection mode: RadioGroup with legend "How should the carrier get it?". The RadioCards contain only text, so the whole card is the label.
- **Mobile DateChipList:** a RadioGroup with legend "Pickup date". Each chip's accessible name is "Tuesday 17 November", and disabled chips add ", unavailable: Holiday". Arrow keys move among enabled chips (Radix RadioGroup skips disabled).
- **Desktop Calendar:** ARIA date grid (D-UX-017). Disabled days are focusable and announced with the reason, but not selectable. Selecting is click or Enter/Space. No dragging (2.5.7).
- Window: RadioGroup with legend "Pickup time"; the custom Selects are labelled "From" and "To" and described by the 2-hour rule.
- Service point list: RadioGroup; "Opening hours" is a disclosure button per point with `aria-expanded`.
- The zone note is in the legend description (`aria-describedby`), so it is read with the field.
- Touch targets: chips are at least 64 × 56 px (above 44). The custom time Selects are 44 px.
