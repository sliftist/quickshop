import http from "http";
import { runPromise } from "socket-function/src/runPromise";
import { formatTime } from "socket-function/src/formatting/format";
import { WebSocketServer } from "ws";
import { TRIGGER_PATH, log, parsePortArg } from "./watchShared";

const WEBSOCKET_OPEN = 1;
const DELAYED_COMMAND_FLAG = "--delayed-command";
const DELAYED_COMMAND_DELAY_MS = 20000;

function parseCommands(rest: string[]) {
    let command = rest[0];
    if (!command) throw new Error(`Expected a build command after --port, was ${JSON.stringify(rest)}`);
    if (rest.length === 1) return { command, delayedCommand: undefined };
    if (rest.length !== 3 || rest[1] !== DELAYED_COMMAND_FLAG) throw new Error(`Expected "<command> [${DELAYED_COMMAND_FLAG} <command>]", was ${JSON.stringify(rest)}`);
    return { command, delayedCommand: rest[2] };
}

async function main() {
    let { port, rest } = parsePortArg(process.argv.slice(2));
    let { command, delayedCommand } = parseCommands(rest);

    let server = http.createServer(async (request, response) => {
        if (request.url !== TRIGGER_PATH) {
            response.writeHead(404);
            response.end(`Unknown path ${request.url}, expected ${TRIGGER_PATH}`);
            return;
        }
        log(`Reload triggered, ${currentBuild ? "build already running, queueing another" : "starting build"}`);
        let success = await requestBuild();
        response.writeHead(success ? 200 : 500);
        response.end(success ? "Build succeeded, reload sent" : "Build failed, no reload sent");
    });

    let wss = new WebSocketServer({ server });
    wss.on("connection", ws => {
        log(`Hot reload client connected, ${wss.clients.size} connected`);
        ws.on("close", () => {
            log(`Hot reload client disconnected, ${wss.clients.size} connected`);
        });
    });

    let currentBuild: Promise<boolean> | undefined;
    let queuedBuild: Promise<boolean> | undefined;
    let delayedTimer: ReturnType<typeof setTimeout> | undefined;
    let delayedRunning = false;
    let delayedRerunNeeded = false;

    async function runDelayedCommand() {
        if (!delayedCommand) return;
        delayedTimer = undefined;
        if (delayedRunning) {
            delayedRerunNeeded = true;
            return;
        }
        delayedRunning = true;
        let startTime = Date.now();
        log(`Delayed build starting: ${delayedCommand}`);
        try {
            await runPromise(delayedCommand);
            log(`Delayed build succeeded in ${formatTime(Date.now() - startTime)}: ${delayedCommand}`);
        } catch (error) {
            console.error(`[pid ${process.pid}] Delayed build failed after ${formatTime(Date.now() - startTime)}: ${delayedCommand}`, (error as Error).stack ?? error);
        } finally {
            delayedRunning = false;
        }
        if (delayedRerunNeeded) {
            delayedRerunNeeded = false;
            await runDelayedCommand();
        }
    }

    function scheduleDelayedCommand() {
        if (!delayedCommand) return;
        if (delayedTimer) {
            clearTimeout(delayedTimer);
        }
        delayedTimer = setTimeout(() => void runDelayedCommand(), DELAYED_COMMAND_DELAY_MS);
    }

    async function build() {
        let startTime = Date.now();
        log(`Build starting: ${command}`);
        let success = true;
        try {
            await runPromise(command);
        } catch (error) {
            success = false;
            console.error(`[pid ${process.pid}] Build failed:`, (error as Error).stack ?? error);
        }
        log(`Build ${success ? "succeeded" : "failed"} in ${formatTime(Date.now() - startTime)}, notifying ${wss.clients.size} client(s)`);
        for (let client of wss.clients) {
            if (client.readyState === WEBSOCKET_OPEN) {
                client.send(JSON.stringify({ type: "build-complete", success }));
            }
        }
        if (success) {
            scheduleDelayedCommand();
        }
        return success;
    }

    function requestBuild(): Promise<boolean> {
        if (!currentBuild) {
            currentBuild = build().finally(() => {
                currentBuild = undefined;
            });
            return currentBuild;
        }
        if (!queuedBuild) {
            queuedBuild = currentBuild.then(() => {
                queuedBuild = undefined;
                return requestBuild();
            });
        }
        return queuedBuild;
    }

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, resolve);
    });
    log(`Listening on port ${port}. Builds and reloads only happen on GET http://localhost:${port}${TRIGGER_PATH} (yarn reload-extension)${delayedCommand ? `; each successful build schedules "${delayedCommand}" ${formatTime(DELAYED_COMMAND_DELAY_MS)} later` : ""}`);

    await requestBuild();
}

main().catch(error => {
    console.error(`[pid ${process.pid}] Fatal error:`, (error as Error).stack ?? error);
    process.exit(1);
});
