import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getPost } from "@/server/posts";
import { PageHeader } from "../../_components/page-header";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Report a post" };

export default async function ReportPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { postId } = await params;
  const { env } = await getCloudflareContext({ async: true });
  // The same rule as everywhere: a post you may not see is a 404, and so is your own (there is nothing to report).
  const post = await getPost(getDb(env.DB), member.userId, postId);
  if (!post || post.author.userId === member.userId) notFound();

  return (
    <main className="column">
      <PageHeader title="Report a post" back={{ href: `/${post.author.username}/status/${post.id}`, label: "Back to the post" }} centered />
      <p className="hint">Tell us what is wrong. You will get a case number so you can follow what happens.</p>
      <section aria-label="The post you are reporting" className="report-post">
        <p className="report-post-who">
          <strong>
            {post.author.firstName} {post.author.lastName}
          </strong>{" "}
          <span className="muted">@{post.author.username}</span>
        </p>
        {post.body ? <p className="report-post-body">{post.body}</p> : null}
        {post.photos.length > 0 || post.gif ? (
          <p className="hint">{post.gif ? "With a GIF." : `With ${post.photos.length} ${post.photos.length === 1 ? "picture" : "pictures"}.`}</p>
        ) : null}
      </section>
      <ReportForm postId={post.id} />
    </main>
  );
}
