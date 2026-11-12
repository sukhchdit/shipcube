# W14 — Prohibited items lookup, legal pages and help (S-W04, S-W05)

Routes `/{lng}/prohibited-items`, `/{lng}/legal/terms`, `/{lng}/legal/privacy`, `/{lng}/help` · **Pre-rendered** per locale · Permission `public` · Stories: **US-055, US-059, US-112** · US-170 (Should: keyword lookup UI and calculator), US-060 (Should) · Benchmarks matched: per-country prohibited items guide, help pages.

## 1. Prohibited items (S-W04)

**Data needed:** enabled destination countries; per country, entries with category, localised name, status (PROHIBITED | RESTRICTED), restriction note, source label and unreviewed flag (US-055); optional carrier entries (union). The lookup is a client fetch after the shell renders (rate-limited 120/min). US-055 (Must) provides the data and endpoint, and US-170 (Should) the keyword UI. The Must slice of this page is the **country list view**; keyword search is Should.

### 360 px
```
| # What you can't send                |
| Check before you book. Rules differ  |
| by country and by carrier.           |
| Destination                          |
| [India                         v]    |
| Search (Should)                      |
| [battery_____________] [Search]      |
| ! Sample data: this list is for      |  warning InlineAlert while unreviewed
|   guidance only and hasn't been      |
|   reviewed. It isn't legal advice.   |
| ## Prohibited (12)                   |
| +----------------------------------+ |
| | [x Prohibited] Batteries, loose  | |
| | lithium                          | |
| | Category: Dangerous goods        | |
| | Source: Carrier list (sample)    | |
| +----------------------------------+ |
| ## Restricted (7)                    |
| | [! Restricted] Medicines         | |
| | Allowed with a prescription copy.| |
```

### 1280 px
Destination and search in one row. Results in two columns (Prohibited | Restricted) as card lists, each with a count heading. At ≥ 768 the categories can be filtered by a Select.

### States
| State | Rendering |
|---|---|
| Loading | List skeletons |
| Empty | Before a country is chosen: the explanation + the country Select focused. No match for a keyword: "Nothing found for 'battery'. Not finding an item doesn't mean it's allowed. Check with us before you send it." (US-170) |
| Error | ErrorState + Try again |
| Partial | `PACK_UNAVAILABLE`: "We don't have country rules for Brazil yet. Carrier rules are shown." (US-055) |
| Permission-denied | 429: RateLimitedState with countdown |
| Offline | Banner; the last list stays |

## 2. Legal pages (S-W05: terms, privacy)

```
| # Terms of service                                   |
| ! Draft, pending legal review. This text isn't final.|  warning banner while the pack is unreviewed (US-059)
| Version 0.1 · Effective {date} · Country: United States [v] |
| (prose, max 72ch, headings h2/h3, table of contents  |
|  as an in-page nav at ≥ 1024 on the inline-end side) |
```
- Text comes from the compliance pack per locale at build time. The country selector (when packs differ) navigates to an anchor or a variant section. There is no client fetch, so the page works with JavaScript off.
- States: the static page covers loading and error. A missing locale fails the build (US-112). Offline is not applicable to static pages already loaded; the banner shows if the connection drops.

## 3. Help (placeholder, S-W05)

```
| # Help                                               |
| ## Getting a quote · ## Booking · ## Customs ·       |
| ## Pickups and drop-off · ## Tracking · ## Account   |
| (short static answers from i18n; CMS is M4)          |
| Need more help? Contact details from configuration.  |
```
A neutral placeholder, clearly static content. No "coming soon" stubs. Every heading has real copy.

## 4. Accessibility
- One `h1`. Lists are `ul` with the counts in their headings. Status badges are text plus icon.
- The search result count is announced politely.
- The legal page's "Draft" banner is the first content inside `main`, so screen readers hear it first.
- Pre-rendered HTML contains the headings, form labels and, for legal pages, the full text (NFR-WEB-005).
