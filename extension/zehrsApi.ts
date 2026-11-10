import { getSiteHeaders } from "./siteHeaders";

const API_BASE = "https://api.pcexpress.ca/pcx-bff/api";
const BANNER = "zehrs";
const LANG = "en";
const PICKUP_TYPE = "STORE";
const OFFER_TYPE = "OG";
const ERROR_BODY_LIMIT = 500;
const DEFAULT_FULFILLMENT_METHOD = "pickup";
export const SEARCH_PAGE_SIZE = 48;

let fulfillmentMethod = DEFAULT_FULFILLMENT_METHOD;

export type ProductImage = {
    thumbnailUrl: string;
    smallUrl: string;
    mediumUrl: string;
    largeUrl: string;
    extraLargeUrl?: string;
    imageUrl?: string;
};

export type PricingUnits = {
    type: string;
    unit: string;
    interval: number;
    minOrderQuantity: number;
    maxOrderQuantity: number;
    weighted: boolean;
};

export type ProductTile = {
    productId: string;
    brand?: string;
    title: string;
    packageSizing?: string;
    link: string;
    productImage?: ProductImage[];
    pricing: {
        price: string;
        wasPrice?: string;
        displayPrice: string;
    };
    pricingUnits: PricingUnits;
    deal?: {
        text?: string;
    };
    isSponsored?: boolean;
};

export type ProductDetail = {
    code: string;
    name: string;
    brand?: string;
    description?: string;
    packageSize?: string;
    ingredients?: string;
    link: string;
    imageAssets?: ProductImage[];
    averageWeight?: string;
    uom?: string;
};

export type SearchFilters = { [filterGroup: string]: string[] };

export type QuickFilter = {
    name: string;
    group: string;
    values: string[];
};

export type CartItem = {
    productId: string;
    name: string;
    brand?: string;
    image?: string;
    unitPrice: number;
    comparisonPrice?: string;
    pricingUnits: PricingUnits;
    link?: string;
    creationTime?: string;
};

export type CartQuantities = { [productId: string]: number };

export type CartSnapshot = {
    quantities: CartQuantities;
    items: CartItem[];
    totalPrice: number;
    fulfillmentType?: string;
    pickupLocationName?: string;
};

type FilterGroupResponse = {
    code: string;
    values: { code: string }[];
};

type SearchResponse = {
    searchResultsCount: number;
    layout?: {
        sections?: {
            mainContentCollection?: {
                components?: {
                    data?: {
                        productTiles?: ProductTile[];
                    };
                }[];
            };
            quickFiltersSection?: {
                components?: {
                    data?: {
                        quickFilters?: {
                            name: string;
                            filterGroup: FilterGroupResponse;
                        }[];
                    };
                }[];
            };
        };
    };
};

type CartEntry = {
    quantity: number;
    creationTime?: string;
    prices?: {
        salePrice?: number;
        comparisonPrices?: {
            price: number;
            unit: string;
            quantity: number;
        }[];
    };
    offer: {
        id: string;
        webLink?: string;
        regularPrice?: number;
        sellingIncrement: number;
        sellingUnit: string;
        sellingType: string;
        minOrderQuantity: number;
        maxOrderQuantity: number;
        product: {
            name: string;
            brand?: string;
            primaryImage?: string;
            weighted?: boolean;
        };
    };
};

type CartResponse = {
    orders: {
        fulfillment?: {
            type?: string;
            pickupBooking?: {
                pickupLocation?: {
                    name?: string;
                };
            };
        };
        totals?: {
            totalPrice?: number;
        };
        entries: CartEntry[];
    }[];
};

function getCookies() {
    let cookies: { [name: string]: string } = {};
    for (let part of document.cookie.split("; ")) {
        let index = part.indexOf("=");
        if (index < 0) continue;
        cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
    }
    return cookies;
}

function getSession() {
    let cookies = getCookies();
    let storeId = cookies["last_selected_store"];
    let cartId = cookies["lcl-cart-id-banner"];
    if (!storeId) throw new Error(`Expected a last_selected_store cookie (pick a store on the site first), cookies present: ${Object.keys(cookies).join(", ")}`);
    if (!cartId) throw new Error(`Expected a lcl-cart-id-banner cookie, cookies present: ${Object.keys(cookies).join(", ")}`);
    return { storeId, cartId };
}

function getDateParam() {
    let now = new Date();
    return String(now.getDate()).padStart(2, "0") + String(now.getMonth() + 1).padStart(2, "0") + String(now.getFullYear());
}

async function apiRequest(config: { path: string; method: "GET" | "POST"; body?: unknown; keepalive?: boolean }): Promise<unknown> {
    let headers = await getSiteHeaders({ locale: LANG, banner: BANNER });
    let url = `${API_BASE}${config.path}`;
    let response = await fetch(url, {
        method: config.method,
        headers,
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
        keepalive: config.keepalive,
    });
    let text = await response.text();
    if (!response.ok) throw new Error(`Expected 2xx from ${config.method} ${url}, got ${response.status}: ${text.slice(0, ERROR_BODY_LIMIT)}`);
    return JSON.parse(text);
}

