"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Package, Wallet, Building2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { INTERNAL_ACCOUNTS, type InternalRole } from "@/lib/internal-auth";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

const MODULES: { role: InternalRole; label: string; desc: string; icon: typeof ClipboardList }[] = [
  { role: "ppic", label: "PPIC", desc: "Planning, MRP, monitoring produksi", icon: ClipboardList },
  { role: "procurement", label: "Procurement", desc: "Purchase order, material, invoice vendor", icon: Package },
  { role: "finance", label: "Finance", desc: "Approval PO, payment, ledger", icon: Wallet },
];

export default function ModuleSelectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const login = useInternalAuthStore((s) => s.login);
  const logoutVendor = useVendorAuthStore((s) => s.logout);
  const router = useRouter();

  const [selectedRole, setSelectedRole] = useState<InternalRole | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!mounted) return null;

  function pickRole(role: InternalRole) {
    setSelectedRole((prev) => (prev === role ? null : role));
    setPassword("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    const account = INTERNAL_ACCOUNTS.find((a) => a.role === selectedRole)!;
    if (login(selectedRole, password)) {
      setError("");
      router.push(account.homeHref);
    } else {
      setError("Password salah.");
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #000000 0%, #050912 30%, #0A1B3D 62%, var(--accent-blue) 100%)" }}
    >
      <div className="mb-7 text-center">
        <div className="font-sans text-[13px] font-semibold text-white/60">GarmenERP</div>
        <div className="mt-1.5 font-heading text-[26px] font-bold text-white">Pilih Modul</div>
        <div className="mt-1 font-sans text-[12.5px] text-white/70">Pilih modul yang ingin Anda akses.</div>
      </div>

      {/* items-start supaya kartu yang formnya sedang terbuka boleh jadi lebih tinggi dari
         kartu lain di baris yang sama, tanpa memaksa semua kartu ikut meregang setinggi itu. */}
      <div className="grid w-full max-w-[900px] grid-cols-2 items-start gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          const active = selectedRole === m.role;
          return (
            <div
              key={m.role}
              className={cn(
                "flex flex-col rounded-xl border bg-surface-card p-3 shadow-[0_10px_30px_rgba(0,0,0,.25)] transition-all",
                active ? "border-accent-blue shadow-[0_16px_36px_rgba(37,99,235,.3)]" : "border-white/10 hover:shadow-[0_14px_32px_rgba(0,0,0,.3)]"
              )}
            >
              <button onClick={() => pickRole(m.role)} className="group flex w-full flex-col text-left font-sans">
                <span
                  className={cn(
                    "flex h-[92px] items-center justify-center rounded-lg transition-colors",
                    active ? "bg-accent-blue" : "bg-info-bg group-hover:bg-accent-blue"
                  )}
                >
                  <Icon size={30} strokeWidth={1.75} className={cn(active ? "text-white" : "text-action-primary group-hover:text-white")} />
                </span>
                <div className="mt-3 text-[13px] font-semibold text-text-primary">{m.label}</div>
                <div className="mt-1 text-[11px] leading-[1.4] text-text-muted">{m.desc}</div>
              </button>

              {/* Form password nempel LANGSUNG di bawah kartu yang diklik (bukan panel
                 terpisah di tengah layar) — supaya jelas ini punya kartu yang mana. */}
              {active && (
                <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
                  <div>
                    <div className="flex items-center gap-1 font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                      <Lock size={10} />
                      Password
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input mt-1 !py-1.5 !text-[11.5px]"
                      autoFocus
                      placeholder="••••••••"
                    />
                  </div>
                  {error && <div className="font-sans text-[10.5px] font-medium text-danger-fg">{error}</div>}
                  <button type="submit" className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-[11.5px] font-semibold text-white">
                    Masuk
                  </button>
                </form>
              )}
            </div>
          );
        })}

        <button
          onClick={() => {
            // Selalu tampilkan form login vendor dulu, walau sebelumnya ada sesi vendor
            // lain yang masih tersimpan — supaya user memilih akun vendor yang dituju.
            logoutVendor();
            router.push("/vendor-maklon/login");
          }}
          className="group flex flex-col rounded-xl border border-white/10 bg-surface-card p-3 text-left font-sans shadow-[0_10px_30px_rgba(0,0,0,.25)] transition-all hover:shadow-[0_14px_32px_rgba(0,0,0,.3)]"
        >
          <span className="flex h-[92px] items-center justify-center rounded-lg bg-accent-orange-bg transition-colors group-hover:bg-accent-orange">
            <Building2 size={30} strokeWidth={1.75} className="text-accent-orange group-hover:text-white" />
          </span>
          <div className="mt-3 text-[13px] font-semibold text-text-primary">Vendor Produksi</div>
          <div className="mt-1 text-[11px] leading-[1.4] text-text-muted">Login dengan akun vendor maklon (username &amp; password sendiri)</div>
        </button>
      </div>

      <div className="mt-6 w-full max-w-[420px] rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-center font-sans text-[10.5px] leading-[1.7] text-white/60 backdrop-blur-sm">
        Password default:
        <br />
        {INTERNAL_ACCOUNTS.map((a) => (
          <span key={a.role} className="mr-2 font-mono">
            {a.label} — {a.password}
          </span>
        ))}
        <div className="mt-1.5">Akun demo Vendor Produksi:</div>
        {Object.keys(VENDOR_PRODUKSI).map((v) => (
          <span key={v} className="mr-2 font-mono">
            {v === "BAYU" ? "bayu / bayu123" : "gi01 / gi01123"} — {VENDOR_PRODUKSI[v].name}
          </span>
        ))}
      </div>
    </div>
  );
}
