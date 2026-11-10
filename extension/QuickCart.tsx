import * as preact from "preact";
import { css } from "typesafecss";
import { observable } from "sliftutils/render-utils/mobxTyped";
import { observer } from "sliftutils/render-utils/observer";
import { CartItem, ProductDetail, ProductTile, QuickFilter, SearchFilters, getProductDetail, searchProducts, tileToCartItem } from "./zehrsApi";
import { cartState, changeQuantity, flushAll, getCartSummary, getDisplayedQuantity, hasUnsavedChange, refreshCart, removeFromRow, setCartAreaHovered } from "./cartSync";
import { formatMass, getCostPer100Grams, getUnitMassGrams, rememberDetailMass, rememberTileMasses } from "./productMass";

const MODAL_Z_INDEX = 2147483000;
const SUB_MODAL_Z_INDEX = 10;
const ACCENT = { h: 174, s: 72, l: 32 };
const REMOVE = { h: 4, s: 70, l: 42 };
const DETAILS = { h: 220, s: 15, l: 15 };
const OVERLAY_ALPHA = 0.72;
const OVERLAY_HOVER_ALPHA = 0.9;
const TILE_MIN_WIDTH = 170;
const GRID_GAP = 8;
const DETAIL_INFO_WIDTH = 380;
const TILE_FOCUS_OUTLINE_WIDTH = 3;
const TILE_FOCUS_OUTLINE = `${TILE_FOCUS_OUTLINE_WIDTH}px solid hsl(174, 72%, 32%)`;
const SPINNER_SIZE = 56;
const SPINNER_BORDER_WIDTH = 6;
const SPINNER_ANIMATION_NAME = "quick-cart-spin";
const CART_ROW_ITEM_WIDTH = 190;
const CART_ROW_IMAGE_WIDTH = 56;
const CART_ROW_BADGE_SPACE = 26;
const CART_ROW_NAME_LINE_HEIGHT = 15;
const CART_ROW_NAME_LINES = 3;
const CART_ROW_FOOTER_LINE_HEIGHT = 15;
const PRICE_BAR_THICKNESS = 5;
const PRICE_BAR_CONTENT_GAP = 3;
const PRICE_BACKGROUND_PADDING = 6;
const PRICE_BACKGROUND_ALPHA = 1;
const PRICE_BACKGROUND_TRACK_ALPHA = 1;
const PRICE_BAR_TRACK = { h: 240, s: 10, l: 22 };
const PRICE_BAR_STAGES = [
    { maxPer100Grams: 1, color: { h: 160, s: 70, l: 24 }, label: "green: up to $1" },
    { maxPer100Grams: 5, color: { h: 230, s: 60, l: 34 }, label: "blue: up to $5" },
    { maxPer100Grams: 20, color: { h: 345, s: 65, l: 38 }, label: "red: up to $20" },
];
const SAVINGS_DEAL_PATTERN = /^save\b/i;
const TILE_TEXT_GAP = 4;
const TILE_DESCRIPTION_GAP = 1;
const MODAL_LINE_HEIGHT = "1.1";
const MODAL_FONT_FAMILY = "Inter, \"Segoe UI\", Roboto, Arial, sans-serif";
const COST_ON_BAR_COLOR = { h: 0, s: 0, l: 76 };
const APPROXIMATE_PRICE_PREFIX = /^about\s+/i;
const CART_ROW_ITEM_HEIGHT = 92;
const SITE_ORIGIN = "https://www.zehrs.ca";
const CART_PAGE_URL = `${SITE_ORIGIN}/en/cartReview`;
const FLYER_FILTER_NAME = "Flyer Item";
const DIETARY_GROUP = "dietaryCallouts";
const DEFAULT_CATALOG_NAME = "Zehrs";
const LOAD_MORE_SCROLL_THRESHOLD_PX = 600;
const SEARCH_BORDER = "1px solid hsl(0, 0%, 70%)";
const NON_TEXT_INPUT_TYPES = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"];

const QUICK_FILTERS: QuickFilter[] = [
    { name: "Our Brands", group: "productBrand", values: ["N", "P", "PO"] },
    { name: "Deals", group: "promotions", values: ["Price Reduction", "$1,$2,$3,$4,$5", "Multi-Buy"] },
    { name: "Shop Canadian", group: "shopCanadian", values: ["prepared_in_canada"] },
    { name: FLYER_FILTER_NAME, group: "flyers", values: ["FLYER_ITEM"] },
];

const DIETARY_OPTIONS: [string, string][] = [
    ["vegan", "Vegan"],
    ["plant_based", "Plant Based"],
    ["gluten_free", "Gluten Free"],
    ["dairy_free", "Dairy Free"],
    ["organic", "Organic"],
    ["nut_free", "Nut Free"],
    ["peanut_free_allergen", "Peanut Free"],
    ["kosher", "Kosher"],
    ["halal", "Halal"],
    ["no_added_sugar", "No Added Sugar"],
    ["sugar_free", "Sugar Free"],
    ["low_in_sodium", "Low in Sodium"],
    ["low_in_fat", "Low in Fat"],
    ["source_of_protein", "Source of Protein"],
    ["high_fibre", "High Fibre"],
    ["whole_grain", "Whole Grain"],
    ["gmo_free", "GMO Free"],
];

