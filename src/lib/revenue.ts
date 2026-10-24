// The owner's money picture, as one pure function (docs/PRD.md, "Paid subscriptions"), so the page, the graphs and the
// tests all use the same arithmetic. Everything is whole US cents. The picture is:
//
//   collected from subscribers (tax included)
//   - refunded
//   - tax (Polar collects it and pays it on)
//   - Polar's fee (an estimate)
//   = what reaches the owner
//   - what members earned (paid out so far, plus still to pay)
//   = what the owner keeps
//
// These five parts always add up to what was collected: refunded + tax + Polar's fee + members + owner.

export type Sums = {
  /** What subscribers paid, tax included. */
  totalCents: number;
  /** The tax in it. */
  taxCents: number;
  /** Refunded to subscribers, before tax. */
  refundedCents: number;
  /** The tax that went back with refunds. */
  refundedTaxCents: number;
  /** Our estimate of Polar's fee. */
  feeCents: number;
  /** What members earned from these payments (after refunds). */
  earnedCents: number;
  /** What has been paid out to members. */
  paidOutCents: number;
};

export const EMPTY_SUMS: Sums = { totalCents: 0, taxCents: 0, refundedCents: 0, refundedTaxCents: 0, feeCents: 0, earnedCents: 0, paidOutCents: 0 };

export type Ledger = {
  collected: number;
  /** Everything that went back to subscribers, tax included. */
  refunded: number;
  /** Tax that stayed with the payments (Polar pays it on). */
  tax: number;
  polarFee: number;
  /** Collected, less refunds, tax and Polar's fee. */
  reachesYou: number;
  memberEarned: number;
  memberPaid: number;
  /** Earned and not yet paid out: money you hold that belongs to members. */
  stillToPay: number;
  /** What is left for the owner. Can be below zero for very small prices, where Polar's fixed fee is most of the payment. */
  yoursToKeep: number;
};

export function ledger(s: Sums): Ledger {
  const collected = s.totalCents;
  const refunded = s.refundedCents + s.refundedTaxCents;
  const tax = s.taxCents - s.refundedTaxCents;
  const reachesYou = collected - refunded - tax - s.feeCents;
  return {
    collected,
    refunded,
    tax,
    polarFee: s.feeCents,
    reachesYou,
    memberEarned: s.earnedCents,
    memberPaid: s.paidOutCents,
    stillToPay: s.earnedCents - s.paidOutCents,
    yoursToKeep: reachesYou - s.earnedCents,
  };
}

export type SegmentKey = "refunded" | "tax" | "fee" | "members" | "yours";

export const SEGMENT_LABEL: Record<SegmentKey, string> = {
  refunded: "Refunded",
  tax: "Tax",
  fee: "Polar's fee",
  members: "Members",
  yours: "Yours",
};

/** The parts of what was collected, for the bars. A part below zero is drawn as nothing (its true number is still in the table). */
export function segments(l: Ledger): { key: SegmentKey; cents: number }[] {
  return [
    { key: "refunded", cents: Math.max(0, l.refunded) },
    { key: "tax", cents: Math.max(0, l.tax) },
    { key: "fee", cents: Math.max(0, l.polarFee) },
    { key: "members", cents: Math.max(0, l.memberEarned) },
    { key: "yours", cents: Math.max(0, l.yoursToKeep) },
  ];
}

// ---- months ----

/** "2026-10" for a time, in UTC. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `count` months ending with the one that contains `now`, oldest first. */
export function lastMonths(now: number, count: number): string[] {
  const d = new Date(now);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${year}-${String(month + 1).padStart(2, "0")}`);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return out;
}

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" to "Oct 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${NAMES[Number(m) - 1] ?? "?"} ${y}`;
}

/** "2026-10" to "Oct". */
export function monthShort(key: string): string {
  return NAMES[Number(key.split("-")[1]) - 1] ?? "?";
}
