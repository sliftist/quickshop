export const TRIGGER_PATH = "/trigger";

export function parsePortArg(args: string[]) {
    if (args[0] !== "--port") throw new Error(`Expected first argument to be --port, was ${JSON.stringify(args[0])}`);
    let port = parseInt(args[1], 10);
    if (isNaN(port)) throw new Error(`Expected a number after --port, was ${JSON.stringify(args[1])}`);
    return { port, rest: args.slice(2) };
}

export function log(message: string) {
    console.log(`[pid ${process.pid}] [${new Date().toISOString()}] ${message}`);
}
