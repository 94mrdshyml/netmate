import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { currentTime } from "@/lib/time";
import { readKlipyKey } from "@/server/gifs";
import { getPost } from "@/server/posts";
import { Avatar } from "../_components/avatar";
import { Composer } from "../_components/composer";
import { PageHeader } from "../_components/page-header";
import { QuoteCard } from "../_components/quote-card";

export const dynamic = "force-dynamic";

export const metadata = { title: "New post" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ quote?: string | string[] }> }) {
  const member = await getMember();
  if (!member) return null;
  const { settings } = await getInstanceState();
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  // Klipy's key goes to a signed-in member's browser only while GIF search is on (CLAUDE.md rule 3).
  const gifKey = await readKlipyKey(db, env.SETTINGS_ENCRYPTION_KEY);

  // `?quote=<post id>`: the post to quote. One that is missing, hidden from this member, or from a
  // private account (which cannot be quoted) is simply not found.
  const { quote } = await searchParams;
  const quoteParam = Array.isArray(quote) ? quote[0] : quote;
  let quoted = null;
  if (quoteParam) {
    quoted = await getPost(db, member.userId, quoteParam);
    if (!quoted || quoted.share === "none") notFound();
  }

  return (
    <main className="column">
      <PageHeader title={quoted ? "Quote post" : "New post"} back={{ href: "/", label: "Back to Home" }} />
      <Composer
        autoFocus
        places={settings.placesEnabled}
        gifKey={gifKey}
        placeholder={quoted ? "Add your thoughts" : undefined}
        quoteId={quoted?.id}
        quoteCard={
          quoted ? (
            <QuoteCard
              quote={{
                available: true,
                id: quoted.id,
                body: quoted.body,
                createdAt: quoted.createdAt,
                photos: quoted.photos,
                gif: quoted.gif,
                author: quoted.author,
              }}
              now={currentTime()}
              plain
            />
          ) : undefined
        }
        leading={<Avatar userId={member.userId} avatarKey={member.avatarKey} size={40} />}
      />
    </main>
  );
}
