/**
 * @module components/ui/AnchorCard
 *
 * The compliance dashboard hero. THREE states driven by `items.length`,
 * because a single-item card lies at every other count:
 *   0    all-clear — gold check, calm, no red anywhere.
 *   1    one named subject, one primary action, thin red LEFT EDGE.
 *   2+   "N staff need attention", rows stacked inside one card, capped
 *        at `maxVisible` with "and N more".
 *
 * Caller supplies `items` already ordered most-urgent-first — this
 * component only renders, it doesn't sort. The red left edge is deliberate
 * and semantic: it marks the single urgent thing and appears once on the
 * page. Do not reuse it decoratively on other cards.
 */

import { CheckCircle2 } from "lucide-react";

export interface AnchorCardItem {
  id: string;
  label: string;
  actionLabel: string;
  onAction?: () => void;
  href?: string;
}

export interface AnchorCardProps {
  items: AnchorCardItem[];
  /** Only shown at count 0, e.g. "Next expiry in 24 days". */
  allClearSubtext?: string;
  maxVisible?: number;
}

function ActionControl({ item, className }: { item: AnchorCardItem; className: string }) {
  if (item.href) {
    return (
      <a href={item.href} className={className}>
        {item.actionLabel}
      </a>
    );
  }
  return (
    <button type="button" onClick={item.onAction} className={className}>
      {item.actionLabel}
    </button>
  );
}

export function AnchorCard({ items, allClearSubtext, maxVisible = 5 }: AnchorCardProps) {
  const count = items.length;

  if (count === 0) {
    return (
      <div className="rounded-xl border border-dark-200 bg-dark-100 p-6 text-center animate-fade-in-up">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-gold-dim border border-border-gold">
          <CheckCircle2 className="size-6 text-gold" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-[#FAFAFA]">All clear</h2>
        {allClearSubtext && <p className="mt-1 text-sm text-dark-600">{allClearSubtext}</p>}
      </div>
    );
  }

  if (count === 1) {
    const item = items[0];
    return (
      <div className="rounded-xl border border-dark-200 border-l-4 border-l-red-500 bg-dark-100 p-6 animate-fade-in-up">
        <p className="text-lg font-semibold text-[#FAFAFA]">{item.label}</p>
        <ActionControl
          item={item}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
        />
      </div>
    );
  }

  const visible = items.slice(0, maxVisible);
  const remaining = count - visible.length;

  return (
    <div className="rounded-xl border border-dark-200 bg-dark-100 p-6 animate-fade-in-up">
      <h2 className="text-lg font-semibold text-[#FAFAFA]">{count} staff need attention</h2>
      <ul className="mt-4 divide-y divide-dark-200">
        {visible.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center justify-between gap-4 py-3">
            <span className="text-sm text-[#E5E5E5]">{item.label}</span>
            <ActionControl
              item={item}
              className="shrink-0 text-sm font-semibold text-gold hover:text-gold-hover hover:underline"
            />
          </li>
        ))}
      </ul>
      {remaining > 0 && <p className="mt-3 text-sm text-dark-600">and {remaining} more</p>}
    </div>
  );
}
