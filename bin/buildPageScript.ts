import { bundleEntryCaller } from "sliftutils/bundler/bundleEntryCaller";
import { formatTime } from "socket-function/src/formatting/format";
import { log } from "./watchShared";

const PAGE_ENTRY = "./extension/extPage.tsx";
const OUTPUT_FOLDER = "./build-extension";

async function main() {
    let startTime = Date.now();
    await bundleEntryCaller({ entryPoint: PAGE_ENTRY, outputFolder: OUTPUT_FOLDER });
    log(`Bundled page-context script ${PAGE_ENTRY} into ${OUTPUT_FOLDER} in ${formatTime(Date.now() - startTime)}`);
}

main().catch(error => {
    console.error((error as Error).stack ?? error);
    process.exit(1);
});