export const quickCartState = observable({
    open: false,
    initialized: false,
    query: "",
    searching: false,
    loadingMore: false,
    searchedTerm: "",
    searchedFilterNames: [] as string[],
    searchedDefaultFlyers: false,
    pendingTerm: "",
    totalResults: 0,
    page: 1,
    hasMore: false,
    results: [] as ProductTile[],
    activeQuickFilters: {} as { [name: string]: boolean },
    dietary: "",
    knownFilterValues: {} as { [name: string]: string[] },
    cartExpanded: true,
    error: "",
    detailTile: undefined as ProductTile | undefined,
    detail: undefined as ProductDetail | undefined,
    detailLoading: false,
});

const pageScrollLockClasses = String(css.overflow("hidden", "important")).trim().split(/\s+/);

let searchInput: HTMLInputElement | undefined;
let detailReturnFocus: HTMLElement | undefined;

function focusSearchInputWhenRendered() {
    if (!quickCartState.open) return;
    if (searchInput && searchInput.isConnected) {
        searchInput.focus();
        return;
    }
    requestAnimationFrame(focusSearchInputWhenRendered);
}

function reportError(context: string, error: unknown) {
    console.error(`[Quick Shop] ${context}:`, (error as Error).stack ?? error);
    quickCartState.error = `${context}: ${(error as Error).message ?? String(error)}`;
}

function setPageScrollLocked(locked: boolean) {
    for (let element of [document.documentElement, document.body]) {
        if (locked) {
            element.classList.add(...pageScrollLockClasses);
        } else {
            element.classList.remove(...pageScrollLockClasses);
        }
    }
}

async function openModal() {
    quickCartState.open = true;
    quickCartState.error = "";
    setPageScrollLocked(true);
    focusSearchInputWhenRendered();
    if (!quickCartState.initialized) {
        quickCartState.initialized = true;
        void runSearch({ append: false });
    }
    await refreshCart();
}

function closeModal() {
    quickCartState.open = false;
    setPageScrollLocked(false);
    closeDetail();
    void flushAll();
}

function closeDetail() {
    if (!quickCartState.detailTile) return;
    quickCartState.detailTile = undefined;
    quickCartState.detail = undefined;
    let returnFocus = detailReturnFocus;
    detailReturnFocus = undefined;
    if (returnFocus && returnFocus.isConnected) {
        returnFocus.focus();
    }
}

async function goToCart() {
    await flushAll();
    window.location.href = CART_PAGE_URL;
}

function buildFilters(term: string) {
    let filters: SearchFilters = {};
    let names: string[] = [];
    let defaultFlyers = false;
    for (let quickFilter of QUICK_FILTERS) {
        if (!quickCartState.activeQuickFilters[quickFilter.name]) continue;
        filters[quickFilter.group] = quickCartState.knownFilterValues[quickFilter.name] || quickFilter.values;
        names.push(quickFilter.name);
    }
    if (quickCartState.dietary) {
        filters[DIETARY_GROUP] = [quickCartState.dietary];
        let option = DIETARY_OPTIONS.find(([code]) => code === quickCartState.dietary);
        names.push(option ? option[1] : quickCartState.dietary);
    }
    let flyerFilter = QUICK_FILTERS.find(quickFilter => quickFilter.name === FLYER_FILTER_NAME);
    if (!term && !names.length && flyerFilter) {
        filters[flyerFilter.group] = flyerFilter.values;
        defaultFlyers = true;
    }
    return { filters, names, defaultFlyers };
}

function rememberFilterValues(quickFilters: QuickFilter[]) {
    let known = { ...quickCartState.knownFilterValues };
    for (let quickFilter of quickFilters) {
        if (quickCartState.activeQuickFilters[quickFilter.name] || !quickFilter.values.length) continue;
        known[quickFilter.name] = quickFilter.values;
    }
    quickCartState.knownFilterValues = known;
}

async function runSearch(config: { append: boolean }) {
    let state = quickCartState;
    let term = config.append ? state.searchedTerm : state.query.trim();
    let page = config.append ? state.page + 1 : 1;
    let { filters, names, defaultFlyers } = buildFilters(term);
    if (config.append) {
        state.loadingMore = true;
    } else {
        state.pendingTerm = term;
        state.searching = true;
        closeDetail();
    }
    state.error = "";
    try {
        let response = await searchProducts({ term, filters, page });
        rememberFilterValues(response.quickFilters);
        rememberTileMasses(response.tiles);
        if (config.append) {
            let seen = new Set(state.results.map(tile => tile.productId));
            state.results = [...state.results, ...response.tiles.filter(tile => !seen.has(tile.productId))];
        } else {
            state.results = response.tiles;
        }
        state.page = page;
        state.hasMore = response.hasMore && response.tiles.length > 0;
        state.totalResults = response.totalResults;
        state.searchedTerm = term;
        state.searchedFilterNames = names;
        state.searchedDefaultFlyers = defaultFlyers;
    } catch (error) {
        reportError(`Search for "${term}" with filters ${JSON.stringify(filters)} page ${page} failed`, error);
    } finally {
        state.searching = false;
        state.loadingMore = false;
    }
}

