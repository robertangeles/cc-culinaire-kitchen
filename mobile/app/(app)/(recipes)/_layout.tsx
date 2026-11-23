import { Stack } from "expo-router";
import { RecipesProvider } from "../../../src/recipes/RecipesProvider";

/** The recipes module: My Recipes, the Recipe Lab and a recipe, sharing one recipes store. */
export default function RecipesLayout() {
  return (
    <RecipesProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </RecipesProvider>
  );
}
