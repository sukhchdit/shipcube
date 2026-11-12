# F04 — Public tracking

Stories: **US-247, US-248, US-249, US-112** (Must) · US-250 (Should) · Screen S-W03

```mermaid
flowchart TD
  T0["/lng/track (pre-rendered shell) or link from email / confirmation with ?number="] --> T1{"number in URL?"}
  T1 -->|No| T2["Empty state: lookup form focused on load only if user came from Track nav;<br/>hint: tracking number or order number"]
  T1 -->|Yes| T3["Prefill field, run lookup"]
  T2 --> T4["Submit lookup"]
  T4 --> T5{"Client check"}
  T5 -->|"empty or invalid characters"| T6["Inline error on field"]
  T5 -->|"order number with bad check digit"| T6
  T5 -->|OK| T3
  T3 --> T7["Loading: result skeleton; URL updated to ?number= (replaceState)"]
  T7 --> T8{"Response"}
  T8 -->|"200 tracking number"| T9["Result: status badge, ETA, carrier + service,<br/>timeline newest first (city, country only).<br/>Announced: Status In transit, estimated delivery date"]
  T8 -->|"200 order number"| T10["Order: list of shipments, each with status and Track link<br/>(table at 768+, cards below)"]
  T8 -->|"404 TRACKING_NOT_FOUND"| T11["Not found message (same for unknown, not yet trackable, voided):<br/>We couldn't find that number. Check it, or try again later<br/>if you booked in the last hour"]
  T8 -->|"429 RATE_LIMITED"| T12["Rate-limited state: Too many lookups. Try again in N s<br/>(countdown, button re-enables)"]
  T8 -->|"network or 5xx"| T13["Error state with Try again"]
  T9 --> T14{"Some events pending or stale?"}
  T14 -->|"stale flag"| T15["Partial notice: Updates from the carrier are delayed.<br/>Last update time"]
  T14 -->|no| T16["Done"]
  T7 -.offline.-> T17["Offline banner; retry on reconnect"]
```

The Should variant (US-250, customer reference plus receiver postcode) adds a second tab of the lookup form: "Use your reference". It has two fields (reference, postcode). Its responses are identical to the not-found branch on a mismatch.

| State | Rendering |
|---|---|
| Loading | Result card skeleton (status line, 4 timeline rows) |
| Empty | No search yet: form plus a short explanation of where to find the number |
| Error | Network or 5xx: error state with Try again and correlation ID |
| Partial | Stale or pending events notice; the timeline is shown |
| Permission-denied | Rate limited (429): explicit state with countdown (US-248 maps this to permission-denied) |
| Offline | Banner; the last result stays visible |
| Not found | Neutral message; the input is kept for correction |

Privacy: no names, streets, postcodes, phone numbers, emails, references, contents, prices, carrier free text or facility names are ever displayed (DR-B31). Event location renders as "City, CC" or "CC" only (US-248).
