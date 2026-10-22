# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and the impact you expect.

You can expect an acknowledgement within a few days. We will keep you updated, fix the problem, and credit you in the release notes if you wish.

## Supported versions

Netmate is pre-0.1. Only the latest commit on `main` and the latest release get security fixes.

## What matters most here

Reports are especially welcome about:

- taking over an unconfigured instance through `/setup`
- reading or changing another member's private data (private accounts, bookmarks, analytics)
- bypassing the invite quota or the admin approval
- reaching `/hq` as a non-admin
- exposing the Resend or Klipy keys stored by an instance
- request forgery through link previews or uploads
- injecting script or style through instance branding or post text

## For people running an instance

Keep `SETUP_TOKEN`, `AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY` secret, use a Cloudflare API token limited to what the deploy needs, and upgrade to new releases promptly.
