---
description: "Jalankan tim dev 4 agen (Planner -> Coder -> Tester -> Reviewer) secara berurutan untuk satu permintaan fitur/bug."
---

Kamu bertindak sebagai SUPERVISOR yang mengorkestrasi 4 subagent secara berurutan untuk menyelesaikan permintaan berikut dari user:

$ARGUMENTS

Ikuti alur ini PERSIS, tanpa melompati tahap:

## Tahap 0 — Persiapan
1. Jalankan `mkdir -p .pipeline` untuk memastikan folder handoff ada.
2. Jika `.pipeline/spec.md`, `changes.md`, `test-report.md`, atau `review.md` dari task SEBELUMNYA masih ada dan tidak relevan dengan permintaan ini, hapus dulu (`rm -f .pipeline/*.md`) supaya tidak tercampur.

## Tahap 1 — Planner
1. Panggil subagent `planner` dengan permintaan di atas.
2. Setelah selesai, baca `.pipeline/spec.md`.
3. **Jika ada bagian "Open questions" yang belum terjawab**: STOP di sini. Tampilkan pertanyaan tersebut ke user dan tunggu jawaban sebelum lanjut ke Tahap 2. Jangan menebak jawabannya sendiri.
4. Jika tidak ada open question, lanjut otomatis ke Tahap 2.

## Tahap 2 — Coder
1. Panggil subagent `coder` untuk mengimplementasikan berdasarkan `.pipeline/spec.md`.
2. Baca `.pipeline/changes.md` setelah selesai.
3. Lanjut otomatis ke Tahap 3.

## Tahap 3 — Tester
1. Panggil subagent `tester` untuk memverifikasi hasil.
2. Baca `.pipeline/test-report.md`.
3. **Jika verdict = NOT READY**:
   - Ringkas bug yang ditemukan.
   - Panggil ulang subagent `coder` dengan instruksi tambahan: perbaiki bug-bug tersebut (rujuk ke `.pipeline/test-report.md`).
   - Ulangi Tahap 3 (panggil tester lagi).
   - Maksimal 3 kali putaran coder<->tester. Jika setelah 3 putaran masih NOT READY, STOP dan laporkan ke user apa yang masih gagal — jangan looping tanpa henti.
4. Jika verdict = SHIP, lanjut ke Tahap 4.

## Tahap 4 — Reviewer
1. Panggil subagent `reviewer` untuk audit akhir.
2. Baca `.pipeline/review.md`.
3. **Jika verdict = CHANGES REQUESTED**:
   - Ringkas temuan `[blocker]` dan `[should-fix]` (abaikan `[nit]` untuk keputusan lanjut/tidak).
   - Jika ada `[blocker]`: panggil ulang subagent `coder` untuk memperbaiki, lalu ulangi Tahap 3 dan Tahap 4 dari awal.
   - Jika hanya `[should-fix]`/`[nit]`: tampilkan ke user, tanyakan apakah mau diperbaiki sekarang atau nanti.
4. Jika verdict = APPROVE, lanjut ke Tahap 5.

## Tahap 5 — Ringkasan akhir
Tampilkan ke user, dalam Bahasa Indonesia, ringkasan singkat:
- Apa yang dikerjakan (dari spec.md, bagian Goal).
- File apa saja yang berubah (dari changes.md).
- Status akhir: SHIP & APPROVE, atau apa yang masih perlu perhatian user.
- Jangan tempelkan isi lengkap tiap file .pipeline/*.md — cukup ringkasan, user bisa buka filenya sendiri kalau mau detail.

## Aturan umum
- Jangan pernah melompati Tester atau Reviewer meskipun task terlihat kecil/sepele.
- Jangan izinkan Coder "sekalian" menambah fitur di luar spec — kalau Coder melakukan itu, minta ia mundurkan (revert) bagian di luar scope.
- Selalu beri tahu user di tahap mana proses sedang berjalan (misal: "🔵 Tahap 2: Coder sedang implementasi...") supaya user tahu progresnya, bukan diam sampai selesai semua.
