import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Checkbox dengan ikon centang & hit-area yang cukup besar untuk diklik presisi
 *  (kotak visualnya tetap kecil, tapi padding di sekeliling memperbesar area klik). */
export function Checkbox({
  checked,
  onChange,
  disabled,
  title,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      title={title}
      aria-checked={checked}
      role="checkbox"
      className={cn("flex-none p-[3px] disabled:cursor-not-allowed disabled:opacity-40", className)}
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
          checked ? "border-accent-blue bg-accent-blue" : "border-[#B8C4D0] bg-white"
        )}
      >
        {checked && <Check size={11} strokeWidth={3} className="text-white" />}
      </span>
    </button>
  );
}
