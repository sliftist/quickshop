import { observable } from "sliftutils/render-utils/mobxTyped";
import { CartItem, PricingUnits, ProductDetail, ProductTile, getProductDetail } from "./zehrsApi";

const STORAGE_KEY = "quickShop.productMassGrams.v1";
const MAX_CONCURRENT_DETAIL_FETCHES = 4;
const GRAMS_PER_UNIT: { [unit: string]: number } = {
    mg: 0.001,
    g: 1,
    kg: 1000,
    ml: 1,
    l: 1000,
    lb: 453.592,
    oz: 28.3495,
};
const PACKAGE_SIZE_PATTERN = /^\s*(?:(\d+(?:\.\d+)?)\s*x\s*)?(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|l|lb|oz)\b/i;
const COMPARISON_PRICE_PATTERN = /\$(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)?\s*(mg|kg|g|ml|l|lb|oz)\b/i;
const GRAMS_PER_HUNDRED = 100;
const ASSUMED_UNKNOWN_MASS_GRAMS = 100;
const SOLD_BY_WEIGHT_TYPE = "SOLD_BY_WEIGHT";
const MASS_DECIMALS_KG = 2;

export const productMassState = observable({
    gramsPerUnit: loadStoredMasses(),
    unknown: {} as { [productId: string]: boolean },
});

let fetching = new Set<string>();

function loadStoredMasses() {
    if (typeof localStorage === "undefined") return {} as { [productId: string]: number };
    try {
        let stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return {} as { [productId: string]: number };
        return JSON.parse(stored) as { [productId: string]: number };
    } catch (error) {
        console.error(`[Quick Shop] Reading cached product sizes from localStorage failed:`, (error as Error).stack ?? error);
        return {} as { [productId: string]: number };
    }
}

function storeMasses() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(productMassState.gramsPerUnit));
    } catch (error) {
        console.error(`[Quick Shop] Writing cached product sizes to localStorage failed:`, (error as Error).stack ?? error);
    }
}

export function parsePackageMassGrams(text: string | undefined) {
    if (!text) return undefined;
    let match = PACKAGE_SIZE_PATTERN.exec(text.split(",")[0]);
    if (!match) return undefined;
    let count = match[1] ? parseFloat(match[1]) : 1;
    let amount = parseFloat(match[2]);
    let gramsPerUnit = GRAMS_PER_UNIT[match[3].toLowerCase()];
    if (!gramsPerUnit || !(count * amount)) return undefined;
    return count * amount * gramsPerUnit;
}

function gramsPerQuantityUnit(pricingUnits: PricingUnits) {
    if (pricingUnits.type !== SOLD_BY_WEIGHT_TYPE) return undefined;
    return GRAMS_PER_UNIT[pricingUnits.unit.toLowerCase()];
}

function rememberMass(productId: string, grams: number | undefined) {
    if (!grams || productMassState.gramsPerUnit[productId] === grams) return;
    productMassState.gramsPerUnit = { ...productMassState.gramsPerUnit, [productId]: grams };
    storeMasses();
}

export function rememberTileMasses(tiles: ProductTile[]) {
    let updated = { ...productMassState.gramsPerUnit };
    let changed = false;
    for (let tile of tiles) {
        let grams = parsePackageMassGrams(tile.packageSizing);
        if (!grams || updated[tile.productId] === grams) continue;
        updated[tile.productId] = grams;
        changed = true;
    }
    if (!changed) return;
    productMassState.gramsPerUnit = updated;
    storeMasses();
}

export function rememberDetailMass(detail: ProductDetail) {
    let grams = parsePackageMassGrams(detail.packageSize);
    if (!grams && detail.averageWeight) {
        let average = parseFloat(detail.averageWeight);
        let unitGrams = GRAMS_PER_UNIT[(detail.uom || "").toLowerCase()];
        if (average && unitGrams) {
            grams = average * unitGrams;
        }
    }
    if (!grams) {
        productMassState.unknown = { ...productMassState.unknown, [detail.code]: true };
        return;
    }
    rememberMass(detail.code, grams);
}

export function getUnitMassGrams(item: { productId: string; pricingUnits: PricingUnits }) {
    return gramsPerQuantityUnit(item.pricingUnits) ?? productMassState.gramsPerUnit[item.productId];
}

export function parseComparisonPricePer100Grams(text: string | undefined) {
    if (!text) return undefined;
    let match = COMPARISON_PRICE_PATTERN.exec(text);
    if (!match) return undefined;
    let price = parseFloat(match[1]);
    let amount = match[2] ? parseFloat(match[2]) : 1;
    let gramsPerUnit = GRAMS_PER_UNIT[match[3].toLowerCase()];
    if (!gramsPerUnit || !amount) return undefined;
    return price / (amount * gramsPerUnit) * GRAMS_PER_HUNDRED;
}

export function getCostPer100Grams(item: { productId: string; pricingUnits: PricingUnits; unitPrice: number; comparisonPrice?: string }) {
    let fromComparison = parseComparisonPricePer100Grams(item.comparisonPrice);
    if (fromComparison !== undefined) return { cost: fromComparison, massAssumed: false };
    if (!item.unitPrice) return undefined;
    let grams = getUnitMassGrams(item);
    if (!grams) return { cost: item.unitPrice / ASSUMED_UNKNOWN_MASS_GRAMS * GRAMS_PER_HUNDRED, massAssumed: true };
    return { cost: item.unitPrice / grams * GRAMS_PER_HUNDRED, massAssumed: false };
}

export function formatMass(grams: number) {
    if (grams < GRAMS_PER_UNIT.kg) return `${Math.round(grams)} g`;
    return `${parseFloat((grams / GRAMS_PER_UNIT.kg).toFixed(MASS_DECIMALS_KG))} kg`;
}

export async function ensureMasses(items: CartItem[]) {
    let missing = items.filter(item => getUnitMassGrams(item) === undefined && !productMassState.unknown[item.productId] && !fetching.has(item.productId));
    if (!missing.length) return;
    for (let item of missing) {
        fetching.add(item.productId);
    }
    console.log(`[Quick Shop] Fetching package sizes for ${missing.length} cart item(s) not in the size cache: ${missing.map(item => item.productId).join(", ")}`);
    let queue = [...missing];
    async function worker() {
        while (true) {
            let item = queue.shift();
            if (!item) return;
            try {
                rememberDetailMass(await getProductDetail(item.productId));
            } catch (error) {
                console.error(`[Quick Shop] Fetching the package size of ${item.productId} (${item.name}) failed:`, (error as Error).stack ?? error);
            } finally {
                fetching.delete(item.productId);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_DETAIL_FETCHES, missing.length) }, worker));
}
