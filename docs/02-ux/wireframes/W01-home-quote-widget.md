# W01 — Home with quote widget (S-W01)

Route `/{lng}/` · **Pre-rendered** per locale · Permission `public` · Stories: **US-109, US-112, US-156, US-157, US-158, US-173** (content type) · Flow: [F01 §1](../flows/F01-guest-quote-and-compare.md#1-get-a-quote-home-widget) · Benchmarks matched (capabilities only): instant quote without an account, volumetric weight shown live, metric/imperial input.

**Data needed (build time or first load):** enabled countries (name via `Intl.DisplayNames`, postcode label, pattern, required flag, or city-instead-of-postcode, unit system), content types, seeded envelope default size, default volumetric divisor per unit system, package limits (1–20 packages, 0.1–1000 kg, 1–300 cm) from `packages/shared`.

## 1. Layout

### 360 × 640 (widget fills the first screen; no hero image)
```
+--------------------------------------+
| [=] {Logo} {BRAND}          [Sign in]|  56
+--------------------------------------+
| # Compare carriers and ship          |  display 28/36 (1–2 lines)
|   worldwide                          |
|                                      |
| From                                 |  fieldset legend
| [United States     v][ZIP code_____] |  country 55% | postcode 45%
|                [⇅ Swap]              |  IconButton "Swap origin and destination"
| To                                   |
| [India             v][PIN code_____] |
|                                      |
| What are you sending?                |
| [ Parcel ✓ | Document ]              |  SegmentedControl
| [ ] Delivering to a home address     |  residential flag
|                                      |
| Package 1            [ lb/in | kg/cm]|  units SegmentedControl (applies to all)
| Weight [4.4____] lb                  |
| Size   [11.8_] x [7.9__] x [3.9__] in|  fieldset "Dimensions (L x W x H)"
| Billable 4.4 lb (volumetric 2.6 lb)  |  live readout + (i) "What's this?" popover
| <+ Add another package>              |
|                                      |
| [         Get quotes          ]      |  Button lg, full width
+--------------------------------------+
| below the fold: how it works (3 steps), what you can send (link to
| Prohibited items), track a shipment form shortcut, help link
```

### 1280 × 720
```
+------------------------------------------------------------------------------------------------+
| {Logo} {BRAND}   Get a quote  Track  Prohibited items  Help         [English v] [USD v] [Sign in]|
+------------------------------------------------------------------------------------------------+
|  # Compare carriers and ship worldwide                                                         |
|  Instant prices from major express carriers. No account needed to compare.                    |
|                                                                                                |
|  +------------------------------------------------------------------------------------------+  |
|  | From                                        To                                           |  |
|  | [United States      v] [ZIP code____]  [⇅]  [India            v] [PIN code______]       |  |
|  |                                                                                          |  |
|  | What are you sending?            [ Parcel ✓ | Document ]   [ ] Delivering to a home      |  |
|  |                                                                                          |  |
|  | Packages                                                      Units [ lb/in ✓ | kg/cm ]  |  |
|  |  #  Weight        Length     Width      Height     Volumetric   Billable                 |  |
|  |  1  [4.4___] lb   [11.8_] in [7.9__] in [3.9__] in  2.6 lb       4.4 lb      [remove]     |  |
|  |  <+ Add another package>                         Total billable weight: 4.4 lb  (i)      |  |
|  |                                                                       [   Get quotes  ]  |  |
|  +------------------------------------------------------------------------------------------+  |
|                                                                                                |
|  How it works:  1 Compare prices  2 Book and pay  3 Print and hand over        (text + icons)  |
+------------------------------------------------------------------------------------------------+
```
768–1023: the widget card keeps the From/To pairs side by side and the package table becomes per-package rows with a 2-column grid (weight | L × W × H).

## 2. Regions and components

| Region | Components | Notes |
|---|---|---|
| Hero heading | `h1` (display style) | The only `h1`. The subcopy is ≥ 768 only, to save mobile height. |
| Route | Combobox (country) ×2, TextField (postcode or city, label per country), IconButton swap | Country options are the enabled countries only. The postcode label and `inputmode` change with the country (US-119): `numeric` for US ZIP and IN PIN, `text` for GB and CA. For countries without postcodes, a "City or town" TextField replaces it. Swap exchanges both pairs and announces "Origin and destination swapped". |
| Content type | SegmentedControl Parcel / Document | Document hides the dimension inputs behind "<Edit size>" with the seeded envelope size prefilled (D-UX-019) |
| Residential | Checkbox | Label "Delivering to a home address"; hint (≥ 768) "Some carriers charge more for home delivery" |
| Packages | PackageRows + units SegmentedControl | Default units from origin: US → imperial, otherwise metric (US-157). Toggling converts displayed values with exact constants (canonical integers unchanged). Up to 20 rows. Rows 2+ have "Remove package n". |
| Live weights | live text + Popover "What's this?" | "Billable weight is the greater of actual and volumetric weight." The divisor shown is the default for the unit system, labelled "estimate until prices load". |
| Submit | Button lg "Get quotes" | Loading label "Getting quotes…" |

## 3. Interaction details

- **Validation timing:** on blur for each field, plus on submit. Messages (en): "Enter a PIN code", "Enter a valid PIN code, for example 400001" (the example comes from reference data), "Weight must be between 0.1 and 1,000 kg" (the unit follows the selected system: "0.22 and 2,204 lb"), "Each side must be between 1 and 300 cm".
- **Number entry:** DecimalField accepts "2,5" in es and fr and "2.5" everywhere.
- **Live readout:** recalculates after a 150 ms debounce. An invalid value shows "—" with "Enter a valid weight to see billable weight" (US-157).
- **Submit:** client validation runs first. Then the quote is created and the page navigates to results. Pre-hydration typing is preserved (the form reads DOM values on hydrate, US-158).
- **Keyboard:** Tab order goes From country, From postcode, Swap, To country, To postcode, content type, residential, units, the package rows, Add package, Get quotes. Enter in any field submits.
- **No JavaScript:** a `<noscript>` InlineAlert inside the widget: "Turn on JavaScript to see prices. You can still read about our services below."

## 4. States

| State | Trigger | Rendering |
|---|---|---|
| Default | First load | Origin defaults to the locale's likely country only when unambiguous (en→none, the field is empty); US→IN is **not** prefilled (no assumption). Units default after origin selection. |
| Loading | Submit in flight | Button loading; fields stay editable; no skeleton (the static page is already rendered) |
| Empty | n/a | Not applicable (form). Results-level empty is in W02. |
| Error | 5xx or network | Form-level InlineAlert (danger) above the button: "We couldn't get prices right now. Try again." + correlation ID; values kept |
| Validation error | Client or 400 | Inline errors; ErrorSummary when 2 or more; focus to the first invalid field |
| Partial | Reference data for postcode rules missing for a country | Postcode treated as optional text with the hint "We'll check this postcode when you book" (no blocking) |
| Permission-denied | Not applicable (public). A 429 rate limit uses an InlineAlert: "You've requested a lot of quotes. Try again in {seconds} seconds." The button is disabled with a countdown reason. | |
| Offline | `navigator.onLine === false` | OfflineBanner; "Get quotes" `aria-disabled` with "You're offline"; values kept (US-158) |
| Hover/focus/active/disabled | per component matrix | Hover styles only under `hover: hover` |

## 5. Accessibility

- Landmarks: shell plus `main` → `section aria-labelledby="quote-heading"` (the widget's visually hidden `h2` "Get a quote").
- Each From/To pair is a `fieldset` with a `legend`. Dimensions are a `fieldset` with legend "Dimensions of package 1 (length, width, height)" and individual labels "Length", "Width", "Height" (visually hidden at 360, visible at 1280).
- Live readout: `aria-live="polite"`, `aria-atomic="true"`, throttled to 1 s, announcing only "Total billable weight 4.4 pounds".
- Swap button: an icon-only button with `aria-label`.
- Targets: every control is 44 px under `pointer: coarse`. The swap button is 44 × 44.
- Error summary pattern per [accessibility.md §5](../accessibility.md#5-forms-validation-and-the-error-summary).
- Hero fits at 360 × 640 with 16 px input text on touch (D-UX-004). With +30% text expansion (pseudo-locale), the heading may wrap to 3 lines; the widget then extends below the fold, which is acceptable: it is still the first interactive element (US-109).
- CLS: the widget's height is fixed by the pre-rendered markup. Hydration adds no elements above it (NFR-WEB-003).

## 6. i18n keys (examples)

`home:meta.title`, `home:hero.title`, `quote:widget.from.legend`, `quote:widget.to.legend`, `quote:widget.swap`, `quote:widget.contentType.parcel`, `quote:widget.contentType.document`, `quote:widget.residential.label`, `quote:widget.units.imperial`, `quote:widget.units.metric`, `quote:widget.package.legend` (`{index}`), `quote:widget.live.billable` (`{billable}`, `{volumetric}`), `quote:widget.add`, `quote:widget.submit`, `quote:widget.noscript`. Postcode labels come from reference-data keys `address:postcodeLabel.{type}` (zip, pin, postcode, postalCode, eircode).
