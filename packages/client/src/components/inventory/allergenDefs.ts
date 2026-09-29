export const ALLERGEN_DEFS = [
  { key: "containsDairyInd" as const, label: "Dairy", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { key: "containsGlutenInd" as const, label: "Gluten", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { key: "containsNutsInd" as const, label: "Nuts", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { key: "containsShellfishInd" as const, label: "Shellfish", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { key: "containsEggsInd" as const, label: "Eggs", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { key: "isVegetarianInd" as const, label: "Veg", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
];

export type AllergenKey = typeof ALLERGEN_DEFS[number]["key"];
