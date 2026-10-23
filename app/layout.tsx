import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { getInstanceState } from "@/instance/request";
import { fontFaceCss } from "@/instance/fonts";
import { buildThemeCss } from "@/instance/theme";
import { THEME_COOKIE, themeAttribute } from "@/lib/theme-choice";
import "./globals.css";

// Read per request: the instance name and look come from the database.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getInstanceState();
  // The uploaded favicon, or one drawn from the name and colour (app/brand-icon).
  const icon = settings.faviconKey ? `/media/${settings.faviconKey}` : "/brand-icon";
  return { title: settings.name, icons: { icon, apple: icon } };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { settings, fontFaces } = await getInstanceState();
  // buildThemeCss and fontFaceCss validate every value, so what reaches the stylesheet is safe.
  const { css } = buildThemeCss(
    {
      primary: settings.primaryColor,
      radius: settings.radius,
      fontFamily: settings.fontFamily,
    },
    fontFaceCss(settings.fontFamily, fontFaces),
  );

  // The member's own light or dark choice (a cookie) wins; otherwise the instance default applies.
  const theme = themeAttribute((await cookies()).get(THEME_COOKIE)?.value, settings.themeDefault);

  return (
    <html lang="en" data-theme={theme ?? undefined}>
      <head>
        <style id="instance-theme" dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
