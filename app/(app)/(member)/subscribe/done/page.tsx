import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getProfile } from "@/server/profiles";
import { subscribeState } from "@/server/subscriptions";
import { PageHeader } from "../../_components/page-header";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

export const metadata = { title: "Subscription" };

// Where Polar sends someone after paying. Polar tells us about the payment by webhook, which can take a few seconds, so
// this page looks again until the subscription shows up. It trusts nothing in the address: what it shows comes from our own records.
export default async function SubscribeDonePage({ searchParams }: { searchParams: Promise<{ creator?: string | string[] }> }) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { creator } = await searchParams;
  const username = Array.isArray(creator) ? creator[0] : creator;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const profile = username ? await getProfile(db, member.userId, username) : null;
  const state = profile ? await subscribeState(db, member.userId, profile.userId) : null;
  const subscribed = state?.mine !== null && state?.mine !== undefined;
  const name = profile ? `${profile.firstName} ${profile.lastName}` : "this person";

  return (
    <main className="column">
      <PageHeader title="Subscription" back={{ href: profile ? `/${profile.username}` : "/", label: "Back" }} centered />
      {subscribed ? (
        <section className="report-done" aria-live="polite">
          <h2>You are subscribed to {name}.</h2>
          <p>You can now see the posts they share with subscribers.</p>
          <div className="report-done-actions">
            <Link className="btn btn-primary" href={profile ? `/${profile.username}` : "/"}>
              See their posts
            </Link>
            <Link className="btn btn-ghost" href="/subscriptions">
              Your subscriptions
            </Link>
          </div>
        </section>
      ) : (
        <section className="report-done" aria-live="polite">
          <h2>Confirming your payment</h2>
          <p>Polar is telling us your payment went through. This usually takes a few seconds. If you did not pay, nothing was charged.</p>
          <AutoRefresh />
          <div className="report-done-actions">
            <Link className="btn btn-ghost" href={profile ? `/${profile.username}` : "/"}>
              Back to {profile ? `@${profile.username}` : "Home"}
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
