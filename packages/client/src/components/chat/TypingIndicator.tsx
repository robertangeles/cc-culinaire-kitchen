import { ChefHat } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="size-8 rounded-full bg-[#D4A574]/20 flex items-center justify-center animate-bounce">
        <ChefHat className="size-4 text-[#D4A574]" />
      </div>
      <span className="text-sm text-[#D4A574] animate-pulse">Prepping...</span>
    </div>
  );
}
