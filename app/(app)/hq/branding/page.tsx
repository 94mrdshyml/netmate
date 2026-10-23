import { requireAdmin } from "@/auth/admin";
import { defaultAvatarSvg } from "@/avatars/default";
import { getInstanceState } from "@/instance/request";
import { AVATAR_STYLES } from "@/instance/options";
import { BrandingForm } from "./branding-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Branding" };

// One drawn sample per style, made here so the browser never contacts anyone to show them.
const SAMPLE = { username: "sam_sample", name: "Sam Sample" } as const;

export default async function BrandingPage() {
  await requireAdmin();
  const { settings } = await getInstanceState();
  const samples = Object.fromEntries(
    AVATAR_STYLES.map((style) => [style, `data:image/svg+xml;utf8,${encodeURIComponent(defaultAvatarSvg(style, SAMPLE))}`]),
  );

  return (
    <>
      <h1>Branding</h1>
      <p className="hint">The name and look of your community. Changes show for everyone as soon as you save.</p>
      <BrandingForm
        initial={{
          name: settings.name,
          primary: settings.primaryColor,
          radius: settings.radius,
          fontFamily: settings.fontFamily,
          avatarStyle: settings.avatarStyle,
        }}
        avatarSamples={samples}
      />
    </>
  );
}
