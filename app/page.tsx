"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Package, Wallet, Building2, Lock, KeyRound, X, ShieldCheck, Factory } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { INTERNAL_ACCOUNTS, type InternalRole } from "@/lib/internal-auth";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

const MODULES: { role: InternalRole; label: string; desc: string; icon: typeof ClipboardList }[] = [
  { role: "ppic", label: "PPIC", desc: "Planning, MRP, monitoring produksi", icon: ClipboardList },
  { role: "procurement", label: "Procurement", desc: "Purchase order, material, invoice vendor", icon: Package },
  { role: "finance", label: "Finance", desc: "Approval PO, payment, ledger", icon: Wallet },
  { role: "scm", label: "SCM", desc: "Approval MRP dari PPIC, monitoring lintas modul", icon: ShieldCheck },
  { role: "produksi", label: "Produksi", desc: "Monitoring progres semua vendor produksi", icon: Factory },
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
  const [showPasswordInfo, setShowPasswordInfo] = useState(false);

  if (!mounted) return null;

  function pickRole(role: InternalRole) {
    setSelectedRole(role);
    setPassword("");
    setError("");
  }

  function closeLogin() {
    setSelectedRole(null);
    setPassword("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    const account = INTERNAL_ACCOUNTS.find((a) => a.role === selectedRole)!;
    setError("");
    if (login(selectedRole, password)) {
      router.push(account.homeHref);
    } else {
      setError("Password salah.");
    }
  }

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #000000 0%, #050912 30%, #0A1B3D 62%, var(--accent-blue) 100%)" }}
    >
      <button
        onClick={() => setShowPasswordInfo(true)}
        className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 font-sans text-[11.5px] font-medium text-white/70 backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
      >
        <KeyRound size={13} />
        Password default
      </button>

      <div className="mb-8 text-center">
        <div className="font-sans text-[13px] font-semibold text-white/60">ERP Tigalapan Indonesia</div>
        <div className="mt-1.5 font-heading text-[26px] font-bold text-white">Pilih Modul</div>
        <div className="mt-1 font-sans text-[12.5px] text-white/70">Pilih modul yang ingin Anda akses.</div>
      </div>

      {/* Kartu SELALU punya tinggi tetap (tidak pernah berubah bentuk saat diklik) — form
         password ditampilkan di modal terpisah (lihat di bawah), bukan ditempel di dalam kartu.
         Sebelumnya form nempel langsung di kartu yang diklik, jadi kartu itu jadi lebih tinggi
         dari kartu lain di baris yang sama dan bikin grid-nya kelihatan berantakan/tidak rapi. */}
      <div className="grid w-full max-w-[720px] grid-cols-2 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => {
          const Icon = m.icon;
          const active = selectedRole === m.role;
          return (
            <button
              key={m.role}
              onClick={() => pickRole(m.role)}
              className={cn(
                "group flex flex-col rounded-xl border bg-surface-card p-4 text-left font-sans shadow-[0_10px_30px_rgba(0,0,0,.25)] transition-all duration-200",
                active
                  ? "border-accent-blue shadow-[0_16px_36px_rgba(37,99,235,.32)]"
                  : "border-white/10 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_16px_36px_rgba(0,0,0,.32)]"
              )}
            >
              <span
                className={cn(
                  "flex h-[92px] items-center justify-center rounded-lg transition-colors duration-200",
                  active ? "bg-accent-blue" : "bg-info-bg group-hover:bg-accent-blue"
                )}
              >
                <Icon size={30} strokeWidth={1.75} className={cn("transition-colors duration-200", active ? "text-white" : "text-action-primary group-hover:text-white")} />
              </span>
              <div className="mt-3.5 text-[13.5px] font-semibold text-text-primary">{m.label}</div>
              <div className="mt-1 min-h-[31px] text-[11px] leading-[1.4] text-text-muted">{m.desc}</div>
            </button>
          );
        })}

        <button
          onClick={() => {
            // Selalu tampilkan form login vendor dulu, walau sebelumnya ada sesi vendor
            // lain yang masih tersimpan — supaya user memilih akun vendor yang dituju.
            logoutVendor();
            router.push("/vendor-maklon/login");
          }}
          className="group flex flex-col rounded-xl border border-white/10 bg-surface-card p-4 text-left font-sans shadow-[0_10px_30px_rgba(0,0,0,.25)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_16px_36px_rgba(0,0,0,.32)]"
        >
          <span className="flex h-[92px] items-center justify-center rounded-lg bg-accent-orange-bg transition-colors duration-200 group-hover:bg-accent-orange">
            <Building2 size={30} strokeWidth={1.75} className="text-accent-orange transition-colors duration-200 group-hover:text-white" />
          </span>
          <div className="mt-3.5 text-[13.5px] font-semibold text-text-primary">Vendor Produksi</div>
          <div className="mt-1 min-h-[31px] text-[11px] leading-[1.4] text-text-muted">Pilih nama vendor Anda &amp; masukkan password</div>
        </button>
      </div>

      {selectedRole &&
        (() => {
          const m = MODULES.find((mod) => mod.role === selectedRole)!;
          const Icon = m.icon;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" onClick={closeLogin}>
              <div
                className="w-full max-w-[340px] overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-[0_20px_50px_rgba(0,0,0,.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-blue">
                    <Icon size={16} strokeWidth={1.75} className="text-white" />
                  </span>
                  <span className="font-sans text-[13px] font-semibold text-text-primary">{m.label}</span>
                  <button onClick={closeLogin} className="ml-auto text-text-muted hover:text-danger-fg">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 px-4 py-3.5">
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
              </div>
            </div>
          );
        })()}

      {showPasswordInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" onClick={() => setShowPasswordInfo(false)}>
          <div
            className="w-full max-w-[380px] overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-[0_20px_50px_rgba(0,0,0,.4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
              <KeyRound size={14} className="text-action-primary" />
              <span className="font-sans text-[13px] font-semibold text-text-primary">Password default</span>
              <button onClick={() => setShowPasswordInfo(false)} className="ml-auto text-text-muted hover:text-danger-fg">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3.5 font-sans text-[12px] leading-[1.7] text-text-primary">
              {INTERNAL_ACCOUNTS.map((a) => (
                <div key={a.role} className="flex items-center justify-between">
                  <span className="text-text-muted">{a.label}</span>
                  <span className="font-mono font-semibold">{a.password}</span>
                </div>
              ))}
              <div className="mt-3 border-t border-[#F1F4F7] pt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                Vendor Produksi — pilih nama vendor di halaman login, password di bawah
              </div>
              <div className="max-h-[220px] overflow-y-auto">
                {Object.entries(VENDOR_PRODUKSI).map(([id, v]) => (
                  <div key={id} className="mt-1.5 flex items-center justify-between">
                    <span className="text-text-muted">{v.name}</span>
                    <span className="font-mono font-semibold">{v.password}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
