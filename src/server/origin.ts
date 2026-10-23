// The public address of the site for a request: the configured one, or the address the request
// came in on (so local development works with nothing set).

export function siteOrigin(env: { BETTER_AUTH_URL?: string }, headers: Headers): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  const host = headers.get("host") ?? "localhost";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}
