import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// These run inside the Workers runtime against a local D1 (Miniflare).
// Local SQLite is close to, but not the same as, remote D1: a feature that
// passes here is still confirmed against the real service in the deploy smoke test.

describe("D1 batch", () => {
  it("rolls back every statement when one fails", async () => {
    await env.DB.exec("create table t_batch (id integer primary key, n integer not null)");

    await expect(
      env.DB.batch([
        env.DB.prepare("insert into t_batch (id, n) values (1, 10)"),
        env.DB.prepare("insert into t_batch (id, n) values (2, null)"),
      ]),
    ).rejects.toThrow();

    const row = await env.DB.prepare("select count(*) as c from t_batch").first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  it("keeps a counter in step with the row that causes it", async () => {
    await env.DB.exec(
      "create table t_posts (id text primary key, like_count integer not null default 0);" +
        "create table t_likes (post_id text not null, user_id text not null, primary key (post_id, user_id))",
    );
    await env.DB.prepare("insert into t_posts (id) values ('p1')").run();

    const like = (user: string) => [
      env.DB.prepare("insert or ignore into t_likes (post_id, user_id) values ('p1', ?)").bind(user),
      env.DB.prepare(
        "update t_posts set like_count = (select count(*) from t_likes where post_id = 'p1') where id = 'p1'",
      ),
    ];
    await env.DB.batch(like("u1"));
    await env.DB.batch(like("u1")); // idempotent: same state wanted twice
    await env.DB.batch(like("u2"));

    const post = await env.DB.prepare("select like_count as c from t_posts where id = 'p1'").first<{ c: number }>();
    expect(post?.c).toBe(2);
  });
});

describe("SQL features the PRD relies on", () => {
  it("has ln and pow", async () => {
    const row = await env.DB.prepare("select ln(1) as a, pow(2, 3) as b").first<{ a: number; b: number }>();
    expect(row).toEqual({ a: 0, b: 8 });
  });

  it("has window functions", async () => {
    const { results } = await env.DB.prepare(
      "select n, row_number() over (order by n desc) as rn from (select 1 as n union all select 2 union all select 3)",
    ).all<{ n: number; rn: number }>();
    expect(results.map((r) => r.rn)).toEqual([1, 2, 3]);
  });

  it("supports insert or ignore", async () => {
    await env.DB.exec("create table t_ign (k text primary key)");
    await env.DB.prepare("insert or ignore into t_ign values ('a')").run();
    await env.DB.prepare("insert or ignore into t_ign values ('a')").run();
    const row = await env.DB.prepare("select count(*) as c from t_ign").first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  it("supports recursive queries for day series", async () => {
    const { results } = await env.DB.prepare(
      "with recursive d(n) as (select 0 union all select n + 1 from d where n < 6) select n from d",
    ).all<{ n: number }>();
    expect(results).toHaveLength(7);
  });

  it("enforces foreign keys with cascade deletes", async () => {
    await env.DB.exec(
      "create table t_parent (id text primary key);" +
        "create table t_child (id text primary key, parent_id text not null references t_parent(id) on delete cascade)",
    );
    await env.DB.batch([
      env.DB.prepare("insert into t_parent values ('p')"),
      env.DB.prepare("insert into t_child values ('c', 'p')"),
    ]);
    await expect(env.DB.prepare("insert into t_child values ('x', 'missing')").run()).rejects.toThrow();
    await env.DB.prepare("delete from t_parent where id = 'p'").run();
    const row = await env.DB.prepare("select count(*) as c from t_child").first<{ c: number }>();
    expect(row?.c).toBe(0);
  });
});

describe("full-text search (FTS5)", () => {
  async function setup() {
    await env.DB.exec(
      "create table t_docs (id text primary key, body text not null, deleted integer not null default 0);" +
        "create virtual table t_docs_fts using fts5(body, content='t_docs', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2', prefix='2 3 4');" +
        "create trigger t_docs_ai after insert on t_docs begin insert into t_docs_fts(rowid, body) values (new.rowid, new.body); end;" +
        "create trigger t_docs_ad after delete on t_docs begin insert into t_docs_fts(t_docs_fts, rowid, body) values ('delete', old.rowid, old.body); end;",
    );
  }

  it("matches word starts, ignoring case and accents, kept in step by triggers", async () => {
    await setup();
    await env.DB.batch([
      env.DB.prepare("insert into t_docs (id, body) values ('1', 'Café opening in Kolkata')"),
      env.DB.prepare("insert into t_docs (id, body) values ('2', 'Totally unrelated')"),
    ]);

    const hits = async (q: string) =>
      (
        await env.DB.prepare(
          "select d.id from t_docs_fts f join t_docs d on d.rowid = f.rowid where t_docs_fts match ? order by d.id",
        )
          .bind(q)
          .all<{ id: string }>()
      ).results.map((r) => r.id);

    expect(await hits("cafe")).toEqual(["1"]);
    expect(await hits("KOLK*")).toEqual(["1"]);
    expect(await hits("unre*")).toEqual(["2"]);

    await env.DB.prepare("delete from t_docs where id = '1'").run();
    expect(await hits("cafe")).toEqual([]);
  });

  it("reports whether the trigram tokenizer exists (informational, see PRD R9)", async () => {
    let available = true;
    try {
      await env.DB.exec("create virtual table t_tri using fts5(body, tokenize='trigram')");
    } catch {
      available = false;
    }
    console.info(`[spike 3] FTS5 trigram tokenizer available in local D1: ${available}`);
    expect(typeof available).toBe("boolean");
  });
});

describe("R2", () => {
  it("stores, reads and deletes an object", async () => {
    await env.MEDIA.put("u1/a.txt", "hello");
    const obj = await env.MEDIA.get("u1/a.txt");
    expect(await obj?.text()).toBe("hello");
    await env.MEDIA.delete("u1/a.txt");
    expect(await env.MEDIA.get("u1/a.txt")).toBeNull();
  });
});
