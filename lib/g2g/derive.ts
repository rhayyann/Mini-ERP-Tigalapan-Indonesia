import { GATES, PHASES, type Gate } from "./gates";
import type { G2GState } from "./store";

export type Tone = "locked" | "active" | "done";

export type GateViewModel = {
  id: number;
  name: string;
  desc: string;
  role: string;
  tone: Tone;
  badge: "LOCKED" | "ACTIVE" | "DONE";
  slaText: string;
  slaOver: boolean;
  barPct: number;
  barTone: Tone | "over";
  meta: string;
};

export type PhaseViewModel = {
  index: number;
  label: string;
  allDone: boolean;
  isCurrent: boolean;
  isViewed: boolean;
};

export type TimelineRow = {
  gateId: number;
  name: string;
  mark: "done" | "active" | "upcoming";
  barPct: number;
  barTone: Tone | "over";
  slaText: string;
  slaOver: boolean;
  nameTone: Tone;
};

export type LineItemRow = {
  roll: string;
  pola: string;
  target: number;
  cutting: number;
  fg: number;
  status: string;
  tone: "neutral" | "info" | "success" | "rework" | "danger";
};

export type G2GViewModel = {
  qtyLabel: string;
  activeRole: string;
  progressLabel: string;
  slaUsedLabel: string;
  poStatus: string;
  poStatusTone: "neutral" | "info" | "success";
  phases: PhaseViewModel[];
  phaseTitle: string;
  phaseSubtitle: string;
  stageCards: GateViewModel[];
  nextActionTitle: string;
  nextActionHint: string;
  primaryLabel: string;
  primaryDisabled: boolean;
  canReject: boolean;
  hasAlt: boolean;
  altLabel: string;
  items: LineItemRow[];
  itemsSummary: string;
  timeline: TimelineRow[];
  log: G2GState["log"];
  logCount: string;
  done: boolean;
  currentGate: Gate | null;
};

function gateViewModel(g: Gate, state: G2GState): GateViewModel {
  const { cursor } = state;
  const isDone = g.id <= cursor;
  const done = cursor >= GATES.length;
  const isActive = !done && GATES[cursor].id === g.id;
  const spent = state.spent[g.id];
  const tone: Tone = isDone ? "done" : isActive ? "active" : "locked";
  const over = isDone && spent !== undefined && spent > g.sla;

  return {
    id: g.id,
    name: g.name,
    desc: g.desc,
    role: g.role,
    tone,
    badge: isDone ? "DONE" : isActive ? "ACTIVE" : "LOCKED",
    slaText: (isDone ? spent : isActive ? "0.0" : "0") + " / " + g.sla + (g.sla > 7 ? " hari" : " HD"),
    slaOver: over,
    barPct: isDone && spent !== undefined ? Math.min(100, Math.round((spent / g.sla) * 100)) : isActive ? 18 : 0,
    barTone: isDone ? (over ? "over" : "done") : "active",
    meta: isDone ? g.done : isActive ? "Menunggu aksi " + g.role : "Terbuka setelah gate " + (g.id - 1),
  };
}

