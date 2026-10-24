import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { siteStats, WEEKS } from "@/server/members";
import { Card, PageHeader, Stat } from "../hq-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Activity" };

const weekLabel = (index: number) => {
  const ago = WEEKS - 1 - index;
  return ago === 0 ? "Last 7 days" : ago === 1 ? "The week before" : `${ago} weeks before`;
};

export default async function ActivityPage() {
  await requireStaff();
  const { env } = await getCloudflareContext({ async: true });
  const stats = await siteStats(getDb(env.DB));
  const { members, content, interactions, weeks } = stats;

  return (
    <>
      <PageHeader title="Activity">How much your community has made and done. Numbers only: nothing here says who liked or looked at whom, and saved posts are private, so they are not counted.</PageHeader>

      <h2 className="hq-section">People</h2>
      <div className="hq-stats">
        <Stat icon="users" label="Members" value={members.active} note="People who can sign in" />
        <Stat icon="user-check" label="Waiting for approval" value={members.pending} note={members.pending === 0 ? "Nobody is waiting" : "Joined past the automatic approvals"} />
        <Stat icon="shield" label="Moderators" value={members.moderators} note="Made moderators by you" />
        <Stat icon="lock" label="Private accounts" value={members.private} note="Posts only for approved followers" />
      </div>

      <h2 className="hq-section">What people made</h2>
      <div className="hq-stats">
        <Stat icon="feather" label="Posts" value={content.posts} note="Not counting replies and quotes" />
        <Stat icon="message-circle" label="Replies" value={content.replies} note="Answers to posts" />
        <Stat icon="repeat" label="Quotes" value={content.quotes} note="Posts that quote another post" />
        <Stat icon="image" label="Pictures" value={content.pictures} note="Files attached to posts" />
        <Stat icon="smile" label="GIFs" value={content.gifs} note="Posts with a GIF" />
        <Stat icon="link" label="Link cards" value={content.links} note="Posts with a link preview" />
        <Stat icon="map-pin" label="Places" value={content.places} note="Posts with a place" />
        <Stat icon="trash-2" label="Removed posts" value={content.removed} note="Deleted by their author" />
      </div>

      <h2 className="hq-section">How people react</h2>
      <div className="hq-stats">
        <Stat icon="heart" label="Likes" value={interactions.likes} note="On posts and replies" />
        <Stat icon="repeat" label="Reposts" value={interactions.reposts} note="Posts shared again" />
        <Stat icon="user" label="Mentions" value={interactions.mentions} note="@names in posts" />
        <Stat icon="user-plus" label="Follows" value={interactions.follows} note="Who follows whom, in total" />
      </div>

      <Card id="weeks-heading" icon="bar-chart" title="The last eight weeks" description="Each row is a block of seven days, ending now.">
        <div className="hq-table-wrap">
          <table className="hq-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">New members</th>
                <th scope="col">Posts</th>
                <th scope="col">Replies</th>
                <th scope="col">Likes</th>
              </tr>
            </thead>
            <tbody>
              {[...weeks.keys()].reverse().map((i) => (
                <tr key={i}>
                  <th scope="row">{weekLabel(i)}</th>
                  <td>{weeks[i]!.newMembers}</td>
                  <td>{weeks[i]!.posts}</td>
                  <td>{weeks[i]!.replies}</td>
                  <td>{weeks[i]!.likes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
