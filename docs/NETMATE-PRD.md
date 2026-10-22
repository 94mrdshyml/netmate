# Netmate: Product Requirements

**Version:** 2026-10-22. **Status:** the app is built and live with a small group of real users. The move to Cloudflare is decided but not started.

This is the one document that says what Netmate is, what it does today, and what the Cloudflare move changes. Older docs (`PRD.md`, `ARCHITECTURE.md`) record the first build and are partly out of date; this one replaces `PRD.md` as the product reference. `ARCHITECTURE.md`, `FEED.md`, `ANALYTICS.md`, `DESIGN.md` and `TEST-ACCOUNTS.md` stay as the detailed notes for their own areas.

## Contents

1. What Netmate is
2. Where we are today
3. The move to Cloudflare, in short
4. Product rules
5. Features
6. Screens and routes
7. Data
8. The numbers that define behaviour
9. Security and privacy
10. Quality and performance
11. Target architecture on Cloudflare
12. What changes in the code
13. Migration plan
14. Risks and open checks
15. Decisions for the owner
16. Not built, and ideas for later
17. Sources

---

## 1. What Netmate is

Netmate is a Twitter/X-style microblogging web app, built for phones. People post short messages (up to 280 characters) with photos, GIFs and links, follow each other, like, repost, reply, quote and save posts, and see a home feed that mixes people they follow with popular posts from people they don't.

What makes it Netmate and not a copy:

- **Mates.** Anywhere you see a person, the app can say "Followed by Meera and 2 more", meaning people you follow follow them. It is used for suggestions, search results, profiles and follower lists.
- **Owner-only analytics.** Every account gets its own analytics page: reach, profile visits, followers over time, a funnel from "saw you" to "followed you", engagement, and best posts. Only you can see yours, and it only shows counts, never who.
- **Brand.** True-black dark theme, one yellow (`#FFD400`) used sparingly, a light theme that follows the phone.

**Audience:** at the moment about 3 real people plus 36 fake test accounts. The product is built to work at that size and grow from there.

**One-line pitch:** a small, calm, mobile-first social feed that shows you what's worth reading and tells you honestly how your own posts are doing.

## 2. Where we are today

| Item | State |
|---|---|
| Live site | `netmate.vercel.app` (Vercel, Singapore region) |
| Database | Neon Postgres, Singapore |
| Sign-in | Neon Auth (managed Better Auth) |
| File storage | Neon Object Storage |
| Real users | about 3 |
| Test data | 36 fake accounts, about 430 posts, about 9,700 analytics events, living in the production database (see section 5.14) |
| Code size | about 8,000 lines in `app` and `src`, about 9,300 with scripts and migrations |
| Tests | 125 unit tests, 14 service checks, 33 integration checks (3 of the 33 need real file storage, so they only run against a live environment) |
| Database migrations | 10 (`0000` to `0009`) |

Everything in section 5 is built and merged to `main`, except where it says **not built**.

## 3. The move to Cloudflare, in short

The owner has decided to move the whole stack to Cloudflare. Nothing is moved yet. Section 11 onward is the plan.

| Concern | Today | Target |
|---|---|---|
| Framework | Next.js 16 | Next.js 16, unchanged |
| Where it runs | Vercel (Node.js) | Cloudflare Workers, using the OpenNext adapter for Next.js |
| Database | Neon Postgres | Cloudflare D1 (SQLite) |
| Sign-in | Neon Auth (managed) | Better Auth, run by us inside the app, with its data in D1 |
| File storage | Neon Object Storage | Cloudflare R2 |
| Background jobs | Neon Functions (unused) | Workers Cron Triggers |
| Rate limiting | a Postgres table | D1 table for strict limits, Workers Rate Limiting for high-volume ones |

What stays the same for people using the app: every feature, every screen, every rule. What changes is underneath, and a few things are harder on D1 than on Postgres. The honest list is in sections 12 and 14.

Two things found while researching that change the plan (details in section 14):

- Next.js 16 renames `middleware.ts` to `proxy.ts`, which runs on the Node.js runtime. The OpenNext Cloudflare adapter supported only Edge middleware as of its Next 16 release (January 2026). Our `proxy.ts` is only a first gate (every page checks the session again), so the plan is to use an Edge `middleware.ts` or drop it.
- R2's documentation does not say that presigned upload links can lock the file size. We rely on that today. The plan is to upload through our own Worker instead, which can check size and type itself.

## 4. Product rules

These apply everywhere and are the product's character.

1. **Mobile only.** One centred column, at most 480px wide. Wide screens show the same column in the middle. No desktop layout.
2. **Signed in to use it.** Signed-out visitors are sent to sign in. There are no public profile or post pages. (This is also why analytics only counts signed-in viewers.)
3. **Privacy first.** Private accounts, blocking and muting exist. Analytics and bookmarks are private to their owner and never show who.
4. **Plain and quiet.** Flat design, no shadows or gradients. Yellow is the only colour, used for your own actions (liked, reposted), links and tags, the unread badge, the logo and the compose button.
5. **Counts, not names, in analytics.** The analytics page never names a person.
6. **Say what you want, don't toggle.** Likes, reposts, follows and bookmarks send the state the person wants ("liked"), not a flip, so a double tap can't undo itself.
7. **Be honest in the UI.** Zeros show as zeros, "new" is never shown as a percentage, a suggested post says it is suggested.

## 5. Features

