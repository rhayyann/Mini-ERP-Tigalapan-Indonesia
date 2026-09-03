"use client";

import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { addDays, formatDate, formatPcs, formatRupiah, maklonPoBadgeWithApproval, maklonPoDisplayStatus, materialReceivedForMaklon, mrpDetailFor } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

function PoProduksiContent({ vendorId }: { vendorId: string }) {
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  const myPOs = maklonPOs.filter((p) => p.vendorProduksi === vendorId && p.approved);

  const columns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: false, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) + " pcs" },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    // Entitas SENGAJA tidak ditampilkan — PO Maklon di sistem ini tidak menggunakan entitas.
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadgeWithApproval(p, vendorInvoices);
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    // Tgl PO ditampilkan default (ganti No PO — vendor lebih butuh tanggal PO-nya daripada
    // nomornya) sementara Target Prod dipindah ke toggle "Kolom" (dibatasi 7 kolom total);
    // Target Deadline dipertahankan karena itu tanggal paling actionable buat vendor dikejar.
    { key: "tglPO", label: "Tanggal PO", default: true, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.poSent) },
    {
      key: "targetProd",
      label: "Target Prod",
      default: false,
      render: (p) => {
        const poSent = mrpDetailFor(p.mrpId, mrpDetails)?.dates.poSent;
        return poSent ? formatDate(addDays(poSent, 13)) : "—";
      },
    },
    {
      key: "targetDeadline",
      label: "Target Deadline",
      default: true,
      // Target deadline = 2 minggu dari tanggal PO diterbitkan (sebelumnya 3 minggu / +13+7 hari).
      render: (p) => {
        const poSent = mrpDetailFor(p.mrpId, mrpDetails)?.dates.poSent;
        return poSent ? formatDate(addDays(poSent, 14)) : "—";
      },
    },
    {
      key: "cancelLines",
      label: "Catatan perubahan dari Procurement",
      default: false,
      render: (p) =>
        p.cancelledLines.length ? (
          <div className="flex flex-col gap-1">
            {p.cancelledLines.map((c, i) => (
              <div key={i} className="text-danger-fg">
                {c.warna ? `${c.warna} · ${c.lengan} — ` : ""}
                {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs)` : ""}: {c.note}
              </div>
            ))}
          </div>
        ) : (
          "—"
        ),
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => {
        // Halaman ini murni monitoring status produksi — tidak ada tombol aksi sama sekali.
        // "Mulai Produksi" ada di halaman Good Receive (begitu bahan diterima), "Tandai
        // Selesai & Kirim" otomatis begitu target Finish Good tercapai (halaman Produksi),
        // dan "Ajukan Invoice Maklon" sekarang di halaman Invoice & Payment (tab "Invoice
        // Maklon") — supaya semua urusan tagihan ada di satu tempat, bukan tersebar.
        if (mrpDetailFor(p.mrpId, mrpDetails)?.mrp.isFob) return "—";
        // qty 0 = seluruh material PO ini sudah dipindahkan Procurement ke vendor lain (lihat
        // catatan di maklonPoBadge) — tidak ada aksi apa pun yang perlu/bisa dilakukan vendor ini
        // lagi untuk PO tsb, jadi jangan tampilkan "Menunggu bahan diterima" yang menyesatkan.
        if (p.qty === 0) return <span className="font-sans text-[11px] text-text-muted">Material sudah dipindahkan ke vendor lain</span>;
        const displayStatus = maklonPoDisplayStatus(p, vendorInvoices);
        if (displayStatus === "PARTIAL_WAITING_MATERIAL" || displayStatus === "FULL_WAITING_MATERIAL") {
          const ready = materialReceivedForMaklon(p.mrpId, p.vendorProduksi, invoices);
          return (
            <span className="font-sans text-[11px] text-text-muted">
              {ready ? "Bahan diterima — mulai produksi di Good Receive" : "Menunggu bahan diterima"}
            </span>
          );
        }
        if (displayStatus === "PRODUCTION") {
          return <span className="font-sans text-[11px] text-text-muted">Sedang produksi — catat progress di halaman Produksi</span>;
        }
        if (displayStatus === "DELIVERY") {
          return (
            <span className="font-sans text-[11px] text-text-muted">
              Siap diinvoice —{" "}
              <Link href="/vendor-maklon/invoice-payment" className="font-semibold text-action-primary underline">
                ajukan di Invoice &amp; Payment
              </Link>
            </span>
          );
        }
        if (displayStatus === "INVOICE") return <span className="font-sans text-[11px] text-text-muted">Menunggu approval/pembayaran Finance</span>;
        if (displayStatus === "PAID" || displayStatus === "FULLY_PAID") return <span className="font-sans text-[11px] text-success-fg">Lunas</span>;
        return "—";
      },
    },
  ];

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/po-produksi"
      breadcrumb={["Dashboard", "PO Produksi Saya"]}
      title="PO Produksi Saya"
      subtitle={`${myPOs.length} PO produksi yang sudah disetujui Finance`}
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <DataTable
        title="PO produksi saya"
        columns={columns}
        rows={myPOs}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(myPOs.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          { label: "No PO", options: Array.from(new Set(myPOs.map((p) => p.id))), test: (p, v) => p.id === v },
          {
            label: "Status",
            options: Array.from(new Set(myPOs.map((p) => maklonPoBadgeWithApproval(p, vendorInvoices).label))),
            test: (p, v) => maklonPoBadgeWithApproval(p, vendorInvoices).label === v,
          },
        ]}
        emptyText="Belum ada PO produksi yang disetujui Finance untuk vendor Anda."
        renderExpanded={(p) => {
          const rows = mrpDetailFor(p.mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === p.vendorProduksi) ?? [];
          if (rows.length === 0) {
            return <div className="font-sans text-[11.5px] text-text-muted">Belum ada rincian aduan pola untuk PO ini.</div>;
          }
          return (
            <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
              <div className="grid grid-cols-4 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                <span>Warna</span>
                <span>Lengan</span>
                <span className="text-right">Qty (pcs)</span>
                <span>Size</span>
              </div>
              {rows.map((a) => (
                <div key={a.id} className="grid grid-cols-4 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                  <span className="font-medium">{a.warna}</span>
                  <span>{a.lengan}</span>
                  <span className="text-right font-mono">{formatPcs(a.qty)}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {a.sizes.length > 0 ? a.sizes.map((s) => `${s.size} ${s.qty}`).join(", ") : "—"}
                  </span>
                </div>
              ))}
            </div>
          );
        }}
      />
    </AppShell>
  );
}

export default function VendorPoProduksiPage() {
  return <VendorAuthGuard>{(vendorId) => <PoProduksiContent vendorId={vendorId} />}</VendorAuthGuard>;
}
