const TURBOPACK_HEADERS_EXPORT_NAME = "getAuthPCXBffHeaders";
const TURBOPACK_BRIDGE_MODULE_ID = 990000001;
const TURBOPACK_BRIDGE_CHUNK_NAME = "quick-shop-bridge.js";
const TURBOPACK_BRIDGE_ENTRY_CHUNK_NAME = "quick-shop-bridge-entry.js";
const TURBOPACK_BRIDGE_TIMEOUT_MS = 10000;
const WEBPACK_BRIDGE_CHUNK_ID = "quick-shop-bridge";
const PCID_CLIENT_EXPORT_NAME = "getPcidClient";
const REQUEST_BUILDER_METHODS = ["getRequestHeaders", "_getDefaultHeaders", "_getRequestHeaders", "withAuthHeaders"];
const REQUEST_BUILDER_PROBE_PATH = "/";
const REQUEST_BUILDER_IS_MARKETPLACE_API = false;
const REQUEST_BUILDER_NO_PROXY = false;
const REQUEST_BUILDER_IS_BFF = true;
const MAX_EXPORT_KEYS_PER_MODULE = 400;

type HeaderConfig = { locale: string; banner: string };
type HeaderMap = { [name: string]: unknown };

type HeaderProvider = {
    description: string;
    getHeaders: (config: HeaderConfig) => Promise<HeaderMap>;
};

type TurbopackContext = {
    c: unknown;
};

type TurbopackRuntime = {
    push: (chunk: unknown[]) => unknown;
};

type WebpackRequire = {
    c?: unknown;
};

type WebpackChunkArray = unknown[];

type SiteHeadersFunction = (config: HeaderConfig) => HeaderMap;

type RequestBuilderInstance = {
    _getDefaultHeaders: () => HeaderMap;
    _getRequestHeaders: () => HeaderMap;
};

type RequestBuilderClass = new (path: string, isMarketPlaceApi: boolean, noProxy: boolean, isBFF: boolean) => RequestBuilderInstance;

type PcidClient = {
    ensureFreshToken: () => Promise<unknown>;
};

type LoadedExport = { moduleId: string; exportName: string; value: unknown };

let providerPromise: Promise<HeaderProvider> | undefined;

function collectionEntries(collection: unknown): [unknown, unknown][] {
    if (collection instanceof Map) return [...collection.entries()];
    if (collection && typeof collection === "object") return Object.entries(collection);
    return [];
}

function readSafely(read: () => unknown): unknown {
    try {
        return read();
    } catch {
        return undefined;
    }
}

function* loadedExports(moduleCache: unknown): Generator<LoadedExport> {
    for (let [moduleId, module] of collectionEntries(moduleCache)) {
        let exports = readSafely(() => (module as { exports?: unknown } | undefined)?.exports);
        if (!exports || (typeof exports !== "object" && typeof exports !== "function") || exports === window) continue;
        let keys = readSafely(() => Object.keys(exports as object));
        if (!Array.isArray(keys)) continue;
        for (let exportName of keys.slice(0, MAX_EXPORT_KEYS_PER_MODULE)) {
            let value = readSafely(() => (exports as { [name: string]: unknown })[exportName]);
            yield { moduleId: String(moduleId), exportName, value };
        }
    }
}

function countModules(moduleCache: unknown) {
    return collectionEntries(moduleCache).length;
}

function getTurbopackRuntime() {
    let runtime = (globalThis as unknown as { TURBOPACK?: TurbopackRuntime }).TURBOPACK;
    if (!runtime || typeof runtime.push !== "function") return undefined;
    return runtime;
}

function getTurbopackContext(runtime: TurbopackRuntime) {
    return new Promise<TurbopackContext>((resolve, reject) => {
        let timer = setTimeout(() => {
            reject(new Error(`Expected the site's Turbopack runtime to run the ${TURBOPACK_BRIDGE_CHUNK_NAME} module within ${TURBOPACK_BRIDGE_TIMEOUT_MS}ms, but it did not`));
        }, TURBOPACK_BRIDGE_TIMEOUT_MS);
        runtime.push([TURBOPACK_BRIDGE_CHUNK_NAME, TURBOPACK_BRIDGE_MODULE_ID, (context: TurbopackContext) => {
            clearTimeout(timer);
            resolve(context);
        }]);
        runtime.push([TURBOPACK_BRIDGE_ENTRY_CHUNK_NAME, { otherChunks: [], runtimeModuleIds: [TURBOPACK_BRIDGE_MODULE_ID] }]);
    });
}

async function createTurbopackProvider(runtime: TurbopackRuntime): Promise<HeaderProvider> {
    let context = await getTurbopackContext(runtime);
    for (let loaded of loadedExports(context.c)) {
        if (loaded.exportName !== TURBOPACK_HEADERS_EXPORT_NAME || typeof loaded.value !== "function") continue;
        let headersFunction = loaded.value as SiteHeadersFunction;
        return {
            description: `the site's Turbopack ${TURBOPACK_HEADERS_EXPORT_NAME} (module ${loaded.moduleId}, ${countModules(context.c)} loaded modules)`,
            getHeaders: async config => headersFunction(config),
        };
    }
    throw new Error(`Expected a loaded Turbopack module exporting ${TURBOPACK_HEADERS_EXPORT_NAME}, but none of the ${countModules(context.c)} loaded modules does`);
}

