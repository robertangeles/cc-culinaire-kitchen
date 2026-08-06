import { ChefHat } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="size-8 rounded-full bg-gold/20 flex items-center justify-center animate-bounce">
        <ChefHat className="size-4 text-gold" />
      </div>
      <span className="text-sm text-gold animate-pulse">Prepping...</span>
    </div>
  );
}
