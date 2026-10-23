// Gives every e2e run an empty database and no saved login (a fresh, unconfigured instance).
import { rmSync } from "node:fs";

for (const path of [".wrangler/e2e-state", "tests/e2e/.auth"]) {
  rmSync(path, { recursive: true, force: true });
}
console.log("e2e state reset");
