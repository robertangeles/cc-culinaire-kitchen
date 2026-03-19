import { ChefHat } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.js";
import { useAuth } from "../../context/AuthContext.js";

interface WelcomeScreenProps {
  onSelectPrompt: (prompt: string) => void;
}

const suggestions = [
  "My hollandaise split. How do I fix it?",
  "What's the proper technique for searing scallops?",
  "Explain the five mother sauces and their derivatives",
  "How do I temper chocolate without a marble slab?",
];

export function WelcomeScreen({ onSelectPrompt }: WelcomeScreenProps) {
  const { settings } = useSettings();
  const { user, isGuest } = useAuth();
  const pageTitle = settings.page_title || "CulinAIre Kitchen";
  const logoPath = settings.logo_path;

  // Derive greeting: "Hello [FirstName]" for authenticated users, site name for guests
  const firstName = user && !isGuest ? user.userName.split(" ")[0] : null;
  const heading = firstName ? `Hello, ${firstName}` : `Welcome to ${pageTitle}`;
  const subtitle = firstName
    ? settings.meta_description || "Your AI Culinary Knowledge Engine"
    : settings.meta_description || "Your AI Culinary Knowledge Engine";

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="text-center mb-10">
        <div
          className={`inline-flex items-center justify-center rounded-2xl mb-4 overflow-hidden ${logoPath ? "" : "bg-[#D4A574]/20"}`}
          style={{ width: 100, height: 100 }}
        >
          {logoPath ? (
            <img
              src={logoPath}
              alt={pageTitle}
              className="size-full object-contain"
            />
          ) : (
            <ChefHat className="size-10 text-[#D4A574]" />
          )}
        </div>
        <h1 className="text-3xl font-bold text-[#FAFAFA] mb-2">
          {heading}
        </h1>
        <p className="text-[#999999] text-lg">
          {subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full">
        {suggestions.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelectPrompt(prompt)}
            className="text-left rounded-xl border border-[#2A2A2A] bg-[#161616] px-4 py-3 text-sm text-[#E5E5E5] hover:border-[#D4A574]/40 hover:bg-[#1E1E1E] transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
