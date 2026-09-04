import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Item 3.2 (feedback batch 2026-09-04): headroom untuk upload foto bukti berat bersih (Klaim
  // Material, lihat production-cutting-tab.tsx) -- foto SUDAH dikompresi di browser sebelum
  // dikirim (JPEG q0.7, sisi terpanjang <=1280px, dan ditolak client-side kalau >700KB), jadi 2mb
  // di sini murni jaring pengaman/headroom, bukan batas yang memang dituju foto biasa.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
