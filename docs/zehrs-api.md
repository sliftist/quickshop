# Zehrs (PC Express) API

The Zehrs site is a front end for the Loblaw "PC Express" backend at `https://api.pcexpress.ca/pcx-bff/api`. Every endpoint below works with `fetch` from page context on `www.zehrs.ca`; the API sends `access-control-allow-origin: https://www.zehrs.ca`, so these calls must run in the page (MAIN world), not from an extension background script. Implementation: `extension/zehrsApi.ts`.

## Common headers

The extension does not build these headers itself. The site's own client code has a function, `getAuthPCXBffHeaders({ locale, banner })`, that returns the full header set the site uses for this API: `x-apikey`, `x-loblaw-tenant-id`, `Business-User-Agent`, `Site-Banner`, `baseSiteId`, `x-channel`, `x-application-type`, `Accept-Language`, `Content-Type`, the site's feature flags, and `Authorization: bearer <token>` from the site's own login client when signed in. `extension/siteHeaders.ts` calls that function on every request, so the extension always sends exactly what the site sends.

The function lives in a module of the site's Turbopack bundle. The extension reaches it by registering a tiny module of its own with the page's Turbopack runtime (`globalThis.TURBOPACK.push`), which hands that module the runtime context; the context's module cache (`context.c`) is then searched for the loaded module that exports `getAuthPCXBffHeaders`. Module ids change with every site build, so it is found by export name, never by id.

## Session values (cookies)

- `last_selected_store`: the store id (a 4-digit code), used as `storeId` and `sellerId`.
- `lcl-cart-id-banner`: the open cart id, used as `cartId`.

The `date` parameter used below is today in `DDMMYYYY` form (e.g. `10112026`).

## Search

`POST /v2/products/search`

```json
{
    "cart": { "cartId": "<cartId>" },
    "fulfillmentInfo": { "storeId": "<storeId>", "pickupType": "STORE", "offerType": "OG", "date": "<DDMMYYYY>" },
    "listingInfo": { "filters": {}, "sort": {}, "pagination": { "from": 1 }, "includeFiltersInResponse": false },
    "banner": "zehrs",
    "searchRelatedInfo": { "term": "milk", "options": [] }
}
```

Returns up to 48 tiles per page. `searchResultsCount` is the total. Product tiles are at `layout.sections.mainContentCollection.components[].data.productTiles`; collect them across every component and dedupe by `productId` (sponsored tiles can repeat).

Useful tile fields:

- `productId`: e.g. `21425018_EA`; the suffix is the unit (`_EA` each, `_KG` by weight). This is the id used for the cart and the product detail call.
- `brand`, `title`, `packageSizing` (e.g. `"2 l, $0.28/100ml"`).
- `productImage[0]`: `thumbnailUrl` (120px), `smallUrl` (250px), `mediumUrl` (400px), `largeUrl` (800px), `extraLargeUrl` (1200px).
- `pricing.displayPrice` (e.g. `"$5.50"` or `"about $1.72"` for weighted items), `pricing.wasPrice`, `pricing.price`.
- `deal.text` (e.g. `"SAVE $0.49"`, `"$5.50 MIN 2"`), `deal.expiryDate`.
- `pricingUnits`: `type` (`SOLD_BY_EACH` etc.), `unit`, `interval` (quantity step), `minOrderQuantity`, `maxOrderQuantity`, `weighted`.
- `link`: product page path, e.g. `/en/purfiltre-partially-skimmed-milk-1/p/21425018_EA`.
- `isSponsored`.
- `description`: HTML description, already included on search tiles.

Pagination: `listingInfo.pagination.from` is the 1-based page number (not an item offset); each page is 48 tiles. The `pagination` object on the grid component reports `hasMore: false` even when more pages exist, so compute "more" as `page * 48 < searchResultsCount`.

### Filters

`listingInfo.filters` maps a filter group code to an array of value codes, e.g. `{ "flyers": ["FLYER_ITEM"] }` (a plain string instead of an array returns HTTP 400). With `includeFiltersInResponse: true` the response lists the available groups at `layout.sections.filtersSection.components[0].data.filterGroups` and the site's big checkbox filters at `layout.sections.quickFiltersSection.components[0].data.quickFilters` (each has `name` and a `filterGroup` with `code` and `values[].code`).

