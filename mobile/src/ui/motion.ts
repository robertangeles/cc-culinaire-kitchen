/** The one authored motion: the item card advances in about 180 ms, ease-out. With reduce-motion on there is no movement at all. */
export const CARD_ADVANCE_MS = 180;

export function cardMotion(reduceMotion: boolean): { durationMs: number } {
  return { durationMs: reduceMotion ? 0 : CARD_ADVANCE_MS };
}
