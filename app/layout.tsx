import type { Metadata, Viewport } from "next";
import { getInstanceState } from "@/instance/request";
import { buildThemeCss } from "@/instance/theme";
import "./globals.css";

// Read per request: the instance name and look come from the database.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getInstanceState();
  return { title: settings.name };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { settings } = await getInstanceState();
  // buildThemeCss validates every value, so what reaches the stylesheet is safe.
  const { css } = buildThemeCss({
    primary: settings.primaryColor,
    radius: settings.radius,
    fontFamily: settings.fontFamily,
  });

  return (
    <html lang="en">
      <head>
        <style id="instance-theme" dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
