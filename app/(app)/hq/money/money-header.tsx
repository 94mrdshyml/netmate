import type { ReactNode } from "react";
import { HqTabs, PageHeader } from "../hq-ui";
import { MONEY_TABS } from "../sections";

/** The top of every page in the Money section: one title, and the section's three pages as tabs. */
export function MoneyHeader({ current, children }: { current: string; children: ReactNode }) {
  return (
    <PageHeader title="Money" tabs={<HqTabs label="Money" items={MONEY_TABS} current={current} />}>
      {children}
    </PageHeader>
  );
}
