"use client";

/** Sub-tab horizontal reusable — presentational saja, state aktif dikontrol parent. */
export type TabItem = { key: string; label: string; badge?: number };

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border-subtle">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={
              "relative flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 font-sans text-[12.5px] font-semibold " +
              (isActive ? "border-accent-blue text-action-primary" : "border-transparent text-text-muted")
            }
          >
            {item.label}
            {!!item.badge && item.badge > 0 && (
              <span className="rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
