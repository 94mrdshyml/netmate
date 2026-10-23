import { requireAdmin } from "@/auth/admin";
import { getInstanceState } from "@/instance/request";
import { Card, PageHeader, Pill } from "../hq-ui";
import { PlacesSwitch } from "./places-switch";

export const dynamic = "force-dynamic";

export const metadata = { title: "Services" };

export default async function ServicesPage() {
  await requireAdmin();
  const { settings } = await getInstanceState();

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
    </>
  );
}
