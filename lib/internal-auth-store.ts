import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InternalRole } from "./internal-auth";
import { loginInternalAction, logoutInternalAction } from "./auth/actions";
import { useMrpStore } from "./mrp/store";

// CATATAN MIGRASI SUPABASE: dulu login() mengecek password langsung terhadap
// INTERNAL_ACCOUNTS (plaintext, ter-bundle ke client). Sekarang password dicek
// server-only lewat Server Action loginInternalAction (lib/auth/actions.ts) yang juga
// men-set cookie httpOnly sungguhan (BISA lebih dari satu role aktif sekaligus, lihat
// lib/auth/session.ts) -- store ini cuma jadi CACHE hasilnya di client, dipakai
// AppShell/Sidebar untuk render, BUKAN lagi satu-satunya lapisan proteksi (proteksi
// sesungguhnya ada di proxy.ts, yang mengecek cookie tsb).
type InternalAuthState = {
  unlockedRoles: InternalRole[];
  login: (role: InternalRole, password: string) => Promise<boolean>;
  logout: (role: InternalRole) => void;
};

export const useInternalAuthStore = create<InternalAuthState>()(
  persist(
    (set, get) => ({
      unlockedRoles: [],
      login: async (role, password) => {
        const result = await loginInternalAction(role, password);
        if (!result.ok) return false;
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])) });
        // StoreHydrator sekarang cuma fetch snapshot sekali saat mount + saat fokus/poll berkala
        // (lihat components/shell/store-hydrator.tsx, demi navigasi antar halaman yang cepat) --
        // tanpa baris ini, halaman pertama setelah login akan kosong sampai fokus/poll berikutnya.
        void useMrpStore.getState().refresh();
        return true;
      },
      logout: (role) => {
        void logoutInternalAction(role);
        set({ unlockedRoles: get().unlockedRoles.filter((r) => r !== role) });
      },
    }),
    { name: "internal-auth-v1" }
  )
);
