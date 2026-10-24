import { afterEach, describe, expect, it, vi } from "vitest";
import { DOH_URL, fakeFetcher, fetchLinkCard, linkFetcherFor, PREVIEW_MAX_BYTES, resolveOverDoh, type FetchDeps } from "@/links/fetch";

const PUBLIC = ["93.184.216.34"];
const html = (head: string) => `<!doctype html><html><head>${head}</head><body>hello</body></html>`;
const GOOD = html(`<title>Page</title><meta property="og:description" content="About it"><meta property="og:image" content="https://cdn.example.com/p.png">`);

const page = (body: string | Uint8Array<ArrayBuffer>, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

/** Deps with a scripted web: `pages` maps an address to its response (made fresh each time). */
function web(pages: Record<string, () => Response>, resolved: Record<string, string[] | null> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const asked: string[] = [];
  const deps: FetchDeps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const make = pages[url];
      if (!make) throw new TypeError("no such page");
      return make();
    }) as typeof fetch,
    resolve: async (host) => {
      asked.push(host);
      return host in resolved ? resolved[host]! : PUBLIC;
    },
  };
  return { deps, calls, asked };
}

describe("fetchLinkCard", () => {
  it("makes a card from a page, keeps the address that was asked for, and sends nothing that identifies anyone", async () => {
    const { deps, calls } = web({ "https://example.com/story": () => page(GOOD) });
    const result = await fetchLinkCard("https://example.com/story", deps);
    expect(result).toEqual({ ok: true, card: { url: "https://example.com/story", title: "Page", description: "About it", image: "https://cdn.example.com/p.png", site: "example.com" } });
    expect(calls).toHaveLength(1);
    const init = calls[0]!.init!;
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("user-agent")).toBe("netmate-self-hosted link preview");
    for (const name of ["cookie", "authorization", "referer", "x-forwarded-for", "cf-connecting-ip"]) expect(headers.has(name)).toBe(false);
  });

  it("refuses an address that is not allowed without resolving or fetching anything", async () => {
    const { deps, calls, asked } = web({});
    for (const bad of ["http://127.0.0.1/", "https://localhost/", "ftp://example.com/", "https://example.com:8080/", "https://u:p@example.com/", "http://[::1]/", "not a url"]) {
      expect(await fetchLinkCard(bad, deps), bad).toEqual({ ok: false, reason: "unsafe" });
    }
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  it("refuses a name that points at a private address, in any of its answers, and does not fetch it", async () => {
    for (const answers of [["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["93.184.216.34", "192.168.1.1"], ["::1"], ["fd00::1"], ["::ffff:10.0.0.1"], ["not an address"]]) {
      const { deps, calls } = web({ "https://evil.example.com/": () => page(GOOD) }, { "evil.example.com": answers });
      expect(await fetchLinkCard("https://evil.example.com/", deps), answers.join()).toEqual({ ok: false, reason: "unsafe" });
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses when the name could not be resolved or has no addresses", async () => {
    for (const answer of [null, []]) {
      const { deps, calls } = web({ "https://x.example.com/": () => page(GOOD) }, { "x.example.com": answer });
      expect(await fetchLinkCard("https://x.example.com/", deps)).toEqual({ ok: false, reason: "unsafe" });
      expect(calls).toHaveLength(0);
    }
  });

  it("follows redirects by hand, checking every hop, and describes the page it reached", async () => {
    const { deps, calls } = web({
      "https://short.example.com/a": () => redirect("https://example.com/final"),
      "https://example.com/final": () => page(html(`<title>Final</title><meta property="og:image" content="/pic.png">`)),
    });
    const result = await fetchLinkCard("https://short.example.com/a", deps);
    expect(result).toMatchObject({ ok: true, card: { url: "https://short.example.com/a", title: "Final", image: "https://example.com/pic.png", site: "example.com" } });
    expect(calls.map((c) => c.url)).toEqual(["https://short.example.com/a", "https://example.com/final"]);
  });

  it("follows a relative redirect", async () => {
    const { deps } = web({ "https://example.com/a": () => redirect("/b"), "https://example.com/b": () => page(GOOD) });
    expect(await fetchLinkCard("https://example.com/a", deps)).toMatchObject({ ok: true });
  });

  it("refuses a redirect to a private address, a private name, another scheme, an odd port or a login, and stops there", async () => {
    for (const to of ["http://127.0.0.1/admin", "https://metadata.internal/", "file:///etc/passwd", "https://example.com:8443/", "https://u:p@example.com/", "http://[::1]/", "ftp://example.com/"]) {
      const { deps, calls } = web({ "https://example.com/a": () => redirect(to), [to]: () => page(GOOD) });
      expect(await fetchLinkCard("https://example.com/a", deps), to).toEqual({ ok: false, reason: "unsafe" });
      expect(calls.map((c) => c.url)).toEqual(["https://example.com/a"]);
    }
  });

  it("refuses a redirect to a name that resolves to a private address", async () => {
    const { deps, calls } = web(
      { "https://example.com/a": () => redirect("https://rebind.example.net/x"), "https://rebind.example.net/x": () => page(GOOD) },
      { "rebind.example.net": ["10.1.1.1"] },
    );
    expect(await fetchLinkCard("https://example.com/a", deps)).toEqual({ ok: false, reason: "unsafe" });
    expect(calls).toHaveLength(1);
  });

  it("follows at most three redirects", async () => {
    const hops: Record<string, () => Response> = {};
    for (let i = 0; i < 6; i++) hops[`https://example.com/${i}`] = () => redirect(`https://example.com/${i + 1}`);
    hops["https://example.com/6"] = () => page(GOOD);
    const { deps, calls } = web(hops);
    expect(await fetchLinkCard("https://example.com/0", deps)).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(calls).toHaveLength(4);
    // Exactly three redirects still works.
    const three = web({ ...hops, "https://example.com/3": () => page(GOOD) });
    expect(await fetchLinkCard("https://example.com/0", three.deps)).toMatchObject({ ok: true });
  });

  it("gives up on a redirect loop, a redirect with no place to go, an error status and a missing page", async () => {
    const loop = web({ "https://example.com/a": () => redirect("https://example.com/a") });
    expect(await fetchLinkCard("https://example.com/a", loop.deps)).toEqual({ ok: false, reason: "too_many_redirects" });
    const none = web({ "https://example.com/a": () => new Response(null, { status: 302 }) });
    expect(await fetchLinkCard("https://example.com/a", none.deps)).toEqual({ ok: false, reason: "status" });
    for (const status of [204, 400, 401, 403, 404, 410, 500, 503]) {
      const w = web({ "https://example.com/a": () => new Response(status === 204 ? null : "x", { status }) });
      expect(await fetchLinkCard("https://example.com/a", w.deps), String(status)).toEqual({ ok: false, reason: "status" });
    }
    const gone = web({});
    expect(await fetchLinkCard("https://example.com/a", gone.deps)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("accepts only HTML", async () => {
    for (const type of ["application/json", "image/png", "text/plain", "application/pdf", ""]) {
      const w = web({ "https://example.com/a": () => new Response(GOOD, { status: 200, headers: { "content-type": type } }) });
      expect(await fetchLinkCard("https://example.com/a", w.deps), type).toEqual({ ok: false, reason: "not_html" });
    }
    const xhtml = web({ "https://example.com/a": () => new Response(GOOD, { status: 200, headers: { "content-type": "application/xhtml+xml" } }) });
    expect(await fetchLinkCard("https://example.com/a", xhtml.deps)).toMatchObject({ ok: true });
  });

  it("says there is no card for a page without a title", async () => {
    const w = web({ "https://example.com/a": () => page(html("")) });
    expect(await fetchLinkCard("https://example.com/a", w.deps)).toEqual({ ok: false, reason: "no_card" });
  });

  it("reads at most 512 KB of a huge page, and stops pulling the rest", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const head = new TextEncoder().encode(html(`<title>Early</title>`).replace("</head>", "</head>"));
    let sentHead = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sentHead) {
          sentHead = true;
          pulled += head.length;
          return controller.enqueue(head);
        }
        pulled += chunk.length;
        if (pulled > 5 * 1024 * 1024) return controller.close();
        controller.enqueue(chunk);
      },
    });
    const w = web({ "https://example.com/big": () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } }) });
    expect(await fetchLinkCard("https://example.com/big", w.deps)).toMatchObject({ ok: true, card: { title: "Early" } });
    // It stopped well before the end of a 5 MB page (a stream reads a little ahead, so allow some slack).
    expect(pulled).toBeLessThan(PREVIEW_MAX_BYTES + 512 * 1024);
  });

  it("does not see a title that is only after the first 512 KB", async () => {
    const late = `<!doctype html><html><head>${"<!-- filler -->".repeat(60_000)}<title>Too late</title></head></html>`;
    expect(late.length).toBeGreaterThan(PREVIEW_MAX_BYTES);
    const w = web({ "https://example.com/a": () => page(late) });
    expect(await fetchLinkCard("https://example.com/a", w.deps)).toEqual({ ok: false, reason: "no_card" });
  });

  it("decodes the page's own character set", async () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode("<html><head><title>Caf"), 0xe9, ...new TextEncoder().encode("</title></head></html>")]);
    const w = web({ "https://example.com/a": () => new Response(bytes, { status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" } }) });
    expect(await fetchLinkCard("https://example.com/a", w.deps)).toMatchObject({ ok: true, card: { title: "Café" } });
    const unknown = web({ "https://example.com/a": () => new Response(GOOD, { status: 200, headers: { "content-type": "text/html; charset=not-a-charset" } }) });
    expect(await fetchLinkCard("https://example.com/a", unknown.deps)).toMatchObject({ ok: true });
  });

  it("gives up on a page that never finishes, within the time limit, even if the page ignores the abort", async () => {
    const never = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const deps: FetchDeps = {
      resolve: async () => PUBLIC,
      // The body never ends and never reacts to the abort.
      fetch: (async () => new Response(never, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch,
    };
    const started = Date.now();
    expect(await fetchLinkCard("https://example.com/slow", deps)).toEqual({ ok: false, reason: "unreachable" });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(2900);
    expect(took).toBeLessThan(4500);
  }, 10_000);

  it("gives up on a name that is slow to resolve in the same time", async () => {
    const deps: FetchDeps = { resolve: () => new Promise(() => undefined), fetch: (async () => page(GOOD)) as typeof fetch };
    const started = Date.now();
    expect(await fetchLinkCard("https://example.com/slow", deps)).toEqual({ ok: false, reason: "unreachable" });
    expect(Date.now() - started).toBeLessThan(4500);
  }, 10_000);
});

describe("resolveOverDoh", () => {
  const answer = (body: unknown, ok = true) => new Response(JSON.stringify(body), { status: ok ? 200 : 502, headers: { "content-type": "application/dns-json" } });
  const signal = new AbortController().signal;

  it("collects the IPv4 and IPv6 answers, asking for each type with the JSON form", async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      expect(new Headers(init?.headers).get("accept")).toBe("application/dns-json");
      return url.includes("type=AAAA")
        ? answer({ Status: 0, Answer: [{ type: 28, data: "2606:2800:220:1::1" }, { type: 5, data: "alias.example.com." }] })
        : answer({ Status: 0, Answer: [{ type: 5, data: "alias.example.com." }, { type: 1, data: "93.184.216.34" }] });
    }) as typeof fetch;
    expect(await resolveOverDoh("example.com", fetchFn, signal)).toEqual(["93.184.216.34", "2606:2800:220:1::1"]);
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(u.startsWith(`${DOH_URL}?name=example.com&type=`)).toBe(true);
  });

  it("says there are no addresses for a name that does not exist", async () => {
    const fetchFn = (async () => answer({ Status: 3 })) as typeof fetch;
    expect(await resolveOverDoh("nope.example.com", fetchFn, signal)).toEqual([]);
  });

  it("gives null when either lookup fails, answers badly or the resolver errors", async () => {
    const mixed = (async (input: RequestInfo | URL) => (String(input).includes("AAAA") ? answer({}, false) : answer({ Status: 0, Answer: [{ type: 1, data: "1.1.1.1" }] }))) as typeof fetch;
    expect(await resolveOverDoh("example.com", mixed, signal)).toBeNull();
    expect(await resolveOverDoh("example.com", (async () => answer({ Status: 2 })) as typeof fetch, signal)).toBeNull();
    expect(await resolveOverDoh("example.com", (async () => new Response("not json")) as typeof fetch, signal)).toBeNull();
    expect(await resolveOverDoh("example.com", (async () => { throw new TypeError("offline"); }) as typeof fetch, signal)).toBeNull();
  });

  it("puts the name in the address safely", async () => {
    const seen: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return answer({ Status: 0, Answer: [] });
    }) as typeof fetch;
    await resolveOverDoh("a.example.com&type=TXT#x", fetchFn, signal);
    for (const u of seen) {
      const url = new URL(u);
      expect(url.searchParams.get("name")).toBe("a.example.com&type=TXT#x");
      expect(["A", "AAAA"]).toContain(url.searchParams.get("type"));
    }
  });
});

describe("the made-up web for tests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has two pages, refuses what the real fetcher would refuse, and finds nothing else", async () => {
    expect(await fakeFetcher("https://news.example.test/story")).toMatchObject({ ok: true, card: { url: "https://news.example.test/story", image: "https://images.example.test/card.png" } });
    expect(await fakeFetcher("https://plain.example.test/")).toMatchObject({ ok: true, card: { image: null } });
    expect(await fakeFetcher("https://other.example.test/")).toEqual({ ok: false, reason: "unreachable" });
    expect(await fakeFetcher("http://127.0.0.1/")).toEqual({ ok: false, reason: "unsafe" });
  });

  it("is used only when ENV is exactly 'test'", async () => {
    expect(linkFetcherFor({ ENV: "test" })).toBe(fakeFetcher);
    // Anything else is the real fetcher, which must go to the network (here, a stub that is offline), never to the made-up pages.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    for (const env of [{}, { ENV: "production" }, { ENV: "TEST" }, { ENV: "test " }, { ENV: undefined }]) {
      const fetcher = linkFetcherFor(env);
      expect(fetcher).not.toBe(fakeFetcher);
      expect(await fetcher("https://news.example.test/story")).toEqual({ ok: false, reason: "unsafe" });
    }
  });
});
