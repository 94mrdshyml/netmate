// The one layout every email uses (docs/PRD.md section 7), written with React Email. Mail apps
// ignore CSS variables and web fonts, so the brand colours are written out and the font has plain
// fallbacks. React escapes every piece of text, so a name or a message cannot add markup.

import { Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text } from "@react-email/components";
import { isWebUrl, type EmailBrand, type EmailContent } from "@/email/template";
import { deriveTheme, RADII } from "@/instance/theme";

export function BrandedEmail({ brand, content }: { brand: EmailBrand; content: EmailContent }) {
  const light = deriveTheme(brand.primary).light;
  const radius = RADII[brand.radius];
  // The family name was checked against the font list; keep only safe characters regardless.
  const family = brand.fontFamily.replace(/[^A-Za-z0-9 ]/g, "");
  const fontFamily = `'${family}', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;
  const button = content.button && isWebUrl(content.button.url) ? content.button : null;

  return (
    <Html lang="en">
      <Head>
        <title>{content.heading}</title>
      </Head>
      <Preview>{content.paragraphs[0] ?? content.heading}</Preview>
      <Body style={{ margin: 0, padding: "24px 12px", background: "#f4f4f5", fontFamily, color: "#0f0f0f" }}>
        <Container style={{ maxWidth: 480, margin: "0 auto", background: "#ffffff", borderRadius: radius, padding: 24 }}>
          {brand.logoUrl ? (
            <Img src={brand.logoUrl} alt={brand.name} height={32} style={{ display: "block", height: 32, width: "auto", border: 0 }} />
          ) : (
            <Text style={{ margin: 0, fontSize: 20, fontWeight: 700, color: light.brandText }}>{brand.name}</Text>
          )}
          <Heading as="h1" style={{ margin: "24px 0 12px", fontSize: 20, lineHeight: 1.3 }}>
            {content.heading}
          </Heading>
          {content.paragraphs.map((text, i) => (
            <Text key={i} style={{ margin: "0 0 12px", fontSize: 16, lineHeight: 1.5 }}>
              {text}
            </Text>
          ))}
          {button ? (
            <Section style={{ margin: "24px 0 0" }}>
              <Button
                href={button.url}
                style={{ display: "inline-block", padding: "12px 20px", background: light.brand, color: light.onBrand, borderRadius: radius, fontWeight: 600, textDecoration: "none" }}
              >
                {button.label}
              </Button>
            </Section>
          ) : null}
          <Text style={{ margin: "24px 0 0", fontSize: 13, color: "#6b6b6b" }}>{`Sent by ${brand.name}.`}</Text>
        </Container>
      </Body>
    </Html>
  );
}
