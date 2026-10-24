import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db";
import { readInstance } from "@/instance/settings";
import { deriveTheme } from "@/instance/theme";

// The tab icon before an admin uploads one: a rounded square in the brand colour with the first
// letter of the instance name. Drawn here from instance settings, so nothing is hard-coded.
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET() {
  // Read fresh, not from the per-isolate cache: another isolate may not have heard about a rename yet (it catches up
  // within 30 seconds), and a browser keeps this icon for five minutes, so the one read it costs is worth a correct icon.
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await readInstance(getDb(env.DB));
  const theme = deriveTheme(settings.primaryColor).light;
  const letter = escape((Array.from(settings.name.trim())[0] ?? "").toUpperCase());
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${theme.brand}"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-size="36" font-weight="700" fill="${theme.onBrand}">${letter}</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
