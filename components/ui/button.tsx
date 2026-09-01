import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "ghost" | "danger" | "success" | "accent" | "dashed" | "muted";
export type ButtonSize = "xs" | "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-action-primary text-white hover:bg-accent-blue-2",
  ghost: "border-[#CBD5DF] bg-white text-action-primary hover:border-accent-blue",
  danger: "border-[#EFC9C4] bg-white text-danger-fg hover:border-danger",
  success: "border-[#A8C5DF] bg-white text-success-fg hover:border-success",
  accent: "border-[#A8C5DF] bg-white text-accent-blue hover:border-accent-blue",
  dashed: "border-dashed border-[#CBD5DF] bg-transparent text-text-muted hover:text-text-primary",
  muted: "border-[#CBD5DF] bg-white text-text-muted hover:text-text-primary",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "px-2 py-[3px] font-sans text-[10.5px] rounded-[5px]",
  sm: "px-2.5 py-[5px] font-sans text-[11px] rounded-[6px]",
  md: "px-3.5 py-[8px] font-sans text-xs rounded-md",
};

/** Small button with real chrome (border/bg/padding) — for row-level & inline actions that
 *  should look clickable, not a bare colored text link. Use `variant`/`size` to match context. */
export function Button({
  variant = "ghost",
  size = "sm",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1 border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  );
}
