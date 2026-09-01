"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EntitasPanel } from "@/components/finance/entitas-panel";

export default function FinanceMasterDataPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <AppShell role="finance" activeHref="/finance/master-data" breadcrumb={["Dashboard", "Master Data"]} title="Master Data">
      <EntitasPanel />
    </AppShell>
  );
}
