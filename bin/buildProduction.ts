import fs from "fs";
import path from "path";
import { bundleEntryCaller } from "sliftutils/bundler/bundleEntryCaller";
import { formatTime } from "socket-function/src/formatting/format";
import { log } from "./watchShared";

const PAGE_ENTRY = "./extension/extPage.tsx";
const PAGE_SCRIPT_NAME = "extPage";
const MANIFEST_PATH = "./extension/manifest.json";
const ASSETS_FOLDER = "./assets";
const OUTPUT_FOLDER = "./build-extension-prod";
const PAGE_WORLD = "MAIN";
const FORBIDDEN_OUTPUT_STRINGS = ["localhost", "ws://", "enableHotReloading"];
const FORBIDDEN_CONTEXT_CHARS = 80;

type ContentScript = { world?: string; js?: string[] };
type Manifest = { background?: unknown; permissions?: unknown; host_permissions?: unknown; content_scripts?: ContentScript[] };

async function writeProductionManifest() {
    let manifest = JSON.parse(await fs.promises.readFile(MANIFEST_PATH, "utf8")) as Manifest;
    delete manifest.background;
    delete manifest.permissions;
    delete manifest.host_permissions;
    manifest.content_scripts = (manifest.content_scripts || []).filter(script => script.world === PAGE_WORLD);
    if (!manifest.content_scripts.length) throw new Error(`Expected ${MANIFEST_PATH} to have a content script with world ${PAGE_WORLD}, found none`);
    await fs.promises.writeFile(path.join(OUTPUT_FOLDER, "manifest.json"), JSON.stringify(manifest, undefined, 4));
}

async function checkNoDevelopmentCode() {
    for (let fileName of await fs.promises.readdir(OUTPUT_FOLDER)) {
        if (!fileName.endsWith(".js")) continue;
        let contents = await fs.promises.readFile(path.join(OUTPUT_FOLDER, fileName), "utf8");
        for (let forbidden of FORBIDDEN_OUTPUT_STRINGS) {
            let index = contents.indexOf(forbidden);
            if (index < 0) continue;
            let context = contents.slice(Math.max(0, index - FORBIDDEN_CONTEXT_CHARS), index + forbidden.length + FORBIDDEN_CONTEXT_CHARS);
            throw new Error(`Expected no "${forbidden}" in production file ${fileName}, found it at offset ${index}: ${JSON.stringify(context)}`);
        }
    }
}

async function main() {
    let startTime = Date.now();
    await fs.promises.rm(OUTPUT_FOLDER, { recursive: true, force: true });
    await fs.promises.mkdir(OUTPUT_FOLDER, { recursive: true });
    await bundleEntryCaller({ entryPoint: PAGE_ENTRY, outputFolder: OUTPUT_FOLDER });
    await fs.promises.rm(path.join(OUTPUT_FOLDER, `${PAGE_SCRIPT_NAME}.debug.js`), { force: true });
    await writeProductionManifest();
    await fs.promises.cp(ASSETS_FOLDER, path.join(OUTPUT_FOLDER, path.basename(ASSETS_FOLDER)), { recursive: true });
    await checkNoDevelopmentCode();
    log(`Production extension built into ${OUTPUT_FOLDER} in ${formatTime(Date.now() - startTime)}`);
}

main().catch(error => {
    console.error((error as Error).stack ?? error);
    process.exit(1);
});
