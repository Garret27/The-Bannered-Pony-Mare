import fs from "fs";
import path from "path";

const CHAR_ALTERNATES: Record<string, string[]> = {
  "0": ["o"],
  o: ["0"],
  O: ["0"],
  "1": ["l", "i"],
  l: ["1", "i"],
  i: ["1", "l"],
  I: ["1", "l"],
  "|": ["i", "l"],
  "5": ["s"],
  s: ["5"],
  S: ["5"],
  "8": ["b"],
  b: ["8"],
  B: ["8"],
};

const DIGRAPH_SWAPS: Array<[string, string]> = [
  ["rn", "m"],
  ["m", "rn"],
  ["vv", "w"],
  ["w", "vv"],
  ["cl", "d"],
  ["d", "cl"],
];

let dictionary: Set<string> | null = null;

function loadDictionary(): Set<string> {
  if (dictionary) return dictionary;
  const filePath = path.join(process.cwd(), "lib", "english-words.txt");
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  dictionary = new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((word) => word.length >= 3),
  );
  return dictionary;
}

function applyCasing(original: string, replacement: string): string {
  const letters = original.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase()) {
    return replacement.toUpperCase();
  }
  const first = original.match(/[A-Za-z]/);
  if (first && first[0] === first[0].toUpperCase()) {
    return (
      replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
    );
  }
  return replacement.toLowerCase();
}

function candidatesFor(token: string, words: Set<string>): string | null {
  if (token.length < 3) return null;
  if (/^\d+$/.test(token)) return null;
  const lower = token.toLowerCase();
  if (words.has(lower)) return null;

  const found = new Set<string>();

  const consider = (next: string) => {
    const key = next.toLowerCase();
    if (key !== lower && words.has(key)) found.add(key);
  };

  for (let i = 0; i < token.length; i += 1) {
    const alternates = CHAR_ALTERNATES[token[i]] ?? CHAR_ALTERNATES[lower[i]];
    if (!alternates) continue;
    for (const alternate of alternates) {
      consider(token.slice(0, i) + alternate + token.slice(i + 1));
    }
  }

  for (let i = 0; i < lower.length; i += 1) {
    for (const [from, to] of DIGRAPH_SWAPS) {
      if (lower.slice(i, i + from.length) !== from) continue;
      consider(lower.slice(0, i) + to + lower.slice(i + from.length));
    }
  }

  if (found.size !== 1) return null;
  return applyCasing(token, [...found][0]);
}

/** Fix OCR words only when one lookalike swap turns a non-word into a dictionary word. */
export function fixLookalikeLetters(srt: string): { text: string; fixes: number } {
  const words = loadDictionary();
  let fixes = 0;
  const text = srt
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^\d+$/.test(trimmed) || trimmed.includes("-->")) return line;
      return line.replace(/[A-Za-z0-9|]+/g, (token) => {
        const fixed = candidatesFor(token, words);
        if (!fixed || fixed === token) return token;
        fixes += 1;
        return fixed;
      });
    })
    .join("\n");

  return { text, fixes };
}
