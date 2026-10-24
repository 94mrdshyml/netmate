import { formatUsd } from "@/lib/money";
import { monthShort, SEGMENT_LABEL, segments, type Ledger, type SegmentKey } from "@/lib/revenue";

// Two small charts for the money pages, drawn with plain HTML and CSS (no chart package, no script). Each one has a plain
// sentence for screen readers, and every number is also in a table or list next to it, so a chart is never the only way to
// read an amount. Colours are the page's own: greys for money that is not anyone's to keep, the brand colour for the people
// it is shared between. A part is also named in words in the legend, never by colour alone.

const SEG_ORDER: SegmentKey[] = ["refunded", "tax", "fee", "members", "yours"];

/** "$12", "$1.2k": short enough to sit above a bar. */
export function compactUsd(cents: number): string {
  if (cents <= 0) return "";
  if (cents < 100_000) return `$${Math.round(cents / 100)}`;
  return `$${(cents / 100_000).toFixed(1).replace(/\.0$/, "")}k`;
}

function sentence(l: Ledger): string {
  const parts = segments(l)
    .filter((p) => p.cents > 0)
    .map((p) => `${SEGMENT_LABEL[p.key].toLowerCase()} ${formatUsd(p.cents)}`);
  return parts.length === 0 ? "Nothing collected yet." : `Of ${formatUsd(l.collected)} collected: ${parts.join(", ")}.`;
}

/** One bar showing where everything collected went, with the five parts listed under it. */
export function MoneyBar({ ledger: l }: { ledger: Ledger }) {
  const parts = segments(l);
  const sum = parts.reduce((a, p) => a + p.cents, 0);
  if (sum === 0) return <p className="hint">Nothing has been collected yet.</p>;
  return (
    <div className="mc">
      <div className="mc-split" role="img" aria-label={sentence(l)}>
        {parts.map((p) => (p.cents > 0 ? <span key={p.key} className={`mc-seg mc-seg-${p.key}`} style={{ flexBasis: `${(p.cents / sum) * 100}%` }} /> : null))}
      </div>
      <ul className="mc-legend" aria-label="Where the money went">
        {SEG_ORDER.map((key) => {
          const cents = key === "refunded" ? l.refunded : key === "tax" ? l.tax : key === "fee" ? l.polarFee : key === "members" ? l.memberEarned : l.yoursToKeep;
          return (
            <li key={key}>
              <span className={`mc-swatch mc-seg-${key}`} aria-hidden="true" />
              <span className="mc-legend-name">{SEGMENT_LABEL[key]}</span>
              <span className="mc-legend-value">{formatUsd(cents)}</span>
              <span className="muted mc-legend-pct">{sum > 0 && cents > 0 ? `${Math.round((cents / sum) * 100)}%` : "0%"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One column per month: stacked parts of what was collected (owner), or a single bar of what was earned (member). */
export function MonthBars({
  months,
  mode,
  label,
}: {
  months: { key: string; ledger?: Ledger; earned?: number }[];
  mode: "stacked" | "earned";
  label: string;
}) {
  const totals = months.map((m) => (mode === "stacked" ? Math.max(0, m.ledger?.collected ?? 0) : Math.max(0, m.earned ?? 0)));
  const max = Math.max(...totals, 1);
  const spoken = months.map((m, i) => `${m.key} ${formatUsd(totals[i] ?? 0)}`).join(", ");
  return (
    <div className="mc">
      <div className="mc-months" role="img" aria-label={`${label}: ${spoken}.`}>
        {months.map((m, i) => {
          const total = totals[i] ?? 0;
          const parts = mode === "stacked" && m.ledger ? segments(m.ledger) : [];
          const sum = parts.reduce((a, p) => a + p.cents, 0);
          return (
            <div key={m.key} className="mc-col">
              <span className="mc-top">{compactUsd(total)}</span>
              <div className="mc-well">
                <div className="mc-stack" style={{ height: `${(total / max) * 100}%` }}>
                  {mode === "earned" ? (
                    <span className="mc-seg mc-seg-yours" style={{ flexBasis: "100%" }} />
                  ) : (
                    parts.map((p) => (p.cents > 0 ? <span key={p.key} className={`mc-seg mc-seg-${p.key}`} style={{ flexBasis: `${(p.cents / (sum || 1)) * 100}%` }} /> : null))
                  )}
                </div>
              </div>
              <span className="mc-month">{monthShort(m.key)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
