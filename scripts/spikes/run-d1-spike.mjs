// Runs each numbered section of d1-features.sql against a remote D1 database on its
// own, so one unsupported feature does not hide the others. CI only (see
// .github/workflows/spike-d1.yml). Usage: node run-d1-spike.mjs <database-name>
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const db = process.argv[2];
if (!db || !db.startsWith("netmate-spike-")) {
  console.error("Refusing to run: the database name must start with netmate-spike-");
  process.exit(1);
}

const sql = readFileSync(new URL("./d1-features.sql", import.meta.url), "utf8");
const sections = sql
  .split(/^-- (?=\d+\. )/m)
  .slice(1)
  .map((s) => {
    const [title, ...rest] = s.split("\n");
    return { title: title.trim(), body: rest.join("\n").trim() };
  });

const dir = mkdtempSync(join(tmpdir(), "d1-spike-"));
let failed = 0;

for (const [i, section] of sections.entries()) {
  const file = join(dir, `section-${i + 1}.sql`);
  writeFileSync(file, section.body + "\n");
  const run = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", db, "--remote", "--file", file, "--json"],
    { encoding: "utf8" },
  );

  if (run.status === 0) {
    let rows = [];
    try {
      const parsed = JSON.parse(run.stdout);
      rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((r) => r.results ?? []);
    } catch {
      rows = [run.stdout.slice(0, 500)];
    }
    console.log(`PASS  ${section.title}`);
    for (const row of rows) console.log("      " + JSON.stringify(row));
  } else {
    failed++;
    const msg = (run.stderr + run.stdout).replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-4).join(" | ");
    console.log(`FAIL  ${section.title}`);
    console.log("      " + msg.slice(0, 400));
  }
}

console.log(`\n${sections.length - failed} of ${sections.length} sections passed`);
