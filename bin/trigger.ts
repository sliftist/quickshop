import { TRIGGER_PATH, log, parsePortArg } from "./watchShared";

async function main() {
    let { port } = parsePortArg(process.argv.slice(2));
    let url = `http://localhost:${port}${TRIGGER_PATH}`;
    let response = await fetch(url);
    let text = await response.text();
    if (!response.ok) throw new Error(`Expected a successful build from ${url}, got ${response.status}: ${text}`);
    log(text);
}

main().catch(error => {
    console.error((error as Error).stack ?? error);
    process.exit(1);
});
