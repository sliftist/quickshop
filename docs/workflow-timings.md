# Workflow timings: Zehrs site vs Quick Shop modal vs Walmart

Measured 2026-11-10 in a real, signed-in Chrome (desktop, 1420px wide) against a single Zehrs store. Test items were removed from the cart afterwards.

## The workflow

This is how people actually shop the site, one item at a time: search for something, click a product, look at it, add it to the cart, then search for the next thing. On the Zehrs site that next search happens from the product page's header, so the loop repeats for every item on the shopping list:

1. Search (from wherever you are, which after the first item is a product page).
2. Click a result to open the product.
3. Add it to the cart.
4. Go back to step 1 for the next item.

## How it was measured

- Steps that stay inside one page were timed in the page with `performance.now()` from the click until the target element appeared, so tool latency is not included.
- Steps that load a new page were timed from the click (a timestamp saved in `sessionStorage` just before clicking) to the new page's Largest Contentful Paint (LCP), plus the new page's DOMContentLoaded and load events. For the product page, a second measurement used a MutationObserver injected before any page script ran, to record when the ADD button first existed.
- On the search results page, LCP lands within about 70 ms of the result titles appearing (2.78 s vs 2.84 s in a direct comparison), so LCP is used as "results visible".
- "Ready" means the thing the user needs is on screen and clickable, not that every ad and tracker has finished.

## Zehrs website (built-in)

| Step | What happens | Time to usable |
|---|---|---|
| Search from a product page | Full page load: the product page and the search page are separate front-end apps | 3.9 s and 4.3 s (DOMContentLoaded 4.7 / 5.2 s, load 7.4 / 7.5 s) |
| Open the product | Full page load back into the product-page app | 9.2 s until the ADD button exists (first, colder run: LCP 11.5 s) |
| Add to cart | Optimistic quantity control, then cart request | 0.65 s UI, 2.0 s server-confirmed |
| **Per item on the list** | | **≈ 13.8 to 16.5 s** |

Two full page loads per item. The product page is the worst of it: its HTML is parsed in about 2 s, but it is a client-rendered app that then waits on content-management fetches, feature flags, ads and recommendations before the ADD button renders, 9 to 11 seconds after the click. The search page that follows rebuilds the header, nav, cart, ads and analytics from scratch every time (172 network requests on one load).

The only fast search on the site is the very first one if you start from the home page, which is the same app as search and routes in-page (1.92 s). Every search after the first item comes from a product page and pays the full reload.

## Quick Shop modal (this extension)

| Step | Run 1 | Run 2 |
|---|---|---|
| Search | 1.32 s | 1.94 s |
| Open the product (image, price, add button) | 0.08 s | 0.22 s |
| Product description and ingredients loaded | 0.36 s | 0.61 s |
| Add to cart (server-confirmed) | 1.28 s | 2.08 s |
| **Per item on the list** | **≈ 2.7 s** | **≈ 4.2 s** |

Nothing ever reloads. Opening the modal takes 0.08 to 0.19 s once per session and going back to the results takes 0.06 to 0.09 s, if you want to pick a second item from the same search. Search and add-to-cart are bound by the same PC Express API the site uses. The product view renders immediately from the search tile while the detail call fills in the description.

One place the site is better: its add-to-cart updates the UI optimistically (0.65 s) while ours waits for the server (1.3 to 2.1 s). Making ours optimistic would take another second or so off every item.

## Walmart.ca

Not measured yet: walmart.ca put up a "Robot or human? Press & Hold" bot challenge on the first search from the automated browser. Numbers go here once the challenge is passed by hand.

## Side by side

| | Zehrs website | Quick Shop modal | Walmart.ca |
|---|---|---|---|
| Search (for the next item) | 3.9 to 4.3 s (full reload) | 1.3 to 1.9 s | pending |
| Open product | 9.2 to 11.5 s (full reload) | 0.1 to 0.2 s (details by 0.4 to 0.6 s) | pending |
| Add to cart | 0.65 s UI / 2.0 s confirmed | 1.3 to 2.1 s confirmed | pending |
| Full reloads per item | 2 | 0 | pending |
| **Per item** | **≈ 13.8 to 16.5 s** | **≈ 2.7 to 4.2 s** | pending |
| 20-item shopping list | ≈ 4.6 to 5.5 minutes of waiting | ≈ 0.9 to 1.4 minutes | pending |
| Grade | F | A | pending |

## Grades and what they say about the implementations

**Zehrs website: F.** A product page that takes 9 to 11 seconds to show its add button would have been slow on 1990s dial-up, and on a modern desktop with a fast connection there is no excuse for it. The backend is fine: search and add-to-cart come back in one to two seconds, and it is the same backend our modal uses. The grade comes from what is wrapped around it. Search and product pages are two different front-end apps, so the core shopping loop does two full page reloads per item, and the product page waits around nine seconds on content, flags, ads and recommendations before showing the button the user came for. This is the typical result of many teams each owning a slice of the page (ads, analytics, CMS content, personalization) with nobody owning the time it takes to buy milk. The optimistic add-to-cart shows the developers know how to make things feel fast; the page-level architecture just never got that attention.

**Quick Shop modal: A.** It does one job, calls the backend directly, keeps results in memory and never reloads, so per item it is down to roughly the cost of the two API calls the job actually needs. It loses points for waiting on the server for add-to-cart, and for being a small single-purpose tool that skips everything a real storefront has to handle (filters, substitutions, promotions, accessibility review).

**Walmart.ca: pending.**
