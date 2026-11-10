const HEADERS_EXPORT_NAME = "getAuthPCXBffHeaders";
const BRIDGE_MODULE_ID = 990000001;
const BRIDGE_CHUNK_NAME = "quick-shop-bridge.js";
const BRIDGE_ENTRY_CHUNK_NAME = "quick-shop-bridge-entry.js";
const BRIDGE_TIMEOUT_MS = 10000;

type TurbopackContext = {
    i: (moduleId: unknown) => unknown;
    c: unknown;
};

type TurbopackRuntime = {
    push: (chunk: unknown[]) => unknown;
};

type SiteHeadersFunction = (config: { locale: string; banner: string }) => { [name: string]: unknown };

let headersFunctionPromise: Promise<SiteHeadersFunction> | undefined;

function getTurbopackRuntime() {
    let runtime = (globalThis as unknown as { TURBOPACK?: TurbopackRuntime }).TURBOPACK;
    if (!runtime || typeof runtime.push !== "function") throw new Error(`Expected this Zehrs page to use the Turbopack runtime (globalThis.TURBOPACK.push), but it is ${typeof runtime}`);
    return runtime;
}

function getTurbopackContext() {
    let runtime = getTurbopackRuntime();
    return new Promise<TurbopackContext>((resolve, reject) => {
        let timer = setTimeout(() => {
            reject(new Error(`Expected the site's Turbopack runtime to run the ${BRIDGE_CHUNK_NAME} module within ${BRIDGE_TIMEOUT_MS}ms, but it did not`));
        }, BRIDGE_TIMEOUT_MS);
        runtime.push([BRIDGE_CHUNK_NAME, BRIDGE_MODULE_ID, (context: TurbopackContext) => {
            clearTimeout(timer);
            resolve(context);
        }]);
        runtime.push([BRIDGE_ENTRY_CHUNK_NAME, { otherChunks: [], runtimeModuleIds: [BRIDGE_MODULE_ID] }]);
    });
}

function collectionEntries(collection: unknown): [unknown, unknown][] {
    if (collection instanceof Map) return [...collection.entries()];
    if (collection && typeof collection === "object") return Object.entries(collection);
    return [];
}

function findHeadersFunction(context: TurbopackContext) {
    let modules = collectionEntries(context.c);
    for (let [moduleId, module] of modules) {
        let exports = (module as { exports?: { [name: string]: unknown } } | undefined)?.exports;
        let candidate = exports?.[HEADERS_EXPORT_NAME];
        if (typeof candidate !== "function") continue;
        console.log(`[Quick Shop] Using the site's ${HEADERS_EXPORT_NAME} from loaded module ${String(moduleId)} (searched ${modules.length} loaded modules)`);
        return candidate as SiteHeadersFunction;
    }
    throw new Error(`Expected a loaded site module exporting ${HEADERS_EXPORT_NAME}, but none of the ${modules.length} loaded modules does`);
}

function getHeadersFunction() {
    if (!headersFunctionPromise) {
        headersFunctionPromise = getTurbopackContext().then(findHeadersFunction);
        headersFunctionPromise.catch(() => {
            headersFunctionPromise = undefined;
        });
    }
    return headersFunctionPromise;
}

export async function getSiteHeaders(config: { locale: string; banner: string }) {
    let headersFunction = await getHeadersFunction();
    let siteHeaders = headersFunction(config);
    let headers: { [name: string]: string } = {};
    for (let [name, value] of Object.entries(siteHeaders)) {
        if (value === undefined || value === null) continue;
        headers[name] = String(value);
    }
    return headers;
}