function isWebpackChunkArray(value: unknown): value is WebpackChunkArray {
    if (!Array.isArray(value) || value.push === Array.prototype.push || !value.length) return false;
    return value.every(entry => Array.isArray(entry) && Array.isArray(entry[0]) && !!entry[1] && typeof entry[1] === "object");
}

function findWebpackChunkArrays() {
    let found: { globalName: string; chunks: WebpackChunkArray }[] = [];
    for (let globalName of Object.getOwnPropertyNames(window)) {
        let value = readSafely(() => (window as unknown as { [name: string]: unknown })[globalName]);
        if (isWebpackChunkArray(value)) found.push({ globalName, chunks: value });
    }
    return found;
}

function getWebpackRequire(globalName: string, chunks: WebpackChunkArray) {
    let captured: WebpackRequire | undefined;
    chunks.push([[`${WEBPACK_BRIDGE_CHUNK_ID}-${globalName}`], {}, (require: WebpackRequire) => {
        captured = require;
    }]);
    return captured;
}

function isRequestBuilderClass(value: unknown): value is RequestBuilderClass {
    if (typeof value !== "function") return false;
    let prototype = readSafely(() => (value as { prototype?: unknown }).prototype);
    if (!prototype || typeof prototype !== "object") return false;
    return REQUEST_BUILDER_METHODS.every(method => typeof (prototype as { [name: string]: unknown })[method] === "function");
}

function createWebpackProvider(): HeaderProvider | undefined {
    for (let { globalName, chunks } of findWebpackChunkArrays()) {
        let require = getWebpackRequire(globalName, chunks);
        if (!require) continue;
        let requestBuilder: { moduleId: string; value: RequestBuilderClass } | undefined;
        let pcidClientGetter: { moduleId: string; value: () => PcidClient } | undefined;
        for (let loaded of loadedExports(require.c)) {
            if (!requestBuilder && isRequestBuilderClass(loaded.value)) requestBuilder = { moduleId: loaded.moduleId, value: loaded.value };
            if (!pcidClientGetter && loaded.exportName === PCID_CLIENT_EXPORT_NAME && typeof loaded.value === "function") pcidClientGetter = { moduleId: loaded.moduleId, value: loaded.value as () => PcidClient };
            if (requestBuilder && pcidClientGetter) break;
        }
        if (!requestBuilder || !pcidClientGetter) continue;
        let RequestBuilder = requestBuilder.value;
        let getPcidClient = pcidClientGetter.value;
        return {
            description: `the site's webpack (${globalName}) request builder from module ${requestBuilder.moduleId} and ${PCID_CLIENT_EXPORT_NAME} from module ${pcidClientGetter.moduleId} (${countModules(require.c)} loaded modules)`,
            getHeaders: async () => {
                let builder = new RequestBuilder(REQUEST_BUILDER_PROBE_PATH, REQUEST_BUILDER_IS_MARKETPLACE_API, REQUEST_BUILDER_NO_PROXY, REQUEST_BUILDER_IS_BFF);
                let headers: HeaderMap = { ...builder._getDefaultHeaders(), ...builder._getRequestHeaders() };
                let token = await getPcidClient().ensureFreshToken();
                if (typeof token === "string" && token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }
                return headers;
            },
        };
    }
    return undefined;
}

async function createProvider(): Promise<HeaderProvider> {
    let turbopack = getTurbopackRuntime();
    if (turbopack) return await createTurbopackProvider(turbopack);
    let webpack = createWebpackProvider();
    if (webpack) return webpack;
    let chunkGlobals = findWebpackChunkArrays().map(found => found.globalName);
    throw new Error(`Expected this Zehrs page to have either a Turbopack runtime exporting ${TURBOPACK_HEADERS_EXPORT_NAME} or a webpack runtime with the site's request builder and ${PCID_CLIENT_EXPORT_NAME}, but found neither (webpack chunk globals: ${chunkGlobals.join(", ") || "none"})`);
}

function getProvider() {
    if (!providerPromise) {
        providerPromise = createProvider().then(provider => {
            console.log(`[Quick Shop] [${new Date().toISOString()}] Using ${provider.description} for API request headers on ${location.pathname}`);
            return provider;
        });
        providerPromise.catch(() => {
            providerPromise = undefined;
        });
    }
    return providerPromise;
}

export async function getSiteHeaders(config: HeaderConfig) {
    let provider = await getProvider();
    let siteHeaders = await provider.getHeaders(config);
    let headers: { [name: string]: string } = {};
    for (let [name, value] of Object.entries(siteHeaders)) {
        if (value === undefined || value === null) continue;
        headers[name] = String(value);
    }
    return headers;
}
