import type { LocaleBucket } from "../shared/types";

const HANGUL_RE = /[\u3131-\u318E\uAC00-\uD7A3]/g;
const LATIN_RE = /[A-Za-z]/g;

export function detectLocaleBucket(text: string): LocaleBucket {
  const normalized = text.trim();
  if (!normalized) {
    return "default";
  }

  const hangul = normalized.match(HANGUL_RE)?.length ?? 0;
  const latin = normalized.match(LATIN_RE)?.length ?? 0;

  if (hangul > latin && hangul >= 2) {
    return "ko";
  }

  if (latin >= hangul && latin >= 2) {
    return "en";
  }

  return "default";
}

export function detectLocaleBuckets(texts: string[]): LocaleBucket[] {
  return [...new Set(texts.map(detectLocaleBucket))];
}
