import { create } from "zustand";
import { persist } from "zustand/middleware";
import { loginVendorAction, logoutVendorAction } from "../auth/actions";
import { useMrpStore } from "./store";

// CATATAN MIGRASI SUPABASE: dulu login() mengecek password langsung ke
// VENDOR_PRODUKSI[id].password (plaintext, ter-bundle ke client, seragam "vendor123"
// buat semua vendor). Sekarang dicek server-only lewat Server Action loginVendorAction
// (lib/auth/actions.ts) terhadap kolom vendors_produksi.password_hash di Supabase, yang
// juga men-set cookie httpOnly sungguhan TERPISAH dari sesi role internal (lihat
// lib/auth/session.ts) -- login/logout vendor tidak lagi ikut melogout-kan role internal
// yang sedang aktif di tab lain. Store ini cuma cache hasilnya di client buat
// AppShell/Sidebar/VendorAuthGuard -- proteksi sesungguhnya ada di proxy.ts.
type VendorAuthState = {
  loggedInVendorId: string | null;
  /** Login berbasis ketik nama vendor (bukan dropdown/select) — `nameOrId` dicocokkan
   *  case-insensitive ke `name` ATAU kode vendor di server (lihat loginVendorAction). */
  login: (nameOrId: string, password: string) => Promise<boolean>;
  logout: () => void;
};

export const useVendorAuthStore = create<VendorAuthState>()(
  persist(
    (set) => ({
      loggedInVendorId: null,
      login: async (nameOrId, password) => {
        const result = await loginVendorAction(nameOrId, password);
        if (!result.ok) return false;
        set({ loggedInVendorId: result.vendorId ?? null });
        // Lihat catatan sama di lib/internal-auth-store.ts -- StoreHydrator tidak lagi refetch
        // otomatis tiap pindah halaman, jadi perlu dipicu manual begitu login sukses.
        void useMrpStore.getState().refresh();
        return true;
      },
      logout: () => {
        void logoutVendorAction();
        set({ loggedInVendorId: null });
      },
    }),
    { name: "vendor-auth-v1" }
  )
);