function toggleQuickFilter(name: string) {
    quickCartState.activeQuickFilters = { ...quickCartState.activeQuickFilters, [name]: !quickCartState.activeQuickFilters[name] };
    void runSearch({ append: false });
}

async function openDetail(tile: ProductTile, returnFocus?: HTMLElement) {
    detailReturnFocus = returnFocus;
    quickCartState.detailTile = tile;
    quickCartState.detail = undefined;
    quickCartState.detailLoading = true;
    try {
        let detail = await getProductDetail(tile.productId);
        rememberDetailMass(detail);
        if (quickCartState.detailTile === tile) {
            quickCartState.detail = detail;
        }
    } catch (error) {
        reportError(`Loading ${tile.productId} failed`, error);
    } finally {
        quickCartState.detailLoading = false;
    }
}

function getDetailIndex() {
    let productId = quickCartState.detailTile?.productId;
    if (!productId) return -1;
    return quickCartState.results.findIndex(result => result.productId === productId);
}

async function moveDetail(offset: 1 | -1) {
    let state = quickCartState;
    let index = getDetailIndex();
    if (index < 0) return;
    let target = state.results[index + offset];
    if (!target && offset > 0 && state.hasMore && !state.loadingMore) {
        await runSearch({ append: true });
        target = state.results[index + offset];
    }
    if (!target) return;
    void openDetail(target, detailReturnFocus);
}

function formatQuantity(unit: string, quantity: number) {
    if (!unit || unit === "ea") return String(quantity);
    return `${quantity} ${unit}`;
}

function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
    return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(target.type);
}

function loadMoreIfAtBottom(scroller: HTMLElement) {
    let state = quickCartState;
    if (!state.hasMore || state.loadingMore || state.searching) return;
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - LOAD_MORE_SCROLL_THRESHOLD_PX) return;
    void runSearch({ append: true });
}

