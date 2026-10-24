// bun run db:seed: fills the LOCAL database with demo people and posts (see src/demo/).
//
// LOCAL ONLY. It opens the local copy of D1 and R2 that `bun run dev` uses (.wrangler/state), through
// Wrangler's local bindings. It has no way to reach a real site: there is no remote option, and no network call.
// (A real site gets its demo people from the admin's /hq/demo page instead.)
// Run `bun run dev` once and finish /setup first, because the demo people are added next to your admin.
//
//   bun run db:seed                              the database `bun run dev` uses
//   bun run db:seed -- --persist-to <folder>     another local state folder: the one that holds the d1 and r2 folders (the default is .wrangler/state/v3)

import { getPlatformProxy } from "wrangler";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { DEMO_EMAIL_DOMAIN, DEMO_PASSWORD, PEOPLE } from "@/demo/data";
import { seedDemo } from "@/demo/seed";

type LocalEnv = { DB: D1Database; MEDIA: R2Bucket; AUTH_SECRET?: string };

const args = process.argv.slice(2);
const at = args.indexOf("--persist-to");
const folder = at >= 0 ? args[at + 1] : undefined;
if (at >= 0 && !folder) {
  console.error("--persist-to needs a folder, for example --persist-to .wrangler/state/v3");
  process.exit(1);
}
const unknown = args.filter((a, i) => a !== "--persist-to" && args[i - 1] !== "--persist-to");
if (unknown.length > 0) {
  console.error(`I do not know "${unknown[0]}". The only option is --persist-to <folder>.`);
  process.exit(1);
}

const proxy = await getPlatformProxy<LocalEnv>({ persist: folder ? { path: folder } : true });
let code = 0;
try {
  const env = proxy.env;
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET is missing. Copy .dev.vars.example to .dev.vars and fill it in (see the file for how).");
  }
  const tables = await env.DB.prepare("select name from sqlite_master where type = 'table' and name = 'profiles'").first();
  if (!tables) throw new Error("The local database is empty. Run `bun run db:migrate:local` and finish /setup first.");

  const auth = createAuth({ DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: "http://localhost:3000" });
  const result = await seedDemo({
    db: getDb(env.DB),
    d1: env.DB,
    media: env.MEDIA,
    hash: async (password) => (await auth.$context).password.hash(password),
    password: DEMO_PASSWORD,
  });

  if (result.already) {
    console.log("The demo people are already in this database, so nothing was changed.");
    console.log("To start again, stop the dev server and delete the .wrangler/state folder, then set up and seed once more.");
  } else {
    console.log(`Added ${result.people} people, ${result.posts} posts, ${result.replies} replies, ${result.quotes} quotes,`);
    console.log(`${result.reposts} reposts, ${result.likes} likes, ${result.saves} saves, ${result.pictures} pictures and ${result.follows} follows.`);
    console.log("");
    console.log(`Sign in as any of them with the password "${DEMO_PASSWORD}". Their emails are:`);
    for (const p of PEOPLE) console.log(`  ${`${p.username}@${DEMO_EMAIL_DOMAIN}`.padEnd(34)} ${p.firstName} ${p.lastName}${p.private ? "  (private account)" : ""}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  code = 1;
} finally {
  await proxy.dispose();
}
process.exit(code);
