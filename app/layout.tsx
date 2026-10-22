import type { Metadata, Viewport } from "next";
import { DEFAULT_INSTANCE_NAME, DEFAULT_THEME } from "@/instance/defaults";
import { buildThemeCss } from "@/instance/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: DEFAULT_INSTANCE_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Instance settings come from the database in the next step; for now the defaults.
  // buildThemeCss validates every value, so what reaches the stylesheet is safe.
  const { css } = buildThemeCss(DEFAULT_THEME);

  return (
    <html lang="en">
      <head>
        <style id="instance-theme" dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
