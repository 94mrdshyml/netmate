import { requireAdmin } from "@/auth/admin";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { gifPanel } from "@/server/gifs";
import { Card, PageHeader, Pill } from "../hq-ui";
import { GifForm } from "./gif-form";
import { LinkPreviewsSwitch } from "./link-previews-switch";
import { PlacesSwitch } from "./places-switch";

export const dynamic = "force-dynamic";

export const metadata = { title: "Services" };

export default async function ServicesPage() {
  await requireAdmin();
  const { settings } = await getInstanceState();
  const { env } = await getCloudflareContext({ async: true });
  const gifs = await gifPanel(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY);

  return (
    <>
      <PageHeader title="Services">Optional features that ask an outside service. Each one is off until you turn it on.</PageHeader>

      <Card
        id="places-heading"
        icon="map-pin"
        title="Place suggestions"
        description="Members can add a place to a post, and get suggestions as they type."
        aside={settings.placesEnabled ? <Pill icon="check-circle">On</Pill> : <Pill>Off</Pill>}
      >
        <PlacesSwitch enabled={settings.placesEnabled} />
        <p className="hint">
          Suggestions come from OpenStreetMap through the free Photon service. This server asks Photon, never your members&apos; phones, so
          Photon sees the words someone types but not who they are. Only towns, regions and countries are suggested, never streets. A place is
          plain text, never coordinates. If Photon is slow or down, members can still type the place themselves.
        </p>
      </Card>

      <Card
        id="links-heading"
        icon="link"
        title="Link previews"
        description="A web address in a post gets a card with the page's picture, title and description."
        aside={settings.linkPreviewsEnabled ? <Pill icon="check-circle">On</Pill> : <Pill>Off</Pill>}
      >
        <LinkPreviewsSwitch enabled={settings.linkPreviewsEnabled} />
        <p className="hint">
          When someone pastes a link, this server visits that page once, not anyone&apos;s phone, and keeps its title, description and
          picture address with the post. The visit refuses private and internal addresses, follows at most three redirects, waits at most three
          seconds and reads at most 512 KB. The one catch: the card&apos;s picture is loaded by each reader&apos;s own phone from the linked site, with no
          referrer, so that site can see the reader&apos;s address. Nothing else is shared. Members get 20 previews every 10 minutes.
        </p>
      </Card>

      <Card
        id="gifs-heading"
        icon="image"
        title="GIF search"
        description="Members can add a GIF to a post, searched from Klipy."
        aside={
          gifs.state === "on" ? <Pill icon="check-circle">On</Pill> : gifs.state === "unreadable" ? <Pill>Key unreadable</Pill> : <Pill>Off</Pill>
        }
      >
        <GifForm state={gifs.state} />
        <p className="hint">
          GIFs are searched and loaded by each member&apos;s own phone straight from Klipy, which is what Klipy requires. Klipy can see that
          phone&apos;s address and what it searches for, but not the member&apos;s name. Because Klipy puts the key in every search address, the key
          is given to signed-in members&apos; phones while GIF search is on. It is stored encrypted here and never shown again after you save it.
          A post keeps only Klipy&apos;s address for its GIF, never a copy. Turning this off hides the button; GIFs already on posts still show.
        </p>
        {gifs.state === "unreadable" ? (
          <p className="error" role="alert">
            The saved key cannot be read, so GIF search is off for members. Paste the key again to fix it.
          </p>
        ) : null}
      </Card>
    </>
  );
}
