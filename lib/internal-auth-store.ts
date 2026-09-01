import { create } from "zustand";
import { persist } from "zustand/middleware";
import { INTERNAL_ACCOUNTS, type InternalRole } from "./internal-auth";

type InternalAuthState = {
  unlockedRoles: InternalRole[];
  login: (role: InternalRole, password: string) => boolean;
  logout: (role: InternalRole) => void;
};

export const useInternalAuthStore = create<InternalAuthState>()(
  persist(
    (set, get) => ({
      unlockedRoles: [],
      login: (role, password) => {
        const account = INTERNAL_ACCOUNTS.find((a) => a.role === role);
        if (!account || account.password !== password) return false;
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])) });
        return true;
      },
      logout: (role) => {
        set({ unlockedRoles: get().unlockedRoles.filter((r) => r !== role) });
      },
    }),
    { name: "internal-auth-v1" }
  )
);
