import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { emailPanel } from "@/server/email";
import { Icon } from "../../(member)/_components/icon";
import { Card, PageHeader, Pill } from "../hq-ui";
import { EmailForm } from "./email-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Email" };

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function EmailPage() {
  const admin = await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const panel = await emailPanel(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY);
  const setUp = panel.state === "set_up";

  return (
    <>
      <PageHeader title="Email">
        Netmate sends sign-up, verification and password emails through Resend. The sender address must be on a domain you have verified in Resend.
      </PageHeader>

      <Card
        id="status-heading"
        icon="send"
        title="Status"
        aside={setUp ? <Pill icon="check-circle">Set up</Pill> : <Pill tone="attention" icon="alert-circle">Not set up</Pill>}
      >
        <p className="hq-status" role="status">
          <Icon name={setUp ? "check-circle" : "alert-circle"} size={18} />
          {setUp
            ? "Email is set up."
            : panel.state === "unreadable"
              ? "The saved email settings cannot be read, usually because the encryption key changed. Enter the Resend key again."
              : "Email is not set up."}
        </p>
        <dl className="hq-facts hq-facts-wide">
          <div>
            <dt>Last send</dt>
            <dd>{panel.lastSentAt ? `Last email sent ${when.format(panel.lastSentAt)} UTC.` : "No email has been sent yet."}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>
              {panel.lastError ? (
                <span className="error" data-testid="last-error">
                  Last error ({panel.lastErrorAt ? `${when.format(panel.lastErrorAt)} UTC` : "unknown time"}): {panel.lastError}
                </span>
              ) : (
                <span>No errors.</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <EmailForm setUp={setUp} initialFrom={panel.from ?? ""} testTo={admin.email} />
    </>
  );
}
