// The friendly line under the faces on the invite welcome screen (docs/PRD.md section 6).
// Interface copy rule: no emoji and no em dashes.

/**
 * "Ana, Ben and 12 others are already here, saving you a seat." Takes the first names to show
 * (at least one) and how many more members there are beyond them.
 */
export function welcomeLine(names: string[], others: number): string {
  const items = [...names, ...(others > 0 ? [`${others} ${others === 1 ? "other" : "others"}`] : [])];
  if (items.length === 0) return "";
  const who = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `${who} ${items.length === 1 ? "is" : "are"} already here, saving you a seat.`;
}
