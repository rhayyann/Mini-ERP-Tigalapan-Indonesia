"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type ColumnDef<T> = {
  key: string;
  label: string;
  default: boolean;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

export type FilterDef<T> = {
  label: string;
  options: string[];
  test: (row: T, value: string) => boolean;
};

export function DataTable<T>({
  title,
  subtitle,
  headerActions,
  columns,
  rows,
  keyOf,
  filterDefs,
  emptyText = "Tidak ada data.",
  firstColumnLabel,
  firstColumnRender,
  firstColumnAlign = "left",
  rowClassName,
  bodyMaxHeight,
  renderExpanded,
}: {
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  columns: ColumnDef<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  filterDefs?: FilterDef<T>[];
  emptyText?: string;
  firstColumnLabel: string;
  firstColumnRender: (row: T) => ReactNode;
  firstColumnAlign?: "left" | "right";
  rowClassName?: (row: T) => string | undefined;
  /** Opsional — kalau diisi (mis. "60vh"), body tabel jadi scroll SENDIRI (bukan ikut nge-scroll
   *  halaman utama) dengan header kolom yang tetap kelihatan (sticky) selagi di-scroll. Dipakai
   *  di halaman Master Data yang barisnya bisa ratusan (Harga Kain/Harga Kain PKS) — kalau tidak
   *  diisi, perilaku lama (tabel tumbuh mengikuti isi, ikut scroll halaman) TIDAK berubah sama
   *  sekali, supaya semua pemakai DataTable lain di app ini tidak kena efek samping. */
  bodyMaxHeight?: string;
  /** Opsional — kalau diisi, tiap baris jadi bisa diklik untuk expand/collapse 1 baris rincian
   *  di bawahnya (kolom chevron ditambah otomatis di ujung kanan) — pola yang sama dipakai di
   *  halaman MRP PPIC. Tidak diisi = tabel tetap seperti biasa, tidak ada perubahan sama sekali
   *  buat pemakai DataTable lain. */
  renderExpanded?: (row: T) => ReactNode;
}) {
  const [visible, setVisible] = useState<Set<string>>(new Set(columns.filter((c) => c.default).map((c) => c.key)));
  const [colOpen, setColOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<string[]>((filterDefs ?? []).map(() => ""));
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggle(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = rows.filter((r) => (filterDefs ?? []).every((f, i) => !filterValues[i] || f.test(r, filterValues[i])));
  const visibleColumns = columns.filter((c) => visible.has(c.key));

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <div>
          <span className="font-sans text-[13px] font-semibold text-text-primary">{title}</span>
          {subtitle && <div className="mt-0.5 font-sans text-[10.5px] font-medium text-text-muted">{subtitle}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {headerActions}
          <div className="relative">
            <button onClick={() => setColOpen((v) => !v)} className="rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary">
              ⊞ Kolom
            </button>
            {colOpen && (
              <div className="absolute right-0 top-[110%] z-20 max-h-72 w-56 overflow-y-auto rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                    <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} className="h-3.5 w-3.5 accent-accent-blue" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {filterDefs && filterDefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
          {filterDefs.map((f, i) => (
            <select
              key={f.label}
              value={filterValues[i]}
              onChange={(e) => {
                const next = [...filterValues];
                next[i] = e.target.value;
                setFilterValues(next);
              }}
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
      )}

      <div className={"overflow-x-auto" + (bodyMaxHeight ? " overflow-y-auto" : "")} style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}>
        <table className="w-full border-collapse">
          <thead className={bodyMaxHeight ? "sticky top-0 z-10" : undefined}>
            <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
              <th className={"px-5 py-[9px] " + (firstColumnAlign === "right" ? "text-right" : "text-left")}>{firstColumnLabel}</th>
              {visibleColumns.map((c) => (
                <th key={c.key} className={"px-3 py-[9px] " + (c.align === "right" ? "text-right" : "text-left")}>
                  {c.label}
                </th>
              ))}
              {renderExpanded && <th className="w-8 px-3 py-[9px]" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const key = keyOf(r);
              const isExpanded = renderExpanded ? expandedKeys.has(key) : false;
              return (
                <Fragment key={key}>
                  <tr
                    className={
                      "border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] last:border-b-0 " +
                      (renderExpanded ? "cursor-pointer hover:bg-[#FAFBFC] " : "") +
                      (rowClassName?.(r) ?? "")
                    }
                    onClick={renderExpanded ? () => toggleExpanded(key) : undefined}
                  >
                    <td className={"px-5 py-[11px] " + (firstColumnAlign === "right" ? "text-right" : "text-left")}>{firstColumnRender(r)}</td>
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={"px-3 py-[11px] " + (c.align === "right" ? "text-right" : "text-left")}>
                        {c.render(r)}
                      </td>
                    ))}
                    {renderExpanded && (
                      <td className="px-3 py-[11px]">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                        )}
                      </td>
                    )}
                  </tr>
                  {renderExpanded && isExpanded && (
                    <tr className="border-b border-[#F1F4F7] last:border-b-0">
                      <td colSpan={visibleColumns.length + 2} className="bg-[#FAFBFC] px-5 py-4">
                        {renderExpanded(r)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1 + (renderExpanded ? 1 : 0)} className="px-5 py-6 text-center font-sans text-xs text-text-muted">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
