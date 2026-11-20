import { palettes, type Palette } from "../theme";

/** The phone app is light paper only, like the first CulinAIre app; the dark palette is kept for when dark mode is wanted. */
export function useColors(): Palette {
  return palettes.light;
}