export function handleQuickCartKeyDown(event: KeyboardEvent) {
    if (!quickCartState.open) return;
    if (event.key === "Escape") {
        event.preventDefault();
        if (quickCartState.detailTile) {
            closeDetail();
            return;
        }
        closeModal();
        return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (quickCartState.detailTile && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !isTypingTarget(event.target)) {
        event.preventDefault();
        void moveDetail(event.key === "ArrowRight" ? 1 : -1);
        return;
    }
    if (event.key.length !== 1 && event.key !== "Backspace") return;
    if (!searchInput || event.target === searchInput || isTypingTarget(event.target)) return;
    if (quickCartState.detailTile) {
        closeDetail();
    }
    searchInput.focus();
}

const solidButton = css.bord(0, "transparent").pointer.fontWeight("bold").fontFamily("inherit").hslcolor(0, 0, 100);
const accentButton = solidButton + css.hsl(ACCENT.h, ACCENT.s, ACCENT.l).hslhover(ACCENT.h, ACCENT.s, ACCENT.l - 8);
const removeButton = solidButton + css.hsl(REMOVE.h, REMOVE.s, REMOVE.l).hslhover(REMOVE.h, REMOVE.s, REMOVE.l - 8);
const plainButton = css.bord(0, "transparent").pointer.fontFamily("inherit").hslcolor(0, 0, 10).hsl(0, 0, 93).hslhover(0, 0, 86);

@observer
export class QuickCartButton extends preact.Component {
    render() {
        return <button
            className={solidButton + css.height("100%").pad2(20, 0).fontSize(14).flexShrink0
                .hsl(ACCENT.h, ACCENT.s, ACCENT.l + 6).hslhover(ACCENT.h, ACCENT.s, ACCENT.l)
            }
            onClick={() => void openModal()}
        >
            Quick Shop
        </button>;
    }
}

function Price(props: { tile: ProductTile; withCostBar?: boolean }) {
    let { tile, withCostBar } = props;
    let dealText = getDealText(tile);
    return <div className={css.vbox(TILE_TEXT_GAP).alignItems("stretch")}>
        <div className={css.relative.hbox(6).alignItems("center") + (withCostBar && css.pad2(PRICE_BACKGROUND_PADDING, 2).overflowHidden.minWidth(0))}>
            {withCostBar && <PriceBar item={tileToCartItem(tile)} className={css.absolute.pos(0, 0).fillBoth} alpha={PRICE_BACKGROUND_ALPHA} trackAlpha={PRICE_BACKGROUND_TRACK_ALPHA} />}
            <span className={css.relative.fontWeight("bold").fontSize(15).whiteSpace("nowrap") + (withCostBar && css.hslcolor(0, 0, 100))}>
                {withCostBar ? tile.pricing.displayPrice.replace(APPROXIMATE_PRICE_PREFIX, "~") : tile.pricing.displayPrice}
            </span>
            {withCostBar && <span className={css.relative.marginLeft("auto").fontSize(11).whiteSpace("nowrap").hslcolor(COST_ON_BAR_COLOR.h, COST_ON_BAR_COLOR.s, COST_ON_BAR_COLOR.l)}>{formatUnitCost(tileToCartItem(tile))}</span>}
        </div>
        {!withCostBar && dealText && <span className={css.fontSize(12).opacity(0.75)}>{dealText}</span>}
    </div>;
}

function getDealText(tile: ProductTile) {
    let text = tile.deal?.text;
    if (!text || SAVINGS_DEAL_PATTERN.test(text)) return undefined;
    return text;
}

@observer
class QuantityBadge extends preact.Component<{ item: CartItem; showZero?: boolean }> {
    render() {
        let { item, showZero } = this.props;
        let quantity = getDisplayedQuantity(item.productId);
        if (!quantity && !showZero) return undefined;
        return <div className={css.absolute.top(0).right(0).zIndex(2).pointerEvents("none").pad2(10, 4).fontWeight("bold").hslcolor(0, 0, 100)
            + (quantity ? css.hsl(ACCENT.h, ACCENT.s, ACCENT.l) : css.hsl(REMOVE.h, REMOVE.s, REMOVE.l))
            + (hasUnsavedChange(item.productId) && css.opacity(0.7))
        }>
            {formatQuantity(item.pricingUnits.unit, quantity)}
        </div>;
    }
}

function packageSizeOnly(tile: ProductTile) {
    let size = tile.packageSizing?.split(",")[0].trim();
    if (!size || size.startsWith("$")) return undefined;
    return size;
}

function formatUnitCost(item: CartItem) {
    let costInfo = getCostPer100Grams(item);
    if (costInfo && !costInfo.massAssumed) return `$${costInfo.cost.toFixed(2)}/100g`;
    if (item.unitPrice) return `$${item.unitPrice.toFixed(2)}/ea`;
    return "";
}

@observer
class PriceBar extends preact.Component<{ item: CartItem; className: string; alpha: number; trackAlpha: number }> {
    render() {
        let { item, className, alpha, trackAlpha } = this.props;
        let costInfo = getCostPer100Grams(item);
        let cost = costInfo?.cost;
        let knownCost = cost || 0;
        let previousMax = 0;
        let title = !costInfo ? "Cost per 100 g unknown" : costInfo.massAssumed ? "Size unknown" : `$${costInfo.cost.toFixed(2)} per 100 g`;
        return <div
            title={title}
            className={css.hsla(PRICE_BAR_TRACK.h, PRICE_BAR_TRACK.s, PRICE_BAR_TRACK.l, trackAlpha) + className}
        >
            {cost !== undefined && PRICE_BAR_STAGES.map(stage => {
                let fraction = Math.min(1, Math.max(0, (knownCost - previousMax) / (stage.maxPer100Grams - previousMax)));
                previousMax = stage.maxPer100Grams;
                let percent = Math.round(fraction * 100);
                if (!percent) return undefined;
                return <div key={stage.label} className={css.absolute.left(0).top(0).height("100%").width(`${percent}%`).hsla(stage.color.h, stage.color.s, stage.color.l, alpha)} />;
            })}
        </div>;
    }
}

function OverlayLabel(props: { label: string; hint: string }) {
    return <span className={css.vbox(2).alignItems("center")}>
        <span>{props.label}</span>
        <span className={css.fontSize(12).opacity(0.8)}>{props.hint}</span>
    </span>;
}

@observer
class TileOverlay extends preact.Component<{ tile: ProductTile; tileElement?: HTMLElement }> {
    render() {
        let { tile, tileElement } = this.props;
        let item = tileToCartItem(tile);
        let quantity = getDisplayedQuantity(tile.productId);
        let half = solidButton + css.flexGrow(1).flexBasis(0).fontSize(18).display("flex").justifyContent("center").alignItems("center");
        let addClass = half + css.hsla(ACCENT.h, ACCENT.s, ACCENT.l, OVERLAY_ALPHA).hslahover(ACCENT.h, ACCENT.s, ACCENT.l, OVERLAY_HOVER_ALPHA);
        return <div className={css.absolute.pos(0, 0).fillBoth.zIndex(1).display("flex")}>
            <button
                tabIndex={-1}
                className={half + css.hsla(DETAILS.h, DETAILS.s, DETAILS.l, OVERLAY_ALPHA).hslahover(DETAILS.h, DETAILS.s, DETAILS.l, OVERLAY_HOVER_ALPHA)}
                onClick={() => void openDetail(tile, tileElement)}
            >
                <OverlayLabel label="Details" hint="(Enter)" />
            </button>
            <div className={css.flexGrow(1).flexBasis(0).display("flex").flexDirection("column")}>
                {!quantity && <button tabIndex={-1} className={addClass} onClick={() => changeQuantity(item, 1)}>
                    <OverlayLabel label="Add" hint="↑" />
                </button>}
                {!!quantity && <button tabIndex={-1} className={addClass} onClick={() => changeQuantity(item, 1)}>
                    <OverlayLabel label="+" hint="↑" />
                </button>}
                {!!quantity && <button
                    tabIndex={-1}
                    className={half + css.hsla(REMOVE.h, REMOVE.s, REMOVE.l, OVERLAY_ALPHA).hslahover(REMOVE.h, REMOVE.s, REMOVE.l, OVERLAY_HOVER_ALPHA)}
                    onClick={() => changeQuantity(item, -1)}
                >
                    <OverlayLabel label="−" hint="↓" />
                </button>}
            </div>
        </div>;
    }
}

@observer
class ResultTile extends preact.Component<{ tile: ProductTile }> {
    synced = observable({
        hovered: false,
        focused: false,
    });
    element: HTMLElement | undefined;

    render() {
        let { tile } = this.props;
        let image = tile.productImage?.[0];
        return <div
            tabIndex={0}
            ref={elem => this.element = elem || undefined}
            className={css.relative.vbox(TILE_TEXT_GAP).alignItems("stretch").minWidth(0).pad2(6, 8)
                .outline("none", "important").outline(TILE_FOCUS_OUTLINE, "focus", "important").outlineOffset(-TILE_FOCUS_OUTLINE_WIDTH)
            }
            onMouseEnter={() => this.synced.hovered = true}
            onMouseLeave={() => this.synced.hovered = false}
            onFocus={() => this.synced.focused = true}
            onBlur={() => this.synced.focused = false}
            onKeyDown={event => {
                if (event.target !== event.currentTarget) return;
                let item = tileToCartItem(tile);
                if (event.key === "ArrowUp") {
                    event.preventDefault();
                    changeQuantity(item, 1);
                } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    changeQuantity(item, -1);
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    void openDetail(tile, event.currentTarget);
                }
            }}
        >
            {image && <img src={image.smallUrl} className={css.width("100%")} />}
            <Price tile={tile} withCostBar />
            <div className={css.vbox(TILE_DESCRIPTION_GAP).alignItems("stretch")}>
                {getDealText(tile) && <span className={css.fontSize(12).opacity(0.75)}>{getDealText(tile)}</span>}
                {tile.brand && <span className={css.fontSize(12).opacity(0.7)}>{tile.brand}</span>}
                <span className={css.fontWeight("bold")}>{tile.title}</span>
                {packageSizeOnly(tile) && <span className={css.fontSize(12).opacity(0.7)}>{packageSizeOnly(tile)}</span>}
            </div>
            <QuantityBadge item={tileToCartItem(tile)} />
            {(this.synced.hovered || this.synced.focused) && <TileOverlay tile={tile} tileElement={this.element} />}
        </div>;
    }
}