function entryToCartItem(entry: CartEntry): CartItem {
    let offer = entry.offer;
    let comparison = entry.prices?.comparisonPrices?.[0];
    return {
        comparisonPrice: comparison && `$${comparison.price.toFixed(2)}/${comparison.quantity}${comparison.unit}`,
        productId: offer.id,
        name: offer.product.name,
        brand: offer.product.brand,
        image: offer.product.primaryImage,
        unitPrice: entry.prices?.salePrice ?? offer.regularPrice ?? 0,
        pricingUnits: {
            type: offer.sellingType,
            unit: offer.sellingUnit.toLowerCase(),
            interval: offer.sellingIncrement,
            minOrderQuantity: offer.minOrderQuantity,
            maxOrderQuantity: offer.maxOrderQuantity,
            weighted: !!offer.product.weighted,
        },
        link: offer.webLink,
        creationTime: entry.creationTime,
    };
}

export function tileToCartItem(tile: ProductTile): CartItem {
    return {
        productId: tile.productId,
        name: tile.title,
        brand: tile.brand,
        image: tile.productImage?.[0]?.thumbnailUrl,
        unitPrice: parseFloat(tile.pricing.price) || 0,
        comparisonPrice: tile.packageSizing?.trim().startsWith("$") ? tile.packageSizing.trim() : tile.packageSizing?.split(",").slice(1).join(",").trim() || undefined,
        pricingUnits: tile.pricingUnits,
        link: tile.link,
    };
}

function cartToSnapshot(cart: CartResponse): CartSnapshot {
    let order = cart.orders[0];
    let cartFulfillment = order?.fulfillment?.type;
    if (cartFulfillment && cartFulfillment !== fulfillmentMethod) {
        console.log(`[Quick Shop] Cart fulfillment method changed from ${fulfillmentMethod} to ${cartFulfillment}`);
        fulfillmentMethod = cartFulfillment;
    }
    let quantities: CartQuantities = {};
    let items: CartItem[] = [];
    let totalPrice = 0;
    for (let cartOrder of cart.orders) {
        totalPrice += cartOrder.totals?.totalPrice || 0;
        for (let entry of cartOrder.entries) {
            quantities[entry.offer.id] = entry.quantity;
            items.push(entryToCartItem(entry));
        }
    }
    return {
        quantities,
        items,
        totalPrice,
        fulfillmentType: cartFulfillment,
        pickupLocationName: order?.fulfillment?.pickupBooking?.pickupLocation?.name,
    };
}

export async function searchProducts(config: { term: string; filters: SearchFilters; page: number }) {
    let { storeId, cartId } = getSession();
    let response = await apiRequest({
        path: "/v2/products/search",
        method: "POST",
        body: {
            cart: { cartId },
            fulfillmentInfo: { storeId, pickupType: PICKUP_TYPE, offerType: OFFER_TYPE, date: getDateParam(), timeSlot: undefined },
            listingInfo: { filters: config.filters, sort: {}, pagination: { from: config.page }, includeFiltersInResponse: true },
            banner: BANNER,
            searchRelatedInfo: { term: config.term, options: [] },
        },
    }) as SearchResponse;
    let seen = new Set<string>();
    let tiles: ProductTile[] = [];
    for (let component of response.layout?.sections?.mainContentCollection?.components || []) {
        for (let tile of component.data?.productTiles || []) {
            if (seen.has(tile.productId)) continue;
            seen.add(tile.productId);
            tiles.push(tile);
        }
    }
    let quickFilters: QuickFilter[] = [];
    for (let component of response.layout?.sections?.quickFiltersSection?.components || []) {
        for (let quickFilter of component.data?.quickFilters || []) {
            quickFilters.push({ name: quickFilter.name, group: quickFilter.filterGroup.code, values: quickFilter.filterGroup.values.map(value => value.code) });
        }
    }
    return {
        tiles,
        totalResults: response.searchResultsCount,
        hasMore: config.page * SEARCH_PAGE_SIZE < response.searchResultsCount,
        quickFilters,
    };
}

export async function getProductDetail(productId: string) {
    let { storeId } = getSession();
    let query = new URLSearchParams({ lang: LANG, date: getDateParam(), pickupType: PICKUP_TYPE, storeId, banner: BANNER });
    return await apiRequest({ path: `/v1/products/${encodeURIComponent(productId)}?${query}`, method: "GET" }) as ProductDetail;
}

export async function getCart() {
    let { cartId } = getSession();
    let cart = await apiRequest({ path: `/v1/carts/${cartId}`, method: "GET" }) as CartResponse;
    return cartToSnapshot(cart);
}

export async function setCartQuantity(config: { productId: string; quantity: number }) {
    let { cartId, storeId } = getSession();
    let response = await apiRequest({
        path: `/v1/carts/${cartId}`,
        method: "POST",
        keepalive: true,
        body: {
            entries: {
                [config.productId]: { quantity: config.quantity, fulfillmentMethod, sellerId: storeId },
            },
        },
    }) as { cart: CartResponse; errors?: unknown[] };
    if (response.errors?.length) throw new Error(`Expected no errors setting ${config.productId} to quantity ${config.quantity}, got ${JSON.stringify(response.errors).slice(0, ERROR_BODY_LIMIT)}`);
    return cartToSnapshot(response.cart);
}
