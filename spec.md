# Quick Shop

## Objective

A Chrome extension for the Zehrs website (zehrs.ca) that makes finding items and adding them to your cart faster. It shows a small modal inside the site that lets you search and add items to your cart without re-navigating the page. The modal shows very basic versions of the search page and the results page.

## Current state

A teal "Quick Shop" button is inserted at the right-hand end of the header's nav bar on every page (including pages like the cart page that have no header cart button), filling the full height of the bar like the site's own nav buttons. Clicking it opens a modal (96% of the window wide). Nothing anywhere has rounded corners.

The modal's top row (a flex row with an 8px gap) has the name of the store whose catalog is being searched (from the cart, e.g. "Zehrs Example Store"), the search box (placeholder "Search Zehrs Example Store", square, with the site's focus styling overridden so it looks the same focused or not), Search, a cart indicator ("Cart · N items · $total", which opens the site's cart page after saving pending changes), an expander (▾) next to it, and "Close (ESC)". While the modal is open, typing anywhere (outside another text field) goes into the search box. The site's own focus traps (e.g. the Material UI popover on the cart page) are kept from pulling focus out of the modal by capture-phase `focusin` / `focusout` listeners on `window` in `extension/extPage.tsx`. The page behind the modal can't scroll while it is open.

With nothing searched and no filters checked, the results show the weekly flyer items ("flyer items" in the header) without ticking the Flyer Item checkbox, so typing a search or checking a filter leaves the flyer view naturally.

The expander opens a horizontally scrolling row of the cart's items under the search bar, newest first, each with − / + quantity controls. An item decreased to 0 stays in the row (dimmed, with a Remove button that drops it immediately) until the mouse has been away from the cart indicator and the row for 15 seconds.

Under that is a filter bar: Our Brands, Deals, Shop Canadian and Flyer Item checkboxes, and a Dietary dropdown. Changing any of them re-runs the current search. Our Brands and Deals use the value codes from the latest search response, falling back to hard-coded codes.

Results show as a Zehrs-style grid (image, price, was-price, deal, brand, name, package size) with no borders and tight spacing, plus a "Load more (shown of total)" button for the next page of 48, which also fires automatically when the results are scrolled to within 600px of the bottom. Hovering a tile covers it with two semi-transparent halves: the left half opens the details, the right half adds to cart. Once the item is in the cart the right half splits into + on top and − on the bottom, and the quantity shows in the tile's top-right corner.

Tiles are tab stops (the overlay buttons are not, so Tab moves tile to tile after the filters). A focused tile gets a square outline and shows the same overlay as hover, labelled with its keys: ↑ adds one, ↓ removes one, Enter opens the details. While a search runs, the results area shows a large centred "Searching for "…"…" with a spinner.

Details open as a sub-modal inside the modal, mostly to see a big product image: the largest available image (the 1200px `extraLargeUrl`) is shown as large as the window allows, with brand, size, price, quantity controls, description, ingredients and a link to the full product page in a column beside it. It has its own "Close (ESC)". Escape closes the sub-modal first (returning focus to the tile that opened it), then the modal.

The header buttons read "Search (Enter)" and "N items · $total · mass" (no "Cart" label; "Loading..." until the cart arrives). The cart row shows each item's mass ("1.2 kg (600 g each)").

The cart API has no package sizes, so `extension/productMass.ts` keeps a per-product grams cache (in `localStorage`, so it survives page loads). It is filled from every search tile's `packageSizing` and every opened product detail, and on each cart load any cart item missing from it is fetched from the product detail endpoint (up to 4 at a time). Sizes are parsed from text like "450 g", "1.36 kg", "720 ml" or "6x200.0 ml"; millilitres count as grams. Items priced by weight use the detail's `averageWeight`, and items sold by weight use their quantity in kg. Items whose size can't be determined (e.g. "18 ea") show as "Size unknown" and are counted as "+ N unknown" in the total.

Quantity changes are optimistic: the UI updates instantly and each item's change is sent to the cart 5 seconds after its last click, so rapid clicks collapse into one request. Touching a different item sends the previous item's pending change immediately, and closing the modal or leaving the page (`pagehide`, sent with `keepalive`) sends everything still pending. The badge is dimmed while a change is unsaved. This logic lives in `extension/cartSync.ts`.

## Architecture

- `extension/extPage.tsx` runs in the page's MAIN world (declared in `manifest.json` with `"world": "MAIN"`), because the PC Express API only accepts CORS requests from `www.zehrs.ca` and needs the page's cookies. It is bundled by `bin/buildPageScript.ts`, which `yarn build-extension` runs after the sliftutils extension build.
- `extension/extContentScript.ts` stays in the isolated world only for hot reloading (it needs `chrome.*` APIs, which the MAIN world doesn't have).
- `extension/zehrsApi.ts` wraps the API calls documented in `docs/zehrs-api.md`.
- `extension/QuickCart.tsx` is the Preact + MobX UI.

## Development

`yarn watch-extension` runs the build server. Builds and reloads only happen when you run `yarn reload-extension`, so saving files never triggers a reload by itself. That builds the debug extension into `build-extension/` (with hot reloading) and tells it to reload.

Every successful debug build also schedules a production build into `build-extension-prod/` 20 seconds later (restarting the delay if another debug build happens first), so production stays up to date without slowing down the debug loop. `yarn build-extension-prod` runs it directly. The production build is only the page script (`extPage.js`) plus a manifest with the background worker and the isolated content script removed, since those exist only for hot reloading, so it contains no localhost connection code at all. `bin/buildProduction.ts` fails the build if `localhost`, `ws://` or `enableHotReloading` appears in any production file.

Load only one of the two folders in Chrome at a time; with both loaded the modal would be injected twice.