@observer
class QuantityStepper extends preact.Component<{ item: CartItem; label?: string }> {
    render() {
        let { item, label } = this.props;
        let quantity = getDisplayedQuantity(item.productId);
        let unsaved = hasUnsavedChange(item.productId);
        return <div className={css.hbox(0)}>
            <button className={removeButton + css.pad2(14, 6).fontSize(16)} disabled={!quantity} onClick={() => changeQuantity(item, -1)}>−</button>
            <span className={css.pad2(12, 6).fontWeight("bold").whiteSpace("nowrap") + (unsaved && css.opacity(0.6))}>
                {formatQuantity(item.pricingUnits.unit, quantity)}{label}
            </span>
            <button className={accentButton + css.pad2(14, 6).fontSize(16)} onClick={() => changeQuantity(item, 1)}>+</button>
        </div>;
    }
}

@observer
class DetailSubModal extends preact.Component<{ tile: ProductTile }> {
    render() {
        let { tile } = this.props;
        let item = tileToCartItem(tile);
        let detail = quickCartState.detail;
        let detailImage = detail?.imageAssets?.[0];
        let tileImage = tile.productImage?.[0];
        let image = detailImage?.extraLargeUrl || detailImage?.imageUrl || tileImage?.extraLargeUrl || tileImage?.imageUrl || detailImage?.largeUrl || tileImage?.largeUrl;
        let quantity = getDisplayedQuantity(tile.productId);
        let detailIndex = getDetailIndex();
        let hasPrevious = detailIndex > 0;
        let hasNext = detailIndex >= 0 && (detailIndex < quickCartState.results.length - 1 || quickCartState.hasMore);
        return <div
            className={css.absolute.pos(0, 0).fillBoth.zIndex(SUB_MODAL_Z_INDEX).hsla(0, 0, 0, 0.4).display("flex").justifyContent("center").alignItems("center")}
            onClick={event => {
                if (event.target === event.currentTarget) closeDetail();
            }}
        >
            <div className={css.vbox(16).alignItems("stretch").width("94%").height("94%").pad2(24, 20).hsl(0, 0, 100)}>
                <div className={css.hbox(8)}>
                    <span className={css.flexGrow(1).fontSize(22).fontWeight("bold")}>{tile.title}</span>
                    <span className={css.opacity(0.7).whiteSpace("nowrap")}>{detailIndex + 1} of {quickCartState.totalResults}</span>
                    <button className={plainButton + css.pad2(16, 8).fontSize(14).whiteSpace("nowrap")} disabled={!hasPrevious} onClick={() => void moveDetail(-1)}>← Previous</button>
                    <button className={plainButton + css.pad2(16, 8).fontSize(14).whiteSpace("nowrap")} disabled={!hasNext} onClick={() => void moveDetail(1)}>Next →</button>
                    <button className={plainButton + css.pad2(16, 8).fontSize(14).whiteSpace("nowrap")} onClick={closeDetail}>Close (ESC)</button>
                </div>
                <div className={css.hbox(28).alignItems("stretch").flexGrow(1).minHeight(0)}>
                    <div className={css.flexGrow(1).minWidth(0).display("flex").justifyContent("center").alignItems("center")}>
                        {image && <img src={image} className={css.maxWidth("100%").maxHeight("100%")} />}
                    </div>
                    <div className={css.vbox(10).width(DETAIL_INFO_WIDTH).flexShrink0.overflowAuto}>
                        {tile.brand && <span className={css.opacity(0.7)}>{tile.brand}</span>}
                        {tile.packageSizing && <span className={css.opacity(0.7)}>{tile.packageSizing}</span>}
                        <Price tile={tile} />
                        {!quantity && <button className={accentButton + css.pad2(18, 8).fontSize(16)} onClick={() => changeQuantity(item, 1)}>Add to cart</button>}
                        {!!quantity && <QuantityStepper item={item} label=" in cart" />}
                        {quickCartState.detailLoading && <span>Loading details...</span>}
                        {detail?.description && <div dangerouslySetInnerHTML={{ __html: detail.description }} />}
                        {detail?.ingredients && <div><b>Ingredients:</b> {detail.ingredients}</div>}
                        <a href={SITE_ORIGIN + tile.link} target="_blank">Open full product page</a>
                    </div>
                </div>
            </div>
        </div>;
    }
}

