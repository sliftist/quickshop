import * as preact from "preact";
import { css } from "typesafecss";
import { isInBrowser } from "sliftutils/misc/environment";
import { configureMobxNextFrameScheduler } from "sliftutils/render-utils/mobxTyped";
import { QuickCartButton, QuickCartModal, handleQuickCartKeyDown } from "./QuickCart";
import { flushAll } from "./cartSync";

const NAV_BAR_RIGHT_END_SELECTORS = [
    "[data-testid=\"iceberg-menu-bar\"] [data-testid=\"iceberg-masthead-right\"] > div",
    ".site-header .menu-bar",
];
const PLACEMENT_CHECK_INTERVAL_MS = 1000;
const FALLBACK_OFFSET_PX = 12;
const FALLBACK_Z_INDEX = 2147482000;
const FALLBACK_PLACEMENT = "fixed top-right fallback";

function findNavBarRightEnd() {
    for (let selector of NAV_BAR_RIGHT_END_SELECTORS) {
        let matches = document.querySelectorAll(selector);
        let container = matches[matches.length - 1];
        if (container) return { selector, container };
    }
    return undefined;
}

function main() {
    if (!isInBrowser()) return;
    configureMobxNextFrameScheduler();

    let buttonRoot = document.createElement("div");
    buttonRoot.className = String(css.display("flex").alignItems("stretch").alignSelf("stretch").flexShrink0);
    let fallbackClasses = String(css.fixed.right(FALLBACK_OFFSET_PX).top(FALLBACK_OFFSET_PX).zIndex(FALLBACK_Z_INDEX)).trim().split(/\s+/);
    preact.render(<QuickCartButton />, buttonRoot);

    let modalRoot = document.createElement("div");
    document.body.appendChild(modalRoot);
    window.addEventListener("focusin", event => {
        if (event.target instanceof Node && modalRoot.contains(event.target)) {
            event.stopImmediatePropagation();
        }
    }, true);
    window.addEventListener("focusout", event => {
        if (event.relatedTarget instanceof Node && modalRoot.contains(event.relatedTarget)) {
            event.stopImmediatePropagation();
        }
    }, true);
    preact.render(<QuickCartModal />, modalRoot);

    document.addEventListener("keydown", handleQuickCartKeyDown);
    window.addEventListener("pagehide", () => void flushAll());

    let placement: string | undefined;
    function updatePlacement() {
        let navBarRightEnd = findNavBarRightEnd();
        let nextPlacement = navBarRightEnd ? `end of ${navBarRightEnd.selector}` : FALLBACK_PLACEMENT;
        if (navBarRightEnd && navBarRightEnd.container.lastElementChild !== buttonRoot) {
            buttonRoot.classList.remove(...fallbackClasses);
            navBarRightEnd.container.appendChild(buttonRoot);
        }
        if (!navBarRightEnd && !buttonRoot.isConnected) {
            buttonRoot.classList.add(...fallbackClasses);
            document.body.appendChild(buttonRoot);
        }
        if (!modalRoot.isConnected) {
            console.log(`[Quick Shop] Modal root was removed from the page, re-attaching to body`);
            document.body.appendChild(modalRoot);
        }
        if (nextPlacement !== placement) {
            console.log(`[Quick Shop] Button placement changed from ${placement ?? "none"} to ${nextPlacement} at ${new Date().toISOString()}`);
            placement = nextPlacement;
        }
    }
    updatePlacement();
    setInterval(updatePlacement, PLACEMENT_CHECK_INTERVAL_MS);
}

main();