### 5.1 Accounts

**Sign up** needs five things, all required:

| Field | Rule |
|---|---|
| First name | 1 to 50 characters |
| Last name | 1 to 50 characters |
| Email | a valid email, up to 254 characters, unique ignoring upper/lower case |
| Username | 3 to 15 characters, letters, numbers and underscores only, unique ignoring case, stored in lower case, shown as `@username`. Cannot be changed later |
| Password | 8 to 128 characters |

The username field checks availability as you type (after a short pause) before you submit. Some usernames are reserved because they are page addresses or would look official: `admin`, `api`, `auth`, `settings`, `home`, `explore`, `notifications`, `messages`, `search`, `compose`, `bookmarks`, `analytics`, `sign-in`, `sign-up`, `login`, `logout`, `onboarding`, `status`, `netmate`, `support`, `help`, `about`, `terms`, `privacy`, and a few more.

**Sign in** is email and password. **Sign out** is in Settings.

**Onboarding.** If someone's account exists but their profile was never created (the tab closed halfway, or the username was taken in the meantime), they are sent to a short page to finish: first name, last name, username.

**Default picture.** Everyone without an uploaded avatar gets a DiceBear "Cameo" picture, made from their account id, so it stays the same even if their username changed.

**Account settings** (`Settings > Account`): shows the email, lets you change your password (current password required, 5 tries per 10 minutes) and delete your account (password required). Deleting removes the profile, posts, follows, likes and everything attached to them.

**Not built:** email verification, password reset ("forgot password"), changing your email, changing your username. Also, uploaded photos are not deleted from storage when an account is deleted (the database rows go; the files stay as orphans).

### 5.2 Posting

**Compose** (full-screen sheet from the yellow button): up to 280 characters with a live ring counter, up to 4 photos, or one GIF, or a quoted post. A post needs text, a photo, a GIF or a quote; it can't be empty. A post can be a reply or a quote, not both. A GIF can't go with photos.

**Photos.** JPEG, PNG, WebP or GIF files. Post photos up to 5 MB each. Photos are sent from the phone straight to storage, then attached to the post.

**GIFs.** A GIF button opens a full-screen search powered by Klipy. The phone talks to Klipy directly (not through our server). GIFs are loaded from Klipy's own addresses and never copied to our storage, as Klipy's terms require. The search box says "Search KLIPY" and results appear in Klipy's order. The server only accepts GIF addresses that really come from Klipy's media host. (Tenor, the usual choice, closed its API on 30 June 2026.) A testing key is limited to 100 requests an hour; a production key has to be requested from Klipy before real traffic.

**Link previews.** If a post's text contains a link and the post has no photos, GIF or quote, the server fetches that page once when the post is made and saves a small card (title, description, picture, site name). If the page is slow, broken or unsafe, the post goes out without a card. Limited to 20 fetches per 10 minutes per person. The server visits an address a person typed, so the fetcher is built to refuse private and internal addresses, checks every redirect, allows only ports 80 and 443, waits at most 3 seconds, reads at most 512 KB, and accepts only HTML. Card text is shown as plain text and the picture is loaded by the reader's browser without sending a referrer. Trade-off: the picture is loaded from the other site, so that site sees the reader's IP address.

**Hashtags.** `#tag` in a post becomes a tappable link to a search for that tag. Tags are lower-cased and stored per post (up to 10 distinct tags per post, each up to 50 letters, numbers or underscores).

**Mentions.** `@username` in a post links to that profile and sends that person a "mention" alert (once per post).

**Reply.** From a post's page, a reply box sits under the post. Replies are posts that point at a parent. They appear under the post (newest first), on the replier's Replies tab, and the parent's reply count goes up. Replies never appear in the home feed.

**Like.** Heart on every post. Idempotent. Likes the author a notification (not for liking your own post).

**Repost and quote.** The repost button opens a small sheet: Repost (or Undo repost) or Quote. A repost puts the post in your followers' feeds with "X reposted" above it. A quote opens the composer with the original post shown under your text; the quote text may be empty. If the original is deleted or you can't see it, the quote card says "This post isn't available". A private account's posts can't be reposted or quoted. Quoting alerts the author.

**Bookmark (save).** Bookmark icon on every post. Private: no count shown to anyone, no alert. See 5.9.

**Share.** Opens the phone's share sheet with the post's link, or copies the link where sharing isn't available.

**Delete.** You can delete your own posts from the post menu. Deletion hides the post everywhere (it is kept in the database but marked deleted).

**Post page** (`/[username]/status/[id]`): the post, its action row, the reply box and the replies.

**Time.** Shown relatively ("5h", "2d").

### 5.3 The home feed

Home has two tabs under the top bar. **For you** opens first.

**Following** is the original feed: your own posts and posts from people you follow, plus their reposts, newest first. A post can appear twice, once as itself and once as someone's repost.

**For you** is ranked. What can appear in it:

1. Your own posts.
2. Posts by people you follow.
3. Posts someone you follow reposted (with "X reposted" above).
4. Strangers' public posts, only if they have traction: at least 2 likes, reposts or replies in total, or at least one person you follow liked or reposted them. These carry a grey "Suggested for you" line above them.

Only top-level posts from the last 7 days. Never shown: replies, deleted posts, anyone you blocked or who blocked you, anyone you muted, private accounts you don't follow.

**How a post is scored** (higher is shown first). Five parts multiplied together:

