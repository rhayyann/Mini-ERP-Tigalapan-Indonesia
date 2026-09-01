"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { PoMaterialPanel } from "@/components/finance/po-material-panel";
import { PoMaklonPanel } from "@/components/finance/po-maklon-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { countPendingMaklonPO, countPendingMaterialPO } from "@/lib/shell/badges";

export default function FinancePoApprovalPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const [tab, setTab] = useState<"material" | "maklon">("material");

  if (!mounted) return null;

  const materialBadge = countPendingMaterialPO(materialPOs);
  const maklonBadge = countPendingMaklonPO(maklonPOs);

  return (
    <AppShell role="finance" activeHref="/finance/po-approval" breadcrumb={["Dashboard", "PO Approval"]} title="PO Approval">
      <Tabs
        items={[
          { key: "material", label: "PO Material", badge: materialBadge },
          { key: "maklon", label: "PO Maklon", badge: maklonBadge },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "material" | "maklon")}
      />
      {tab === "material" ? <PoMaterialPanel /> : <PoMaklonPanel />}
    </AppShell>
  );
}
