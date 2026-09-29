import { BookOpen, Loader2, PenTool, Search } from "lucide-react";

export interface ImportIngredient {
  name: string;
  amount: string;
  unit: string;
  note?: string;
}

export interface ImportRecipe {
  recipeId: string;
  title: string;
  domain: string;
  ownerName?: string;
  yield?: string;
  ingredients: ImportIngredient[];
}

const DOMAIN_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  recipe: { label: "Recipe Lab", bg: "bg-gold/20", text: "text-gold" },
  patisserie: { label: "Patisserie", bg: "bg-pink-500/20", text: "text-pink-400" },
  spirits: { label: "Spirits", bg: "bg-blue-500/20", text: "text-blue-400" },
};

interface RecipeImportPanelProps {
  isEdit: boolean;
  mode: "import" | "scratch";
  importedFromRecipe: boolean;
  recipes: ImportRecipe[];
  loading: boolean;
  error: string;
  search: string;
  groupedRecipes: [string, ImportRecipe[]][];
  filteredRecipes: ImportRecipe[];
  onModeChange: (mode: "import" | "scratch") => void;
  onSearchChange: (value: string) => void;
  onSelectRecipe: (recipe: ImportRecipe) => void;
}

export function RecipeImportPanel({
  isEdit,
  mode,
  importedFromRecipe,
  recipes,
  loading,
  error,
  search,
  groupedRecipes,
  filteredRecipes,
  onModeChange,
  onSearchChange,
  onSelectRecipe,
}: RecipeImportPanelProps) {
  return (
    <>
      {/* Mode toggle — only for new items */}
      {!isEdit && !importedFromRecipe && (
        <div className="flex gap-1 p-1 bg-dark rounded-xl border border-dark-200">
          <button
            type="button"
            onClick={() => onModeChange("import")}
            className={`flex items-center gap-2 flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              mode === "import"
                ? "bg-gold text-dark"
                : "bg-dark-100 text-dark-600 hover:text-[#FAFAFA]"
            }`}
          >
            <BookOpen className="size-4" />
            Import from Recipe
          </button>
          <button
            type="button"
            onClick={() => onModeChange("scratch")}
            className={`flex items-center gap-2 flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              mode === "scratch"
                ? "bg-gold text-dark"
                : "bg-dark-100 text-dark-600 hover:text-[#FAFAFA]"
            }`}
          >
            <PenTool className="size-4" />
            Create from Scratch
          </button>
        </div>
      )}

      {/* Import mode UI */}
      {mode === "import" && !isEdit && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-dark-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search recipes..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-gold" />
              <span className="ml-2 text-sm text-dark-600">Loading recipes...</span>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && filteredRecipes.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-dark-500">
                {recipes.length === 0
                  ? "No saved recipes found. Create recipes in the Recipe Lab first."
                  : "No recipes match your search."}
              </p>
            </div>
          )}

          {!loading && groupedRecipes.length > 0 && (
            <div className="bg-dark border border-dark-200 rounded-xl max-h-[300px] overflow-y-auto">
              {groupedRecipes.map(([domain, domainRecipes]) => {
                const badge = DOMAIN_BADGE[domain] ?? {
                  label: domain,
                  bg: "bg-dark-200",
                  text: "text-dark-600",
                };
                return (
                  <div key={domain}>
                    <div className="sticky top-0 bg-dark px-4 py-2 border-b border-dark-200">
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    {domainRecipes.map((recipe) => (
                      <button
                        key={recipe.recipeId}
                        type="button"
                        onClick={() => onSelectRecipe(recipe)}
                        className="w-full text-left hover:bg-dark-100 px-4 py-3 cursor-pointer transition-colors border-b border-dark-200/50 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#FAFAFA] font-medium truncate">
                              {recipe.title}
                              {recipe.ownerName && (
                                <span className="text-dark-500 font-normal ml-1.5">
                                  (by {recipe.ownerName})
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="ml-3 text-xs text-dark-500 whitespace-nowrap">
                            {recipe.ingredients.length} ingredient
                            {recipe.ingredients.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