| Part | Rule |
|---|---|
| Reactions | `1 + ln(1 + likes + 2 x reposts + 2 x replies)`. The tenth like counts much less than the first |
| Freshness | halves every 12 hours, counted from when the post reached you (the repost time for a repost) |
| Closeness | you and people you follow count 1, a stranger counts 0.4, a post reposted by someone you follow counts 1. Each time in the last 30 days you liked, reposted, saved or replied to that author adds 15%, up to 8 times. For a stranger's post, each person you follow who liked or reposted it adds 25%, up to 4 people |
| Already seen | a post you have seen counts 0.15 (seen means half of it was on screen for a second) |
| Same author again | the second post by the same author counts 0.7 of its score, the third 0.7 x 0.7, and so on |

**Paging.** Lists load more as you scroll. For you pages by score, and remembers the moment the first page was made, so views recorded while scrolling can't reshuffle what you've already seen. A like arriving mid-scroll can nudge a post slightly; duplicates are dropped on the phone.

**New posts pill.** Every 30 seconds while the tab is visible, the app checks for new top-level posts from people you follow. If there are any, a pill "N new posts" appears under the top bar (capped at "99+"). Tapping it scrolls to the top and reloads the tab you are on.

**Mates block.** After the third post, a "Mates of your mates" block suggests up to 4 people followed by people you follow, with a Follow button.

**Empty and end states.** For you: "Nothing here yet" with the mates block. Following: "Your feed is empty". The end of For you says "That's everything from the last 7 days."; the end of Following says "You're all caught up."

**Checked on test data:** accounts following 10 or more people see 0 to 5% strangers on the first page; accounts following 6 see 10 to 35%; an account following nobody still gets a full feed of popular posts. Every number in the scoring is a named constant in one file, so tuning is a small change.

### 5.4 Profiles

`/[username]` shows: banner (3:1 picture, or a flat colour if none), avatar, name, `@username`, bio, joined date, city or country, link, follower and following counts, and the Mates line ("Followed by ..."). Two tabs: **Posts** (with reposts) and **Replies**. There is no Likes tab.

**Your own profile** has Edit profile and an Analytics button. **Other profiles** have Follow (or Following, with Unfollow on hover or long press, or Requested for private accounts). If someone blocked you, or you blocked them, the page says so instead of showing posts. A private account you don't follow shows only the header.

**Edit profile** (`Settings > Edit profile`): first name, last name, bio (up to 160 characters), city or country, link, avatar (up to 2 MB), banner (up to 5 MB).

**Link in bio.** One link per profile, up to 100 characters. "riya.dev" gets `https://` added. Only http and https links with a real domain are accepted, no username:password inside. Shown without the scheme, opens in a new tab, marked `nofollow`. Taps on it are counted in analytics.

**City or country.** Plain text, never coordinates. While typing, the app suggests cities, states and countries from OpenStreetMap (through the free Photon service, called from the server with a 3 second limit and 40 lookups per minute per person). Streets and house numbers are filtered out. If Photon is down, the field still works as plain text. Photon is a free shared service: if traffic grows, host it ourselves or pay for a geocoder.

### 5.5 Following, followers, Mates and suggestions

- **Follow and unfollow** are idempotent. Following a private account sends a request instead (see 5.8). Limited to 30 follows per 10 minutes.
- **Followers and following lists** (`/[username]/followers`, `/following`) are paged. Each row shows the avatar, name, bio, a Follow button and the Mates line.
- **Mates** are "people you follow who follow this person". The line shows up to a few names and "+ N more".
- **Suggestions** ("people you may know", used in the mates block and on the search screen): people followed by the people you follow, most shared first. If that gives too few (for example a new account that follows nobody), the newest accounts fill the rest. People you blocked or who blocked you are skipped.

### 5.6 Search and hashtags

One search screen (`/search?q=`) with two tabs, Posts and People.

- **People:** matches the start of a username, first name, last name or full name, ignoring case; a leading `@` is allowed. An exact username match comes first. Capped at 20 results, not paged. Blocked people are skipped. Each result shows the Mates line.
- **Posts:** `#tag` is an exact match on a hashtag. Any other text is a case-insensitive "contains" match on the post text, 2 characters minimum. Newest first, paged, and filtered so you only see posts you are allowed to see. Replies are included. Tapping a hashtag in a post opens `/search?q=%23tag` on the Posts tab.
- With nothing typed, the screen shows suggestions (this replaces a separate Explore page).

No ranking, no typo tolerance, no trending tags yet.

### 5.7 Notifications

`/notifications` (the bell in the bottom bar, with an unread badge). Types: **like, repost, follow, follow request, reply, quote, mention.** Never for your own actions. Newest first, paged (30 per page). Likes and reposts of the same post inside one page collapse into one row ("Meera and 2 others liked your post"). Each row shows a snippet of the post (up to 140 characters). Alerts from people you blocked, were blocked by, or muted are hidden. Opening the screen marks everything read. A quote alert replaces a mention alert for the same person.

### 5.8 Privacy and safety

`Settings > Privacy`.

