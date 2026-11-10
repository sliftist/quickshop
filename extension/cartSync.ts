import { observable } from "sliftutils/render-utils/mobxTyped";
import { sort } from "socket-function/src/misc";
import { CartItem, CartQuantities, CartSnapshot, getCart, setCartQuantity } from "./zehrsApi";
import { ensureMasses, getUnitMassGrams } from "./productMass";

const FLUSH_DELAY_MS = 5000;
const ZERO_ITEM_LINGER_MS = 15000;
const QUANTITY_PRECISION = 1000;

export const cartState = observable({
    confirmed: {} as CartQuantities,
    desired: {} as { [productId: string]: number },
    saving: {} as { [productId: string]: boolean },
    items: {} as { [productId: string]: CartItem },
    rowOrder: [] as string[],
    serverTotalPrice: 0,
    fulfillmentType: "",
    pickupLocationName: "",
    loaded: false,
    areaHovered: false,
    error: "",
});

let flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
let flushChains = new Map<string, Promise<void>>();
let lastEditedProductId: string | undefined;
let pruneTimer: ReturnType<typeof setTimeout> | undefined;

function log(message: string) {
    console.log(`[Quick Shop] [${new Date().toISOString()}] ${message}`);
}

function withoutKey<T>(record: { [key: string]: T }, key: string) {
    let copy = { ...record };
    delete copy[key];
    return copy;
}

function applySnapshot(snapshot: CartSnapshot) {
    cartState.confirmed = snapshot.quantities;
    let items = { ...cartState.items };
    for (let item of snapshot.items) {
        items[item.productId] = item;
    }
    cartState.items = items;
    let newestFirst = sort([...snapshot.items], item => -(Date.parse(item.creationTime || "") || 0));
    let newIds = newestFirst.map(item => item.productId).filter(productId => !cartState.rowOrder.includes(productId) && getDisplayedQuantity(productId) > 0);
    if (newIds.length) {
        cartState.rowOrder = [...newIds, ...cartState.rowOrder];
    }
    cartState.serverTotalPrice = snapshot.totalPrice;
    cartState.fulfillmentType = snapshot.fulfillmentType || "";
    cartState.pickupLocationName = snapshot.pickupLocationName || "";
    cartState.loaded = true;
    void ensureMasses(snapshot.items);
}

function rememberItem(item: CartItem) {
    if (!cartState.items[item.productId]) {
        cartState.items = { ...cartState.items, [item.productId]: item };
    }
    if (!cartState.rowOrder.includes(item.productId)) {
        cartState.rowOrder = [item.productId, ...cartState.rowOrder];
    }
}

export function getDisplayedQuantity(productId: string) {
    let desired = cartState.desired[productId];
    if (desired !== undefined) return desired;
    return cartState.confirmed[productId] || 0;
}

export function hasUnsavedChange(productId: string) {
    return cartState.desired[productId] !== undefined || !!cartState.saving[productId];
}

export function getCartSummary() {
    let productIds = new Set([...Object.keys(cartState.confirmed), ...Object.keys(cartState.desired)]);
    let itemCount = 0;
    let totalPrice = cartState.serverTotalPrice;
    let totalGrams = 0;
    let unknownMassCount = 0;
    for (let productId of productIds) {
        let quantity = getDisplayedQuantity(productId);
        let item = cartState.items[productId];
        itemCount += item?.pricingUnits.weighted ? (quantity > 0 ? 1 : 0) : quantity;
        let unitGrams = item && getUnitMassGrams(item);
        if (quantity > 0 && unitGrams === undefined) {
            unknownMassCount++;
        } else if (unitGrams) {
            totalGrams += unitGrams * quantity;
        }
        let desired = cartState.desired[productId];
        if (desired !== undefined) {
            totalPrice += (desired - (cartState.confirmed[productId] || 0)) * (item?.unitPrice || 0);
        }
    }
    return { itemCount: Math.round(itemCount), totalPrice: Math.max(0, totalPrice), totalGrams, unknownMassCount };
}

