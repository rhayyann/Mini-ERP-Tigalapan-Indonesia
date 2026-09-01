import { create } from "zustand";
import { persist } from "zustand/middleware";
import { VENDOR_ACCOUNTS } from "./vendor-auth";

type VendorAuthState = {
  loggedInVendorId: string | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
};

export const useVendorAuthStore = create<VendorAuthState>()(
  persist(
    (set) => ({
      loggedInVendorId: null,
      login: (username, password) => {
        const account = VENDOR_ACCOUNTS.find((a) => a.username === username.trim().toLowerCase() && a.password === password);
        if (!account) return false;
        set({ loggedInVendorId: account.vendorId });
        return true;
      },
      logout: () => set({ loggedInVendorId: null }),
    }),
    { name: "vendor-auth-v1" }
  )
);