- **Private account.** Turning it on means nobody new can follow without your approval, and only your followers see your posts, replies, follower lists and reposts. Strangers can still see your header (name, avatar, bio). Anyone who tries to follow sends a request (and you get a "follow request" alert). You answer in `Settings > Privacy > Follow requests` (approve or decline). Turning private off approves everyone who is waiting. A private account's posts can't be reposted or quoted.
- **Block.** Removes follows and pending requests both ways and removes alerts between the two of you. After a block you can't see each other's posts or profiles, can't follow, and don't appear in each other's search or suggestions. The blocked person isn't told. Manage in `Settings > Privacy > Blocked` (up to 200 listed).
- **Mute.** Hides a person (and their reposts) from your home feed, For you and your alerts. They are not told, and nothing changes for them. Manage in `Settings > Privacy > Muted`.

One rule decides who can see what (`visibleTo`): you can see an author's content if it's yours, or if neither of you blocked the other and the author is public or you follow them. Every list of posts, the post page, replies, quotes, bookmarks, the feed and analytics recording all use it.

### 5.9 Bookmarks

The bookmark icon saves a post privately. `/bookmarks` (linked from Settings) lists them, newest saved first, paged. Posts you can no longer see (deleted, author went private, blocked) are skipped, not shown. Nobody sees your list, and nobody sees a count of bookmarks on a post. The post's author sees only a total count of saves in their own analytics, never who.

### 5.10 Analytics

`/analytics`, reached from your own profile and from Settings. **Only the signed-in owner sees their own page.** It takes the signed-in person's id from their session and has no way to ask for someone else's. It never names a viewer.

**Range:** 7 days or 28 days, as whole UTC days including today. All totals and charts use the same window, so they add up.

