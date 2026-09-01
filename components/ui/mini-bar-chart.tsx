export function MiniBarChart({ data, height = 112 }: { data: { label: string; pct: number; color: string }[]; height?: number }) {
  return (
    <div className="flex items-end gap-2.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end gap-[5px]">
          <span className="block rounded-t-[3px]" style={{ height: `${d.pct}%`, background: d.color }} />
          <span className="text-center font-mono text-[10px] text-text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
