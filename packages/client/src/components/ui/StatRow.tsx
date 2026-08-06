/**
 * @module components/ui/StatRow
 *
 * A FLAT horizontal row of counts. Deliberately NOT cards: nobody clicks a
 * number in a box, and four bordered boxes would compete with the
 * AnchorCard for attention. Muted text, generous spacing, each entry
 * optionally a link, wraps to two lines on narrow screens.
 */

export interface StatRowEntry {
  label: string;
  value: number | string;
  onClick?: () => void;
  href?: string;
}

export interface StatRowProps {
  entries: StatRowEntry[];
}

export function StatRow({ entries }: StatRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-dark-600">
      {entries.map((entry, i) => {
        const content = (
          <>
            <span className="font-semibold text-[#E5E5E5]">{entry.value}</span>{" "}
            <span>{entry.label}</span>
          </>
        );
        const linkClassName = "inline-flex min-h-11 items-center hover:text-gold transition-colors";

        if (entry.href) {
          return (
            <a key={i} href={entry.href} className={linkClassName}>
              {content}
            </a>
          );
        }
        if (entry.onClick) {
          return (
            <button key={i} type="button" onClick={entry.onClick} className={linkClassName}>
              {content}
            </button>
          );
        }
        return (
          <span key={i} className="inline-flex items-center">
            {content}
          </span>
        );
      })}
    </div>
  );
}