**What is counted** (only signed-in viewers; a signed-out visitor can't see anything in the first place):

| Event | When it counts |
|---|---|
| Post impression | half of the post is on screen for one second |
| Profile impression | a person's row shows on screen: in search, in followers or following lists, in "people you may know" |
| Profile visit | someone opens your profile (sent from the page after it loads, so prefetching and refreshes don't count) |
| Bio link click | someone taps the link in your bio |
| Link card click | someone taps a link card on one of your posts |
| Share | someone's share sheet finished, or they copied the link to your post |
| Follow, unfollow | written by the server at the moment a follow changes (including approvals, going public, and blocks) |
| Likes, reposts, quotes, replies, saves | read from the normal tables, not from events |

Rules for recording: the phone sends only a kind and a post or profile id; the server looks up the owner itself, so a phone can't claim events for someone else. The server drops anything the viewer isn't allowed to see, anything about themselves, and repeats: a view or tap counts once per person, per thing, per day. Events are queued on the phone and sent every 5 seconds, at 20 waiting, or when the tab goes to the background (a few can be lost if the app is closed outright). Limited to 60 reports a minute per person.

**What the page shows**, top to bottom:

1. **Overview.** Impressions as the big figure with its change against the same number of days before ("+141% vs the 7 days before"; "new" when there was nothing before, never a percentage from zero). Beside it: profile visits, followers (now, with net change) and engagement. Tapping any of the four switches the daily chart below it (one column per day; tap or drag to read one day; the best day is labelled).
2. **From seen to followed (the funnel).** Counts people, not taps: people who saw you, then opened your profile after that, then followed after that. Each bar is its true share of the people who saw you, with the step-to-step rate between bars. People who already followed when they first saw you are left out of every step. "Visited without seeing a post" counts profile visitors who hadn't seen anything of yours in the 7 days before (search, a link, a mention).
3. **Who saw you.** Impressions from people who follow you now against everyone else, with shares. This uses today's follower list, so it is a close estimate, not exact history.
4. **What people did.** Likes, reposts, quotes, replies and saves as ranked bars (other people's actions only, on your undeleted posts), then bio link taps, link card taps and shares as three figures.
5. **Best posts.** Top 5 by engagement per 100 views. A post needs at least 5 views to be ranked. The rate can go over 100%, since one person can like, repost and save.

**Storage.** One append-only table. View and tap rows older than 60 days are deleted (so the 28-day view and the 28 days before it are always covered). Follow and unfollow rows are kept forever. The database design is in section 7.

**Not doing:** who viewed you, age or gender, video views, best time to post.

### 5.11 Spam protection and limits

Limits are counted per person, or per IP address for sign-up and sign-in.

| What | Limit |
|---|---|
| Posts | 10 per minute |
| Likes | 60 per minute |
| Reposts | 30 per minute |
| Saves (bookmarks) | 60 per minute |
| Follows | 30 per 10 minutes |
| Uploads | 30 per 10 minutes |
| Link-preview fetches | 20 per 10 minutes |
| Location suggestions | 40 per minute |
| Analytics reports | 60 per minute |
| Sign-up | 10 per 10 minutes per IP |
| Sign-in | 30 per 10 minutes per IP, and 10 per 10 minutes per email |
| Username availability checks | 60 per minute per IP |
| Password checks (change, delete) | 5 per 10 minutes |
| Any request to the sign-in service | 60 per 10 minutes per IP |

Reads, search, mutes and blocks are not limited. A determined attacker with many IP addresses needs a firewall (Cloudflare WAF) in front.

### 5.12 Settings map

| Row | Goes to |
|---|---|
| Bookmarks | saved posts |
| Analytics | the analytics page |
| Edit profile | name, bio, city, link, photos |
| Privacy | private account, follow requests, blocked, muted |
| Account | email (shown), password, delete account |
| Log out | signs out |

### 5.13 Design and experience

- **Theme.** Dark (true black) by default, light follows the phone, and a toggle in the top bar sets a cookie to override it. Both themes are designed and checked.
- **Colour.** One yellow. In light mode yellow text becomes a darker gold (`#7A6000`) so it can be read on white.
- **Layout.** Top bar (avatar, logo, theme toggle), bottom tabs (Home, Search, Alerts, Profile), a round yellow compose button on Home and your own profile. Tap targets are at least 44px and the layout respects the phone's safe areas.
- **Type.** One typeface (Inter), no emoji in the interface, no em dashes in the interface text.
- **Icons.** One icon set (Feather).
- **No** shadows, gradients, glows or cards in the feed.
- **Accessibility.** Contrast meets WCAG AA; screens work with a keyboard and screen reader; charts have a hidden table of the same numbers.

### 5.14 Test accounts and fake data

To test the feed and analytics, production holds **36 fake accounts** (emails end in `@seed.netmate.test`) with about 430 posts of every kind (text, photos, GIFs, links, hashtags, quotes, replies), follows, likes, reposts and saves, plus about 9,700 fake analytics events and 25 follow-then-unfollow pairs so the analytics page has history. They are real rows in the production database, so real accounts see their posts in For you as "Suggested for you" when they have traction. `TEST-ACCOUNTS.md` has every login, how they were made and the exact steps to remove them. Deleting an account removes everything attached to it.

## 6. Screens and routes

| Route | Screen |
|---|---|
| `/` | Home: For you (default) and Following (`/?feed=following`). Signed out: redirected to sign in |
| `/sign-in`, `/sign-up` | Account screens (no app shell) |
| `/onboarding` | Finish a profile for an account that has none |
| `/compose` | New post (also `?quote=<id>` and reply from a post page) |
| `/[username]` | Profile (`?tab=replies` for Replies) |
| `/[username]/status/[id]` | Post and replies |
| `/[username]/followers`, `/[username]/following` | People lists |
| `/search?q=` | People and posts; `#tag` opens the Posts tab; suggestions when empty |
| `/notifications` | Alerts |
| `/bookmarks` | Saved posts |
| `/analytics` (`?range=28`) | Your analytics |
| `/settings` | Settings home |
| `/settings/profile`, `/settings/account` | Edit profile; email, password, delete |
| `/settings/privacy`, `/settings/privacy/requests`, `/blocked`, `/muted` | Privacy and its lists |
| `/api/auth/*` | The sign-in service |
| `/api/me` | Tells the phone if it is signed in (401 if not) |

## 7. Data

All data below must exist on D1. Types change from Postgres: ids become text (UUID strings made in code), timestamps become whole milliseconds since 1970 in UTC, yes/no becomes 0/1, and Postgres "enums" become text with a check.

| Table | What it holds |
|---|---|
| Auth tables (from Better Auth) | users (id, email, name), accounts (password hash), sessions, verification tokens. Created by Better Auth, not by us |
| `profiles` | one per user: username (unique, lower case), first and last name, bio, link, location, private flag, avatar and banner storage keys, created time |
| `posts` | body (up to 280), author, parent (for replies), quoted post, reply, like and repost counts, created time, deleted time |
| `post_media` | up to 4 per post: kind (`image` or `gif`), key (a storage key for photos, the full Klipy address for GIFs), width, height, position |
| `post_links` | one link card per post: url, title, description, image, site |
| `post_tags` | one row per distinct hashtag per post (indexed by tag and time) |
| `follows` | follower, followee (no self-follow) |
| `follow_requests` | pending asks to follow a private account |
| `blocks`, `mutes` | who blocked or muted whom |
| `likes`, `reposts`, `bookmarks` | one row per person per post |
| `notifications` | recipient, actor, type, post, read time (no self-notify) |
| `rate_hits` | one row per limited attempt, with a key and time, pruned after a day |
| `analytics_events` | append-only: owner, viewer, kind, post, day, time. One row per person per thing per day for the six view and tap kinds (enforced by a unique index); follows and unfollows are never squashed |

Counters on a post (replies, likes, reposts) change in the same step as the row that causes them.

## 8. The numbers that define behaviour

| Thing | Value |
|---|---|
| Post length | 280 characters |
| Photos per post | 4 (a GIF is always alone) |
| Photo size | avatar 2 MB, banner 5 MB, post photo 5 MB |
| Photo types | JPEG, PNG, WebP, GIF |
| Bio | 160 characters |
| Link in bio | 100 characters |
| City or country | 60 characters |
| Names | 50 characters each |
| Username | 3 to 15 characters |
| Password | 8 to 128 characters |
| Hashtags per post | 10 |
| Page size | 20 posts, 30 alerts |
| For you pool | last 7 days |
| For you halving time | 12 hours |
| Stranger weight | 0.4; needs 2 reactions or a followed person's reaction |
| Seen weight | 0.15 |
| Same-author decay | 0.7 each |
| New-posts check | every 30 seconds while visible; shows up to "99+" |
| Analytics ranges | 7 and 28 UTC days |
| Best-post minimum | 5 views, top 5 |
| Analytics view and tap retention | 60 days |
| Analytics report batch | up to 30 events, every 5 seconds |
| Link preview | 3 seconds, 512 KB, 3 redirects, ports 80 and 443 |
| Lists of blocked and muted people | up to 200 shown |
| People search | 20 results |

## 9. Security and privacy

- **Passwords** are handled only by the sign-in service (Better Auth). We never store or log them.
- **Every server action checks the session itself.** Actions can be called directly by anyone, so they never trust a user id sent from the phone.
- **Post text is always shown as text.** @mentions, #tags and links are found by reading the text, never by putting HTML into the page.
- **Uploads.** The server checks the session, file type and size before accepting a file, and before a stored file is attached to a post or profile it checks again that the file exists, belongs to that person (the key starts with their id) and is an allowed image. Anything else is refused and deleted.
- **Link fetching** is guarded against requests to internal addresses (see 5.2).
- **Visibility** has one rule used everywhere (see 5.8).
- **Analytics privacy.** Owner only, counts only, no names. Saves are shown as a total. The phone cannot name an owner.
- **Cookies.** The session cookie is set by the sign-in service. A separate theme cookie remembers dark or light.
- **Third parties.** Klipy (GIF search, called from the phone), Photon / OpenStreetMap (place suggestions, called from the server), DiceBear (default pictures), and the sites behind link previews (their pictures load in the reader's browser).
- **Firewall.** Cloudflare WAF and Turnstile (a bot check) are worth adding in front of sign-up. Not set up yet.

## 10. Quality and performance

- **Speed goal:** first load on a 4G phone under 2 seconds, with the feed built on the server.
- **Browsers:** the latest two versions of Safari on iPhone and Chrome on Android.
- **Accessibility:** WCAG AA contrast; keyboard and screen-reader usable.
- **Tests:** unit tests for validation, text parsing and cursors; integration checks that run the real server code against a database (feed, paging, likes, reposts, follows, privacy, blocks, mutes, search, notifications, uploads, analytics, For you); a browser pass at phone width.
- **Design checks:** a lint and a real-browser inspection of every screen at 390px and 768px wide, in both themes.
- **Known performance limit:** the For you query scores every post in the 7-day pool on each call. Fine for hundreds of posts, probably for a few thousand. Review at about 10,000 posts in the pool.
- **Not set up:** error reporting and uptime monitoring.

## 11. Target architecture on Cloudflare

```
Browser
  │
  ▼
Cloudflare (DNS, CDN, WAF, Turnstile)
  │
  ▼
Worker "netmate"  ── Next.js 16 built with @opennextjs/cloudflare
  │   Server Components · Server Actions · Route Handlers · Better Auth at /api/auth
  ├──► D1 database      (binding DB)       app data and Better Auth data
  ├──► R2 bucket "media" (binding MEDIA)   photos; public reads through a custom domain
  ├──► Rate Limiting    (binding LIMITER)  high-volume limits (likes, events)
  └──► Cron Trigger     daily clean-up: old analytics rows, old rate_hits
```

**Plan needed.** Workers Free allows 10 ms of processor time per request and 50 database queries per request, which a Next.js page with database work will very likely exceed. Workers Paid (30 seconds of processor time by default, 1,000 queries per request, 10 GB per D1 database) is the realistic starting point.

**Request flow.** A page request reaches the Worker, which checks the session (Better Auth reads the cookie and looks up the session in D1), runs the queries through the D1 binding, and renders. Server Actions work the same way.

**Auth flow.** Sign-up is still one server action that checks the five fields, checks the username, creates the account through Better Auth, creates the profile, and signs the person in. Better Auth runs in our own Worker with a D1 database, and password hashing must fit inside the Worker's processor-time limit (checked in the first spike). Sessions live in D1 (optionally cached in KV later).

**Upload flow.** Recommended: the phone sends the file to our Worker (`POST /api/upload`), the Worker checks session, rate limit, file type and size (and sniffs the file's first bytes), writes it into R2 through the binding, and returns the key. This replaces "presigned upload link" because R2's docs do not say a presigned link can lock the file size. 5 MB is far below the Worker's 100 MB request limit. The alternative is presigned links plus the existing check after upload (the Worker looks at the stored file's size and type before attaching it).

**Reading photos.** The bucket is served on a custom domain such as `media.<ourdomain>` (cached by Cloudflare). Presigned links don't work on custom domains, which is another reason to upload through the Worker.

**Rate limiting.** Strict, low-volume limits (sign-in, sign-up, password checks) stay in a D1 table where counts are exact. High-volume limits (likes, events, saves) move to the Workers Rate Limiting binding, which is approximate and counts per Cloudflare location, which is fine for abuse control.

**Clean-up jobs.** The "1 in 100 writes prunes old rows" trick is replaced by one daily Cron Trigger that deletes analytics view and tap rows older than 60 days and old rate-limit rows.

**Environment.** Bindings replace most variables: `DB`, `MEDIA`, `LIMITER`. Remaining secrets: Better Auth secret, the app's public URL, the Klipy key (public), and an email provider key if email is added.

**Local work.** `wrangler dev` with local D1 and R2, and `wrangler d1 migrations` for schema changes. Bun stays as the package manager and script runner for development only.

## 12. What changes in the code

The app's layers stay (pages → actions → server → db). The work is almost entirely below that line and in auth and storage.

| Area | Today | On Cloudflare | Size |
|---|---|---|---|
| Database access | Postgres pool through `pg` and Drizzle | Drizzle with the D1 driver; one `getDb()` using the binding per request | M |
| Column types | uuid, timestamptz, enums, bigint identity, boolean | text ids, integer milliseconds, text with checks, integer primary key. Cursors become `(milliseconds, id)`, which is simpler than carrying Postgres's text timestamp | M |
| Transactions | interactive transactions keep counters in step with rows | D1 has no interactive transactions. Use `db.batch()` (all statements succeed or all roll back) and make each change a fixed list of statements, with the counter changes done as SQL in the same batch. Anything that reads then writes needs a rewrite as conditional SQL | L |
| Bound values per query | no real limit | at most 100 per query: cap `IN (...)` lists (feed hydration uses about 20) and write events as small batches | S |
| `visibleTo` and other shared SQL | Postgres `exists` and subqueries | the same idea, works in SQLite (to verify against D1) | S |
| Post search "contains" | `ilike` plus `pg_trgm` index | `LIKE '%text%'` (a scan, fine for tens of thousands of posts) or an FTS5 index. SQLite's `LIKE` ignores case only for plain English letters, so names with other scripts need a lower-casing step (to check) | M |
| Hashtag search | `post_tags` table | unchanged | S |
| People search and suggestions | `like`, joins, `order by` | works, with the same lower-casing note | S |
| Analytics recording | `jsonb_to_recordset` joined to posts, `on conflict do nothing` | multi-row `INSERT ... SELECT ... WHERE EXISTS` in a batch, `INSERT OR IGNORE` | M |
| Analytics report | six queries with `generate_series`, `filter (where ...)` counts, `date` casts | `filter` works in SQLite; replace `generate_series` with a recursive query or build the days in code; dates as UTC day text | M |
| For you ranking | one large SQL query with `power`, `ln`, window functions, `distinct on` | recommended: SQL only fetches the candidate posts and their counts (simple queries), and the score is computed in TypeScript, which is easier to test and tune and avoids depending on SQLite math functions. `distinct on` becomes a window function or grouping | L |
| Rate limits | `rate_hits` table | same table for strict limits, Rate Limiting binding for the rest | S |
| Auth | Neon Auth client and `neon_auth` tables | Better Auth with the Drizzle SQLite adapter and D1; our sign-up, sign-in, password and delete-account actions call it. User ids become text | L |
| Middleware | `proxy.ts` (Node runtime) | an Edge `middleware.ts`, or remove it (every page already re-checks the session) | S |
| Storage | S3 client, presigned PUT, HEAD check | R2 binding (`put`, `head`, `delete`), upload route in the Worker; photo URLs on the media domain | M |
| Link preview fetcher | Node `dns` lookups to pin the checked address | Workers can't pin a resolved address the same way: re-check the SSRF guard (resolve with DNS-over-HTTPS and refuse private ranges, or fetch through a small allow-checking step). Needs its own design | M |
| `@vercel/functions`, `vercel.json`, Vercel region | present | removed; `wrangler.jsonc` and D1 location hint instead | S |
| Seeding and checks | scripts run against Postgres | scripts run against local D1 (`wrangler d1`) or a test Worker; `verify:mvp` needs a rewrite of its setup | M |
| Docs and CLAUDE.md | Vercel and Neon | update stack table, commands, rules and decision log in the same change as the move | S |

Size is a rough effort guide: S is under a day, M is a few days, L is a week or more of careful work with tests.

## 13. Migration plan

Principle: keep the live Vercel + Neon site running until the Cloudflare version is proven, then switch. Never edit production data in place during the move.

**Phase 0: spikes (before committing to dates).** Each answers one doubt, with a small throwaway project:

1. Next.js 16.4 on Workers with OpenNext: a page, a server action, `middleware.ts`, a database call. (Also confirm the status of `proxy.ts`.)
2. Better Auth on Workers with D1: sign-up, sign-in, sessions, password hashing time against the processor limit, and whether the existing password hashes from Neon Auth can be reused.
3. D1 SQL: confirm window functions, partial and expression indexes, `ln` and `pow`, `INSERT OR IGNORE`, recursive queries, FTS5 (including the trigram tokenizer), foreign-key enforcement and cascades, on the real D1.
4. R2: upload through the Worker, read through a custom domain, delete.

**Phase 1: database port.** New SQLite schema in Drizzle, new migrations, rewrite of the SQL listed in section 12, a data-access layer that hides D1 details from `src/server`. Run the existing integration checks against local D1 until they pass (they are the safety net).

**Phase 2: auth.** Better Auth in the Worker; port sign-up, sign-in, sign-out, change password, delete account, onboarding; the app's user ids stay unique strings.

**Phase 3: storage.** R2 bucket, upload route, media domain. Copy the existing bucket contents across (the 12 seed photos and any real uploads) and keep the same keys so no database values change.

**Phase 4: app on Workers.** `wrangler.jsonc`, OpenNext build, bindings, cron, rate limiting binding, environment, custom domain on a staging name.

**Phase 5: data move.** Export from Neon, import into D1 (about 3 real accounts, 36 test accounts and their rows). Real users' passwords: reuse the hashes if the spike shows they are compatible; otherwise ask the 3 real people to reset or sign up again. Rebuild counters from rows to be safe.

**Phase 6: cutover.** Try the whole app on staging with real accounts; point the domain at the Worker; keep Vercel and Neon untouched for a week as the way back; then retire them and update the docs.

**Rollback.** Until Phase 6 is done, switching the domain back to Vercel restores the old site with its data. Data created on Cloudflare after cutover would have to be copied back by hand, so cutover happens when few people are active.

**Order of pull requests.** Each phase is one or more small pull requests onto `main`. Because `main` deploys to Vercel today, the Cloudflare code must not break the Vercel build until the switch. The simplest way is a branch that carries the whole port and merges once at the end, plus the spikes as separate throwaway branches. This needs a decision (section 15).

## 14. Risks and open checks

"Checked" means read in Cloudflare's or the project's own documentation on 2026-10-22; "Open" means not yet proven.

| # | Item | Status |
|---|---|---|
| 1 | D1 has no interactive transactions; `batch()` is atomic | Checked. Plan: batches plus SQL counters (section 12) |
| 2 | D1 allows 100 bound values per query, 100 KB per statement, 10 GB per database on Paid (500 MB on Free), 1,000 queries per request on Paid (50 on Free) | Checked |
| 3 | D1 supports FTS5, JSON functions, foreign keys (on by default, with a deferred option) and "math functions" | Checked in general. Open: whether `ln` and `pow` are among the math functions, whether window functions are available, whether the FTS5 trigram tokenizer exists |
| 4 | OpenNext supports Next.js 16 (since version 1.15, January 2026) | Checked |
| 5 | `proxy.ts` (Node middleware) on OpenNext | Open. As of the Next 16 release only Edge middleware was supported and the build fails on Node middleware. Use `middleware.ts` or no middleware, and re-check the adapter's current notes |
| 6 | Worker size limit 3 MiB (Free) or 10 MiB (Paid), compressed | Checked. Open: whether our bundle fits |
| 7 | Workers processor-time limit 10 ms (Free) or 30 s default (Paid) | Checked. Open: password hashing time inside the limit |
| 8 | Better Auth with Drizzle on SQLite works; D1 specifically is not covered on that docs page | Open (spike 2) |
| 9 | Better Auth user ids are text; ours are UUIDs | Open: configure id generation or accept text everywhere |
| 10 | R2 presigned PUT links exist, but the docs only describe signing the content type, not the size, and they can't be used on custom domains; a bucket CORS rule is needed for browser uploads | Checked. Plan: upload through the Worker |
| 11 | Workers Rate Limiting binding is approximate, counts per location, windows of 10 or 60 seconds only, no dashboard | Checked. Plan: use it only for high-volume limits |
| 12 | D1 read replicas need the Sessions API to avoid stale reads right after a write | Checked. Not needed at our size; keep in mind |
| 13 | SQLite `LIKE` case-insensitivity covers plain English letters only | Standard SQLite behaviour; open on D1 with real names |
| 14 | Link-preview fetcher pins the checked address using Node DNS; Workers have no equivalent | Open (needs design) |
| 15 | Single database writer: all writes go to one place | Fine for our size; D1 location hint should be Asia-Pacific to match users |
| 16 | A bigger rewrite of the For you and analytics queries | Mitigated: existing checks, plus scoring in code |
| 17 | Moving real users' passwords | Open (spike 2). Fallback: ask the 3 real people to reset |
| 18 | Email for verification and reset does not exist yet | Open: needs a provider (Resend or similar) and a decision (section 15) |
| 19 | Reversal of an earlier decision. On 2026-10-22 the hosting plan moved from Workers to Vercel; this reverses it | Record the owner's reason in `ARCHITECTURE.md` when work starts |

## 15. Decisions for the owner

1. **Custom domain.** Which domain will Netmate live on (also needed for the media domain and Better Auth's trusted origin)?
2. **Cloudflare plan.** Workers Paid is the realistic plan. OK to assume it?
3. **How to land the port.** One long-lived branch merged at the end (recommended, keeps Vercel working), or step-by-step merges behind a switch.
4. **Real users' passwords.** Try to reuse the hashes, or just ask the 3 people to reset?
5. **Email.** Add email verification and "forgot password" as part of the move, or later? (Needs an email provider.)
6. **Uploads.** Through the Worker (recommended) or presigned links plus a check afterwards.
7. **Test accounts.** Move the 36 test accounts and their data, or recreate them from the seed script?
8. **Search.** Keep simple "contains" search, or add a proper search index (FTS5) during the move?

## 16. Not built, and ideas for later

**Not built (in scope for later):**
- Email verification, password reset, change email, change username.
- A Likes tab on profiles.
- Direct messages.
- Paging for people search (capped at 20 today).
- Trending hashtags, typo-tolerant search.
- "Not interested" or "see less" on posts, topic interests, a remembered tab choice.
- Cleaning up uploaded files when an account or post is deleted.
- Error reporting, uptime monitoring, a firewall in front of sign-up.
- Real file-storage CDN settings (cache headers).

**Out of scope for now:** polls, video, lists, verified badges, ads, a desktop layout, native apps.

**Ideas** (not decided): follower growth tips in analytics, copying link-card pictures into our own storage with a "remove preview" button, a "why am I seeing this" explanation on For you, hosting our own place suggestions, quote counts in the ranking once the quote link has an index.

## 17. Sources

Cloudflare facts in sections 3, 11, 12 and 14 were read on 2026-10-22 from:

- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 Worker API (batch, exec): https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 SQL statements and supported features: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- D1 read replication: https://developers.cloudflare.com/d1/best-practices/read-replication/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers Rate Limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- OpenNext for Cloudflare: https://opennext.js.org/cloudflare
- OpenNext Next 16 support (issue 972): https://github.com/opennextjs/opennextjs-cloudflare/issues/972
- Better Auth with Drizzle: https://www.better-auth.com/docs/adapters/drizzle

Cloudflare's products change quickly. Re-read the relevant page before depending on any line marked Open.