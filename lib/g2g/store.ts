import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GATES } from "./gates";

export type LogEntry = { time: string; text: string };

export type G2GState = {
  cursor: number;
  view: number;
  log: LogEntry[];
  qty: number;
  claimed: boolean;
  closed: boolean;
  spent: Record<number, number>;
  clock: number;
};

type G2GActions = {
  setView: (phase: number) => void;
  advance: () => void;
  rejectAction: () => void;
  altAction: () => void;
  reset: () => void;
};

const initialState: G2GState = {
  cursor: 0,
  view: 0,
  log: [{ time: "08:00", text: "Simulasi dimulai · PO-MKL-001 dibuat sebagai draft" }],
  qty: 2400,
  claimed: false,
  closed: false,
  spent: {},
  clock: 8 * 60,
};

function stamp(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

export const useG2GStore = create<G2GState & G2GActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setView: (phase) => set({ view: phase }),

      advance: () => {
        const { cursor, spent, log, clock } = get();
        if (cursor >= GATES.length) return;
        const g = GATES[cursor];
        const nextClock = clock + 45 + (cursor % 3) * 20;
        const nextSpent = { ...spent, [g.id]: Math.round(g.sla * (0.55 + (cursor % 4) * 0.12) * 10) / 10 };
        const nextLog = [{ time: stamp(nextClock), text: "Gate " + g.id + " " + g.name + " selesai — " + g.done }, ...log];
        set({
          cursor: cursor + 1,
          view: cursor + 1 < GATES.length ? GATES[cursor + 1].phase : 5,
          log: nextLog,
          spent: nextSpent,
          clock: nextClock,
        });
      },

      rejectAction: () => {
        const { cursor, log, clock } = get();
        if (cursor <= 0) return;
        const g = GATES[cursor];
        const nextClock = clock + 30;
        const nextLog = [{ time: stamp(nextClock), text: "Gate " + g.id + " " + g.name + " dikembalikan ke gate " + GATES[cursor - 1].id + " untuk revisi" }, ...log];
        set({ cursor: cursor - 1, view: GATES[cursor - 1].phase, log: nextLog, clock: nextClock });
      },

      altAction: () => {
        const { cursor, log, clock } = get();
        const g = GATES[cursor];
        const nextClock = clock + 25;
        if (g.id === 5) {
          const nextLog = [{ time: stamp(nextClock), text: "2 roll di-close partial (shortage supplier) — qty PO 2.400 → 2.160 pcs, PR pengganti dibuat" }, ...log];
          set({ closed: true, qty: 2160, log: nextLog, clock: nextClock });
        } else if (g.id === 7) {
          const nextLog = [{ time: stamp(nextClock), text: "Claim RMA-014 diajukan — roll A-012 selisih berat 11,4% (toleransi 8%)" }, ...log];
          set({ claimed: true, log: nextLog, clock: nextClock });
        }
      },

      reset: () => set({ ...initialState, log: [{ time: "08:00", text: "Simulasi direset · PO-MKL-001 kembali ke draft" }] }),
    }),
    { name: "g2g-sim-v1" }
  )
);
