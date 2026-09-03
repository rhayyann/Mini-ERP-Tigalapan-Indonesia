"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { NAV } from "@/lib/shell/nav";
import { useMrpStore } from "@/lib/mrp/store";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import type { InternalRole } from "@/lib/internal-auth";
import {
  GOOGLE_SHEET_URLS,
  fetchGoogleSheetCsv,
  mapEntitasRows,
  mapHargaKainPksRows,
  mapHargaKainRows,
  mapHargaMaklonRows,
  parseCsvRows,
} from "@/lib/mrp/importGoogleSheet";
import {
  countMaterialClaimsUnresolved,
  countMaterialInvoicesReadyForDelivery,
  countMaterialPOsAwaitingInvoice,
  countMrpAwaitingScmApproval,
  countMrpWithoutPO,
  countPaymentTotal,
  countPoApprovalTotal,
  countProductionYieldUnresolved,
  countVendorGoodReceiveEligible,
  countVendorInvoicePaymentTotal,
  countVendorInvoicesAwaitingReview,
  countVendorPengirimanReady,
  countVendorProduksiActionable,
} from "@/lib/shell/badges";

const GATED_ROLES: InternalRole[] = ["ppic", "procurement", "finance", "scm", "produksi"];

export function AppShell({
  role,
  activeHref,
  breadcrumb,
  title,
  subtitle,
  actions,
  children,
  notifCount,
  roleOverride,
  entityOverride,
  vendorId,
}: {
  role: keyof typeof NAV;
  activeHref?: string;
  breadcrumb: string[];
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  notifCount?: number;
  roleOverride?: string;
  entityOverride?: string;
  vendorId?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const router = useRouter();
  const unlockedRoles = useInternalAuthStore((s) => s.unlockedRoles);
  const logoutInternal = useInternalAuthStore((s) => s.logout);
  const logoutVendor = useVendorAuthStore((s) => s.logout);

  const isGated = GATED_ROLES.includes(role as InternalRole);
  const authorized = !isGated || unlockedRoles.includes(role as InternalRole);

  useEffect(() => {
    if (mounted && isGated && !authorized) router.replace("/");
  }, [mounted, isGated, authorized, router]);

  const nav = NAV[role];
  const allNotifications = useMrpStore((s) => s.notifications);
  const markNotificationRead = useMrpStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useMrpStore((s) => s.markAllNotificationsRead);
  const dismissNotification = useMrpStore((s) => s.dismissNotification);

  const myNotifications = allNotifications
    .filter((n) => n.audience.includes(role) && (role !== "vendorMaklon" || !n.vendorId || n.vendorId === vendorId))
    .sort((a, b) => (a.time < b.time ? 1 : -1));

  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const productionYieldResolutions = useMrpStore((s) => s.productionYieldResolutions);

  // Auto-import Master Data (Harga Maklon/Kain/Kain PKS/Entitas) begitu terdeteksi kosong — SAMA
  // pola dengan `autoImportIfEmpty` di components/mrp/import-sheet-button.tsx, tapi dipasang di
  // sini (AppShell, mount di SETIAP halaman Procurement/Finance) supaya jalan otomatis walau user
  // tidak pernah buka halaman Master Data / tab-nya secara manual sama sekali — sebelumnya
  // auto-import cuma jalan kalau panel tab yang bersangkutan sempat DIRENDER (mis. tab "Harga
  // Kain" tidak pernah diklik → hargaKain tetap kosong selamanya, bikin dropdown "Vendor
  // material" di PO kosong walau user merasa "sudah pernah import").
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);
  const entitasList = useMrpStore((s) => s.entitasList);
  const replaceHargaMaklon = useMrpStore((s) => s.replaceHargaMaklon);
  const replaceHargaKain = useMrpStore((s) => s.replaceHargaKain);
  const replaceHargaKainPks = useMrpStore((s) => s.replaceHargaKainPks);
  const replaceEntitas = useMrpStore((s) => s.replaceEntitas);
  useEffect(() => {
    if (role !== "procurement" && role !== "finance") return;
    if (hargaMaklon.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaMaklon)
        .then((csv) => replaceHargaMaklon(mapHargaMaklonRows(parseCsvRows(csv))))
        .catch(() => {}); // gagal diam-diam — tombol Import manual di halaman Master Data tetap ada sebagai fallback
    }
    if (hargaKain.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaKain)
        .then((csv) => replaceHargaKain(mapHargaKainRows(parseCsvRows(csv))))
        .catch(() => {});
    }
    if (hargaKainPks.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaKainPks)
        .then((csv) => replaceHargaKainPks(mapHargaKainPksRows(parseCsvRows(csv))))
        .catch(() => {});
    }
    if (entitasList.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.entitas)
        .then((csv) => replaceEntitas(mapEntitasRows(parseCsvRows(csv))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, hargaMaklon.length, hargaKain.length, hargaKainPks.length, entitasList.length]);

  let badgeOverrides: Record<string, number> | undefined;
  if (role === "finance") {
    badgeOverrides = {
      "/finance/po-approval": countPoApprovalTotal(materialPOs, maklonPOs),
      "/finance/payment": countPaymentTotal(invoices, vendorInvoices),
    };
  } else if (role === "procurement") {
    badgeOverrides = {
      "/procurement/po-approval": countMrpWithoutPO(mrpDetails),
      // "Invoice Vendor" sekarang tab kedua di halaman ini (bukan halaman terpisah lagi) —
      // badge-nya digabung ke sini juga.
      "/raw-material": countMaterialPOsAwaitingInvoice(materialPOs) + countVendorInvoicesAwaitingReview(vendorInvoices),
      "/procurement/material-tracking": countMaterialInvoicesReadyForDelivery(invoices),
      "/procurement/material-claims": countMaterialClaimsUnresolved(invoices, materialClaimResolutions),
    };
  } else if (role === "scm") {
    badgeOverrides = {
      "/scm/approval-mrp": countMrpAwaitingScmApproval(mrpDetails),
    };
  } else if (role === "produksi") {
    badgeOverrides = {
      "/produksi/yield-alerts": countProductionYieldUnresolved(productionBatches, mrpDetails, productionYieldResolutions),
    };
  } else if (role === "vendorMaklon" && vendorId) {
    badgeOverrides = {
      // PO Produksi Saya sengaja TIDAK dikasih badge — sekarang 100% monitoring, tidak ada
      // satu pun tombol aksi di halaman itu (semua trigger sudah pindah ke Good Receive,
      // Produksi, dan Invoice & Payment).
      "/vendor-maklon/receiving": countVendorGoodReceiveEligible(vendorId, invoices),
      "/vendor-maklon/production": countVendorProduksiActionable(vendorId, productionBatches, productionResults, invoices),
      "/vendor-maklon/pengiriman": countVendorPengirimanReady(vendorId, productionResults, deliveryKolis),
      "/vendor-maklon/invoice-payment": countVendorInvoicePaymentTotal(vendorId, mrpDetails, deliveryKolis, vendorInvoices, maklonInvoices),
    };
  }

  if (!mounted || (isGated && !authorized)) return null;

  return (
    <div className="flex min-h-screen bg-surface-page">
      <Sidebar items={nav.items} activeHref={activeHref} badgeOverrides={badgeOverrides} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          role={roleOverride ?? nav.role}
          entity={entityOverride ?? nav.entity}
          notifications={myNotifications}
          onMarkRead={markNotificationRead}
          onMarkAllRead={() => markAllNotificationsRead(myNotifications.map((n) => n.id))}
          onDismiss={dismissNotification}
          onLogout={
            isGated
              ? () => {
                  logoutInternal(role as InternalRole);
                  router.push("/");
                }
              : role === "vendorMaklon"
                ? () => {
                    logoutVendor();
                    router.push("/vendor-maklon/login");
                  }
                : undefined
          }
        />
        <div className="flex items-center gap-2 px-[22px] pt-3.5 font-sans text-xs text-[#94A3B0]">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className={i === breadcrumb.length - 1 ? "font-medium text-[#31414F]" : undefined}>
              {crumb}
              {i < breadcrumb.length - 1 ? " /" : ""}
            </span>
          ))}
        </div>
        <div className="flex items-end gap-3 px-[22px] pb-0 pt-2">
          <div>
            <div className="font-heading text-[22px] font-bold tracking-tight text-text-primary">{title}</div>
            {subtitle && <div className="mt-0.5 font-sans text-xs text-text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="ml-auto flex gap-2">{actions}</div>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3.5 px-[22px] py-4">{children}</div>
      </div>
    </div>
  );
}
