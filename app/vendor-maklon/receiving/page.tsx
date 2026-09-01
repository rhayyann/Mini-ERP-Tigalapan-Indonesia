"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { addDays, formatDate, formatDecimal, formatPcs, invoiceBadge, materialClaimsList, materialReceivedForMaklon, weightVariance } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

type DraftCode = { codeRoll: string; codeLot: string };
type PendingClaim = { idx: number; grossKg: number; netKg: number; codeRoll: string; codeLot: string; diffKg: number; pct: number };

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
  const receiveRawMaterialRoll = useMrpStore((s) => s.receiveRawMaterialRoll);
  const receiveRawMaterialAddBuy = useMrpStore((s) => s.receiveRawMaterialAddBuy);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedColorKey, setSelectedColorKey] = useState("");
  const [draftNet, setDraftNet] = useState<Record<number, number>>({});
  const [draftCode, setDraftCode] = useState<Record<number, DraftCode>>({});
  const [pendingClaim, setPendingClaim] = useState<PendingClaim | null>(null);
  // Roll yang sedang ditimbang ULANG (bukan input pertama kali) — dipicu manual lewat tombol
  // "Timbang Ulang" pada roll yang Procurement sudah tandai "Retur diminta". Direset tiap ganti
  // warna/invoice supaya tidak nyangkut ke kombinasi lain.
  const [reweighingIdx, setReweighingIdx] = useState<Set<number>>(new Set());
  // Klaim aktif SAAT INI (dihitung ulang dari data live) — dipakai buat cek apakah roll yang
  // "retur diminta" itu masih benar-benar di luar toleransi (kalau sudah pernah ditimbang ulang &
  // sesuai, otomatis tidak dianggap klaim lagi, badge "Retur diminta" pun ikut hilang sendiri).
  const activeClaimKeys = new Set(materialClaimsList(invoices).map((c) => c.key));

  const eligible = invoices.filter((i) => i.destinationVendor === vendorId && (i.status === "DELIVERY" || i.status === "RECEIVING"));
  // MRP tetap tampil di dropdown selama masih ada invoice DELIVERY atau RECEIVING (termasuk yang
  // sudah mulai diterima tapi belum semua roll-nya diinput) — sebelumnya cuma DELIVERY, jadi MRP
  // hilang begitu roll pertama diinput meski masih ada roll lain yang belum diinput.
  const mrpIds = Array.from(new Set(eligible.map((i) => i.mrpId)));
  const mrpInvoices = eligible.filter((i) => i.mrpId === selectedMrpId);
  const selectedInvoice = eligible.find((i) => i.id === selectedInvoiceId) ?? null;
  // PO maklon untuk MRP ini yang masih menunggu bahan TAPI bahannya sudah mulai diterima —
  // aksi "Mulai Produksi" sengaja ditaruh di sini (bukan di PO Produksi Saya) supaya begitu
  // vendor selesai timbang roll, langsung bisa lanjut produksi tanpa pindah halaman.
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
  // demi kebutuhan simulasi supaya tidak perlu input manual. Tetap bisa diedit sebelum "Simpan".
  useEffect(() => {
    if (!selectedColor || !selectedInvoice) return;
    setDraftCode((prev) => {
      const usedRoll = new Set(Object.values(prev).map((c) => c.codeRoll).filter(Boolean));
      const usedLot = new Set(Object.values(prev).map((c) => c.codeLot).filter(Boolean));
      const next = { ...prev };
      let changed = false;
      selectedColor.rolls.forEach((_, idx) => {
        const receipt = selectedInvoice.rollReceipts[selectedColorKey]?.[idx];
        if (receipt || next[idx]) return;
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
    setDraftNet({});
    setDraftCode({});
  }

  function pickInvoice(id: string) {
    setSelectedInvoiceId(id);
    const inv = eligible.find((i) => i.id === id);
    const first = inv?.colorEntries[0];
    setSelectedColorKey(first ? first.warna + "|" + first.lengan : "");
    setDraftNet({});
    setDraftCode({});
    setReweighingIdx(new Set());
  }

  function pickColor(key: string) {
    setSelectedColorKey(key);
    setDraftNet({});
    setDraftCode({});
    setReweighingIdx(new Set());
  }

  function startReweigh(idx: number, netKg: number, codeRoll: string, codeLot: string) {
    setReweighingIdx((prev) => new Set(prev).add(idx));
    setDraftNet((prev) => ({ ...prev, [idx]: netKg }));
    setDraftCode((prev) => ({ ...prev, [idx]: { codeRoll, codeLot } }));
  }

  function commitRoll(idx: number, netKg: number, codeRoll: string, codeLot: string, claim?: { diffKg: number; pct: number }) {
    if (!selectedInvoice || !selectedColor) return;
    receiveRawMaterialRoll(selectedInvoice.id, selectedColor.warna, selectedColor.lengan, idx, netKg, codeRoll || undefined, codeLot || undefined, claim);
    setReweighingIdx((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }

  function saveRoll(idx: number, grossKg: number) {
    if (!selectedInvoice || !selectedColor) return;
    const netKg = draftNet[idx] ?? grossKg;
    const code = draftCode[idx] ?? { codeRoll: "", codeLot: "" };
    const variance = weightVariance(grossKg, netKg);
    if (!variance.withinTolerance) {
      setPendingClaim({ idx, grossKg, netKg, codeRoll: code.codeRoll, codeLot: code.codeLot, diffKg: variance.diff, pct: variance.pct });
      return;
    }
    commitRoll(idx, netKg, code.codeRoll, code.codeLot);
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/receiving"
      breadcrumb={["Dashboard", "Good Receive"]}
      title="Good Receive — Terima Material"
      subtitle="Timbang berat bersih per roll, lalu bandingkan dengan berat kotor dari invoice procurement"
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
            </option>
          ))}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada bahan berstatus DELIVERY menuju vendor Anda.</div>}
      </div>

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">PO material — {selectedMrpId}</div>
          <div className="grid grid-cols-8 gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>No PO</span>
            <span>Supplier</span>
            <span>Warna</span>
            <span>Status</span>
            <span>Tanggal Kirim</span>
            <span>Tanggal Terima</span>
            <span>Target Selesai Produksi</span>
            <span />
          </div>
          {mrpInvoices.map((i) => (
            <div key={i.id} className="grid grid-cols-8 items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
              <span className="font-mono font-medium">{i.poId}</span>
              <span>{i.supplier}</span>
              <span>{i.colorEntries.map((c) => c.warna).join(", ")}</span>
              <span>
                <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill>
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
          ))}
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
              {colorOptions.map((c) => (
                <button
                  key={c.warna + c.lengan}
                  onClick={() => pickColor(c.warna + "|" + c.lengan)}
                  className={
                    "rounded-md border px-2.5 py-[6px] font-sans text-[11.5px] font-semibold " +
                    (selectedColorKey === c.warna + "|" + c.lengan ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                  }
                >
                  {c.warna} · {c.lengan} ({c.rolls.length} roll)
                </button>
              ))}
            </div>
          </div>

          {selectedColor && (
            <div className="w-full overflow-x-auto rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
                Berat per roll — {selectedColor.warna} · {selectedColor.lengan}
              </div>
              <div
                className="grid min-w-[900px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
                style={{ gridTemplateColumns:
                    "minmax(70px,0.6fr) minmax(130px,1.2fr) minmax(90px,0.7fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.8fr) minmax(150px,1fr)",
                }}
              >
                <span>Roll</span>
                <span>Code Roll</span>
                <span>Code Lot</span>
                <span className="text-right">Berat kotor (kg)</span>
                <span className="text-right">Berat bersih (kg)</span>
                <span className="text-right">Selisih</span>
                <span>Toleransi</span>
                <span>Tanggal terima</span>
              </div>
              {selectedColor.rolls.map((grossKg, idx) => {
                const receipt = selectedInvoice.rollReceipts[selectedColorKey]?.[idx] ?? null;
                const isReweighing = reweighingIdx.has(idx);
                const editing = !receipt || isReweighing;
                const netVal = editing ? draftNet[idx] : receipt.netKg;
                const variance = netVal !== undefined ? weightVariance(grossKg, netVal) : null;
                const code = draftCode[idx] ?? { codeRoll: receipt?.codeRoll ?? "", codeLot: receipt?.codeLot ?? "" };
                const claimKey = `${selectedInvoice.id}|${selectedColor.warna}|${selectedColor.lengan}|${idx}`;
                const pendingRetur = !!materialClaimReturRequests[claimKey] && activeClaimKeys.has(claimKey);
                return (
                  <div
                    key={idx}
                    className="grid min-w-[900px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                    style={{ gridTemplateColumns:
                    "minmax(70px,0.6fr) minmax(130px,1.2fr) minmax(90px,0.7fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.8fr) minmax(150px,1fr)",
                }}
                  >
                    <span className="font-mono font-medium">Roll {idx + 1}</span>
                    {editing ? (
                      <input
                        value={code.codeRoll}
                        onChange={(e) => setDraftCode((prev) => ({ ...prev, [idx]: { ...code, codeRoll: e.target.value } }))}
                        className="input text-[11px]"
                        placeholder="Code roll"
                      />
                    ) : (
                      <span className="font-mono text-[11px]">{receipt.codeRoll || "—"}</span>
                    )}
                    {editing ? (
                      <input
                        value={code.codeLot}
                        onChange={(e) => setDraftCode((prev) => ({ ...prev, [idx]: { ...code, codeLot: e.target.value } }))}
                        className="input text-[11px]"
                        placeholder="Code lot"
                      />
                    ) : (
                      <span className="font-mono text-[11px]">{receipt.codeLot || "—"}</span>
                    )}
                    <span className="text-right font-mono">{formatDecimal(grossKg)}</span>
                    {editing ? (
                      <span className="flex justify-end">
                        <NumberInput
                          value={draftNet[idx] ?? receipt?.netKg ?? grossKg}
                          decimals={2}
                          onChange={(v) => setDraftNet((prev) => ({ ...prev, [idx]: v }))}
                          className="input w-[100px] text-right"
                        />
                      </span>
                    ) : (
                      <span className="text-right font-mono">{formatDecimal(receipt.netKg)}</span>
                    )}
                    <span className={"text-right font-mono " + (variance ? (variance.withinTolerance ? "text-success-fg" : "text-danger-fg") : "text-text-muted")}>
                      {variance ? `${variance.diff >= 0 ? "+" : ""}${formatDecimal(variance.diff)} kg (${variance.pct.toFixed(1)}%)` : "—"}
                    </span>
                    <span>
                      {variance ? (
                        <StatusPill tone={variance.withinTolerance ? "success" : "danger"}>{variance.withinTolerance ? "SESUAI" : "DI LUAR TOLERANSI"}</StatusPill>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="flex items-center gap-2.5">
                      {editing ? (
                        <Button onClick={() => saveRoll(idx, grossKg)} variant="primary" size="xs">
                          Simpan
                        </Button>
                      ) : pendingRetur ? (
                        <>
                          <StatusPill tone="info">Retur diminta</StatusPill>
                          <Button
                            onClick={() => startReweigh(idx, receipt.netKg, receipt.codeRoll ?? "", receipt.codeLot ?? "")}
                            variant="accent"
                            size="xs"
                          >
                            Timbang Ulang
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="font-mono text-[11px] text-text-muted">{formatDate(receipt.receivedAt)}</span>
                          <StatusPill tone="success">Diterima</StatusPill>
                        </>
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

      {pendingClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45">
          <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-danger-bg bg-danger-bg px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-danger" />
                <span className="font-sans text-[13px] font-semibold text-danger-fg">Selisih berat di luar toleransi</span>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-sans text-xs text-[#31414F]">
                Roll {pendingClaim.idx + 1} — selisih {pendingClaim.diffKg >= 0 ? "+" : ""}
                {formatDecimal(pendingClaim.diffKg)} kg ({pendingClaim.pct.toFixed(1)}%), melebihi toleransi ±2%.
              </div>
              <div className="mt-2 font-sans text-xs text-text-muted">
                Kirim claim ke Procurement supaya selisih ini dicatat dan bisa ditindaklanjuti?
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button
                onClick={() => setPendingClaim(null)}
                className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  commitRoll(pendingClaim.idx, pendingClaim.netKg, pendingClaim.codeRoll, pendingClaim.codeLot, { diffKg: pendingClaim.diffKg, pct: pendingClaim.pct });
                  setPendingClaim(null);
                }}
                className="rounded-md bg-danger px-3.5 py-[7px] font-sans text-xs font-semibold text-white"
              >
                Ya, Kirim Claim
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function VendorReceivingPage() {
  return <VendorAuthGuard>{(vendorId) => <ReceivingContent vendorId={vendorId} />}</VendorAuthGuard>;
}
