/**
 * The Bench's word filter: whether a post contains a listed word or phrase. The list itself is never in the code; the server reads it from a
 * setting. Text and terms go through the same normalising, so a term written with a look-alike matches its plain spelling too.
 */

/** What a person whose post is refused is told. It never says which word. */
export const BENCH_POST_REFUSED = "This message can't be posted.";

/** Digits and symbols written for letters. `l` joins `i`, since `1`, `!` and `|` stand for either. */
const LOOK_ALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "i", "+": "t", "€": "e", l: "i" };
const SEPARATORS = /[^\p{L}\p{N}@$!|+€]+/u;
const EDGE_SYMBOLS = /^[@$!|+€]+|[@$!|+€]+$/gu;

/**
 * Lower case, without accents or invisible characters, look-alikes as letters, and words one space apart. A run of single letters is one word
 * ("z o r p"). `stripEdges` treats symbols at either end of a word as punctuation ("that!"), not letters.
 */
function normalise(text: string, stripEdges: boolean): string {
  const chunks = text
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}]/gu, "")
    .toLowerCase()
    .split(SEPARATORS)
    .map((chunk) => Array.from(stripEdges ? chunk.replace(EDGE_SYMBOLS, "") : chunk, (ch) => LOOK_ALIKE[ch] ?? ch).join(""))
    .filter(Boolean);
  // Code points, not UTF-16 units: one astral letter is one letter.
  const single = (chunk: string | undefined) => chunk !== undefined && [...chunk].length === 1;
  const words: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let word = chunks[i];
    if (single(word)) while (single(chunks[i + 1])) word += chunks[++i];
    words.push(word);
  }
  return words.join(" ");
}

/** A letter repeated at least as often as in the term: "zoorp" matches "zorp", but "bif" does not match "biff". */
function wordPattern(word: string): string {
  return (word.match(/(.)\1*/gu) ?? [])
    .map((run) => {
      const [ch, ...more] = run;
      return more.length === 0 ? `${ch}+` : `${ch}{${more.length + 1},}`;
    })
    .join("");
}

export type BlockedTerms = readonly RegExp[];

/** One term per line; blank lines are skipped. Normalised text holds only letters, digits and spaces, so nothing needs escaping. */
export function compileBlockedTerms(list: string): BlockedTerms {
  const seen = new Set<string>();
  for (const line of list.split("\n")) {
    const term = normalise(line, false);
    if (term) seen.add(term);
  }
  return [...seen].map((term) => new RegExp(`(?:^| )${term.split(" ").map(wordPattern).join(" ")}(?= |$)`, "u"));
}

/** How many listed terms the text contains, each as whole words. */
export function countBlockedTerms(text: string, terms: BlockedTerms): number {
  if (terms.length === 0) return 0;
  const forms = [normalise(text, false), normalise(text, true)];
  return terms.filter((term) => forms.some((form) => term.test(form))).length;
}
