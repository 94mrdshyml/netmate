import { requireAdmin } from "@/auth/admin";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db";
import { ITEMS, PEOPLE } from "@/demo/data";
import { DEMO_STEPS, demoStatus } from "@/demo/seed";
import { Card, PageHeader, Pill } from "../hq-ui";
import { DemoPanel } from "./demo-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Demo data" };

export default async function DemoPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const status = await demoStatus(getDb(env.DB));
  const complete = status.people >= PEOPLE.length && status.posts >= ITEMS.length;

  return (
    <>
      <PageHeader title="Demo data">Fill this site with invented people and posts so you can see how it looks and feels, then take them away again.</PageHeader>

      <Card
        id="demo-heading"
        icon="users"
        title="Demo people and posts"
        description={`${PEOPLE.length} invented people and about ${ITEMS.length} posts, with pictures, GIFs, tags, mentions, replies, quotes, likes and saves.`}
        aside={status.people === 0 ? <Pill>Off</Pill> : <Pill icon="check-circle">{`${status.people} people, ${status.posts} posts`}</Pill>}
      >
        <DemoPanel steps={DEMO_STEPS} people={status.people} posts={status.posts} complete={complete} />
        <p className="hint">
          Your real members will see these people and posts until you remove them. The demo people have an email ending in demo.example.com and
          cannot sign in, so nobody can use their accounts. You follow 9 of them and 10 follow you, and a few greet you or reply to your latest
          post, so you get alerts to look at. One account is private. The pictures are drawn flat colours, and the GIFs come from Klipy&apos;s public
          pictures, which their phones load from Klipy.
        </p>
        <p className="hint">
          Removing takes away every demo person with their posts, pictures, likes, saves and alerts. Replies that your real members wrote to a demo
          post go too, because a reply cannot stay without its post. Everything else of yours and your members stays as it is.
        </p>
      </Card>
    </>
  );
}
