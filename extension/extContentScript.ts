import { enableHotReloading } from "sliftutils/builders/hotReload";
import { isInChromeExtension } from "sliftutils/misc/environment";

async function main() {
    if (!isInChromeExtension()) {
        return;
    }

    enableHotReloading({ port: 9878 });
}

main().catch(err => console.error(err.stack ?? err));
