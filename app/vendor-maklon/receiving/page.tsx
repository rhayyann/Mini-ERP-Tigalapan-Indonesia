"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { addDays, formatDate, formatDecimal, formatPcs, invoiceBadge, materialReceivedForMaklon, rollArrivalProgress, rollArrivalStatus, rollArrivalStatusBadge } from "@/lib/mrp/derive";
import { countGoodReceiveEligibleForMrp, pendingMarker } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

type DraftCode = { codeRoll: string; codeLot: string };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomLetters(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}

function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** Format contoh: HSGU23492384 (4 huruf + 8 digit). */
function generateCodeRoll(taken: Set<string>): string {
  let code = "";
  do {
    code = randomLetters(4) + randomDigits(8);
  } while (taken.has(code));
  return code;
}

/** Format contoh: 818 (3 digit). */
function generateCodeLot(taken: Set<string>): string {
  let code = "";
  do {
    code = String(100 + Math.floor(Math.random() * 900));
  } while (taken.has(code));
  return code;
}

function ReceivingContent({ vendorId }: { vendorId: string }) {
  const invoices = useMrpStore((s) => s.invoices);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const advanceMaklonProduction = useMrpStore((s) => s.advanceMaklonProduction);
  const markRollArrived = useMrpStore((s) => s.markRollArrived);
  const receiveRawMaterialAddBuy = useMrpStore((s) => s.receiveRawMaterialAddBuy);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  // Filter status PO material — default "Semua" (perilaku lama). Sengaja dipisah dari status
  // asli invoice ("DELIVERY"/"RECEIVING") supaya list yang sudah RECEIVING (biasanya jauh lebih
  // banyak) tidak menenggelamkan yang masih DELIVERY dan justru butuh dipantau/ditindaklanjuti.
  const [statusFilter, setStatusFilter] = useState<"ALL" | "DELIVERY" | "RECEIVING" | "PARSIAL">("ALL");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedColorKey, setSelectedColorKey] = useState("");
  const [draftCode, setDraftCode] = useState<Record<number, DraftCode>>({});

  const eligible = invoices.filter((i) => i.destinationVendor === vendorId && (i.status === "DELIVERY" || i.status === "RECEIVING"));
  // MRP tetap tampil di dropdown selama masih ada invoice DELIVERY atau RECEIVING (termasuk yang
  // sudah mulai diterima tapi belum semua roll-nya ditandai) — sebelumnya cuma DELIVERY, jadi MRP
  // hilang begitu roll pertama ditandai meski masih ada roll lain yang belum ditandai.
  const mrpIds = Array.from(new Set(eligible.map((i) => i.mrpId)));
  const mrpInvoicesAll = eligible.filter((i) => i.mrpId === selectedMrpId);
  const mrpInvoices =
    statusFilter === "ALL"
      ? mrpInvoicesAll
      : statusFilter === "PARSIAL"
        ? mrpInvoicesAll.filter((i) => rollArrivalStatus(i) === "PARSIAL")
        : mrpInvoicesAll.filter((i) => i.status === statusFilter);
  const deliveryCount = mrpInvoicesAll.filter((i) => i.status === "DELIVERY").length;
  const receivingCount = mrpInvoicesAll.filter((i) => i.status === "RECEIVING").length;
  const parsialCount = mrpInvoicesAll.filter((i) => rollArrivalStatus(i) === "PARSIAL").length;
  const selectedInvoice = eligible.find((i) => i.id === selectedInvoiceId) ?? null;
  // PO maklon untuk MRP ini yang masih menunggu bahan TAPI bahannya sudah mulai diterima —
  // aksi "Mulai Produksi" sengaja ditaruh di sini (bukan di PO Produksi Saya) supaya begitu
  // vendor selesai tandai roll diterima, langsung bisa lanjut produksi tanpa pindah halaman.
  const readyMaklonPOs = maklonPOs.filter(
    (p) =>
      p.mrpId === selectedMrpId &&
      p.vendorProduksi === vendorId &&
      (p.status === "FULL_WAITING_MATERIAL" || p.status === "PARTIAL_WAITING_MATERIAL") &&
      materialReceivedForMaklon(p.mrpId, p.vendorProduksi, invoices)
  );
  const colorOptions = selectedInvoice?.colorEntries ?? [];
  const selectedColor = colorOptions.find((c) => c.warna + "|" + c.lengan === selectedColorKey) ?? null;

  // Auto-generate Code Roll & Code Lot per roll (unik dalam batch ini) begitu warna dipilih —
  // demi kebutuhan simulasi supaya tidak perlu input manual. Tetap bisa diedit sebelum "Tandai
  // diterima". Ditandai berdasarkan rollArrivals (bukan rollReceipts lagi) — roll sudah dianggap
  // "selesai di sini" begitu ditandai diterima, tidak perlu menunggu ditimbang (itu di Cutting).
  useEffect(() => {
    if (!selectedColor || !selectedInvoice) return;
    setDraftCode((prev) => {
      const usedRoll = new Set(Object.values(prev).map((c) => c.codeRoll).filter(Boolean));
      const usedLot = new Set(Object.values(prev).map((c) => c.codeLot).filter(Boolean));
      const next = { ...prev };
      let changed = false;
      selectedColor.rolls.forEach((_, idx) => {
        const arrival = selectedInvoice.rollArrivals[selectedColorKey]?.[idx];
        if (arrival || next[idx]) return;
        const codeRoll = generateCodeRoll(usedRoll);
        const codeLot = generateCodeLot(usedLot);
        usedRoll.add(codeRoll);
        usedLot.add(codeLot);
        next[idx] = { codeRoll, codeLot };
        changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColorKey]);

  function pickMrp(mrpId: string) {
    setSelectedMrpId(mrpId);
    setSelectedInvoiceId("");
    setSelectedColorKey("");
    setDraftCode({});
  }

  function pickInvoice(id: string) {
    setSelectedInvoiceId(id);
    const inv = eligible.find((i) => i.id === id);
    const first = inv?.colorEntries[0];
    setSelectedColorKey(first ? first.warna + "|" + first.lengan : "");
    setDraftCode({});
  }

  function pickColor(key: string) {
    setSelectedColorKey(key);
    setDraftCode({});
  }

  function markArrived(idx: number) {
    if (!selectedInvoice || !selectedColor) return;
    const code = draftCode[idx] ?? { codeRoll: "", codeLot: "" };
    markRollArrived(selectedInvoice.id, selectedColor.warna, selectedColor.lengan, idx, code.codeRoll || undefined, code.codeLot || undefined);
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/receiving"
      breadcrumb={["Dashboard", "Good Receive"]}
      title="Good Receive — Terima Material"
      subtitle="Tandai roll yang fisiknya sudah datang — timbang berat bersih & bandingkan dengan berat kotor dilakukan di halaman Cutting"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => pickMrp(e.target.value)}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {mrpIds.map((id) => (
            <option key={id} value={id}>
              {id} ({eligible.filter((i) => i.mrpId === id).length} PO)
              {pendingMarker(countGoodReceiveEligibleForMrp(id, vendorId, invoices), "PO belum lengkap diterima")}
            </option>
          ))}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada bahan berstatus DELIVERY menuju vendor Anda.</div>}
      </div>

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">PO material — {selectedMrpId}</span>
            <div className="flex gap-1.5">
              {(
                [
                  { key: "ALL" as const, label: `Semua (${mrpInvoicesAll.length})` },
                  { key: "DELIVERY" as const, label: `Delivery (${deliveryCount})` },
                  { key: "RECEIVING" as const, label: `Receiving (${receivingCount})` },
                  { key: "PARSIAL" as const, label: `Parsial (${parsialCount})` },
                ]
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  className={
                    "rounded-md border px-2.5 py-[6px] font-sans text-[11px] font-semibold " +
                    (statusFilter === opt.key ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-9 gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>No PO</span>
            <span>Supplier</span>
            <span>Warna</span>
            <span>Status</span>
            <span className="text-right">Roll diterima</span>
            <span>Tanggal Kirim</span>
            <span>Tanggal Terima</span>
            <span>Target Selesai Produksi</span>
            <span />
          </div>
          {mrpInvoices.length === 0 && (
            <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO dengan status ini.</div>
          )}
          {mrpInvoices.map((i) => {
            const progress = rollArrivalProgress(i);
            return (
              <div key={i.id} className="grid grid-cols-9 items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono font-medium">{i.poId}</span>
                <span>{i.supplier}</span>
                <span>{i.colorEntries.map((c) => c.warna).join(", ")}</span>
                <span className="flex items-center gap-1.5">
                  <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill>
                  <StatusPill tone={rollArrivalStatusBadge(rollArrivalStatus(i)).tone}>{rollArrivalStatusBadge(rollArrivalStatus(i)).label}</StatusPill>
                </span>
                <span className={"text-right font-mono " + (progress.arrived < progress.total ? "text-warning-fg" : "text-success-fg")}>
                  {progress.arrived}/{progress.total} roll
                </span>
                <span className="font-mono text-[11px] text-text-muted">{formatDate(i.deliveredAt)}</span>
                <span className="font-mono text-[11px] text-text-muted">{formatDate(i.receivedAt)}</span>
                <span className="font-mono text-[11px] text-text-muted">
                  {i.receivedAt ? formatDate(addDays(i.receivedAt, VENDOR_PRODUKSI[vendorId]?.productionLeadDays ?? 7)) : "—"}
                </span>
                <span className="text-right">
                  <Button onClick={() => pickInvoice(i.id)} variant={selectedInvoiceId === i.id ? "muted" : "primary"} size="xs">
                    {selectedInvoiceId === i.id ? "Terpilih" : "Pilih →"}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {readyMaklonPOs.length > 0 && (
        <div className="rounded-lg border border-[#B7DFC5] bg-success-bg px-5 py-4">
          <div className="font-sans text-[12.5px] font-semibold text-success-fg">Bahan sudah diterima — siap mulai produksi</div>
          <div className="mt-2.5 flex flex-col gap-2">
            {readyMaklonPOs.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-white px-3.5 py-2.5">
                <span className="font-sans text-xs text-[#31414F]">
                  <span className="font-mono font-medium">{p.id}</span> — {formatPcs(p.qty)} pcs
                </span>
                <Button onClick={() => advanceMaklonProduction(p.id)} variant="primary" size="xs">
                  Mulai Produksi →
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedInvoice && (
        <>
          <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[13px] font-semibold text-text-primary">{selectedInvoice.poId}</span>
              <StatusPill tone={invoiceBadge(selectedInvoice.status).tone}>{invoiceBadge(selectedInvoice.status).label}</StatusPill>
            </div>
            <div className="mt-1 font-sans text-xs text-text-muted">
              {selectedInvoice.supplier} · No. invoice supplier: {selectedInvoice.noInvoiceVendor || "—"}
            </div>
            <div className="mt-3 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih warna</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {colorOptions.map((c) => {
                const key = c.warna + "|" + c.lengan;
                const arrivedCount = c.rolls.filter((_, idx) => selectedInvoice.rollArrivals[key]?.[idx]).length;
                return (
                  <button
                    key={key}
                    onClick={() => pickColor(key)}
                    disabled={c.rolls.length === 0}
                    className={
                      "rounded-md border px-2.5 py-[6px] font-sans text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 " +
                      (selectedColorKey === key ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                    }
                  >
                    {c.warna} · {c.lengan} ({arrivedCount}/{c.rolls.length} diterima)
                  </button>
                );
              })}
            </div>
            {colorOptions.some((c) => c.rolls.length === 0) && (
              <div className="mt-2 font-sans text-[11px] text-text-muted">
                Warna dengan 0 roll belum ada data roll dari Procurement untuk invoice ini — tidak bisa ditandai diterima di sini.
              </div>
            )}
          </div>

          {selectedColor && (
            <div className="w-full overflow-x-auto rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
                Tandai roll diterima — {selectedColor.warna} · {selectedColor.lengan}
              </div>
              <div
                className="grid min-w-[760px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
                style={{ gridTemplateColumns: "minmax(70px,0.6fr) minmax(150px,1.3fr) minmax(100px,0.8fr) minmax(110px,0.9fr) minmax(150px,1.2fr)" }}
              >
                <span>Roll</span>
                <span>Code Roll</span>
                <span>Code Lot</span>
                <span className="text-right">Berat kotor (kg)</span>
                <span>Status</span>
              </div>
              {selectedColor.rolls.map((grossKg, idx) => {
                const arrival = selectedInvoice.rollArrivals[selectedColorKey]?.[idx] ?? null;
                const code = draftCode[idx] ?? { codeRoll: arrival?.codeRoll ?? "", codeLot: arrival?.codeLot ?? "" };
                return (
                  <div
                    key={idx}
                    className="grid min-w-[760px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                    style={{ gridTemplateColumns: "minmax(70px,0.6fr) minmax(150px,1.3fr) minmax(100px,0.8fr) minmax(110px,0.9fr) minmax(150px,1.2fr)" }}
                  >
                    <span className="font-mono font-medium">Roll {idx + 1}</span>
                    {arrival ? (
                      <span className="font-mono text-[11px]">{arrival.codeRoll || "—"}</span>
                    ) : (
                      <input
                        value={code.codeRoll}
                        onChange={(e) => setDraftCode((prev) => ({ ...prev, [idx]: { ...code, codeRoll: e.target.value } }))}
                        className="input text-[11px]"
                        placeholder="Code roll"
                      />
                    )}
                    {arrival ? (
                      <span className="font-mono text-[11px]">{arrival.codeLot || "—"}</span>
                    ) : (
                      <input
                        value={code.codeLot}
                        onChange={(e) => setDraftCode((prev) => ({ ...prev, [idx]: { ...code, codeLot: e.target.value } }))}
                        className="input text-[11px]"
                        placeholder="Code lot"
                      />
                    )}
                    <span className="text-right font-mono">{formatDecimal(grossKg)}</span>
                    <span className="flex items-center gap-2.5">
                      {arrival ? (
                        <>
                          <span className="font-mono text-[11px] text-text-muted">{formatDate(arrival.arrivedAt)}</span>
                          <StatusPill tone="success">Diterima</StatusPill>
                        </>
                      ) : (
                        <Button onClick={() => markArrived(idx)} variant="primary" size="xs">
                          Tandai diterima →
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {selectedInvoice.addBuys.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Add Buy — bahan tambahan dari invoice</div>
              <div className="grid grid-cols-5 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                <span>Item</span>
                <span>Warna</span>
                <span className="text-right">Berat (kg)</span>
                <span>Tanggal terima</span>
                <span />
              </div>
              {selectedInvoice.addBuys.map((b) => {
                const receipt = selectedInvoice.addBuyReceipts[b.id];
                return (
                  <div key={b.id} className="grid grid-cols-5 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                    <span className="font-medium">{b.item}</span>
                    <span>{b.warna || "—"}</span>
                    <span className="text-right font-mono">{formatDecimal(b.beratKg)}</span>
                    <span className="font-mono text-[11px] text-text-muted">{receipt ? formatDate(receipt.receivedAt) : "—"}</span>
                    <span className="text-right">
                      {receipt ? (
                        <span className="font-sans text-[11px] text-success-fg">Diterima</span>
                      ) : (
                        <Button onClick={() => receiveRawMaterialAddBuy(selectedInvoice.id, b.id)} variant="success" size="xs">
                          Terima →
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

export default function VendorReceivingPage() {
  return <VendorAuthGuard>{(vendorId) => <ReceivingContent vendorId={vendorId} />}</VendorAuthGuard>;
}
