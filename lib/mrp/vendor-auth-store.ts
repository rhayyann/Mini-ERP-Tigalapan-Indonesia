import { create } from "zustand";
import { persist } from "zustand/middleware";
import { VENDOR_PRODUKSI } from "./seed";

type VendorAuthState = {
  loggedInVendorId: string | null;
  /** Login berbasis ketik nama vendor (bukan dropdown/select) — `nameOrId` dicocokkan
   *  case-insensitive ke `name` ATAU ke key VENDOR_PRODUKSI (kode vendor), supaya user bisa
   *  ketik "Cecep" maupun "CE" dan tetap kena. Password dibandingkan langsung ke
   *  VENDOR_PRODUKSI[id].password (semua vendor pakai password seragam, lihat lib/mrp/seed.ts). */
  login: (nameOrId: string, password: string) => boolean;
  logout: () => void;
};

export const useVendorAuthStore = create<VendorAuthState>()(
  persist(
    (set) => ({
      loggedInVendorId: null,
      login: (nameOrId, password) => {
        const query = nameOrId.trim().toLowerCase();
        if (!query) return false;
        const entry = Object.entries(VENDOR_PRODUKSI).find(([id, v]) => v.name.toLowerCase() === query || id.toLowerCase() === query);
        if (!entry || entry[1].password !== password) return false;
        set({ loggedInVendorId: entry[0] });
        return true;
      },
      logout: () => {
        set({ loggedInVendorId: null });
      },
    }),
    { name: "vendor-auth-v1" }
  )
);
