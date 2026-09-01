"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

export function VendorAuthGuard({ children }: { children: (vendorId: string) => ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const loggedInVendorId = useVendorAuthStore((s) => s.loggedInVendorId);
  const router = useRouter();

  useEffect(() => {
    if (mounted && !loggedInVendorId) router.replace("/vendor-maklon/login");
  }, [mounted, loggedInVendorId, router]);

  if (!mounted || !loggedInVendorId) return null;
  return <>{children(loggedInVendorId)}</>;
}