export function deriveG2G(state: G2GState): G2GViewModel {
  const { cursor, view } = state;
  const done = cursor >= GATES.length;
  const cur = done ? null : GATES[cursor];

  const phases: PhaseViewModel[] = PHASES.map((label, i) => {
    const gs = GATES.filter((g) => g.phase === i);
    const allDone = gs.every((g) => g.id <= cursor);
    const isCurrent = !done && cur!.phase === i;
    return { index: i, label, allDone, isCurrent, isViewed: view === i };
  });

  const totalSla = GATES.reduce((a, g) => a + g.sla, 0);
  const usedSla = Object.values(state.spent).reduce((a, v) => a + v, 0);

  const cutting = cursor >= 9 ? (state.closed ? 265 : 295) : 0;
  const fg = cursor >= 10 ? (state.closed ? 263 : 293) : 0;
  const target = state.closed ? 270 : 300;

  const itemStatus = (): { s: string; tone: LineItemRow["tone"] } => {
    if (cursor >= 13) return { s: "PAID", tone: "success" };
    if (cursor >= 11) return { s: "DELIVERED", tone: "info" };
    if (cursor >= 9) return { s: "IN PRODUCTION", tone: "rework" };
    if (cursor >= 7) return { s: "READY", tone: "success" };
    if (cursor >= 4) return { s: "ON DELIVERY", tone: "info" };
    return { s: "OPEN", tone: "neutral" };
  };
  const is = itemStatus();

  const rows: Omit<LineItemRow, "status" | "tone">[] = [
    { roll: "A-014", pola: "Pola A · Merah", target: Math.round(target * 0.6), cutting: Math.round(cutting * 0.6), fg: Math.round(fg * 0.6) },
    { roll: "A-015", pola: "Pola A · Merah", target: Math.round(target * 0.2), cutting: Math.round(cutting * 0.2), fg: Math.round(fg * 0.2) },
    { roll: "A-016", pola: "Pola B · Biru", target: Math.round(target * 0.2), cutting: Math.round(cutting * 0.2), fg: Math.round(fg * 0.2) },
  ];
  const items: LineItemRow[] = rows.map((r) => ({ ...r, status: is.s, tone: is.tone }));
  if (state.claimed) items.push({ roll: "A-012", pola: "Pola A · Merah", target: 0, cutting: 0, fg: 0, status: "CLAIMED", tone: "danger" });
  if (state.closed) items.push({ roll: "A-002", pola: "Pola A · Merah", target: 0, cutting: 0, fg: 0, status: "CLOSED", tone: "rework" });

  const poStatus = done ? "COMPLETED" : cursor >= 12 ? "INVOICED" : cursor >= 8 ? "IN PRODUCTION" : cursor >= 3 ? "PO APPROVED" : cursor >= 1 ? "IN PROGRESS" : "DRAFT";
  const poStatusTone: G2GViewModel["poStatusTone"] = done ? "success" : cursor >= 3 ? "info" : "neutral";

  const viewedGates = GATES.filter((g) => g.phase === view);

  return {
    qtyLabel: state.qty.toLocaleString("id-ID"),
    activeRole: done ? "selesai" : cur!.role,
    progressLabel: cursor + " / 13",
    slaUsedLabel: Math.round(usedSla * 10) / 10 + " / " + totalSla + " HD",
    poStatus,
    poStatusTone,
    phases,
    phaseTitle: PHASES[view],
    phaseSubtitle: "Gate " + viewedGates.map((g) => g.id).join(", ") + " · klik statusbar untuk pindah fase",
    stageCards: viewedGates.map((g) => gateViewModel(g, state)),
    nextActionTitle: done ? "Semua gate selesai — PO ditutup" : "Gate " + cur!.id + " · " + cur!.name,
    nextActionHint: done ? "Retention Rp 845.000 ditahan sampai Nov 2026. Reset untuk mencoba jalur lain." : cur!.desc + (cur!.role ? " (aksi oleh " + cur!.role + ")" : ""),
    primaryLabel: done ? "Selesai" : cur!.action,
    primaryDisabled: done,
    canReject: !done && !!cur!.reject,
    hasAlt: !done && !!cur!.alt && !(cur!.id === 5 && state.closed) && !(cur!.id === 7 && state.claimed),
    altLabel: done ? "" : cur!.alt || "",
    items,
    itemsSummary: "target " + target + " · cutting " + cutting + " · FG " + fg + " pcs",
    timeline: GATES.map((g) => {
      const v = gateViewModel(g, state);
      return {
        gateId: g.id,
        name: "G" + g.id + " " + g.name,
        mark: g.id <= cursor ? "done" : !done && cur!.id === g.id ? "active" : "upcoming",
        barPct: v.barPct,
        barTone: v.barTone,
        slaText: v.slaText,
        slaOver: v.slaOver,
        nameTone: v.tone,
      };
    }),
    log: state.log,
    logCount: state.log.length + " entri",
    done,
    currentGate: cur,
  };
}
