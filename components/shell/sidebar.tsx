"use client";

import Link from "next/link";
import {
  LayoutGrid,
  ClipboardList,
  Package,
  Wallet,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Send,
  Truck,
  FileText,
  Users,
  Settings,
  Boxes,
  Receipt,
  Lock,
  Database,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/shell/nav";

function iconForLabel(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes("dashboard") || l.includes("overview")) return LayoutGrid;
  if (l.includes("mrp") || l.includes("planning")) return ClipboardList;
  if (l.includes("purchase order") || l.includes("po ") || l === "po" || l.includes("po produksi") || l.includes("po material")) return Package;
  if (l.includes("payment") || l.includes("ledger")) return Wallet;
  if (l.includes("master data")) return Database;
  if (l.includes("approval") || l.includes("master panel") || l.includes("sla")) return ShieldCheck;
  if (l.includes("vendor") || l.includes("entities")) return Building2;
  if (l.includes("receive") || l.includes("monitoring")) return CheckCircle2;
  if (l.includes("pengiriman") || l.includes("delivery")) return Truck;
  if (l.includes("invoice") || l.includes("laporan")) return Receipt;
  if (l.includes("material") || l.includes("raw material")) return Boxes;
  if (l.includes("users")) return Users;
  if (l.includes("settings") || l.includes("logs")) return Settings;
  if (l.includes("produksi") || l.includes("dokumen")) return FileText;
  return Send;
}

export function Sidebar({
  items,
  activeHref,
  badgeOverrides,
}: {
  items: NavItem[];
  activeHref?: string;
  /** Badge count real-time dihitung dari store (href → jumlah item pending), override
   *  `NavItem.badge` statis kalau ada nilainya untuk href tsb. */
  badgeOverrides?: Record<string, number>;
}) {
  return (
    <div className="flex w-[212px] flex-none flex-col bg-surface-nav">
      <div className="flex h-[52px] items-center gap-[9px] border-b border-white/8 px-4">
        <span className="rounded-[6px] bg-accent-blue" style={{ width: 22, height: 22 }} />
        <span className="font-heading text-[13px] font-bold leading-tight tracking-tight text-white">ERP Tigalapan Indonesia</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        {items.map((item) => {
          const active = !!item.href && item.href === activeHref;
          const Icon = iconForLabel(item.label);
          const badge = (item.href && badgeOverrides?.[item.href]) ?? item.badge;
          const className = cn(
            "flex items-center gap-2.5 rounded-[8px] px-3 py-2 font-sans text-[12.5px]",
            active ? "bg-accent-blue font-semibold text-white" : "font-medium text-[#9AA4BE] hover:text-white",
            !item.href && "cursor-default opacity-60"
          );
          const content = (
            <>
              <Icon size={15} strokeWidth={2} className="flex-shrink-0 opacity-90" />
              <span className="flex-1">{item.label}</span>
              {!!badge && badge > 0 && (
                <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{badge}</span>
              )}
              {!item.href && <Lock size={12} className="flex-shrink-0 opacity-50" />}
            </>
          );
          if (!item.href) {
            return (
              <div key={item.label} className={className}>
                {content}
              </div>
            );
          }
          return (
            <Link key={item.label} href={item.href} className={className}>
              {content}
            </Link>
          );
        })}
      </div>
      <div className="mt-auto border-t border-white/8 px-4 py-3.5 font-mono text-[10.5px] text-[#5E7288]">
        v1.0 · PT Tigalapan Sukses Indo
      </div>
    </div>
  );
}