@observer
class CartRowOverlay extends preact.Component<{ item: CartItem }> {
    render() {
        let { item } = this.props;
        let quantity = getDisplayedQuantity(item.productId);
        let half = solidButton + css.flexGrow(1).flexBasis(0).fontSize(18).display("flex").justifyContent("center").alignItems("center");
        let removeClass = half + css.hsla(REMOVE.h, REMOVE.s, REMOVE.l, OVERLAY_ALPHA).hslahover(REMOVE.h, REMOVE.s, REMOVE.l, OVERLAY_HOVER_ALPHA);
        return <div className={css.absolute.pos(0, 0).fillBoth.zIndex(1).display("flex")}>
            {!!quantity && <button tabIndex={-1} className={removeClass} onClick={() => changeQuantity(item, -1)}>
                <OverlayLabel label="−" hint="↓" />
            </button>}
            {!quantity && <button tabIndex={-1} className={removeClass} onClick={() => removeFromRow(item.productId)}>
                <OverlayLabel label="Remove" hint="(Delete)" />
            </button>}
            <button
                tabIndex={-1}
                className={half + css.hsla(ACCENT.h, ACCENT.s, ACCENT.l, OVERLAY_ALPHA).hslahover(ACCENT.h, ACCENT.s, ACCENT.l, OVERLAY_HOVER_ALPHA)}
                onClick={() => changeQuantity(item, 1)}
            >
                <OverlayLabel label="+" hint="↑" />
            </button>
        </div>;
    }
}

@observer
class CartRowItem extends preact.Component<{ item: CartItem }> {
    synced = observable({
        hovered: false,
        focused: false,
    });

