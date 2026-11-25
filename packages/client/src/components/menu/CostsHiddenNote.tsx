import { EyeOff } from "lucide-react";

/** Stands where menu costs would be, for someone without `inventory:cost`. `detail` says what this screen still shows. */
export function CostsHiddenNote({ detail, className = "" }: { detail: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-white/5 bg-gradient-to-br from-dark-50/80 to-dark-50/40 backdrop-blur px-4 py-3 ${className}`}>
      <div className="flex-shrink-0 size-10 rounded-xl bg-dark flex items-center justify-center">
        <EyeOff className="size-5 text-gold" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#FAFAFA]">Costs and margins are hidden</p>
        <p className="text-xs text-dark-600">{detail}</p>
      </div>
    </div>
  );
}
