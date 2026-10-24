# Netmate: Product Requirements

**Version:** 2026-10-22. **Status:** approved plan, nothing built yet.

**This is the single source of truth for what Netmate is and does.** If code, another document or a conversation disagrees with this file, this file wins unless `CLAUDE.md` says otherwise (see its order of authority). Change behaviour here in the same pull request that changes the code.

`docs/NETMATE-PRD.md` and `docs/NETMATE-PRD-v2.md` are history. The first describes an earlier prototype (`netmate.vercel.app`, Vercel + Neon). **Nothing from that prototype is reused: no data, accounts, code, assets or brand.** Its feature thinking is carried into this document and re-specified in full below.

## Contents

1. What Netmate is
2. Product rules
3. Instance lifecycle and roles
4. Setup (`/setup`)
5. Customisation
6. Membership: invites and approvals
7. Email
8. Features
9. Screens and routes
10. Data
11. Numbers that define behaviour
12. Architecture (Cloudflare only)
13. Security and privacy
14. Quality, CI/CD and branching
15. Open-source project
16. Build plan
17. Risks and open checks
18. Decisions log
19. Not in v1, and ideas

---

## 1. What Netmate is

Netmate is an open-source, self-hostable, Twitter/X-style microblogging app for a private community: family and friends, a school, or an organisation. One deployment is one **instance**, with its own members, data, name and look. There is no global network and no federation.

People post short messages (280 characters) with photos, GIFs and links; follow each other; like, repost, reply, quote and save posts; and see a home feed that mixes people they follow with popular posts from others on the same instance.

What makes it Netmate:

- **Your own, branded.** The instance owner sets name, logo, favicon, primary colour, corner radius, font and default avatar style. Emails match.
- **Mates.** Anywhere you see a person, the app can say "Followed by Meera and 2 more", meaning people you follow follow them.
- **Owner-only analytics.** Every member gets a private analytics page: reach, profile visits, followers over time, a funnel from "saw you" to "followed you", engagement and best posts. Counts only, never who.
- **Invite-only.** Members join through invite links; past a quota the admin approves.
- **Mobile first.** One centred phone-width column on every page except the admin panel.

**Pitch:** your own small, calm, branded social feed that shows people what is worth reading and tells them honestly how their posts are doing.

**People:** the **admin** (sets the instance up, runs `/hq`) and **members** (everyone else). Members use it on their phones.

## 2. Product rules

1. **Mobile column everywhere, except `/hq`.** Every member page, plus `/setup`, `/sign-in` and `/sign-up`, is one centred column of at most 480px. Wide screens show the same column in the middle. `/hq` is the only wide, desktop-capable layout.
2. **Invite-only.** No public sign-up. No public profile or post pages. Signed-out visitors see only sign-in and sign-up-with-invite.
3. **Privacy first.** Private accounts, block and mute exist. Analytics and bookmarks are private to their owner and never show who.
4. **Counts, not names, in analytics.**
5. **Say what you want, don't toggle.** Likes, reposts, follows and bookmarks send the state wanted ("liked"), not a flip, so a double tap can't undo itself.
6. **Be honest in the UI.** Zeros show as zeros, "new" is never shown as a percentage, a suggested post says it is suggested.
7. **The instance owns its brand.** No hard-coded name, colour, font or logo anywhere in the product or in emails.
8. **Plain and quiet.** Flat design, no shadows or gradients. One brand colour, used sparingly (your own actions such as liked and reposted, links and tags, the unread badge, the logo, the compose button).
9. **Nothing leaves the instance by default.** Readers' browsers contact no third party unless the admin turns on GIF search, and link-preview pictures load from their own sites.

## 3. Instance lifecycle and roles

| State | Meaning | On any request |
|---|---|---|
| **Unconfigured** | deployed, no admin yet | every route redirects to `/setup` |
| **Configured** | setup finished | `/setup` returns 404 permanently |

| Role | Can |
|---|---|
| **Admin** (exactly one at setup) | everything a member can, plus `/hq` |
| **Moderator** (owner decision, session 46) | a Member the admin has made a moderator, kept as a flag on the profile (`is_moderator`), not as a new role, so the one-admin rule is untouched. Can open the members list and Activity in `/hq` (no email addresses, no buttons that change anything) and work the report cases (`/hq/cases`). The admin alone makes or removes a moderator. Moderators will also be able to remove posts and replies and suspend members once those tools are built (decided, not built yet). Never sees branding, email, keys, invites, approvals, services or demo data |
| **Member** | use the app, own a personal invite link |
| **Pending** | signed up through a member link past that member's quota; cannot sign in until approved |

The "is the instance configured?" check runs on every request, so it is a cheap cached read. Once true it never returns to false.

## 4. Setup (`/setup`)

First open of a fresh deployment. One mobile-width, multi-step flow:

1. **Prove ownership.** Enter the `SETUP_TOKEN` secret that was set at deploy time. Without it, a stranger who finds the URL first could claim the instance.
2. **Admin account.** First name, last name, email, username, password (rules in 8.1).
3. **Instance identity.** Name (default "Netmate"). The built-in logo and favicon are used at first; uploading your own logo and favicon happens in `/hq` (it needs a signed-in admin, because uploads require a session).
4. **Look.** Primary colour, corner radius, font, default avatar style, with a live preview of a sample post, button and field.
5. **Email.** Resend API key and sender address. The key is validated by a real call. Skippable, with a clear warning of what then does not work (verification, reset, notifications; invite links are shared by hand).
6. **Optional services.** Klipy key for GIF search (feature hidden if blank), place suggestions on or off.
7. **Finish.** Creates the admin, saves settings, marks the instance configured, signs the admin in, and lands on Home with a short "invite your first people" prompt.

Rules:

- The final write is **atomic**: admin, settings and the configured flag succeed together or not at all. If two people finish at once, exactly one wins; the other sees the sign-in page.
- Everything entered before the last step is kept in the browser session only; nothing is partly saved.
- After completion `/setup` cannot be reached, even by the admin. Changes go through `/hq`.
- **Deployment secrets.** `/setup` refuses to run unless `SETUP_TOKEN`, `AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY` are set, each at least 32 characters (so the token cannot be guessed). When one is missing the page lists which, never a value. The token is checked first, in constant time, before any other validation, so a stranger learns nothing about the form.
- **One write.** The admin user, their credentials, profile, the instance row and the encrypted keys go into a single D1 batch. The instance row comes first and its fixed key is the one-time claim: of two simultaneous attempts exactly one succeeds and the other leaves nothing behind. Any failure rolls the whole batch back.
- **Choices offered.** Font and avatar style are chosen from short lists (`src/instance/options.ts`); the full Google Fonts search and font hosting arrive with `/hq`. The Resend key is checked with a real call to Resend (a sending-only key counts as valid); an unreachable Resend asks to retry or skip.
- **After finishing**, the new admin is signed in and lands on Home.

## 5. Customisation

All values live in instance settings, are first chosen in `/setup`, edited in `/hq`, and apply to every page and email.

| Setting | Options and rules |
|---|---|
| **Name** | 1 to 30 characters. Shown in the top bar, page titles, emails, share text |
| **Logo** | PNG or SVG, up to 1 MB. Emails use a PNG, so an SVG upload also needs a PNG, otherwise email shows the name as text. An SVG is read as text and **refused** (not cleaned) if it has a script, event handler, link, embedded page or picture, style block or entity, and is always served with a locked-down policy and shown only as a picture. Admin only; checked again when attached. The PNG for email arrives with email (`/hq/email`) |
| **Favicon** | PNG (at least 512px, square) or SVG, up to 1 MB. Browser tab and home-screen icon. Until one is uploaded the tab icon is drawn from the name's first letter and the brand colour (`/brand-icon`) |
| **Primary colour** | any hex colour. See "Colour derivation" below |
| **Corner radius** | `zero`, `sm`, `md`, `lg` = 0, 4, 8, 16 px. Applies to buttons and form fields. Avatars stay round; post media keeps its own fixed radius |
| **Font** | any open-licence (OFL) family from Google Fonts, chosen from a list (short for now). The Worker fetches the latin and latin-ext files for weights 400, 500, 600 and 700 once, when the font is saved, and **stores and serves them from our own bucket**, so readers never contact Google. Only the listed families, only files from Google's font host, woff2 only, 600 KB at most each. If the download fails, everything else still saves with a warning, the page uses a fallback font, and saving again retries |
| **Default avatar style** | one of the DiceBear styles whose artwork is CC0 or MIT: Initials, Thumbs, Shapes, Identicon, Rings, Glass, Pixel art, Notionists (neutral). Generated inside the app, so it makes no outside request, and seeded from the member's username (unique and never changed, so it is stable and no two people share a picture). The Initials style draws letters, so its letters come from the name and its colour from the username. An unknown stored style falls back to Initials. Styles with a CC BY or custom licence are left out on purpose (no attribution duty) |
| **Theme default** | dark, light or follow the phone. Members can still override with a toggle (a cookie) |
| **Invite quota** | number of auto-approved sign-ups per member link. Default 5 |
| **Optional features** | GIF search (needs Klipy key), place suggestions |

**Defaults on a fresh instance:** name "Netmate", the built-in logo and favicon, a neutral accessible primary colour, radius `md`, font Inter, avatar style Initials, theme follows the phone, quota 5.

**Colour derivation.** From the chosen primary the system derives: text colour on top of it, hover and pressed shades, a dark-mode variant, and a light-mode text-link colour (darkened where needed so brand-coloured text is readable on white). Any choice that cannot reach WCAG AA (4.5:1 for text) in both themes is adjusted or refused with a clear message in the editor.

**Applying settings.** Colours, radius and font become CSS variables on the page head, so a change needs no rebuild or redeploy. Settings are cached and the cache clears when `/hq` saves.

## 6. Membership: invites and approvals

Sign-up works only through an invite link `/sign-up?invite=<code>`.

**Links**

- The admin has one personal link, unlimited use.
- Every member has one personal, reusable link, shown in their Settings with copy and share buttons.
- The code identifies the member it belongs to, so every account records **who invited them**.
- Codes are long and random.

**Quota**

- A member's link auto-approves its first **N** sign-ups (N = the invite quota, default 5).
- From sign-up N+1 through that link, the new account is created **Pending**: it cannot sign in and sees a "Waiting for approval" screen.
- The count is sign-ups through the link, ever. A deleted, rejected or pending invitee does not free a slot.
- The admin's link is never limited.
- The check and the resulting status are decided in one atomic database step, so two people using slots N and N+1 at the same moment get the right outcomes.

**Approvals (admin, in `/hq`)**

- A queue of Pending sign-ups showing name, username, email, time, and which member's link they came through.
- Approve: the account becomes a member. Reject (asks to confirm first): the account is deleted and the email can be used again, but the link's count is not given back. Only a Pending person can be approved or rejected from here; an active member is never deleted by this screen.
- The admin is told by a badge in `/hq` and, if email is set up, an email. The invitee is told of approval or rejection by email.

**Controls**