Quick filters seen on Zehrs:

| Checkbox | Group code | Values |
|---|---|---|
| Our Brands | `productBrand` | the Loblaw brand codes present in the results, e.g. `N` (No Name), `P` (President's Choice), `PO` (PC Organics) |
| Deals | `promotions` | `Price Reduction`, `$1,$2,$3,$4,$5`, `Multi-Buy` |
| Shop Canadian | `shopCanadian` | `prepared_in_canada` |
| Flyer Item | `flyers` | `FLYER_ITEM` |
| Dietary | `dietaryCallouts` | `vegan`, `plant_based`, `gluten_free`, `dairy_free`, `organic`, `nut_free`, `peanut_free_allergen`, `kosher`, `halal`, `no_added_sugar`, `sugar_free`, `low_in_sodium`, `low_in_fat`, `source_of_protein`, `high_fibre`, `whole_grain`, `gmo_free`, and more |

Other groups: `category` (aisle codes), `price ranges` (e.g. `$5 and under`), `sellers`.

### Flyer items

An empty `term` with `filters: { "flyers": ["FLYER_ITEM"] }` returns the weekly flyer items (2602 on 2026-11-10, produce first, matching the home page's "Weekly Flyer Features").

The site itself gets the same data server-side through Next.js at `GET https://www.zehrs.ca/_next/data/<buildId>/en/search.json?search-bar=<term>` (the response's `pageProps.initialSearchData` has the same shape). That route depends on the deploy's `buildId`, so the extension uses the API directly instead.

## Product detail

`GET /v1/products/<productId>?lang=en&date=<DDMMYYYY>&pickupType=STORE&storeId=<storeId>&banner=zehrs`

Useful fields: `name`, `brand`, `description` (HTML), `packageSize`, `ingredients`, `imageAssets[0].largeUrl` (800px; `imageUrl` is null here), `offers[0].price.value`, `offers[0].wasPrice.value`, `breadcrumbs`, `nutritionFacts`, `link`.

## Cart

Read: `GET /v1/carts/<cartId>`. Useful fields:

- `orders[].entries[]`: `quantity`, `creationTime` / `modifiedTime` (ISO timestamps, used to show the newest items first), `prices.salePrice` (per unit), and `offer` with `id` (the productId), `sellingIncrement`, `sellingUnit` (`EA`), `sellingType`, `minOrderQuantity`, `maxOrderQuantity`, `webLink`, and `product.name`, `product.brand`, `product.primaryImage` (120px), `product.weighted`.
- No package size: entries only have `product.sizeLabel` (the unit, e.g. `G` or `ML`) and `prices.comparisonPrices` (e.g. `$2.22 per 100 g`). The size has to come from a search tile's `packageSizing` (e.g. `"450 g, $2.22/100g"`) or the product detail's `packageSize` (e.g. `"450 g"`, `"720 ml"`, `"6x200.0 ml"`). Items sold each but priced by weight (bananas, `_KG` ids with `pricingUnits.type` `SOLD_BY_EACH_PRICED_BY_WEIGHT`) have an empty `packageSize` and instead `averageWeight: "1.1"` with `uom: "KG"` on the detail. For `SOLD_BY_WEIGHT` items the cart quantity is itself in `pricingUnits.unit` (kg).
- `orders[0].totals.totalPrice` (also `subTotal`, `totalDiscounts`, fees): the cart total. There is no separate count endpoint; sum the entry quantities.
- `orders[0].fulfillment.type` (`pickup` for store pickup) and `orders[0].fulfillment.pickupBooking.pickupLocation.name` (the store's display name, with `address`).

Set quantity: `POST /v1/carts/<cartId>`

```json
{ "entries": { "21425018_EA": { "quantity": 2, "fulfillmentMethod": "pickup", "sellerId": "<storeId>" } } }
```

`quantity` is the absolute new quantity, not a delta; `0` removes the item. The response is `{ "cart": <same shape as GET>, "errors": [] }`; check `errors` even on HTTP 200.

The site's own header cart counter does not know about changes made this way until the page re-fetches the cart (e.g. on navigation or reload).