export async function refreshCart() {
    try {
        applySnapshot(await getCart());
    } catch (error) {
        console.error(`[Quick Shop] Loading cart failed:`, (error as Error).stack ?? error);
        cartState.error = `Loading cart failed: ${(error as Error).message ?? String(error)}`;
    }
}

function pruneZeroItems() {
    pruneTimer = undefined;
    let kept = cartState.rowOrder.filter(productId => getDisplayedQuantity(productId) > 0 || hasUnsavedChange(productId));
    let removed = cartState.rowOrder.filter(productId => !kept.includes(productId));
    if (removed.length) {
        log(`Removed zero-quantity items from the cart row after ${ZERO_ITEM_LINGER_MS}ms away from it: ${removed.join(", ")}`);
        cartState.rowOrder = kept;
    }
}

function schedulePrune() {
    if (pruneTimer) {
        clearTimeout(pruneTimer);
    }
    pruneTimer = setTimeout(pruneZeroItems, ZERO_ITEM_LINGER_MS);
}

export function setCartAreaHovered(hovered: boolean) {
    cartState.areaHovered = hovered;
    if (hovered) {
        if (pruneTimer) {
            clearTimeout(pruneTimer);
            pruneTimer = undefined;
        }
        return;
    }
    schedulePrune();
}

export function changeQuantity(item: CartItem, direction: 1 | -1) {
    let productId = item.productId;
    let { minOrderQuantity, maxOrderQuantity, interval } = item.pricingUnits;
    let current = getDisplayedQuantity(productId);
    let next = current ? current + direction * interval : direction > 0 ? minOrderQuantity : 0;
    if (next < minOrderQuantity) {
        next = 0;
    }
    next = Math.round(Math.min(next, maxOrderQuantity) * QUANTITY_PRECISION) / QUANTITY_PRECISION;
    if (next === current) return;

    rememberItem(item);
    if (lastEditedProductId && lastEditedProductId !== productId) {
        void flushProduct(lastEditedProductId);
    }
    lastEditedProductId = productId;
    cartState.error = "";
    cartState.desired = { ...cartState.desired, [productId]: next };
    if (!next && !cartState.areaHovered) {
        schedulePrune();
    }

    let existingTimer = flushTimers.get(productId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    flushTimers.set(productId, setTimeout(() => void flushProduct(productId), FLUSH_DELAY_MS));
}

export function removeFromRow(productId: string) {
    cartState.rowOrder = cartState.rowOrder.filter(id => id !== productId);
    void flushProduct(productId);
}

export function flushProduct(productId: string) {
    let timer = flushTimers.get(productId);
    if (timer) {
        clearTimeout(timer);
        flushTimers.delete(productId);
    }
    let previous = flushChains.get(productId) || Promise.resolve();
    let chain = previous.then(() => sendDesiredQuantity(productId));
    flushChains.set(productId, chain);
    return chain;
}

export async function flushAll() {
    let productIds = new Set([...flushTimers.keys(), ...Object.keys(cartState.desired)]);
    await Promise.all([...productIds].map(flushProduct));
}

async function sendDesiredQuantity(productId: string) {
    let quantity = cartState.desired[productId];
    if (quantity === undefined) return;
    let before = cartState.confirmed[productId] || 0;
    if (quantity === before) {
        cartState.desired = withoutKey(cartState.desired, productId);
        return;
    }
    cartState.saving = { ...cartState.saving, [productId]: true };
    log(`Saving ${productId}: cart quantity ${before} -> ${quantity}`);
    try {
        let snapshot = await setCartQuantity({ productId, quantity });
        applySnapshot(snapshot);
        log(`Saved ${productId}: requested ${quantity}, cart now has ${snapshot.quantities[productId] || 0}, cart total $${snapshot.totalPrice.toFixed(2)}`);
    } catch (error) {
        console.error(`[Quick Shop] Saving ${productId} from ${before} to ${quantity} failed:`, (error as Error).stack ?? error);
        cartState.error = `Saving ${productId} (${before} -> ${quantity}) failed: ${(error as Error).message ?? String(error)}`;
    } finally {
        if (cartState.desired[productId] === quantity) {
            cartState.desired = withoutKey(cartState.desired, productId);
        }
        cartState.saving = withoutKey(cartState.saving, productId);
    }
}