- The admin can replace any member's link with a new code (for a leaked link). The old code stops working at once, existing accounts are unaffected, and the count of sign-ups carries over to the new link, so replacing a link never hands out a new quota. There is no separate revoke: a member without a link would simply get a fresh one when they next open their Invite screen.
- Sign-ups per link and per IP are rate-limited.
- When email is set up, sign-up requires email verification. Pending approval is a separate gate after it.
- The invite page shows a clear message for an invalid or revoked code.
- **Invite by email.** On the Invite screen a member types an address and the person gets an email, in the instance's brand, saying who invited them with a "Join {instance}" button to that member's own link (so the quota rules are the same as for a shared link). It needs email to be set up: without it the screen says "Email is not set up, so share your link by hand" and the admin is pointed to `/hq/email`. Limits: 10 an hour per member and 2 a day to any one address (the address is kept only as a salted hash in the limit table). The address is never stored or logged. Your own address is refused. A person who already has an account is not emailed and is not told apart from anyone else, so this cannot be used to find out who is a member. A refused send tells the member to try again or share the link by hand; Resend's own reason goes to `/hq/email` for the admin.
- **Welcome screen.** A valid invite link first opens a welcome, not the form: the instance's name and logo, "{inviter's name} invited you to join {instance name}", up to four overlapping faces (the inviter first, then the members who joined earliest), one friendly line ("Ana, Ben, Cleo and 12 others are already here, saving you a seat.") and a "Join {instance name}" button that opens the form on the same link (`join=1`). Only first names and pictures of active, non-private members are used (the inviter is always shown, since their full name is on the screen anyway); nothing else about anyone is given to a visitor who has no account yet.

**Later:** email-domain rules, closed or open sign-up modes, more admins, per-person quota overrides. Sign-up policy is stored as a setting so these can be added without redesign.

## 7. Email

Provider: **Resend**. Templates: **React Email**, rendered on the server. Every template uses the instance name, logo, primary colour and radius, and the font where the mail app allows (web-safe fallback otherwise).

| Email | Sent to | When |
|---|---|---|
| Verify email | new member | after sign-up |
| Welcome | new member | after verification (and approval) |
| Reset password | member | "forgot password" |
| Confirm new email | member | change email |
| Invitation | a person a member invites | a member types their address on the Invite screen |
| Pending sign-up | admin | a Pending account is created |
| Approved / Rejected | invitee | admin decides |

Rules:

- With no Resend key, email features degrade and say so: verification is skipped, "forgot password" is hidden, invite links are shared by hand, and `/hq` shows a banner "Email is not set up".
- `/hq/email` is where the admin saves the Resend key and sender address, sees whether email is set up, sends a test email to their own address (5 an hour) and sees the time of the last send and Resend's last error (scrubbed of addresses and keys, at most 300 characters). "Remove" forgets the key and sender. Saving a blank key keeps the saved one, so the sender can change alone. Every `/hq` page shows a banner while email is not set up.
- The Resend key is stored encrypted, never shown again after saving (the form shows "key saved" and allows replacing it), and never logged.
- The sender address must be on a domain verified in Resend. Setup explains this and shows Resend's own error if not.
- Sign-up status emails are sent for a Pending sign-up (to the admin: name, username, who invited them, a "Review requests" button; never the applicant's address) and for the admin's answer (to the person, by first name: "You're in" with a "Sign in" button, or a polite "not approved" with no button). Only the request that really approves or rejects sends the email, so a repeat click sends nothing; the address is read before a rejection deletes the account. They never block anything: with no email set up they are skipped, and a refused send is only recorded for `/hq/email`. Button addresses come from the site address (`BETTER_AUTH_URL`); with none known the button is left out.
- Email logos are served from the public media domain as PNG.
- Tests never call Resend; a fake outbox runs only when `ENV=test`. The fake accepts keys starting `re_test_` and refuses a sender on a `.invalid` domain like an unverified domain; any other value of `ENV`, or none, is the real Resend. Mail is sent with Resend's HTTP API directly (no package). Templates are React Email components (`@react-email/components`, pinned): one shared branded layout (`src/email/layout.tsx`) rendered to HTML and a plain-text copy (`src/email/render.tsx`) on the server, with no request made. `bun run test:email` renders them with a sample brand, every corner style and extreme colours, and runs in CI.

## 8. Features

### 8.1 Accounts

**Sign up** (via invite) needs five required fields:

| Field | Rule |
|---|---|
| First name | 1 to 50 characters |
| Last name | 1 to 50 characters |
| Email | valid, up to 254 characters, unique ignoring case |
| Username | 3 to 15 characters, letters, numbers, underscores; unique ignoring case; stored lower case; shown as `@username`; **cannot be changed later** |
| Password | 8 to 128 characters |

The username field checks availability as you type (after a short pause). Reserved usernames: `admin`, `api`, `auth`, `settings`, `home`, `explore`, `notifications`, `messages`, `search`, `compose`, `bookmarks`, `analytics`, `sign-in`, `sign-up`, `login`, `logout`, `onboarding`, `status`, `hq`, `setup`, `waiting`, `invite`, `profile`, `account`, `avatar`, `media`, `verify-email`, `forgot-password`, `reset-password`, `support`, `help`, `about`, `terms`, `privacy`, plus the instance name (lower-cased, letters and numbers only).

**Sign in** is email and password. **Sign out** is in Settings. **Forgot password** and **change email** use Resend (hidden or disabled without it).

**Forgot password.** When email is set up, the sign-in screen has a "Forgot your password?" link to `/forgot-password`, where a person types their email. The answer is always the same ("If that address belongs to a member, a link is on its way. It works for an hour."), whether or not the address is a member, and the email is sent after the response so the time taken is the same too. The email has a button to `/reset-password?token=...`. The link works once and for 60 minutes. The reset page checks the link before it shows the form, asks for a new password (8 to 128 characters), then sends the person to the sign-in screen with "Your password was changed". Setting a new password ends every other session of that account. The page sends no Referer header, so the token is not passed on. A wrong, used or expired link says "Link not valid" and offers a new one. Without email set up the link is hidden and `/forgot-password` says reset is not available. Limits: 5 links an hour per address, 20 requests an hour per visitor, and 10 tries with a link per 10 minutes per visitor.

**Onboarding.** If an account exists without a profile (tab closed halfway), the person is sent to a short page to finish: first name, last name, username.

**Default picture.** Everyone without an uploaded avatar gets a DiceBear picture in the instance's style, seeded from their username (unique and permanent, so it survives a name change and is never shared).

**Account settings:** shows the email; change password (current password required, 5 tries per 10 minutes); change email (confirmation by email); delete account (password required). Deleting removes the profile, posts, follows, likes and everything attached, **and their uploaded files from storage**.

### 8.2 Posting

**Compose** (full-screen sheet from the compose button): up to 280 characters with a live ring counter; up to 4 photos, or one GIF, and a quoted post (a quote may carry its own photos or GIF; owner decision, session 39). A post needs text, a photo, a GIF or a quote; it can't be empty. A post is a reply or a quote, not both. A GIF can't go with photos.

**Photos.** JPEG, PNG, WebP or GIF. Post photos up to 5 MB. Sent to our Worker, which checks session, rate limit, type, size and the file's first bytes, then stores it. Before a stored file is attached to a post or profile it is checked again (exists, belongs to that person, allowed image).

**Built (session 32): photos on posts.** The composer has an "Add pictures" button (up to 4; the rest are ignored). Each picture is sent to `/api/upload` (kind `post`, kept under `posts/<member id>/`) as soon as it is chosen, with a preview, an "Uploading" note, a remove button and its own error; the Post button waits for uploads and is off while any picture has failed. Pictures alone are enough to post. When the text is empty the database still needs 1 to 280 characters, so the post keeps one space as its text and it is never shown (a later table rebuild can lift this). The action re-checks every picture (still in storage, this member's own, a real image) and the server accepts at most four distinct keys under the member's own folder. A post shows its pictures in a flat grid with a hairline edge: one wide, two side by side, three with a tall one on the left, four in a square. Each opens the full picture in a new tab. Pictures are not yet removed from storage when a post is deleted (the post is only hidden), and a picture uploaded but never posted stays in storage. Widths and heights are not stored yet; the grid has a fixed shape so the page does not jump.

**Location** (optional, on when the admin turns on place suggestions in `/hq/services`). A new post (not a reply) can carry one place, as plain text such as "Berlin, Germany", 1 to 60 characters, never coordinates. A pin button in the composer opens a box, "Where was this?": after two letters (and a quarter-second pause) it lists up to six suggestions, towns, regions and countries only, never streets. A member picks one with a tap or the arrow keys and Enter, or taps "Use what I typed". The choice becomes a small tag with an x, and Change place replaces it. If suggestions are down, slow, or limited the box says so and the member can still use what they typed. The place shows as a muted line with a pin under the post's words and pictures, on lists, the post page and in search; it is not a link and is not searched. It follows the post's visibility (a private account's place is for its followers). Suggestions come from OpenStreetMap through the free Photon service, asked by our server (3 second limit, 40 lookups a minute per person), so Photon sees the typed words and our server, never a member's phone. Nothing typed is stored or logged. With the setting off the pin is hidden, the suggestion address answers "not found", and the post action refuses a place; places already on posts stay. Built in session 34: `/api/places?q=`, `src/places/photon.ts`, `posts.place`, `/hq/services`.

**GIFs** (optional, needs a Klipy key). **Built.** A "GIF" button in the composer (posts and replies) opens a search box under the text. The member's phone talks to Klipy directly, as Klipy's terms require: no cookies, no referrer and no member id go with the request, content filter "medium". It opens on what is trending; results appear in Klipy's own order, with "More GIFs" for the next page. The box says "Search KLIPY" and "Powered by KLIPY". A chosen GIF shows as a preview with an x; one GIF per post, never with photos (the other button is disabled, and the server refuses both together). A GIF can stand alone with no words. A post keeps only Klipy's address (medium size, WebP when offered, otherwise GIF), its width and height, and its title as the picture's description; nothing is copied to our storage. The server and the database both accept only https addresses on Klipy's media hosts (`static.klipy.com`, `static1.klipy.com`, `static2.klipy.com`) ending in .gif or .webp. Readers' phones load the GIF from Klipy with no referrer. The admin saves the key on `/hq/services`: the admin's browser first tries it with Klipy, then the server stores it encrypted. Because Klipy puts the key in every search address, the key is given to signed-in members' browsers while GIF search is on (CLAUDE.md rule 3); it is never shown back in `/hq`. Removing the key turns GIF search off and hides the button; GIFs already on posts still show. Hidden entirely when no key is set.

**Link previews** (optional, **off by default**; the admin turns them on in `/hq/services`). **Built (session 41).** When a member pastes or types a web address into the composer (new post or reply, not with pictures, a GIF or a quote), the composer waits a moment, then asks `POST /api/link-preview` for a card and shows it under the text within a few seconds, before the post is sent. The card is a picture on top, the site name, the title and up to two lines of description. It has an x to remove it; removing it, adding pictures or a GIF, quoting, or deleting the address from the words drops it. The Post button waits for a card that is on its way (3 seconds at most) so a quick post is not left without one; a page that cannot be read simply gives no card and does not hold the post up. The card in the post is a link that opens the page in a new tab; the address in the words is also a link (found by parsing, never by injecting HTML). The server visits the page once (never a member's phone). The safe fetcher: only http or https on ports 80 and 443, no login in the address, a real domain name only (no bare IP addresses, no `.local` or `.internal`); the name is looked up over DNS-over-HTTPS and the visit is refused if any answer is a private, loopback, link-local, shared, documentation or other special IPv4 or IPv6 address (including mapped, NAT64, 6to4 and Teredo forms); every redirect is followed by hand (3 at most) and checked the same way; it waits at most 3 seconds, reads at most 512 KB, accepts only HTML, and reads the title, description, picture and site name from the page's Open Graph tags (falling back to the title tag and meta description). Workers cannot pin a looked-up address, so a page that changes its address between the check and the visit is the accepted limit of this design (spike 6). Card text is plain text, cleaned and cut to length. The picture must be an https address on a real domain; it is loaded by each reader's own phone with no referrer (that site sees the reader's IP; the trade-off is stated in `/hq` next to the setting). The route replies with the card and a signed token (HMAC over the card, made from the server's auth secret, tied to the member and valid for 30 minutes). The post action accepts a card only with a token that verifies, and the database checks the card's lengths and https addresses; anything else is dropped silently so the post still goes out without it. A member can ask for 20 previews every 10 minutes. With the setting off the route answers "not found", the composer shows nothing and the post action ignores cards; cards already on posts stay. A card follows its post's visibility. Tests use a fake fetcher only when `ENV` is exactly `test`.

**Hashtags.** **Built.** `#tag` becomes a tappable link to a search for that tag (`/search?q=%23tag`, Posts tab). Lower-cased, stored per post (`post_tags`), up to 10 distinct tags per post, each 1 to 50 letters, numbers or underscores (at least one letter or number, any script). Found by parsing the text (`src/lib/post-entities.ts`), never by building markup: the page draws a link only for a tag the server kept for that post, so an 11th tag stays plain text. A `#` or `@` counts only at the start of a word, so "C#", "me@example.com" and "a#b" are plain, and a web address (`https://...` or `www....`) is left alone as a whole. A tag ends at the first character that is not a letter, number or underscore ("#well-known" is the tag "well").

**Mentions.** **Built.** `@username` links to that profile and sends that person a "mention" alert (once per post, written in the same `db.batch()` as the post). The name must have the shape of a username (3 to 15 letters, numbers or underscores). It counts only if the person exists, is an active member and has no block either way with the author (`post_mentions`); a name that does not count stays plain text. At most 10 distinct people per post; the rest stay plain text. Nobody is alerted twice for one post: the author of the post a reply answers has the reply alert, and the author of a quoted post has the quote alert (that replaces the mention alert, as 8.7 says). You are never alerted about your own post, though your own name still links. The alert is shown only if the reader may see the post (the usual rule), so a private account cannot make a stranger's alerts appear.

**Typing tags and names (built, session 40).** In the composer (posts, replies and quotes) a `#tag` and an `@name` change colour as they are typed, in the brand text colour, using the same rules as the saved post: a tag needs a letter or number, a name has the shape of a username (3 to 15 characters), the first 10 distinct of each are coloured, and "C#", an email address or a web address are not. A name that nobody has stops being coloured a moment after it is typed (the page asks `/api/mentions?names=` once, after a 0.45 second pause), so the colour means "this will be a link". Typing an `@` opens a list of up to six people (picture, name, @username): with nothing after the `@`, people you follow (latest follow first) and then the newest members; with letters typed, people whose username, first name or last name starts with them, an exact username first and people you follow ahead of others. It appears wherever the cursor is in a name, also in the middle of a post. Arrow keys move, Enter or Tab or a tap picks (the name goes in with a space after it, and Enter never posts while the list is open), Escape closes it. Never yourself, never someone with a block either way, never a member who is not active; a private account can be mentioned. The lists come from `/api/mentions?q=` (signed-in members from this site only, 120 a minute); nothing typed is stored or logged. If the lookup fails the name can still be typed.

**Reply.** From a post's page. Replies are posts with a parent. They show under the post (newest first), on the replier's Replies tab, and raise the parent's reply count. They never appear in the home feed.

**Like.** Idempotent. Notifies the author (not for liking your own post).

**Repost and quote.** **Built.** The repost button opens a small sheet: Repost (or Undo repost), or Quote. A repost shows "X reposted" (or "You reposted") above the post in the feeds of people who follow the reposter, and on the reposter's profile under Posts. A post can appear twice, once as itself and once as a repost; several reposts of one post on a page show once, the newest. Repost and quote are idempotent ("reposted", not a flip): the row, the counter on the post and the author's alert change in one batch. Reposting your own post is allowed and tells nobody. A reply cannot be reposted (replies never appear in feeds) but can be quoted. Taking a repost back always works. A quote (`/compose?quote=<post id>`) opens the composer with the original under your text; the quote text may be empty. A quote may carry its own pictures (up to 4) or one GIF, like any post (never both together), and a place, and is not also a reply (the database checks that too). The quote card is the original's author, time and text, with a small picture of the original under the text (its first picture, with "+2" when it has more, or its GIF), and links to it; on a quote post its own pictures or GIF come first and the card is below them. If the original is deleted or the reader may not see it (private, blocked), the card says "This post isn't available." A private account's posts can't be reposted or quoted, not even by their owner; their posts show no repost button. Reposting from a muted person, or of a muted person's post, is left out of your home feed (a profile you open on purpose still shows the reposts). Reposting alerts the author ("X reposted your post", grouped like likes); quoting alerts the author and the alert opens the new quote post. Limits: 30 reposts a minute. Share (the phone's share sheet) is not built yet.

**Bookmark.** Private. See 8.9.

**Share.** Opens the phone's share sheet with the post's link, or copies the link.

**Delete.** You can delete your own posts, from the "..." menu on the post (it asks first). Deletion hides the post everywhere (kept in the database, marked deleted, removed from the search index).

**Post page** (`/[username]/status/[id]`): the post, its action row, the reply box and replies. **Time** is relative ("5h", "2d").

### 8.3 The home feed

Two tabs under the top bar. **For you** opens first.

**Following:** your own posts and posts from people you follow, plus their reposts, newest first. A post can appear twice, once as itself and once as someone's repost.

**For you** is ranked. It can contain:

1. Your own posts.
2. Posts by people you follow.
3. Posts someone you follow reposted ("X reposted" above).
4. Other members' public posts, only if they have traction: at least 2 likes, reposts or replies in total, or at least one person you follow liked or reposted them. These show a grey "Suggested for you" line.

Only top-level posts from the last 7 days. Never shown: replies, deleted posts, anyone you blocked or who blocked you, anyone you muted, private accounts you don't follow.

**Score** (higher first). Five parts multiplied:

| Part | Rule |
|---|---|
| Reactions | `1 + ln(1 + likes + 2 x reposts + 2 x replies)` |
| Freshness | halves every 12 hours, counted from when the post reached you (repost time for a repost) |
| Closeness | you and people you follow = 1; a stranger = 0.4; a post reposted by someone you follow = 1. Each time in the last 30 days you liked, reposted, saved or replied to that author adds 15%, up to 8 times. For a stranger's post, each person you follow who liked or reposted it adds 25%, up to 4 people |
| Already seen | a post you have seen counts 0.15 ("seen" = half of it on screen for one second) |
| Same author again | the second post by one author counts 0.7 of its score, the third 0.7 x 0.7, and so on |

The score is **computed in TypeScript** over candidate posts and counts fetched by simple SQL. Every constant is named in one file so tuning is a small change.

**Paging.** Lists load more on scroll. For you pages by score and remembers the moment the first page was made, so views recorded while scrolling can't reshuffle what you've seen. Duplicates are dropped on the phone.

**New posts pill.** Every 30 seconds while the tab is visible, the app checks for new top-level posts from people you follow. If any, a pill "N new posts" (capped "99+") appears under the top bar. Tapping scrolls to top and reloads the current tab.

**Mates block.** After the third post, "Mates of your mates" suggests up to 4 people with a Follow button.

**Empty and end states.** For you: "Nothing here yet" with the mates block. Following: "Your feed is empty". Ends: "That's everything from the last 7 days." (For you), "You're all caught up." (Following).

**Small instances.** A new instance has few posts. The traction rule keeps For you honest; with too few posts, For you falls back to recent public posts so it is never blank for a member with followers.

### 8.4 Profiles

`/[username]` shows banner (3:1 picture, or a flat colour), avatar, name, `@username`, bio, joined date, city or country, link, the post count, follower and following counts, and the Mates line. The **post count** (built, session 38) is the number of top-level posts the person has made that are not deleted, which is what the Posts tab lists (replies and reposts are not counted; a quote is a post of its own). It is plain text, first in the row before Following and Followers, and is left out when their posts are hidden from you (a private account you do not follow, or a block), so it does not show how active a private account is. Tabs: **Posts** (with reposts) and **Replies**. No Likes tab.

**Own profile:** Edit profile and Analytics buttons. **Other profiles:** Follow / Following (Unfollow on hover or long press) / Requested (private accounts). If either side blocked the other, the page says so instead of showing posts. A private account you don't follow shows only the header.

**Edit profile:** first name, last name, bio (160), city or country (60), link, avatar (up to 2 MB), banner (up to 5 MB). The screen has a header with a close button (back to your profile), the title and Save; the cover picture and your picture each have a camera button (Remove appears once there is a picture); fields are boxed with the label inside and a character counter. Saving stays on the page with a "Saved." note.

**Link in bio.** One link, up to 100 characters. "riya.dev" gets `https://` added. Only http and https with a real domain, no username:password. Shown without the scheme, opens in a new tab, `nofollow`. Taps are counted in analytics.

**City or country** (optional feature). Plain text, never coordinates. With the setting on, suggestions come from OpenStreetMap through the free Photon service, called from the server (3 second limit, 40 lookups per minute per person), streets filtered out. Photon down or setting off = a plain text field.

### 8.5 Following, followers, Mates and suggestions

- **Follow / unfollow** are idempotent. Following a private account sends a request (8.8). Limit 30 follows per 10 minutes.
- **Followers and following lists** (`/[username]/followers`, `/following`) are paged. Each row: avatar, name, bio, Follow button, Mates line.
- **Mates** = people you follow who follow this person. The line shows a few names and "+ N more".
- **Suggestions** ("people you may know", used in the mates block and on the search screen): people followed by people you follow, most shared first. If that gives too few, fill from people your inviter and invitees follow, then newest members. Blocked people are skipped.

### 8.6 Search

One search screen (`/search?q=`) with two tabs, Posts and People. Search uses a real **full-text index** (SQLite FTS5 on D1), built from the start.

**Index**

- `posts_fts` indexes post text. `profiles_fts` indexes username, first name, last name.
- Kept in step with the data by database triggers: a new post is indexed; a deleted post leaves the index; a profile name change updates it.
- The index is rebuildable from the normal tables at any time (also needed because D1 export does not carry virtual tables; see R9).
- Tokenisation is case- and accent-insensitive (`unicode61` with accent removal). Whether the `trigram` tokenizer is available on D1, which would give true "contains" matching and scripts without spaces, is decided in spike 3. Until then queries match **word starts** (prefix matching).
- Built (session 23): migration `0006_search.sql`, a custom migration because drizzle-kit cannot describe virtual tables. `posts_fts(body, post_id)` and `profiles_fts(username, first_name, last_name, user_id)`, tokenizer `unicode61 remove_diacritics 2`, filled for existing rows when the migration runs. Triggers: a new post is indexed, a deleted post (or one removed with its author) leaves, a profile is indexed when made, re-indexed when a name changes and removed with it. People who are not active are indexed but never returned.

**Query rules**

- Terms are split on spaces; every term must match (AND). The last term is matched as a prefix, so results appear while typing. "Quoted phrases" match as phrases. Minimum 2 characters.
- Special characters are escaped; a user can never inject search syntax. Each term is sent in double quotes (`src/lib/search-query.ts`); the only operator we add is the `*` on the last word. At most 8 terms, 50 characters each and 100 in all.
- A lone `#tag` query (one hashtag and nothing else) matches the exact hashtag through the `post_tags` table, not full text: no prefix match, no plain word, either case, replies included, newest first. It may be one character long. `#tag more words`, or a hash anywhere else, is an ordinary text search with the `#` dropped. (Built, session 37.)

**Posts tab**

- Matches post text, replies included. Newest first, paged by `(time, id)`.
- Results are filtered by `visibleTo` after matching, so private, blocked and deleted content never appears.
- A hashtag in a post opens `/search?q=%23tag` on the Posts tab (built).

**People tab**

- Matches the start of a username, first name, last name or full name; a leading `@` is allowed. Order: exact username, then username prefix, then best text match. Capped at 20, not paged. Blocked people skipped. Each result shows the Mates line.

With nothing typed, the screen shows suggestions (no separate Explore page). Suggestions (8) are people followed by people you follow, most shared first, then the newest members; never you or someone you already follow. The inviter-and-invitees step and the Mates line on each result come later.

**The screen.** The search box sits in a sticky header. Results appear while typing, after a 250 ms pause, with no button; Enter also works with no script. A query starting with `@` opens People. Under 2 characters the screen asks for more. Posts page with a "More posts" link; People are not paged.

No typo tolerance, no trending tags in v1.

### 8.7 Notifications

`/notifications` (bell in the bottom bar, with unread badge). Types: **like, repost, follow, follow request, reply, quote, mention, invite used** (your link was used) and, for the admin only, **pending approval**. Never for your own actions. Newest first, paged (30). Likes and reposts of the same post within a page collapse ("Meera and 2 others liked your post"). Each row shows a snippet (up to 140 characters). Alerts from people you blocked, were blocked by, or muted are hidden. Opening the screen marks all read. A quote alert replaces a mention alert for the same person.

**Built so far (sessions 24, 33, 36 and 37).** The kinds that exist in the app today: **like, repost, follow, follow request, reply, quote, mention, invite used and pending approval**. How it works:
- An alert is written in the same `db.batch()` as the like, follow, reply or sign-up that causes it, and taken back in the batch that undoes it (unlike, unfollow). Approving a sign-up removes the admin's "pending approval" alert for that person; rejecting deletes the account, which removes it with it. A reply tells the author of the post it answers (not yourself). Invite used goes to the link's owner (the admin's link too); pending approval goes to the admin when a sign-up lands over the quota.
- The database refuses an alert about your own action, an unknown kind, a post alert with no post (or a person alert with one), and the same alert twice (one partial unique index for alerts about a post, one for alerts about a person). Sending a like twice leaves one alert, and an old read alert does not come back as new.
- Reading goes through `visiblePosts`: an alert about a deleted post is not shown or counted.
- Likes of one post inside a page collapse into one line ("Meera and 2 others liked your post", up to three pictures). Each row can show a snippet (cut at 140 characters). Tapping a row opens the post, the reply, the person, or `/hq/approvals`.
- `/notifications` shows the alerts, newest first, 30 per page ("Older alerts"). Opening it marks all read (done from the browser by a small server action, so a prefetch never does it). Unread rows have a brand tint.
- The Alerts tab shows the unread count (capped "99+") and its name says it ("Alerts, 3 unread"). The bar is told the count when the page is drawn, asks again after each move to another screen, and every minute while the tab is visible. The count hides while you are on the Alerts screen.
- Alerts from people you blocked, who blocked you, or whom you muted are not shown and not counted (session 33). A block also deletes the alerts between the two. A follow request writes a "follow request" alert, and tapping it opens `/privacy/requests`.
- Not yet: email for alerts.

### 8.8 Privacy and safety

`Settings > Privacy`.

- **Private account.** Nobody new can follow without approval; only followers see posts, replies, follower lists and reposts. Others still see the header (name, avatar, bio). A follow attempt sends a request and a "follow request" alert; answer in `Settings > Privacy > Follow requests`. Turning private off approves everyone waiting. A private account's posts can't be reposted or quoted.
- **Block.** Removes follows and pending requests both ways and removes alerts between the two. After a block you can't see each other's posts or profiles, can't follow, and don't appear in each other's search or suggestions. The blocked person isn't told. Manage in `Settings > Privacy > Blocked` (up to 200 shown).
- **Mute.** Hides a person (and their reposts) from your home feed, For you and alerts. They aren't told. Manage in `Settings > Privacy > Muted`.

**The one visibility rule (`visibleTo`).** You can see an author's content if it's yours, or if neither of you blocked the other and the author is public or you follow them. Every list of posts, the post page, replies, quotes, bookmarks, feed, search, notifications and analytics recording use it. It is implemented once and never re-implemented.

**Built (session 33).** All of the above, with these exact rules:
- **Screens.** Settings has a Privacy row (`/privacy`): a Private account switch, then Follow requests, Blocked people and Muted people, each with a count line. `/privacy/requests` lists who is waiting (oldest first) with Approve and Decline; `/privacy/blocked` and `/privacy/muted` list up to 200 people, newest first, each with Unblock or Unmute. On someone else's profile a "..." menu has Mute and Block (Block asks first and says what it does).
- **Private account.** The switch is on the Privacy screen. Turning it on keeps everyone who already follows. Turning it off approves everyone waiting, removes their requests and the "follow request" alerts, all in one step. A private profile shows the header (name, picture, bio, counts) and a lock line; the posts, replies, follower and following lists and the Mates line are shown only to the owner and followers (`personVisible`). The follower and following counts are plain numbers there, not links.
- **Follow requests.** Following a private account you do not already follow sends a request (the button says "Requested"; tapping it takes the request back) and a "follow request" alert. Approving makes the person a follower and removes the alert (no extra "followed you" alert); declining removes the request and the alert, the person is not told, and they may ask again. Answering a request nobody made does nothing, and only the account asked can answer. Requests count toward the 30 follows per 10 minutes.
- **Block.** One step: the block, both follows, both waiting requests and every alert between the two. Neither can follow the other (the action answers "not available"), and the blocked person is not told. Their profile shows "You cannot see this profile." (the blocker's profile shows "You blocked @x." with Unblock). Followers and following lists, people search and suggestions leave the other person out. Unblocking does not bring a follow back. Blocking yourself, someone who is not an active member, or an unknown id is refused.
- **Mute.** Only the muter is affected. The muted person's posts leave the Home feed (For you and Following) and their alerts are hidden and not counted; their profile, their posts on the post page and search still show. Unmuting brings everything back. No limit applies to mutes and blocks.
- **The rule.** `src/server/visibility.ts` has the one rule. `personVisible(viewer, person)` is true for yourself, or for an active member who is public or followed by you and with no block either way; `visiblePosts` is that plus "not deleted". `notBlockedWith` and `notMutedBy` are the two smaller pieces used by lists of people, the feed and alerts. Mutes are not part of `personVisible`.
- **Data.** `follow_requests`, `blocks` and `mutes` (migration 0009), each one row per pair, with no-self checks, cascading delete with the account, and the indexes the lists and the "who blocked me" check need. `profiles.is_private` already existed.
- Reposts and quotes of a private account's posts are refused (session 36: they use the visibility rule and also check "not private"). Not yet: the For you ranking skipping muted people (it uses the same feed filter when it arrives).

### 8.8a Reporting a post

Owner decision, session 48. Any member can report a post or reply they can see. Each report is one **case** with a number people can read out and search for.

- **Where.** The "..." under every post that is not yours (your own posts keep Delete post). It offers **Report post**, which opens `/report/[postId]`. The page shows the post, a list of reasons, an optional note and Send report. A post you cannot see, a post that is gone and your own post are all 404 there.
- **Reasons (one list, `src/lib/report-categories.ts`).** Spam; Bullying or harassment; Hate; Threats or violence; Sexual content; Self-harm; False information; Pretending to be someone; Private information; Something illegal; Something else. Each reason has a short hint line under it. "Something else" needs a note. The note is optional otherwise, up to 500 characters, no control characters. The database checks the reason list too.
- **The case number.** Every report makes one case, shown as `CASE-000123` (six digits at least; more when needed). The number is one more than the highest so far, worked out inside the insert itself, so two reports at the same moment cannot share a number. Staff can find a case by typing the number in any usual spelling (`CASE-000123`, `case 123`, `123`). The row's own id is `rpt_`.
- **One live case per person per post.** Reporting a post you already have an open or in-review case on gives you the same case back ("You already reported this"). After it is closed you may report again and get a new case. The database enforces this with a partial unique index, so two taps at once make one case.
- **What the case keeps.** A copy of the post as it was reported (text, how many pictures, whether it has a GIF or a link card, whether it is a reply, when it was posted, who wrote it), the reason, the note, who reported, the state, how it ended, staff's note and the dates. If the author later deletes the post the case still reads the same. This copy is the one place staff read a post without the `visibleTo` rule, because the reporter chose to share exactly this text; staff cannot open the live post from a case.
- **Who is told what.** The person who wrote the post is never told, and nothing in the app shows them a report exists. The reporter sees only their own cases in `Settings > Your reports` (`/reports`): case number, reason, the post's first words, and Waiting, Being looked at, or Closed with how it ended. They never see staff's note. The form says that the people who look after the space can see who sent it, and the author cannot.
- **Limit.** 10 reports an hour per person (the exact D1 table).
- **Working a case (`/hq/cases`, `/hq/cases/[caseNo]`).** The admin and the moderators. The list has Open, In review and Closed tabs, a search by case number or words from the post, and a count of open cases in the menu. A case page shows the post as reported, the reason, the reporter's words, who reported, the other cases on the same post, and its history. Actions, each sending the state wanted so a repeat changes nothing: **Take this case** (open to in review), **Close case** with how it ended (No action needed, Handled, Same as another case) and an optional staff note, and **Open this case again**. Each change and its history entry are written in one batch; two staff pressing at once make one change and one entry. "Post removed" is already allowed by the database and arrives with the removal tools.
- **No judging your own case.** A moderator never sees a case about their own post or one they reported (the list, the count and the page all leave it out; the page is a 404). The admin sees everything, because the admin is the owner.
- **Not built yet.** Removing a post or reply from a case, suspending a member, and telling the reporter by alert or email. Those come with the next admin round.

### 8.9 Bookmarks

**Built.** The bookmark icon under each post saves it privately (the wanted state, not a flip; 60 saves a minute). `/bookmarks`, titled "Saved posts" and linked from Settings, lists them, newest saved first, paged. Posts you can no longer see (deleted, author went private, blocked) are skipped. Nobody sees your list or a bookmark count on a post. The author sees only a total of saves in their own analytics.

### 8.10 Analytics

`/analytics`, from your own profile and from Settings. **Only the signed-in owner sees their own page.** It takes the person from the session and has no way to ask for someone else's. It never names a viewer.

**Range:** 7 or 28 days, as whole UTC days including today. All totals and charts use the same window.

**What is counted** (signed-in viewers only):

| Event | When it counts |
|---|---|
| Post impression | half of the post is on screen for one second |
| Profile impression | a person's row shows on screen (search, followers/following lists, suggestions) |
| Profile visit | someone opens your profile (sent from the page after it loads, so prefetching and refreshes don't count) |
| Bio link click | someone taps the link in your bio |
| Link card click | someone taps a link card on your post |
| Share | someone's share sheet finished, or they copied the link |
| Follow, unfollow | written by the server when a follow changes (including approvals, going public, blocks) |
| Likes, reposts, quotes, replies, saves | read from the normal tables, not from events |

**Recording rules.** The phone sends only a kind and a post or profile id; the server looks up the owner, so a phone can't claim events for someone else. The server drops anything the viewer isn't allowed to see (via `visibleTo`), anything about themselves, and repeats: a view or tap counts once per person, per thing, per day. Events queue on the phone and send every 5 seconds, at 20 waiting, or when the tab goes to the background (a few can be lost if the app is closed outright). Up to 30 events per report. Limit 60 reports a minute per person.

**What the page shows**, top to bottom:

1. **Overview.** Impressions as the big figure with change against the same number of days before ("+141% vs the 7 days before"; "new" when nothing before, never a percentage from zero). Beside it: profile visits, followers (now, with net change) and engagement. Tapping any switches the daily chart below (one column per day; tap or drag to read a day; the best day labelled).
2. **From seen to followed (funnel).** Counts people, not taps: people who saw you, then opened your profile after that, then followed after that. Each bar is its true share of people who saw you, with the step rate between bars. People who already followed when they first saw you are left out of every step. "Visited without seeing a post" counts visitors who hadn't seen anything of yours in the 7 days before.
3. **Who saw you.** Impressions from people who follow you now against everyone else, with shares (an estimate, from today's follower list).
4. **What people did.** Likes, reposts, quotes, replies and saves as ranked bars (other people's actions, on your undeleted posts), then bio link taps, link card taps and shares.
5. **Best posts.** Top 5 by engagement per 100 views; a post needs at least 5 views. The rate can exceed 100%.

**Storage.** One append-only table. View and tap rows older than 60 days are deleted by the daily cron. Follow and unfollow rows are kept. Charts have a hidden table of the same numbers for screen readers.

**Not doing:** who viewed you, age or gender, video views, best time to post.

### 8.11 Spam protection and limits

Limits are counted per person, or per IP address for sign-up and sign-in. IPs are used only as expiring rate-limit keys.

| What | Limit |
|---|---|
| Posts | 10 per minute |
| Likes | 60 per minute |
| Reposts | 30 per minute |
| Saves | 60 per minute |
| Follows | 30 per 10 minutes |
| Uploads | 30 per 10 minutes |
| Link-preview fetches | 20 per 10 minutes |
| Reports | 10 per hour |
| Location suggestions | 40 per minute |
| Name suggestions | 120 per minute |
| Analytics reports | 60 per minute |
| Sign-up | 10 per 10 minutes per IP; 20 per 10 minutes per invite link |
| Sign-in | 30 per 10 minutes per IP, 10 per 10 minutes per email |
| Username availability checks | 60 per minute per IP |
| Password checks (change, delete) | 5 per 10 minutes |
| Any request to the auth service | 60 per 10 minutes per IP |
| Email sends (verify, reset) | 5 per hour per address |
| Reset link requests | also 20 per hour per visitor; trying a link: 10 per 10 minutes per visitor |
| Invitations by email | 10 an hour per member, and 2 a day to any one address |
| Test email from `/hq/email` | 5 per hour per admin |
| Test connection to Polar from `/hq/payments` | 10 per hour per admin |
| Starting a subscription (Subscribe) | 10 per hour per member |
| Stopping or resuming a subscription | 20 per hour per member |

Reads, search, mutes and blocks are not limited. Exact low-volume limits live in a D1 table; high-volume ones (likes, saves, analytics) use the Workers Rate Limiting binding. Admins who want more protection can add Cloudflare WAF and Turnstile (optional setting after v1).

### 8.12 Settings map

| Row | Goes to |
|---|---|
| Invite people | your personal invite link, with copy and share, how many have joined through it, and "Invite by email" (type an address, we email them your link) |
| Bookmarks | saved posts |
| Analytics | your analytics |
| Edit profile | name, bio, city, link, photos |
| Dark or light theme | a button that flips light and dark (a person who has not chosen follows their phone) |
| Your reports | the reports you made and where each case stands |
| Privacy | private account, follow requests, blocked, muted |
| Account | email, password, delete account |
| Log out | signs out |
| Admin panel (admin only) | `/hq` |

### 8.13 Design and experience

- **Theme.** Follows the phone by default (or the instance default). A sun and moon button in the Home top bar flips light and dark, and Settings has a "Dark or light theme" row with the same button. Both save the choice in a cookie that the server reads, so the right theme is painted on the first frame. Both themes are designed and checked, including with extreme brand colours.
- **Layout.** Home has a top bar (your picture, which opens Settings; the instance mark; the theme button). Search and Alerts show your picture in the same corner. Every other screen has a sticky header with a back arrow and its title. Bottom tabs: Home, Search, Alerts, Profile; round compose button on Home and your own profile. Tap targets at least 44px; safe areas respected. On a screen wider than the column, the page around it is a shade apart and a hairline marks each edge of it.
- **Settings screen.** Opened from your picture (Home, Search, Alerts). A full screen with a back arrow, the title in the middle and one plain list: each row has an icon, a title, a short line under it and a chevron. Today: Edit profile, Invite people, Admin panel (admin only), the Dark or light theme row, and a Log out button. Bookmarks, Analytics, Privacy and Account rows arrive with their features (8.12). Your own profile is only in the bottom bar (Profile tab), not repeated in Settings.
- **Interactions.** Controls answer a pointer or finger with the icon turning the brand colour on hover and press (no background appears), a press (scale to 90 to 97%) and a visible state change: hearts pop once when liked, "Following" reads "Unfollow" under a mouse pointer, the bottom bar's current screen is brand-coloured. Short (120 to 200 ms), flat, and off under reduced motion. See `DESIGN.md`.
- **Empty and loading.** An empty list shows an icon, a plain line, a hint and, where it helps, one button. After a tap on a link, a thin brand line along the top shows until the new screen arrives. Icons share one line thickness.
- **Type.** The instance font, 15px body; headings and names semibold at most, buttons, tabs and rows medium, the rest regular. No emoji or em dashes in interface text.
- **Icons.** Feather.
- **No** shadows, gradients, glows or cards in the feed.
- **Accessibility.** WCAG AA contrast; keyboard and screen-reader usable.
- Detailed design rules live in `DESIGN.md`.

### 8.14 Paid subscriptions

Owner decision, session 49. A member can charge a monthly price, and mark posts as for subscribers only. Payments are taken by **Polar** (a payment service that also handles sales tax) and arrive in the **instance owner's Polar account**; the owner shares each payment with the member as described below, and pays members out by hand for now (payout automation comes later). It is built in four steps, each its own pull request, and the whole feature is off until the owner connects Polar.

**Built (step 1, session 49): the owner connects Polar.**
- **`/hq/payments`** (admin only; moderators and members get 404). Choose test mode (Polar's sandbox, where no real money moves) or live mode; paste a Polar access token and a Polar webhook secret; see the webhook address to give Polar (`/api/webhooks/polar`, built in step 2); set the member's share; test the connection. A saved token or secret is stored encrypted in `instance_secrets` like the Resend and Klipy keys, is never shown again (the boxes show "saved"; a blank box keeps what is saved), never goes to any browser and is never logged. "Test the connection" asks Polar for one product with the saved token, is limited to 10 an hour, and says in plain words what Polar refused (a message never repeats the token). Removing the keys asks first.
- **The split.** One whole percent from 0 to 100, the member's share of each payment. Default 50. It applies to payments made after it is changed (step 2 keeps the percent used on each payment). The page shows the owner's own worked example in dollars: at $10 and 55% the member earns $5.50, the owner's side is $4.50, and roughly what is left after Polar's fee.
- **Money rules** (`src/lib/money.ts`, used by every later step): whole US cents only, US dollars only; a member's price is $1.00 to $100.00 a month; the member's share of a payment is the percent of the payment **before tax** (net of discounts), rounded down to a cent, so the two shares never add up to more than was paid. Polar collects the sales tax and pays it on, so tax never takes part in the split. **Polar's own fee comes out of the owner's side**, so a member always knows what they earn. **A refund** takes back the member's share in the same proportion (a payment refunded in full earns nothing).
- **Webhook check** (`src/payments/webhook.ts`): Polar signs every message with the Standard Webhooks scheme (headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 of `id.timestamp.body`). A message counts only if a signature matches (either key form Polar has used, compared in constant time) and its timestamp is within 5 minutes.
- **Polar calls** (`src/payments/polar.ts`) use plain `fetch` (no new package), with a timeout, no redirects, and a failure always becomes a plain message.
- **Data.** `payment_settings` (one row: mode, member's percent; the database checks both) and two new allowed names in `instance_secrets` (`polar_access_token`, `polar_webhook_secret`; migration 0018 rebuilds that table once to widen its check, copying every row).

**Built (step 2, session 51): prices, Subscribe and Polar's messages.**
- **The owner's switch.** `/hq/payments` has an on/off switch, "Members can offer subscriptions". It can be turned on only with both keys saved and readable. Everything below is invisible to members while it is off. Changing between test and live mode, or removing the keys, turns it off, and a test (sandbox) subscription never gives access on a live site (every subscription and payment row records its mode).
- **A member's price.** Settings gets two rows while the feature is on. `Subscription price` (`/subscription`): a monthly price from $1.00 to $100.00 in whole cents (checked by the database too), "Stop offering", the share they earn with a worked example, and the number of people subscribed to them (a number, never names). New subscribers pay the price in force when they subscribe; people already subscribed keep theirs, because each price is a separate Polar product.
- **Subscribe.** A profile with a price shows "Subscribe for $5.00 a month" (44px, with a line that says they pay on Polar's secure page and can stop any time; "Test mode: no real money moves" in test mode). Pressing it asks the server, which makes (or reuses) a private Polar product for that member at that price and a Polar checkout, and gives back Polar's page address; the browser goes there. **This is the one deliberate place a member's browser goes to a third party** (CLAUDE.md rule 2). Polar is given our two ids for the people (as the customer id and as notes on the checkout) and, so its page opens filled in (owner decision, session 53), the subscriber's own first and last name and the email of their account; they can change both on Polar's page. Nothing about the creator beyond their id is sent, and neither the name nor the email is ever logged. The Subscribe box says so in words, and that the person they subscribe to can see their name as a subscriber. The returned address must be `https` on `polar.sh` or one of its subdomains, or it is refused. Refused with a plain message when: subscriptions are off, the keys are unreadable, the person has no price or is not active, it is yourself, either of you blocked the other, or you are already subscribed. Limit: 10 a hour per person.
- **Coming back.** Polar sends the member to `/subscribe/done`, which says "Confirming your payment" and looks again every two seconds (ten times) until our records show the subscription; nothing in the address can make it claim success.
- **Your subscriptions** (`/subscriptions`): the people you pay, the price, "Renews on" or "Ends on" a date, and "Stop subscribing to X" (asks first) or "Keep subscribing". Stopping tells Polar to stop at the end of the period; access lasts until then. It sends the state wanted, so pressing twice does nothing the second time. Limit: 20 changes a hour per person.
- **Polar's messages** (`POST /api/webhooks/polar`, no session). The signature is checked first (404 if no keys are saved, 401 if it is not signed by Polar, 400 for a signed body that is not JSON, 413 over 512 KB); only then is anything read. A subscription message makes or updates our `subscriptions` row from the two ids we put on the checkout (taken from the first message only; a later message cannot move a subscription to other people; unknown people, the same person twice, non-dollar money and odd shapes are ignored). A late older message cannot undo a newer one (Polar's own "modified" time decides). A paid subscription order (first payment, renewal or change; paid, partly or fully refunded) makes or updates one `subscription_payments` row, worked out again from the order each time: the net amount before tax, the amount refunded, the percent that was in force when the payment was first seen (never changed afterwards) and the member's share. A refund therefore takes the share back at the rate it was earned, whatever the split is now. An order that arrives before its subscription's own message still works (it carries the subscription). Answers 200 once handled or deliberately ignored, and 500 only when our database failed, so Polar sends it again.
- **Access** (`hasSubscriberAccess`, used by step 3): a subscription in the mode the site is in, in the state `active` or `trialing`, whose period has not ended more than three days ago (so a missed "ended" message still stops access by itself). Payments that failed or are overdue (`past_due`, `unpaid`), paused, never completed or ended give no access.
- **Data.** `profiles.subscription_price_cents` (null or 100 to 10000, checked), `payment_settings.enabled`, and tables `polar_products` (one Polar product per mode, member and price), `subscriptions` (`sub_`, unique Polar id, mode, subscriber, creator, state, "stops at period end", price, period end, Polar's modified time) and `subscription_payments` (`spay_`, unique Polar order id, mode, creator, subscriber, net, refunded, percent, member's share, paid time; the database refuses a share bigger than the payment). Migration 0019 only adds columns and tables.
- **Not built yet.** Nothing is locked yet: a member can set a price and be subscribed to, but the posts do not have an audience until step 3. The member's earnings page and the owner's payout list are step 4. No email or alert is sent about subscriptions. Deleting an account removes its subscriptions and payment rows with it (to be reconsidered with the earnings ledger in step 4).

**Planned (not built yet).**
1. *Step 3, subscriber-only posts:* a post has an audience, Everyone or Subscribers. The one visibility rule gains one clause: a subscribers post is seen by its author and by people with an active subscription to the author (including one that is stopped but paid up to the period's end). Everyone else sees a locked card with a Subscribe button instead of the words and pictures; subscriber posts stay out of the feed, search, alerts and reposts for those who cannot see them, and cannot be reposted or quoted. Replies to one follow it. When a subscription ends, its subscriber loses sight of those posts again.
2. *Step 4, earnings:* each member sees what they have earned and what they have been paid; the owner sees what each member is owed and records a payout by hand (a note and an amount), so the ledger stays honest until payout automation exists.

## 9. Screens and routes

| Route | Screen | Width |
|---|---|---|
| `/setup` | First-run setup. 404 once configured | mobile |
| `/sign-in` | Sign in | mobile |
| `/sign-up?invite=` | Sign up with invite | mobile |
| `/waiting` | Pending approval notice | mobile |
| `/forgot-password`, `/reset-password`, `/verify-email` | Email-based flows | mobile |
| `/onboarding` | Finish a profile | mobile |
| `/` | Home: For you (default) and Following (`/?feed=following`) | mobile |
| `/compose` | New post (`?quote=<id>`; reply from a post page) | mobile |
| `/[username]` | Profile (`?tab=replies`) | mobile |
| `/[username]/status/[id]` | Post and replies | mobile |
| `/[username]/followers`, `/following` | People lists | mobile |
| `/search?q=` | People and posts; suggestions when empty | mobile |
| `/report/[postId]` | Report a post: reason, optional note, then the case number | mobile |
| `/reports` | Your reports and where each case stands | mobile |
| `/subscription`, `/subscriptions`, `/subscribe/done` | Your subscription price; the people you pay and stopping; where Polar sends you after paying. Only while the owner has subscriptions on | mobile |
| `/notifications`, `/bookmarks` | Alerts, saved posts (built) | mobile |
| `/analytics` (`?range=28`) | Your analytics | mobile |
| `/settings` and `/profile`, `/account`, `/invite`, `/privacy`, `/privacy/requests`, `/privacy/blocked`, `/privacy/muted` | Settings | mobile |
| `/hq` | Admin overview: members, waiting for approval and invite links as number panels, a "Needs you" list (sign-up requests, email) and a summary of the community's look. Reached from Settings, admin only | **wide** |
| `/hq/branding` | Name, logo, favicon, colour, radius, font (downloaded and kept on our storage), avatar style, live preview | **wide** |
| `/hq/approvals` | Pending sign-ups | **wide** |
| `/hq/invites` | Admin link, quota, member links with usage, replace a link | **wide** |
| `/hq/email` | Resend key (saved encrypted, never shown again), sender, test email, last send and last error | **wide** |
| `/hq/members` | Members: search, filter (everyone, moderators, waiting), each person's counts, and the admin's Make or Remove moderator button. Staff (admin or moderator); a moderator sees no emails | **wide** |
| `/hq/stats` | Activity: totals for people, what they made and how they react, and the last eight weeks. Counts only. Staff | **wide** |
| `/hq/cases`, `/hq/cases/[caseNo]` | Reports: the list of cases (open, in review, closed; search by case number) and one case with its actions and history. Staff (admin or moderator) | **wide** |
| `/hq/payments` | Payments: connect Polar (test or live, access token and webhook secret saved locked), the webhook address, the on/off switch for subscriptions, how payments are shared, test the connection. Admin only | **wide** |
| `/hq/services` | Optional services: place suggestions on or off; link previews on or off; the Klipy key for GIF search | **wide** |
| `/hq/demo` | Demo data: add the demo people and posts in steps, or remove them all (admin only, 404 for anyone else) | **wide** |
| `/api/auth/*`, `/api/me`, `/api/upload` | Auth, session probe, upload | n/a |
| `/api/places?q=` | Place suggestions for the composer (signed-in members, setting on, 40 a minute) | n/a |
| `/api/link-preview` | `POST {url}`: a link card and its signed token for the composer (signed-in members on this site, setting on, 20 per 10 minutes) | n/a |
| `/api/webhooks/polar` | `POST`: Polar's messages about subscriptions and payments. No session; the signature is the only proof (404 until keys are saved, 401 for anything not signed by Polar) | n/a |
| `/api/mentions?q=` and `?names=` | People to suggest after an `@`, and which typed names are real (signed-in members, 120 a minute) | n/a |
| `/avatar/[userId]`, `/media/[...key]` | The drawn default picture; stored files from R2 (avatars, banners, posts, the instance logo and favicon, hosted fonts; each only as the type it was stored with; random names, cached for ever). The media subdomain replaces `/media` later | n/a |

`/hq` is admin-only; anyone else gets 404. The one exception (owner decision, session 46) is `/hq/members`, `/hq/stats` and `/hq/cases` (with a case's page), which a moderator may also open; `/hq` itself sends a moderator to `/hq/members`, and every other page and action checks for the admin alone.

## 10. Data

All data is on Cloudflare D1. Times are integer milliseconds UTC. Yes/no is 0/1. Enums are text with a check.

**Ids are Stripe-style.** A short prefix that names the thing, an underscore, then 24 random base62 characters (`0-9A-Za-z`, about 143 bits), made in code with the Web Crypto API and stored as text. Example: `usr_3kT9xQ0mYb7LpA2vNc8RzEd1`. A person can tell what an id is from its prefix, and an id of the wrong kind is easy to spot. Ids are random, not time-ordered, so lists are ordered by their time column, and feed cursors are `(milliseconds, id)`. The prefix table lives in `src/lib/ids.ts`; add a prefix in the same change that adds a table. Better Auth gets its ids from the same function.

| Prefix | Thing |
|---|---|
| `usr_` | user (Better Auth) |
| `sess_` | session (Better Auth) |
| `acc_` | sign-in account of a user (Better Auth) |
| `ver_` | verification token (Better Auth) |
| `inv_` | invite link |
| `invu_` | invite use |
| `post_` | post or reply |
| `ntf_` | notification (alert) |
| `rpt_` | report case |
| `rpe_` | report case history entry |
| `sub_` | subscription |
| `spay_` | subscription payment (one Polar order) |

More prefixes are added as their tables are created (posts, invites, notifications and so on). Invite link codes are a separate, longer random value, not an id.

| Table | Holds |
|---|---|
| Auth tables (Better Auth) | users, accounts (password hash), sessions, verifications |
| `instance` | one row, **present only once setup has finished** (no row means not configured; the fixed primary key `singleton` makes setup one-time): name, logo key, favicon key, primary colour, radius, font family, avatar style, theme default, invite quota, sign-up policy, feature flags (GIFs, places, link previews), created and updated time. The database itself checks the name length, hex colour, radius, theme default and quota |
| `email_state` | one row: time of the last email sent, the last send error (scrubbed, up to 300 characters) and its time |
| `instance_secrets` | encrypted Resend key, Resend sender address and Klipy key, one row per name, stored as `v1:<nonce>:<ciphertext>` (AES-256-GCM, key derived from `SETTINGS_ENCRYPTION_KEY`, the name bound into the ciphertext). Separate from `instance` so theme code never reads them |
| `fonts` | hosted font files: family, weight, style, script subset, unicode range, storage key (a variable font may share one file between rows) |
| `profiles` | one per user: username (unique, lower case), first and last name, bio, link, location, private flag, avatar and banner keys, `role` (admin or member), `status` (active or pending), `is_moderator` (0 or 1, checked by the database; a flag the admin sets on a member, never on the admin), `subscription_price_cents` (empty, or 100 to 10000, checked by the database), `invited_by`, `email_verified_at`, created time |. The database enforces the username rules (3 to 15 characters of a-z, 0-9, underscore), name and bio lengths, role and status values, and **exactly one admin** (a partial unique index). If the inviter is deleted, `invited_by` becomes empty
| `invite_links` | id (`inv_`), member id, long random code (not an id), uses count, created, revoked. At most one active (not revoked) link per member |
| `invite_uses` | id (`invu_`), invite link, new user (one use per person), time, outcome (`approved` or `pending`) |
| `posts` | body (up to 280), place (optional, 1 to 60 characters of plain text, checked by the database), author, parent (reply), quoted post (optional; the database refuses a post that is both a reply and a quote; if the original row is removed the quote stays and its card says "not available"), reply/like/repost counts (repost count never negative), created, deleted |
| `post_media` | up to 4 per post: position (0 to 3), key (storage key under `posts/`; checked by the database). Built for pictures |
| `post_gifs` | one per post at most (post id is the key): Klipy address, width, height, title. The database accepts only https addresses on Klipy's three media hosts, sizes 1 to 4096 and a title of 140 characters or fewer. Removed with the post |
| `post_links` | one link card per post (post id is the key): url (http or https, up to 500), title (1 to 150), description (up to 300, may be empty), picture address (optional, https, up to 500), site name (1 to 60). Checked by the database. Removed with the post |
| `post_tags` | one row per distinct hashtag per post: post, lower-cased tag (1 to 50 characters, checked by the database) and the post's own time; indexed by tag and time. Removed with the post |
| `post_mentions` | one row per person a post mentions (only people who exist, are active and have no block with the author): post and person. Decides which `@names` are drawn as links. Removed with the post or the person |
| `posts_fts`, `profiles_fts` | FTS5 search indexes (rebuildable from the tables above) |
| `follows`, `follow_requests` | follower/followee (no self-follow); pending asks for private accounts |
| `blocks`, `mutes` | who blocked or muted whom |
| `likes`, `reposts`, `bookmarks` | one row per person per post (created time kept; reposts and bookmarks are indexed by person and time for the feed, a profile and the Saved list) |
| `notifications` | id (`ntf_`), recipient, actor, type, post, created, read time. The database checks the kind, refuses an alert about yourself, requires a post for post alerts and none for person alerts, and allows one alert per actor, kind and post (two partial unique indexes) |
| `payment_settings` | one row: the owner's on/off switch, mode (`sandbox` or `production`) and the member's percent of each payment (0 to 100), all checked by the database. The Polar token and webhook secret are rows of `instance_secrets` |
| `polar_products` | the Polar product made for one member at one price in one mode (so a price change makes a new one and old subscribers keep theirs) |
| `subscriptions` | `sub_` id, Polar's id (unique), mode, subscriber, creator, Polar's state, "stops at the end of the period", price, period end, Polar's modified time. Written only from a signed Polar message. The database refuses subscribing to yourself and unknown states |
| `subscription_payments` | `spay_` id, Polar order id (unique), subscription, mode, creator, subscriber, net (before tax), refunded, the percent in force when first seen, the member's share, paid time. The database refuses a share bigger than the payment |
| `reports` | id (`rpt_`), case number (unique, 1 or more), the post (kept as empty if its row is ever removed) and a copy of it (author, username, text, picture count, GIF, link card, reply, posted time), reporter, reason, note (up to 500), state (`open`, `reviewing`, `closed`), outcome, staff note (up to 500), who took or closed it, created, updated and closed times. The database checks the reason list, the lengths, the states, that a closed case has an outcome and a closing time (and an unclosed one has neither), and that a person has at most one unclosed case per post |
| `report_events` | id (`rpe_`), case, who, kind (`filed`, `review_started`, `closed`, `reopened`), detail (the reason, or the outcome), time. Removed with the case |
| `rate_hits` | one row per allowed limited attempt: key (label plus a salted hash of the IP, email or link, never the raw value) and time in ms; plain row number as id because nothing refers to it; pruned daily |
| `analytics_events` | append-only: owner, viewer, kind, post, day, time. Unique per person per thing per day for the six view/tap kinds; follows and unfollows never squashed |

Counters on a post (replies, likes, reposts) change in the same `db.batch()` as the row that causes them.

## 11. Numbers that define behaviour

| Thing | Value |
|---|---|
| Max page width | 480px |
| Post length | 280 characters |
| Photos per post | 4 (a GIF is always alone) |
| Photo sizes | avatar 2 MB, banner 5 MB, post photo 5 MB, logo 1 MB |
| Photo types | JPEG, PNG, WebP, GIF |
| Instance name | 30 characters |
| Bio | 160 characters |
| Link in bio | 100 characters |
| City or country | 60 characters |
| Names | 50 characters each |
| Username | 3 to 15 characters |
| Password | 8 to 128 characters |
| Hashtags per post | 10 |
| Mentions per post | 10 |
| Page size | 20 posts, 30 alerts |
| For you pool | last 7 days |
| For you halving time | 12 hours |
| Stranger weight / seen weight / author decay | 0.4 / 0.15 / 0.7 |
| New-posts check | every 30 seconds while visible, up to "99+" |
| Invite quota | 5 (setting) |
| Analytics ranges | 7 and 28 UTC days |
| Best-post minimum | 5 views, top 5 |
| Analytics view and tap retention | 60 days |
| Analytics report | up to 30 events, every 5 seconds |
| Link preview | 3 seconds, 512 KB, 3 redirects, ports 80 and 443 |
| Blocked and muted lists shown | up to 200 |
| People search | 20 results; minimum query 2 characters |
| Contrast | WCAG AA, 4.5:1 for text |
| Tap target | 44px |

## 12. Architecture (Cloudflare only)

```
Browser
  │
  ▼
Cloudflare (DNS, CDN, optional WAF and Turnstile)
  │
  ▼
Worker "netmate"  ── Next.js 16 via @opennextjs/cloudflare
  │   Server Components · Server Actions · Route Handlers · Better Auth at /api/auth
  ├──► D1 "DB"          app data, instance settings, auth data, search indexes
  ├──► R2 "MEDIA"       photos, logo, favicon, cached fonts. Public reads through a media domain
                       (key prefixes: `avatars/`, `banners/` (cover images), `posts/` (post pictures),
                        `instance/` (logo, favicon), `fonts/`; built only by `src/storage/keys.ts`)
  ├──► Rate Limiting    "LIMITER": high-volume limits
  ├──► Cron Trigger     daily clean-up of old analytics rows and rate hits
  └──► Resend (HTTPS)   email
```

- **Plan.** Workers Paid is the minimum (CPU time and queries per request). The README says so.
- **Deploy.** A "Deploy to Cloudflare" button creates the Worker, D1 and R2 and prompts for secrets: `SETUP_TOKEN`, `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`. Migrations run on every deploy.
- **Domains.** The app on the instance domain; media on a separate media subdomain (cached by Cloudflare). A first try works without a custom media domain; the docs show how to add one.
- **Config at request time.** Instance settings are read from D1 (cached per isolate, cleared on save) and turned into CSS variables in the page head.
- **Uploads.** Through the Worker (`POST /api/upload`): session, rate limit, type, size, first-byte sniff, then write to R2. Presigned links are not used (R2 docs don't say the size can be locked, and they don't work on custom domains).
- **Rate limiting.** Exact low-volume limits in a D1 table; high-volume ones use the Rate Limiting binding (approximate, per location).
- **Middleware.** OpenNext doesn't support Next 16 `proxy.ts`. Use an Edge `middleware.ts` only for the cheap setup-state redirect, or check in the root layout. Every page and action still checks the session itself.
- **Transactions.** D1 has no interactive transactions. Changes are fixed lists of statements run in `db.batch()` (atomic), with counters changed in SQL.
- **Search.** FTS5 virtual tables on D1, kept in step by triggers.
- **Cron.** One daily trigger deletes analytics view/tap rows older than 60 days and old `rate_hits`.
- **Upgrades.** Instances upgrade by pulling a release and redeploying. Migrations are forward-only and safe on any older instance (expand, then contract across releases).
- **Backups.** Documented D1 export/Time Travel guidance. Virtual (FTS) tables are dropped before export and rebuilt after import.
- **Local dev.** `wrangler dev` with local D1 and R2; `wrangler d1 migrations`. Bun is the package manager and script runner (the app itself runs on Workers).

## 13. Security and privacy

- **Setup takeover.** `/setup` requires `SETUP_TOKEN`, is atomic and one-time, and is gone after completion.
- **Secrets at rest.** Resend, Klipy and Polar (access token, webhook secret) keys are encrypted in D1 with `SETTINGS_ENCRYPTION_KEY` (a Worker secret), never logged, never shown back in `/hq` after saving. The Resend and Polar keys never go to a browser. The Klipy key does go to signed-in members' browsers while GIF search is on, because Klipy puts it in the search address and requires searches from the member's browser. Losing the encryption key means re-entering the keys, not losing data.
- **Admin surface.** `/hq` and its actions check the admin role on the server every time and return 404 to non-admins.
- **Invites.** Long random codes, revocable, rate-limited per link and per IP, quota check atomic.
- **Passwords** are handled only by Better Auth. Never stored or logged by us.
- **Every server action checks the session itself.** Actions can be called directly by anyone, so a user id from the client is never trusted.
- **Post text is always rendered as text.** Mentions, tags and links are found by parsing, never by injecting HTML.
- **Theme safety.** Colours are validated as hex; font family names validated against the Google Fonts list; nothing from settings can inject CSS or script.
- **Branding uploads.** Type and size validated; SVG sanitised or rasterised.
- **Uploads.** Checked on the way in and again before attaching.
- **Link fetching** is guarded against internal addresses (8.2); feature stays off if the guard can't be made safe.
- **Search.** User input is escaped before reaching the index; results go through `visibleTo`.
- **Visibility** has one rule used everywhere (8.8).
- **Analytics privacy.** Owner only, counts only, no names. The phone cannot name an owner.
- **Cookies.** Session cookie from Better Auth; a theme cookie.
- **Third parties.** None for readers by default. Optional: Klipy (GIF search, from the phone), Photon (place suggestions, from the server), sites behind link-preview pictures. Resend sends email from the server. Polar (payments) is called from the server only, with the owner's own token; members' browsers go to Polar only when they tap Subscribe, and then only to Polar's own checkout page.
- **Security policy.** `SECURITY.md` with a private report channel. Dependency and secret scanning in CI.

## 14. Quality, CI/CD and branching

**Tests**

| Layer | What | Tool |
|---|---|---|
| Unit | validation, text parsing, cursors, feed scoring, colour contrast derivation, invite quota logic, search query building | Vitest |
| Integration | real server code against local D1: feed, paging, visibility, privacy, invites and approvals, setup atomicity, FTS search and triggers, notifications, analytics | Vitest with the Workers pool |
| Email | each template renders with a sample brand; snapshot plus HTML sanity check | Vitest |
| End to end | `/setup` through first post; invite, 5 auto-approved, 6th pending, admin approves; sign-in; branding change shows everywhere | Playwright at phone width |
| Accessibility | key screens in light, dark and with extreme brand colours | axe via Playwright |
| Theme matrix | each radius, a light and a dark primary, a tall and a wide font stay readable and unbroken | Playwright screenshots |

**Demo data.** Invented people and posts so the feed, search, alerts and profiles can be seen with something in them: 14 people and about 90 posts over the last three days, covering plain words, #tags, @mentions, 1 to 4 pictures (flat-colour scenes the code draws and stores in R2), GIFs (public Klipy pictures; if Klipy ever removes one, that post shows no picture), places, link cards (example domains, no outside picture), replies, quotes, reposts, likes and saves. One account is private, with four approved followers and one request still waiting. Everything goes in through the same server code the app uses, so counters, alerts, tags, mentions and search stay true. If the admin has a post, some demo people reply to it by name so the admin has alerts to look at; if not, those posts are plain posts that greet the admin. The admin follows 9 of the demo people and 10 follow the admin. The code is in `src/demo/`. There are two ways to add it. (1) **Locally:** `bun run db:seed` fills the local database that `bun run dev` uses (it opens only the local copy of D1 and R2 and refuses to run before `/setup` has made an admin); the demo people can sign in with `demo-password` and an email like `meera_rao@demo.example.com`; running it twice changes nothing; to start again delete `.wrangler/state`. (2) **On a real site, from `/hq/demo`** (owner decision, session 45, an exception to the earlier rule that fake data stays out of a real instance): the admin presses "Add demo people" and the page runs the work in steps (7 of them, because one request may make only about 1000 calls to the database and storage); a step that stopped can be run again, nothing is made twice. On a real site the demo people have **no sign-in at all** (no password record), so nobody can use their accounts; they are found only by an email ending in `demo.example.com` together with one of the 14 demo usernames, so a real member is never matched. "Remove demo data" (asked twice) deletes every such person with their posts, pictures in R2, likes, saves, reposts, follows and alerts, deletes any reply a real member wrote to a demo post (a reply cannot outlive its post), and counts the likes, replies and reposts again on every post that stays. Real members see the demo people until they are removed. Both actions check the admin on the server every time (404 for anyone else) and never log anything a person typed.

**Members and numbers** (admin and moderators). `/hq/members` lists everyone, newest first, 25 at a time, with a search (name, username, and email for the admin only) and three filters (everyone, moderators, waiting for approval). Each person shows their role, whether the account is private, when they joined and through whose link, and these counts: posts (not replies or quotes), replies, quotes, reposts, pictures, GIFs, link cards, likes given, likes received, followers and following. Removed posts are not counted. `/hq/stats` ("Activity") shows totals for people (members, waiting, moderators, private accounts), for what they made (posts, replies, quotes, pictures, GIFs, link cards, places, removed posts), for how they react (likes, reposts, mentions, follows), and a table of the last eight blocks of seven days (new members, posts, replies, likes). Everything is counts: no page names who liked, reposted or looked at whom, and **saves are left out completely**, even as totals (bookmarks are private). The admin makes or removes a moderator with one button per person; sending the same state twice changes nothing; the admin and someone still waiting cannot be made moderators.

**Performance goal:** first load on a 4G phone under 2 seconds, feed rendered on the server. Latest two versions of Safari on iPhone and Chrome on Android.

**CI (GitHub Actions), required to merge:** install, lint, typecheck, unit, integration, build (OpenNext), end to end, dependency audit, secret scan, and a migration check (apply from empty, and from the previous release). **What runs when (session 47, to save the free CI minutes):** on a branch, a push that changes code runs everything; a push that changes only documentation (`docs/`, any `.md` file, `LICENSE`) runs only the sign-off, audit and secret scan; after a merge to `main` the unit, integration and browser tests are not run again (the pull request ran them on the same code) and the deploy job builds the app itself, so a build or type error still stops it before anything is uploaded; a documentation-only merge is not deployed. The browser tests reuse the build the build job made, and each browser test counts its own posts apart from the others (test mode only), so no test waits for a rate limit to reset. The post limit itself is tested directly in the integration tests. `scripts/ci/changes.sh` decides this, and any doubt means "run everything".

**Delivery**

- Every PR gets a preview deploy (separate Worker, D1, R2).
- Merge to `main` deploys the official **demo instance**, data reset on a schedule (after phase 7).
- The Release workflow creates the tag and a GitHub Release with notes (manual, see Branching).

**Branching (trunk-based)**

- `main` is protected: PR required, CI green, at least one review (the owner may self-merge until there are other maintainers), linear history, squash merge, no force pushes.
- Short-lived branches `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- **Conventional Commits** enforced on PR titles, so release notes read well. Releases are cut **by hand**: the owner runs the **Release** workflow (Actions, manual, from `main`) with a version such as `0.1.0`. It checks that CI is green on that commit, creates the tag and a GitHub Release, and GitHub generates the notes from merged PR titles. `package.json` stays at `0.0.0` (the git tag is the version). Before 1.0, a breaking change bumps the minor version.
- `v0.x` while the feature set settles; `v1.0` when upgrade paths and setup are stable.
- Hotfixes: branch from `main`, fast PR, patch release.

## 15. Open-source project

- **Licence: AGPL-3.0.** Anyone can run it for any group, free. Anyone running a modified version for others must publish their changes.
- **Name and logo** are covered by a short trademark note (`TRADEMARK.md`): forks may rebrand freely but may not pass as the official project.
- **Contribution terms:** DCO. Every commit carries a `Signed-off-by` line (`git commit -s`), enforced by a CI check. There is no CLA; contributors keep their copyright and their code is licensed AGPL-3.0.
- **Root files:** `README.md` (what, screenshots, one-click deploy, plan requirements), `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `TRADEMARK.md`; `.github/` issue and PR templates, `CODEOWNERS`, Dependabot.
- **Docs:** self-hosting guide (deploy, secrets, Resend, custom domain, media domain, backups, upgrading), admin guide (`/hq`), contributor guide (local setup, tests, architecture).
- **Repo layout:** single app plus `docs/` (see `CLAUDE.md`).
- **Issue hygiene:** labels, "good first issue", a public roadmap board.

## 16. Build plan

Greenfield. CI exists from the first commit.

| Phase | Output |
|---|---|
| **0. Spikes** (throwaway) | (1) Next 16 on Workers via OpenNext: page, server action, Edge middleware, D1 call. (2) Better Auth on D1: sign-up, sessions, text ids, hashing time within the CPU limit. (3) D1 SQL: window functions, `ln`/`pow`, `INSERT OR IGNORE`, recursive queries, foreign keys and cascades, FTS5 incl. triggers, prefix queries, and whether the `trigram` tokenizer exists. (4) R2: upload through the Worker, read through a media domain. (5) Fetch a Google font and serve it from R2. (6) Link-preview SSRF approach on Workers. Each ends with a written yes or no |
| **1. Foundation** | Repo, AGPL, OSS files, CI, branch rules, release automation, Next + OpenNext skeleton, D1 schema and migrations, test harness, theme token system with contrast-safe colour derivation, deploy button, README |
| **2. Instance and access** | Setup flow with `SETUP_TOKEN`, atomic configure, Better Auth, sign-in, invite links and quota, pending state and waiting screen, email verification and reset, branded React Email templates |
| **3. `/hq` v1** | Wide admin layout, branding editor with live preview and font fetching, approvals queue, invites view, email settings and test send |
| **4. Core social** | Profiles, posts, media upload, follow, like, repost, quote, reply, bookmark, hashtags, mentions, Following feed |
| **5. Discovery** | For you ranking, Mates, suggestions, full-text search, notifications, privacy (private, block, mute) |
| **6. Insight and extras** | Analytics, GIFs (optional), link previews, place suggestions (optional) |
| **7. Hardening and 0.1** | Accessibility pass, theme matrix, security review, docs complete, demo instance, first tagged release |

Phases 4 to 6 can overlap once phase 2 is done. Phases 1 to 3 give the first usable milestone: a deployable, brandable, invite-only shell.

## 17. Risks and open checks

| # | Item | Status |
|---|---|---|
| R1 | D1 has no interactive transactions; use `db.batch()` and SQL counters | Planned |
| R2 | D1 limits: 100 bound values per query, 100 KB per statement, 10 GB database on Paid | Planned around |
| R3 | `ln`, `pow`, window functions on D1 | Passed on real D1 (spike 3, run 39818136641, 2026-10-22). The For you score is still computed in TypeScript by design |
| R4 | OpenNext and Next 16: Node middleware unsupported | Edge `middleware.ts` or layout check. Open (spike 1) |
| R5 | Better Auth on D1 with text ids; hashing fits CPU limit | Passed locally (spike 2, 2026-10-22): Better Auth 1.7.12 + Drizzle SQLite adapter work on D1 with UUID text ids, millisecond timestamps, cascade deletes, case-insensitive email, 8 to 128 password rule. Hashing took about 110 to 280 ms in local workerd, far over the 10 ms Free limit and far under the Paid 30 s limit, so Workers Paid stays required. Still to confirm: the migration on remote D1 (`unixepoch('subsecond')` defaults need SQLite 3.42 or newer) and timing on the live Worker. The Drizzle D1 adapter has no transactions, so sign-up (user row, then account row) is not atomic: a failure between them can leave a user without an account, handled in phase 2 |
| R6 | Worker bundle size limit (10 MiB compressed on Paid) | Open |
| R7 | Self-hosters on Workers Free will hit CPU and query limits | Document Paid as required; test on Paid |
| R8 | Font fetch: Google Fonts API behaviour, OFL-only, file size | Open (spike 5) |
| R9 | D1 export does not include virtual (FTS) tables; FTS5 trigram tokenizer availability; FTS triggers inside `db.batch()` | FTS5 with accent-insensitive prefix matching and triggers, and the `trigram` tokenizer, all run on real D1 (spike 3). Still open: D1 export of virtual tables (index stays rebuildable; backup guide covers it) and triggers inside `db.batch()` |
| R10 | Link-preview fetcher can't pin resolved addresses on Workers | Mitigated (session 41): DNS-over-HTTPS check of every answer, every redirect re-checked, feature off by default. A page that changes its address between check and visit is the accepted limit |
| R11 | Migration safety across instances on different versions | Policy: expand then contract; CI checks upgrade from previous release |
| R12 | Email deliverability depends on the admin verifying a sending domain | Document clearly; show Resend's errors |
| R13 | SVG logos in email clients | Require PNG for email; fall back to name text |
| R14 | Single D1 writer; location hint | Fine at this scale; document hint |
| R15 | Invite abuse (leaked link, quota gaming) | Rate limits, revoke, approval past quota |
| R16 | Losing `SETTINGS_ENCRYPTION_KEY` | Documented; recovery is re-entering keys |
| R17 | Accessible colour derivation for any hex, both themes | Design and test in phase 1 |
| R18 | Search over scripts without spaces (CJK) needs the trigram tokenizer | Available on real D1 (spike 3). Decide in the search phase whether to index with `trigram` instead of or beside word-prefix matching |

## 18. Decisions log

| # | Decision | Value |
|---|---|---|
| 1 | Hosting | Cloudflare only (Workers, D1, R2) |
| 2 | Greenfield | Nothing reused from `netmate.vercel.app` |
| 3 | `/hq` v1 scope | Branding, approvals, invites, email |
| 4 | Membership | Invite-only; admin link unlimited; each member link auto-approves first 5 (setting), then admin approval; slots never freed |
| 5 | Licence | AGPL-3.0 |
| 6 | `SETUP_TOKEN` | Required at `/setup` |
| 7 | Media domain | Separate media subdomain |
| 8 | Contribution terms | DCO (sign-off on every commit), no CLA. Confirmed by the owner 2026-10-22 |
| 9 | Fonts | Self-hosted in R2 (chosen by assistant: no reader contact with Google, works offline from the instance) |
| 10 | Demo instance | Yes, with scheduled reset, after phase 7 |
| 11 | Defaults | Name "Netmate" with a built-in logo and favicon |
| 12 | Repo | Single app plus `docs/` |
| 13 | Search | Full-text index (FTS5) from the start |
| 14 | Cloudflare extras | WAF and Turnstile optional after v1 |
| 15 | Package manager | Bun (changed from pnpm by the owner, 2026-10-22) |
| 16 | Ids | Stripe-style prefixed ids (`usr_` + 24 base62 characters), replacing UUIDs. Owner request, 2026-10-22 |
| 17 | Releases | Manual: a Release workflow (workflow_dispatch with a version) tags and creates a GitHub Release with generated notes. release-please was tried and removed on 2026-10-22: GitHub GraphQL errors, default first version 1.0.0, release PRs without CI. Owner decision |
| 18 | Demo data on a real site | Owner decision, session 45: the admin can add and remove demo people and posts from `/hq/demo` on a real instance (an exception to "fake data only for local development and tests"). The demo people have no sign-in, so the exception cannot be used to get into a real site; removing is complete (posts, pictures, alerts, counters) |
| 19 | Moderators | Owner decision, session 46: one owner (the only admin, as before) plus moderators, who are members the admin flags. No second admin. A moderator can see the members list, the numbers and the report cases, and (to be built) remove posts and replies and suspend members; not approve sign-ups, and never settings. Numbers are counts only and leave out saves (bookmarks are private) |
| 20 | Reports | Owner decision, session 48: members report a post for one of eleven reasons and each report becomes a case with a number (CASE-000123). The admin and moderators work the cases; the author is never told; a moderator never sees a case about themselves. Staff read a copy of the post taken when it was reported (an exception to `visibleTo`, because the reporter shared that text) |
| 21 | Paid subscriptions | Owner decision, session 49: Polar takes the payments and they land in the instance owner's Polar account; the owner sets the share the member earns (default 50%) and pays members out by hand until payout automation exists. Posts get an audience, Everyone or Subscribers. Subscribers lose sight of subscriber posts when their subscription ends. The member's share is of the payment before tax; Polar's fee comes out of the owner's side; a refund takes the share back in proportion. Built in four steps; step 1 (connect Polar, the split) and step 2 (prices, Subscribe, Polar's messages) are done |

## 19. Not in v1, and ideas

**Not in v1:** federation, direct messages, video, polls, lists, verified badges, ads, native apps, multiple admins, email-domain rules and open sign-up modes, per-member quota overrides, trending hashtags, typo-tolerant search, a Likes tab on profiles, member data export, instance-to-instance migration tooling, "not interested" on posts, topic interests, uptime monitoring and error reporting setup.

**Ideas (not decided):** follower growth tips in analytics, copying link-card pictures into our own storage with a "remove preview" button, a "why am I seeing this" explanation on For you, hosting our own place suggestions, quote counts in the ranking, Turnstile on sign-up.
