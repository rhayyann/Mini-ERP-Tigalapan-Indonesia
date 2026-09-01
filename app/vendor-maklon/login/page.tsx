"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

export default function VendorLoginPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const login = useVendorAuthStore((s) => s.login);
  const loggedInVendorId = useVendorAuthStore((s) => s.loggedInVendorId);
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (mounted && loggedInVendorId) router.replace("/vendor-maklon/po-produksi");
  }, [mounted, loggedInVendorId, router]);

  if (!mounted) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (login(username, password)) {
      router.push("/vendor-maklon/po-produksi");
    } else {
      setError("Nama vendor atau password salah.");
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #000000 0%, #050912 30%, #0A1B3D 62%, var(--accent-blue) 100%)" }}
    >
      <div className="w-full max-w-[380px]">
        <Link href="/" className="mb-4 flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-white/60 hover:text-white/90">
          <ArrowLeft size={13} />
          Kembali ke pilih modul
        </Link>

        <div className="rounded-xl border border-white/10 bg-surface-card p-6 shadow-[0_16px_40px_rgba(0,0,0,.3)]">
          <span className="flex h-[64px] w-[64px] items-center justify-center rounded-lg bg-accent-orange-bg">
            <Building2 size={28} strokeWidth={1.75} className="text-accent-orange" />
          </span>
          <div className="mt-3.5 font-sans text-[13px] font-semibold text-text-muted">ERP Tigalapan Indonesia</div>
          <div className="mt-1 font-heading text-xl font-bold text-text-primary">Login Vendor Produksi</div>
          <div className="mt-1 font-sans text-xs text-text-muted">Ketik nama vendor Anda lalu masukkan password.</div>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama vendor</div>
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError("");
                }}
                className="input mt-1"
                autoFocus
                placeholder="contoh: Cecep"
              />
            </div>
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input mt-1"
                placeholder="••••••••"
              />
            </div>
            {error && <div className="font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
            <button type="submit" className="mt-1 rounded-md bg-accent-orange px-3.5 py-2 font-sans text-xs font-semibold text-white">
              Masuk
            </button>
          </form>

          <div className="mt-4 border-t border-border-subtle pt-3 font-sans text-[10.5px] leading-[1.6] text-text-muted">
            Password demo untuk semua vendor: <span className="font-mono font-semibold text-text-primary">vendor123</span>
          </div>
        </div>
      </div>
    </div>
  );
}
