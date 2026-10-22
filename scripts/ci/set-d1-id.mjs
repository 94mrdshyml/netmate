// Inserts "database_id" after the DB binding in wrangler.jsonc. CI only; the
// change is never committed. Self-hosters get the id from the deploy button.
import { readFileSync, writeFileSync } from "node:fs";

const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
  console.error("Usage: node scripts/ci/set-d1-id.mjs <d1-uuid>");
  process.exit(1);
}

const path = "wrangler.jsonc";
const text = readFileSync(path, "utf8");
if (text.includes('"database_id"')) {
  console.log("database_id already present, leaving as is");
  process.exit(0);
}

const next = text.replace(/("binding":\s*"DB",)/, `$1\n      "database_id": "${id}",`);
if (next === text) {
  console.error('Could not find the "binding": "DB" line in wrangler.jsonc');
  process.exit(1);
}
writeFileSync(path, next);
console.log(`Set database_id for netmate-db`);
