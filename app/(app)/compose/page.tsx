import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { Composer } from "../_components/composer";
import { Icon } from "../_components/icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "New post" };

export default async function ComposePage() {
  if (!(await getMember())) redirect("/sign-in");

  return (
    <main className="column stack">
      <Link className="back" href="/" aria-label="Back to Home">
        <Icon name="arrow-left" />
      </Link>
      <h1>New post</h1>
      <Composer autoFocus />
    </main>
  );
}
