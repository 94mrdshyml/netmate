import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { countMembers, countPending, listInviteLinks } from "@/server/admin";
import { isEmailSetUp } from "@/server/email";
import { formatUsd } from "@/lib/money";
import { countOpenCases } from "@/server/reports";
import { ownerRevenue } from "@/server/revenue";
import { Icon } from "../(member)/_components/icon";
import { Card, PageHeader, Pill, Stat } from "./hq-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin" };

export default async function HqOverviewPage() {
  // A moderator has no overview: their one page is the members list.
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/hq/members");
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const db = getDb(env.DB);
  const [members, pending, emailReady, links, openCases, money] = await Promise.all([
    countMembers(db),
    countPending(db),
    isEmailSetUp(db),
    listInviteLinks(db),
    countOpenCases(db, { userId: staff.userId, isAdmin: true }),
    ownerRevenue(db),
  ]);
  const joined = links.reduce((total, l) => total + l.usesCount, 0);

  return (
    <>
      <PageHeader title="Overview">How your community is doing, and what needs you.</PageHeader>

      <div className="hq-stats">
        <Stat icon="users" label="Members" value={members} note={`${links.length} invite ${links.length === 1 ? "link" : "links"}, ${joined} ${joined === 1 ? "person has" : "people have"} joined through them`} href="/hq/members" />
        <Stat icon="user-check" label="Waiting for approval" value={pending} note={pending > 0 ? "Review the requests" : "Nobody is waiting"} href="/hq/approvals" />
        <Stat icon="flag" label="Open reports" value={openCases} note={openCases > 0 ? "Take a case and look into it" : "Nothing is waiting"} href="/hq/cases" />
        <Stat icon="credit-card" label="Members are owed" value={formatUsd(money.totals.stillToPay)} note={money.mode === "sandbox" ? "Test mode: practice payments" : "Earned and not yet paid out"} href="/hq/money/payouts" />
      </div>

      <div className="hq-grid">
        <Card id="todo-heading" icon="inbox" title="Needs you" description="Things to answer or set up.">
          <div className="hq-rows">
            <div className="hq-row">
              <span className="hq-tile" aria-hidden="true">
                <Icon name="user-check" size={18} />
              </span>
              <div className="hq-row-text">
                <p className="hq-row-title">Sign-up requests</p>
                <p className="hint">
                  {pending === 0 ? "Nobody is waiting." : pending === 1 ? "1 person is waiting for you to answer." : `${pending} people are waiting for you to answer.`}
                </p>
              </div>
              {pending > 0 ? (
                <Link href="/hq/approvals" className="btn btn-primary">
                  Review
                </Link>
              ) : (
                <Pill icon="check-circle">All clear</Pill>
              )}
            </div>
            <div className="hq-row">
              <span className="hq-tile" aria-hidden="true">
                <Icon name="flag" size={18} />
              </span>
              <div className="hq-row-text">
                <p className="hq-row-title">Reports</p>
                <p className="hint">{openCases === 0 ? "No open cases." : openCases === 1 ? "1 case is open." : `${openCases} cases are open.`}</p>
              </div>
              {openCases > 0 ? (
                <Link href="/hq/cases" className="btn btn-primary">
                  Open cases
                </Link>
              ) : (
                <Pill icon="check-circle">All clear</Pill>
              )}
            </div>
            <div className="hq-row">
              <span className="hq-tile" aria-hidden="true">
                <Icon name="credit-card" size={18} />
              </span>
              <div className="hq-row-text">
                <p className="hq-row-title">Payouts</p>
                <p className="hint">{money.totals.stillToPay > 0 ? `${formatUsd(money.totals.stillToPay)} is owed to members.` : "Nobody is owed anything."}</p>
              </div>
              {money.totals.stillToPay > 0 ? (
                <Link href="/hq/money/payouts" className="btn btn-primary">
                  Pay members
                </Link>
              ) : (
                <Pill icon="check-circle">All clear</Pill>
              )}
            </div>
            <div className="hq-row">
              <span className="hq-tile" aria-hidden="true">
                <Icon name="mail" size={18} />
              </span>
              <div className="hq-row-text">
                <p className="hq-row-title">Email</p>
                <p className="hint">
                  {emailReady ? "Sign-up, verification and password emails are sent." : "Not set up yet. People cannot reset a password until it is."}
                </p>
              </div>
              {emailReady ? (
                <Pill icon="check-circle">Set up</Pill>
              ) : (
                <Link href="/hq/email" className="btn btn-primary">
                  Set up
                </Link>
              )}
            </div>
          </div>
        </Card>

        <Card
          id="community-heading"
          icon="droplet"
          title="Your community"
          description="The look people see."
          aside={
            <Link href="/hq/branding" className="btn btn-ghost hq-small">
              Edit
            </Link>
          }
        >
          <dl className="hq-facts">
            <div>
              <dt>Name</dt>
              <dd>{settings.name}</dd>
            </div>
            <div>
              <dt>Colour</dt>
              <dd>
                <span className="hq-swatch" aria-hidden="true" />
                {settings.primaryColor}
              </dd>
            </div>
            <div>
              <dt>Font</dt>
              <dd>{settings.fontFamily}</dd>
            </div>
            <div>
              <dt>Default avatars</dt>
              <dd>{settings.avatarStyle.replace(/-/g, " ")}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}

/** One number with a plain label. It is a link when there is a page to go to. */
