import { ChefHat } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="size-8 rounded-full bg-amber-100 flex items-center justify-center animate-bounce">
        <ChefHat className="size-4 text-amber-600" />
      </div>
      <span className="text-sm text-stone-400 animate-pulse">Prepping...</span>
    </div>
  );
}
