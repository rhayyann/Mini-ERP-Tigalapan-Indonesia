"use client";

import { useState } from "react";
import { ResetDataButton } from "@/components/shell/reset-data-button";
import type { Notification } from "@/lib/mrp/types";

function formatNotifTime(time: string) {
  return time;
}

/** "PPIC" -> "PP", "Maklon BAYU" -> "MB", "Procurement" -> "PR" — dipakai buat avatar profil,
 *  karena app ini belum punya sistem akun per-nama sungguhan (cuma login per-role/per-vendor). */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function Topbar({
  role,
  entity,
  notifications = [],
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onLogout,
}: {
  role: string;
  entity: string;
  notifications?: Notification[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  onDismiss?: (id: string) => void;
  onLogout?: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex h-[52px] flex-none items-center gap-[14px] border-b border-border-subtle bg-surface-card px-[22px]">
      <div className="font-sans text-[13px] font-semibold text-text-primary">{role}</div>
      <div className="ml-auto flex items-center gap-[14px]">
        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen((v) => !v);
              setProfileOpen(false);
            }}
            className="relative font-sans text-xs font-medium text-text-muted"
          >
            Notifikasi
            {unreadCount > 0 && (
              <span className="absolute -right-3 -top-1.5 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{unreadCount}</span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] rounded-lg border border-border-subtle bg-white shadow-lg">
              <div className="flex items-center border-b border-[#F1F4F7] px-3.5 py-2.5">
                <span className="font-sans text-[12px] font-semibold text-text-primary">Notifikasi</span>
                {unreadCount > 0 && (
                  <button
                    onClick={() => onMarkAllRead?.()}
                    className="ml-auto font-sans text-[10.5px] font-semibold text-action-primary"
                  >
                    Tandai semua dibaca
                  </button>
                )}
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                {notifications.length === 0 && (
                  <div className="px-3.5 py-6 text-center font-sans text-[11.5px] text-text-muted">Tidak ada notifikasi.</div>
                )}
                {notifications.slice(0, 30).map((n) => (
                  <div
                    key={n.id}
                    className={"flex w-full items-start gap-2 border-b border-[#F7F9FB] px-3.5 py-2.5 text-left last:border-b-0 " + (n.read ? "bg-white" : "bg-[#F3F8FE]")}
                  >
                    <button onClick={() => onMarkRead?.(n.id)} className="flex flex-1 items-start gap-2 text-left">
                      {!n.read && <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent-blue" />}
                      <span className={"flex-1 font-sans text-[11.5px] leading-[1.45] " + (n.read ? "text-text-muted" : "text-[#31414F]")}>{n.text}</span>
                    </button>
                    <span className="flex-none font-mono text-[10px] text-[#94A3B0]">{formatNotifTime(n.time)}</span>
                    <button
                      onClick={() => onDismiss?.(n.id)}
                      title="Tutup notifikasi"
                      className="flex-none font-sans text-[13px] leading-none text-[#B8C4D0] hover:text-danger-fg"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="h-5 w-px flex-none bg-border-subtle" />

        <div className="relative">
          <button
            onClick={() => {
              setProfileOpen((v) => !v);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-[#F7F9FB]"
          >
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-action-primary font-sans text-[11px] font-semibold text-white">
              {initialsFor(role)}
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="font-sans text-[12.5px] font-semibold text-text-primary">{role}</span>
              <span className="font-sans text-[10.5px] text-text-muted">{entity}</span>
            </span>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[190px] overflow-hidden rounded-lg border border-border-subtle bg-white py-1 shadow-lg">
              <ResetDataButton variant="menu-item" />
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="block w-full px-3.5 py-2 text-left font-sans text-xs font-medium text-danger-fg hover:bg-[#FBEDEB]"
                >
                  Logout
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
