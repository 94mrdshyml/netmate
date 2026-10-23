# Netmate design

How the app looks and feels. The product rules are in `CLAUDE.md` and `docs/PRD.md` (section 8.13) and win over this file. Use the `taste` design skill for UI work, inside these rules.

**The feel:** calm, quiet and confident. A phone-width column of plain text on a flat page. Content comes first. The instance's one brand colour appears only where it means something: your own actions (liked), links and tags, the active tab bar, the compose button, the logo chip.

## Hard limits (never traded for looks)

- Flat. No shadows, no gradients, no glows, no cards in the feed.
- One brand colour. Everything else is a mix of the page colour and the text colour.
- Nothing is hard-coded to a brand: name, colour, radius, font and avatar style come from instance settings.
- Feather icons only, all drawn with one line thickness (1.75), so the set looks like one. No emoji and no em dashes in interface text.
- Tap targets are at least 44px. Safe areas are respected. One column, 480px at most, centred.
- Text and controls pass WCAG AA in light and dark, with any brand colour.
- Motion is small and stops under `prefers-reduced-motion`.

## Tokens (`app/globals.css`)

Injected by `src/instance/theme.ts` from instance settings: `--bg`, `--fg`, `--brand`, `--on-brand`, `--brand-hover`, `--brand-pressed`, `--brand-text`, `--radius`, `--font`.

Mixed in `globals.css` from those, so they follow light, dark and any brand colour:

| Token | Mix | Use |
|---|---|---|
| `--muted` | text 62% on page | secondary text, inactive icons (at least 4.5:1) |
| `--line` | text 12% on page | dividers, card edges |
| `--line-input` | text 46% on page | borders of fields and ghost buttons (about 3:1) |
| `--surface` | text 5% on page | quiet panels, hover on rows |
| `--surface-hover` | text 9% on page | hover on buttons and icon buttons |
| `--brand-soft` | brand 14% on page | flat cover tint, text selection |
| `--gx` | 16px or the safe area | side padding of the column |

`--muted` and the others are written for `:root` and `.preview` (the /setup preview panels set their own page and text colours).

## Type

The instance font, 15px body, 1.45 line height. Headings and names are semibold (600) at most; buttons, tabs, menu rows and the bottom bar are medium (500); everything else is regular. Headings are tighter (`-0.02em`) and balanced. Numbers use tabular figures so counts do not jump. Handles and times are `--muted`.

## Layout

- `.column` is the page. Its gutter is `--gx`. Anything that should reach the screen edge (post rows, people rows, tabs, headers, the cover picture) uses a negative side margin of `--gx` and puts the gutter back as padding. On a screen wider than the column, the page around it is a shade apart (5% of the text colour mixed into the page colour) and a 1px `--line` hairline runs down each edge. The body itself is the column's width, so the lines are exactly on its edges even beside a scrollbar, and the bottom bar has them too. Phones, and the wide `/hq`, have neither.
- **Home** has the top bar: your picture (opens Settings), the instance mark, the theme button. Under it, the For you and Following tabs, which stick. Search and Alerts show your picture in the same corner.
- **Every other screen** has a sticky page header: a back arrow where there is somewhere to go back to, then the title (and a quiet second line when useful). Both headers are 52px tall.
- **Bottom bar:** Home, Search, Alerts, Profile. Icon and label are `--muted`; on hover, on press and for the current screen they turn the brand colour. No background, no bold. Alerts carries the unread count. Profile is only here: your picture opens Settings, not your profile.
- **Compose button:** a round brand button, Feather "feather" icon, bottom right inside the column, above the bar.

## Components

