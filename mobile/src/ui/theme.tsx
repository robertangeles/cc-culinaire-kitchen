import { useColorScheme } from "react-native";
import { palettes, type Palette } from "../theme";

/** Dark follows the phone setting; there is no manual toggle. */
export function useColors(): Palette {
  return useColorScheme() === "dark" ? palettes.dark : palettes.light;
}
