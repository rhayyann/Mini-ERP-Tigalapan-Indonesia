"use client";

import { formatDate } from "@/lib/mrp/derive";
import { getDeliveryKoliEkspedisiPhotoAction } from "@/lib/mrp/actions";
import { openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";

/** Item 2026-09-10 (feedback: Procurement "Invoice Vendor" & Finance "Payment Maklon" minta info
 *  lampiran ekspedisi dari vendor produksi sebelum approve/bayar) -- kartu ringkas 1 koli
 *  pengiriman (No Koli/Ekspedisi/Tanggal Kirim/Catatan + tombol lihat foto), markup SAMA PERSIS
 *  dipakai di 2 tempat (invoice-vendor-review-panel.tsx & payment-maklon-panel.tsx) supaya tidak
 *  duplikasi. `getDeliveryKoliEkspedisiPhotoAction` sekarang bisa dipanggil procurement/finance
 *  juga (lihat catatan di actions.ts), bukan cuma vendor seperti awalnya (Riwayat Pengiriman). */
async function viewEkspedisiPhoto(koliId: string) {
  const win = openPreviewWindow();
  try {
    const photo = await getDeliveryKoliEkspedisiPhotoAction(koliId);
    if (!photo) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, photo.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

export function KoliEkspedisiCard({
  koliId,
  noKoli,
  ekspedisi,
  deliveredAt,
  ekspedisiNote,
  ekspedisiNoteAt,
  vendorName,
}: {
  koliId: string;
  noKoli: string;
  ekspedisi: string;
  deliveredAt?: string;
  ekspedisiNote?: string;
  ekspedisiNoteAt?: string;
  /** Kalau diisi, nama vendor produksi ikut ditampilkan di kartu -- dipakai Finance (Payment
   *  Maklon) supaya kartu ini bisa berdiri sendiri (mis. saat diekspor/dicetak) tanpa bergantung
   *  konteks baris invoice di luar kartu. Procurement (sudah selalu dalam konteks 1 invoice per
   *  vendor) tidak perlu ini -- kosongkan/biarkan undefined. */
  vendorName?: string;
}) {
  return (
    <div className="rounded-md border border-[#E4E9EE] bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[11.5px] text-[#31414F]">
        {vendorName && (
          <span>
            Vendor: <span className="font-semibold">{vendorName}</span>
          </span>
        )}
        <span className="font-mono font-semibold">{noKoli}</span>
        <span>
          Ekspedisi: <span className="font-medium">{ekspedisi || "—"}</span>
        </span>
        <span>
          Tanggal kirim: <span className="font-mono">{formatDate(deliveredAt)}</span>
        </span>
        {ekspedisiNoteAt ? (
          <button onClick={() => viewEkspedisiPhoto(koliId)} className="font-semibold text-action-primary underline">
            Lihat / Download foto
          </button>
        ) : (
          <span className="text-text-muted">Foto —</span>
        )}
      </div>
      {ekspedisiNote && <div className="mt-1 font-sans text-[11px] text-text-muted">Catatan: {ekspedisiNote}</div>}
    </div>
  );
}