    render() {
        let { item } = this.props;
        let quantity = getDisplayedQuantity(item.productId);
        let unitGrams = getUnitMassGrams(item);
        let massText = unitGrams === undefined ? "Size unknown" : formatMass(unitGrams * (quantity || 1));
        let totalPrice = item.unitPrice * (quantity || 1);
        let unitCostText = formatUnitCost(item);
        let tooltip = [
            item.name,
            item.brand,
            item.unitPrice ? `$${item.unitPrice.toFixed(2)} each` : undefined,
            item.comparisonPrice,
            unitGrams === undefined ? undefined : `${formatMass(unitGrams)} each${quantity > 1 ? `, ${formatMass(unitGrams * quantity)} total` : ""}`,
        ].filter(line => !!line).join("\n");
        let dimmed = !quantity && css.opacity(0.55);
        return <div
            tabIndex={0}
            title={tooltip}
            className={css.relative.width(CART_ROW_ITEM_WIDTH).height(CART_ROW_ITEM_HEIGHT).overflowHidden.flexShrink0.hbox(8).alignItems("stretch").pad2(8, 6).paddingBottom(PRICE_BAR_THICKNESS + PRICE_BAR_CONTENT_GAP).hsl(0, 0, 97)
                .outline("none", "important").outline(TILE_FOCUS_OUTLINE, "focus", "important").outlineOffset(-TILE_FOCUS_OUTLINE_WIDTH)
            }
            onMouseEnter={() => this.synced.hovered = true}
            onMouseLeave={() => this.synced.hovered = false}
            onFocus={() => this.synced.focused = true}
            onBlur={() => this.synced.focused = false}
            onKeyDown={event => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ArrowUp") {
                    event.preventDefault();
                    changeQuantity(item, 1);
                } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    changeQuantity(item, -1);
                } else if (event.key === "Delete" && !quantity) {
                    event.preventDefault();
                    removeFromRow(item.productId);
                }
            }}
        >
            <div className={css.vbox(0).alignItems("center").justifyContent("space-between").width(CART_ROW_IMAGE_WIDTH).flexShrink0 + dimmed}>
                {item.image && <img src={item.image} className={css.width(CART_ROW_IMAGE_WIDTH)} />}
                <span className={css.fontSize(11).lineHeight(`${CART_ROW_FOOTER_LINE_HEIGHT}px`).opacity(0.7).textAlign("center")}>{massText}</span>
            </div>
            <div className={css.vbox(0).alignItems("stretch").flexGrow(1).minWidth(0) + dimmed}>
                <div className={css.vbox(0).minWidth(0).paddingRight(CART_ROW_BADGE_SPACE)}>
                    {item.brand && <span className={css.fontSize(11).lineHeight(`${CART_ROW_FOOTER_LINE_HEIGHT - 2}px`).opacity(0.7).ellipsis}>{item.brand}</span>}
                    <span className={css.fontSize(12).fontWeight("bold").lineHeight(`${CART_ROW_NAME_LINE_HEIGHT}px`).maxHeight(CART_ROW_NAME_LINE_HEIGHT * CART_ROW_NAME_LINES).overflowHidden}>{item.name}</span>
                </div>
                <span className={css.marginTop("auto").lineHeight(`${CART_ROW_FOOTER_LINE_HEIGHT}px`).textAlign("center").whiteSpace("nowrap").overflowHidden}>
                    <span className={css.fontSize(12).fontWeight("bold").hslcolor(ACCENT.h, ACCENT.s, ACCENT.l)}>${totalPrice.toFixed(2)}</span>
                    <span className={css.fontSize(10).opacity(0.7)}> {unitCostText}</span>
                </span>
            </div>
            <PriceBar item={item} className={css.absolute.left(0).right(0).bottom(0).height(PRICE_BAR_THICKNESS).zIndex(3)} alpha={1} trackAlpha={1} />
            <QuantityBadge item={item} showZero />
            {(this.synced.hovered || this.synced.focused) && <CartRowOverlay item={item} />}
        </div>;
    }
}

@observer
class CartRow extends preact.Component {
    render() {
        let items = cartState.rowOrder.map(productId => cartState.items[productId]).filter(item => !!item);
        return <div
            className={css.hbox(8).alignItems("stretch").overflowX("auto").overflowY("hidden").flexShrink0.padv(4)}
            onWheel={event => {
                if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
                event.preventDefault();
                event.currentTarget.scrollLeft += event.deltaY;
            }}
            onMouseEnter={() => setCartAreaHovered(true)}
            onMouseLeave={() => setCartAreaHovered(false)}
        >
            {!items.length && <span className={css.opacity(0.7).pad2(8)}>{cartState.loaded ? "Your cart is empty" : "Loading cart..."}</span>}
            {items.map(item => <CartRowItem key={item.productId} item={item} />)}
        </div>;
    }
}

@observer
class CartIndicator extends preact.Component {
    render() {
        let { itemCount, totalPrice, totalGrams, unknownMassCount } = getCartSummary();
        let massText = formatMass(totalGrams) + (unknownMassCount ? ` + ${unknownMassCount} unknown` : "");
        let expanded = quickCartState.cartExpanded;
        return <div
            className={css.hbox(0).alignItems("stretch").flexShrink0}
            onMouseEnter={() => setCartAreaHovered(true)}
            onMouseLeave={() => setCartAreaHovered(false)}
        >
            <button className={accentButton + css.pad2(16, 10).fontSize(15).whiteSpace("nowrap")} onClick={() => void goToCart()}>
                {cartState.loaded ? `${itemCount} ${itemCount === 1 ? "item" : "items"} · $${totalPrice.toFixed(2)} · ${massText}` : "Loading..."}
            </button>
            <button
                className={accentButton + css.pad2(12, 10).fontSize(15).borderLeft("1px solid hsla(0, 0%, 100%, 0.35)")}
                onClick={() => quickCartState.cartExpanded = !expanded}
            >
                {expanded ? "▴" : "▾"}
            </button>
        </div>;
    }
}

