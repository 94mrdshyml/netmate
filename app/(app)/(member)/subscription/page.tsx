import { redirect } from "next/navigation";

// The old address: the subscription screens became tabs of Subscriptions. The person who got an alert, or kept a link, lands on My subscribers.
export default function OldSubscriptionPage() {
  redirect("/subscriptions/earnings");
}
