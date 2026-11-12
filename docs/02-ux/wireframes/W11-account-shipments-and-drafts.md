# W11 — Account overview, shipments list and drafts (S-C01, S-C02, S-C04)

Routes `/account`, `/account/shipments`, `/account/drafts` · Client-rendered · Permissions: session (overview), `shipment:read` (list), `shipment:create` (resume and delete drafts) · Stories: **US-254, US-256, US-257, US-108, US-070** · US-258 (Should, dashboard widgets) · Flow: [F05](../flows/F05-account.md)

## 1. Account overview (S-C01)

M0 needs the signed-in shell (PRD §6.1, "account dashboard shell"). M1 Should (US-258) adds the widgets. Without US-258, the overview shows the greeting, the verification banner (if any) and quick links.

```
360                                         1280 (account side nav on the left)
| # Hello, Ana                         |   | # Hello, Ana                     Acme Exports (Owner) |
| Acme Exports · Owner                 |   | [Get a quote]                                         |
| [Get a quote]                        |   | +------------------+ +------------------+ +--------+ |
| ## Needs your attention (Should)     |   | | Needs attention  | | Recent shipments | | Spend  | |
| 2 drafts to finish     <View>        |   | | 2 drafts         | | (5 rows)         | | Nov    | |
| 1 shipment with a problem <View>     |   | | 1 problem        | |                  | | $250.00| |
| ## Recent shipments (Should)         |   | +------------------+ +------------------+ +--------+ |
| (5 cards)    <View all shipments>    |   | Spend tile only with payment:read; one figure per currency |
| ## Spend this month (Should)         |
| $250.00 · €80.00                     |
```
States: loading (tile skeletons), empty ("You haven't shipped anything yet." + [Get a quote]), error per tile with tile-level Try again (partial), permission-denied (tiles omitted rather than denied), offline banner.

## 2. Shipments list (S-C02, US-254)

**Data needed:** a page of shipments (25, cursor) with status, order number, tracking number, receiver name and city/country, carrier and service, created date, plus facet values for filters. Prices are not shown in the list; the charge snapshot is on the detail page and the payment summary there needs `payment:read`.

### 1280 px (table ≥ 768)
```
| # Shipments                                                               [Get a quote] |
| [Search tracking no., order no., reference or receiver____________] [Search]           |
| Status [All v]  Carrier [All v]  Direction [All v]  Destination [All v]  Created [__ to __] <Clear filters> |
| 25 shipments shown                                                                     |
| +------------------------------------------------------------------------------------+ |
| | Status        | Order no.     | Tracking no. | Receiver          | Carrier   | Created  ▼| |
| | [In transit]  | US-000000123  | 1234567890   | Ravi Kumar, Mumbai| DHL Expr. | 12 Nov   | |
| | [Label ready] | US-000000124  | 7788990011   | Maria Lopez, Madrid| FedEx    | 11 Nov   | |
| | ...                                                                                | |
| +------------------------------------------------------------------------------------+ |
|                                                       [‹ Previous]  [Next ›]  Rows [25 v] |
```
The row's primary link is the order number cell (opens the detail). Row hover (hover:hover) highlights the row and shows the quick actions (Copy tracking number, Download label) in the last column. On touch and keyboard, a visible "More actions" IconButton is always present.

### 360 px (cards < 768)
```
| # Shipments              [Get a quote]|
| [Search____________________] [Search] |
| [Filters (2)]  Sort [Newest first v]  |  BottomSheet with the same filters
| +----------------------------------+  |
| | [In transit]          12 Nov     |  |
| | US-000000123                     |  |  link to detail (card's primary link)
| | To Ravi Kumar, Mumbai IN         |  |
| | DHL Express · 1234567890 [Copy]  |  |
| +----------------------------------+  |
| ...                                   |
| [‹ Previous]            [Next ›]      |
```
The card fields follow the same priority as the table columns (US-107, US-254): status, order number, receiver, carrier and tracking, created.

### Interaction
- Search on submit (and Enter). There is no search-as-you-type, which avoids audit noise because every list view is a VIEW entry. Filters apply on change, debounced 300 ms for the date fields.
- URL query holds search, filters, sort and cursor. Invalid values (`status=BANANA`) are dropped with an InlineAlert "We ignored an invalid filter in the link" (US-254).
- The result count is announced after changes: "25 shipments shown" (cursor pagination has no total).

## 3. Drafts (S-C04, US-256)

```
1280                                                        360 (cards)
| # Drafts                                                 |   | [Step 3 of 7: Collection]     |
| Drafts are kept for 30 days after your last change.      |   | US 10001 → IN 400001          |
| | Route              | Progress              | Last edited | Expires  |    | | Edited 12 Nov, 14:02          |
| | US 10001 → IN 400001 | Step 3 of 7: Collection | 12 Nov 14:02 | in 30 days | [Resume] [Delete] | | Expires in 30 days            |
| | US 10001 → GB SW1A  | Step 1 of 7: Addresses  | 2 Nov 09:10  | in 20 days | [Resume] [Delete] | | [Resume]  [Delete]            |
```
- **Resume** opens the first incomplete step. **Delete** opens an AlertDialog "Delete this draft? You can't undo this." with "Cancel" (default focus) and "Delete draft" (danger).
- Without `shipment:create` (Viewer), Resume and Delete are absent and the list is read-only (US-256).
- Expiring soon (< 3 days): the "Expires" cell uses warning text with an icon: "Expires in 2 days".

## 4. States (list and drafts)

| State | Rendering |
|---|---|
| Loading | 10 skeleton rows (table) or 3 skeleton cards |
| Empty | No shipments: "No shipments yet. When you book, your shipments appear here." + [Get a quote]. Filtered: "No shipments match your search or filters." + [Clear filters]. No drafts: "No drafts. Bookings you start but don't finish are saved here." + [Get a quote]. |
| Error | ErrorState + Try again + reference |
| Partial | Facet lists failed: the filter controls show "Filters aren't available right now" and the list still renders |
| Permission-denied | Without `shipment:read`: PermissionDeniedState and no request (US-070). The nav entry is absent. |
| Offline | Banner; the current list stays; paging and search disabled with the reason |
| Cross-tenant (US-257) | Never visible: lists contain only own-organisation data. Foreign IDs in detail URLs show NotFoundState. |

## 5. Accessibility

- `h1` per page. The table has a `caption` (visually hidden, "Shipments, newest first") and sortable headers with `aria-sort` (the Created column sort only in M1).
- The filter group is a `form role="search"` labelled "Search and filter shipments".
- StatusBadge text is part of the row's accessible content. Copy buttons are named with the value.
- Pagination: after Next or Previous, focus moves to the list heading and the new range is announced.
- Cards: `ul` > `li` > `article` with the order number as the heading link. Secondary actions are separate buttons, not nested in the link.
