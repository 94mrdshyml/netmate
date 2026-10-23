// Turns a template into the two bodies an email carries: HTML and plain text. Rendering runs on
// the server, inside the Worker, and never makes a request.

import { render } from "@react-email/components";
import { BrandedEmail } from "@/email/layout";
import type { EmailBrand, EmailContent } from "@/email/template";

export async function renderEmail(brand: EmailBrand, content: EmailContent): Promise<{ html: string; text: string }> {
  const element = <BrandedEmail brand={brand} content={content} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