- **Settings:** a full screen opened from your picture: a header with a back arrow and the title in the middle, then one plain list. Each row is an icon (muted, thin line), a title (medium) with a short quiet line under it, and a chevron; hairlines run edge to edge. Edit profile, Invite people, Admin panel (admin only), then a row with the "Dark or light theme" button where the chevron would be, then an outlined full-width Log out button. The bottom bar stays visible.
- **Edit profile:** like the screens people know. Sticky header with a close button, the title and Save. The cover picture has a camera button (and a remove button once there is a cover); your picture overlaps its corner with its own camera button and a Remove button. Fields sit in bordered boxes with the label inside, a character counter (`12 / 160`) and a brand border when focused. Saving stays on the page with a "Saved." note; close goes back to your profile.
- **Brand mark:** a round chip in the brand colour with the first letter of the instance name, then the name. An uploaded logo replaces the chip when logo upload exists.
- **Post row:** picture, then name, handle and time on one line, text, then the action row (reply, like, and a "..." menu for your own, holding Delete post, which still asks first). Rows are separated by a hairline. A liked heart is filled and brand-coloured. On the post's own page the text is larger.
- **Tabs:** the current tab has full-strength text and a short brand bar under it. The others are `--muted`.
- **Buttons:** primary (brand), ghost (hairline border), full width when alone on a row. Corners follow the instance radius. Pressing scales to 97%.
- **Icon buttons:** 44px round. Hover and press turn the icon the brand colour; there is no background.
- **Fields:** 48px tall, the instance radius, a visible border, a brand border and outline on focus.
- **Appearance:** the sun and moon button (top bar on Home, and the "Dark or light theme" row in Settings) flips light and dark. A person who has not chosen follows their phone. The choice is saved in a cookie, which the server reads to paint the right theme on the first frame, so nothing flashes.
- **Loading:** no route-level `loading.tsx`. It makes Next send "200" before a page can say "not found", which breaks the 404 rule. Instead, a thin brand line along the top of the column starts the moment you tap a link to another screen and finishes when it arrives (`NavigationProgress`); buttons that send something show a pending word. No spinners.
- **Admin panel (`/hq`):** the one wide layout, built like a small product. On a wide screen: a side menu on the left (the instance mark and "name admin", then the pages in groups, each with a Feather icon, the current one marked by a quiet fill, a brand icon and a short brand bar at the edge, and the waiting count as a badge on Approvals), and on the right a top strip with breadcrumbs ("Admin, then the page"), the theme button and "Back to the app". Under 900px the menu becomes a strip along the top that scrolls sideways and keeps the current page in view; on the narrowest phones "Back to the app" shows only its arrow (the name stays for screen readers). The pages sit on the quiet page shade (`--surface`) and are made of flat panels: `--bg`, a 1px `--line` edge, the instance radius, no shadow. A panel has a head (a 36px icon tile, a medium title, one quiet line, and room on the right for a small pill or button), a body, and an optional foot with the note on the left and the Save button on the right. Lists inside a panel run edge to edge with hairlines. The Overview opens with three number panels (members, waiting, invite links), then "Needs you" and "Your community". Status is said in words and an icon, never by a new colour: "fine" is a quiet pill, "needs you" is a pill with a brand outline. Branding has its fields in panels on the left, a preview that follows you on the right (one column under 1100px) and a Save bar that sticks to the bottom. The pages are listed once, in `app/(app)/hq/sections.ts`, which both the menu and the breadcrumbs read.
- **Empty and end states:** centred and quiet: a muted icon in a soft circle, one plain line, a second line that says what will appear, and one button where there is something useful to do (`EmptyState`). Plain English. Zeros show as zeros.

## Motion

Hover, press and colour changes take 120 to 200ms with `cubic-bezier(0.2, 0.7, 0.2, 1)`. Every control answers a finger or a pointer: on hover and press the icon turns the brand colour (no background appears), a press scales to 90 to 97%, and a state change you can see.

- Round icon buttons turn the brand colour on hover and shrink when pressed. Ghost buttons take the brand colour on hover; primary buttons darken. The compose feather tilts. The theme button turns when pressed.
- Post actions turn the brand colour on hover; a heart also pops once (a short scale up and back) when you like.
- Bottom bar icons lift 1px on hover and turn the brand colour.
- A "Following" button reads "Unfollow" under a mouse pointer (the button's name does not change).
- Moving to another screen: the old one fades out (120ms) as the new one fades in and settles up 8px (200ms). The bottom bar stays still. It is a template (`template.tsx`) around the member screens, so only a real change of screen plays it, not typing in the search box. Nothing else slides, bounces or loops.
- With reduced motion on, all of it is off.

## Checking a change

Look at it on a phone-width screen in light and dark, with the default colour and with an extreme one (very light, very dark, saturated yellow), at radius zero and large. Tab through it with a keyboard. Run `bun run test:e2e`.
