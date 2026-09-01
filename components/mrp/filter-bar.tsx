"use client";

export type FilterDef = { label: string; value: string; options: string[]; onChange: (v: string) => void };

export function FilterBar({ filters }: { filters: FilterDef[] }) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
      {filters.map((f) => (
        <select
          key={f.label}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]"
        >
          <option value="">{f.label}: Semua</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
