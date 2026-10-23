import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { emailPanel } from "@/server/email";
import { EmailForm } from "./email-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Email" };

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function EmailPage() {
  const admin = await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const panel = await emailPanel(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY);

  return (
    <>
      <h1>Email</h1>
      <p className="hint">
        Netmate sends sign-up, verification and password emails through Resend. The sender address must be on a domain you have verified in Resend.
      </p>

      <p className="banner" role="status">
        {panel.state === "set_up"
          ? "Email is set up."
          : panel.state === "unreadable"
            ? "The saved email settings cannot be read, usually because the encryption key changed. Enter the Resend key again."
            : "Email is not set up."}
      </p>

      <EmailForm setUp={panel.state === "set_up"} initialFrom={panel.from ?? ""} testTo={admin.email} />

      <section className="stack" aria-label="Last results">
        <h2>Last results</h2>
        <p>{panel.lastSentAt ? `Last email sent ${when.format(panel.lastSentAt)} UTC.` : "No email has been sent yet."}</p>
        {panel.lastError ? (
          <p className="error" data-testid="last-error">
            Last error ({panel.lastErrorAt ? `${when.format(panel.lastErrorAt)} UTC` : "unknown time"}): {panel.lastError}
          </p>
        ) : (
          <p className="muted">No errors.</p>
        )}
      </section>
    </>
  );
}