@observer
class FilterBar extends preact.Component {
    render() {
        let state = quickCartState;
        return <div className={css.hbox(16).wrap}>
            {QUICK_FILTERS.map(quickFilter => <label key={quickFilter.name} className={css.hbox(6).pointer.pad2(10, 6).bord2(0, 0, 80) + (state.activeQuickFilters[quickFilter.name] && css.hsl(ACCENT.h, 40, 92))}>
                <input
                    type="checkbox"
                    checked={!!state.activeQuickFilters[quickFilter.name]}
                    onChange={() => toggleQuickFilter(quickFilter.name)}
                />
                {quickFilter.name}
            </label>)}
            <label className={css.hbox(6).pad2(10, 6).bord2(0, 0, 80) + (state.dietary && css.hsl(ACCENT.h, 40, 92))}>
                Dietary
                <select
                    className={css.fontFamily("inherit").fontSize(14)}
                    value={state.dietary}
                    onChange={event => {
                        state.dietary = event.currentTarget.value;
                        void runSearch({ append: false });
                    }}
                >
                    <option value="">Any</option>
                    {DIETARY_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
            </label>
        </div>;
    }
}

@observer
class ResultsView extends preact.Component {
    render() {
        let state = quickCartState;
        if (state.searching) {
            return <div className={css.vbox(20).alignItems("center").justifyContent("center").fillBoth}>
                <style>{`@keyframes ${SPINNER_ANIMATION_NAME} { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                <div className={css.size(SPINNER_SIZE, SPINNER_SIZE)
                    .border(`${SPINNER_BORDER_WIDTH}px solid hsl(0, 0%, 88%)`).borderTop(`${SPINNER_BORDER_WIDTH}px solid hsl(${ACCENT.h}, ${ACCENT.s}%, ${ACCENT.l}%)`)
                    .animation(`${SPINNER_ANIMATION_NAME} 0.9s linear infinite`)
                } />
                <span className={css.fontSize(26).fontWeight("bold")}>
                    {state.pendingTerm ? `Searching for "${state.pendingTerm}"...` : "Loading flyer items..."}
                </span>
            </div>;
        }
        if (!state.results.length && !state.searchedTerm && !state.searchedFilterNames.length && !state.searchedDefaultFlyers) return undefined;
        let what = state.searchedTerm ? `results for "${state.searchedTerm}"` : state.searchedDefaultFlyers ? "flyer items" : "items";
        let filterText = state.searchedFilterNames.length ? ` · ${state.searchedFilterNames.join(", ")}` : "";
        return <div className={css.vbox(10).alignItems("stretch")}>
            <span className={css.opacity(0.7)}>{state.results.length} shown of {state.totalResults} {what}{filterText}</span>
            <div className={css.display("grid").gridTemplateColumns(`repeat(auto-fill, minmax(${TILE_MIN_WIDTH}px, 1fr))`).gap(GRID_GAP)}>
                {state.results.map(tile => <ResultTile key={tile.productId} tile={tile} />)}
            </div>
            {state.hasMore && <button
                className={plainButton + css.pad2(16, 12).fontSize(15).alignSelf("center")}
                disabled={state.loadingMore}
                onClick={() => void runSearch({ append: true })}
            >
                {state.loadingMore ? `Loading more... (${state.results.length} of ${state.totalResults})` : `Load more (${state.results.length} of ${state.totalResults})`}
            </button>}
        </div>;
    }
}

@observer
export class QuickCartModal extends preact.Component {
    render() {
        let state = quickCartState;
        if (!state.open) return undefined;
        let error = state.error || cartState.error;
        let catalogName = cartState.pickupLocationName || DEFAULT_CATALOG_NAME;
        return <div
            className={css.fixed.pos(0, 0).size("100vw", "100vh").zIndex(MODAL_Z_INDEX).hsla(0, 0, 0, 0.5).display("flex").justifyContent("center").alignItems("center")}
            onClick={event => {
                if (event.target === event.currentTarget) closeModal();
            }}
        >
            <div className={css.relative.vbox(12).alignItems("stretch").pad2(20, 16).hsl(0, 0, 100).hslcolor(0, 0, 10).width("96vw").height("92vh").fontSize(14).lineHeight(MODAL_LINE_HEIGHT).fontFamily(MODAL_FONT_FAMILY)}>
                <div className={css.hbox(8).alignItems("stretch")}>
                    <span className={css.display("flex").alignItems("center").fontSize(16).fontWeight("bold").whiteSpace("nowrap")}>{catalogName}</span>
                    <input
                        className={css.flexGrow(1).minWidth(0).pad2(12, 10).fontSize(16).fontFamily("inherit").hsl(0, 0, 100).hslcolor(0, 0, 10)
                            .border(SEARCH_BORDER, "important").borderRadius(0, "important").outline("none", "important").boxShadow("none", "important")
                            .border(SEARCH_BORDER, "focus", "important").outline("none", "focus", "important").boxShadow("none", "focus", "important")
                        }
                        placeholder={`Search ${catalogName}`}
                        value={state.query}
                        ref={elem => searchInput = elem || undefined}
                        onInput={event => state.query = event.currentTarget.value}
                        onKeyDown={event => {
                            if (event.key === "Enter") void runSearch({ append: false });
                        }}
                    />
                    <button className={accentButton + css.pad2(20, 10).fontSize(15).whiteSpace("nowrap")} onClick={() => void runSearch({ append: false })}>
                        Search (Enter)
                    </button>
                    <CartIndicator />
                    <button className={plainButton + css.pad2(20, 10).fontSize(15).whiteSpace("nowrap")} onClick={closeModal}>
                        Close (ESC)
                    </button>
                </div>
                {state.cartExpanded && <CartRow />}
                <FilterBar />
                {error && <div className={css.hslcolor(REMOVE.h, REMOVE.s, REMOVE.l)}>{error}</div>}
                <div className={css.flexGrow(1).minHeight(0).overflowAuto} onScroll={event => loadMoreIfAtBottom(event.currentTarget)}>
                    <ResultsView />
                </div>
                {state.detailTile && <DetailSubModal tile={state.detailTile} />}
            </div>
        </div>;
    }
}
