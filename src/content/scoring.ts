import { SENSITIVITY_THRESHOLDS } from "../shared/constants";
import type { CreatorVote, ExtractedSignals, LocaleBucket, ScoreBreakdown, Sensitivity, SignalMatch } from "../shared/types";
import { detectLocaleBucket } from "./language";

interface Rule {
  pattern: RegExp;
  weight: number;
  reasonKey: string;
}

interface UserRuleOverrides {
  en: string[];
  ko: string[];
  default: string[];
}

interface PreparedUserRules {
  en: string[];
  ko: string[];
  default: string[];
}

interface PreparedLearnedPhrase {
  phrase: string;
  score: number;
}

const MAX_RULES_PER_LOCALE_TO_SCORE = 400;
const MAX_LEARNED_PHRASES_TO_SCORE = 400;

const captionDisclosureRules: Rule[] = [
  { pattern: /\b(ai[- ]?generated|generated with ai|made with ai|created with ai|ai assisted)\b/i, weight: 55, reasonKey: "reasonCaptionDisclosure" },
  { pattern: /\b(prompt(ed)? with ai|midjourney|chatgpt art|stable diffusion)\b/i, weight: 40, reasonKey: "reasonCaptionAiPhrase" },
  { pattern: /(ai로 만든|ai ?생성|ai ?영상|ai ?작품|ai ?콘텐츠|인공지능으로 만든)/i, weight: 40, reasonKey: "reasonCaptionAiPhrase" },
  { pattern: /(ai ?티|ai ?티남|ai ?같음|ai ?냄새|\bai slop\b|\bprompt slop\b|\bdead internet\b)/i, weight: 18, reasonKey: "reasonCaptionSlopPhrase" }
];

const hashtagStrongRules: Rule[] = [
  { pattern: /^#?(aigenerated|aiart|aimade|madewithai|generatedwithai)$/i, weight: 25, reasonKey: "reasonHashtagStrong" },
  { pattern: /^#?(ai영상|ai그림|ai생성|ai콘텐츠|ai작품|인공지능)$/i, weight: 25, reasonKey: "reasonHashtagStrong" }
];

const hashtagWeakRules: Rule[] = [
  { pattern: /^#?ai$/i, weight: 10, reasonKey: "reasonHashtagWeak" },
  { pattern: /^#?chatgpt$/i, weight: 10, reasonKey: "reasonHashtagWeak" }
];

const contradictionRules: Rule[] = [
  { pattern: /\bnot ai\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\bthis is(n't| not) ai\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\b(real person|actually real|shot this|filmed this|not generated)\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /(ai ?아님|ai가 ?아님|ai 아니|인공지능 ?아님|ai로 ?만든 ?거 ?아님)/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /(진짜 ?사람|실제 ?사람|사람이 ?만든|직접 ?찍은|직접 ?촬영|본인이 ?찍은|실사임|실제임)/i, weight: -25, reasonKey: "reasonContradictionNotAi" }
];

const commentStrongRulesEn: Rule[] = [
  { pattern: /\bstop ai\b/i, weight: 24, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(real|fake) or ai\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\breal or fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bfake or fake\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bis( (it|this|that))? real/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bis( (it|this|that))? fake/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /^\s*ai\s*[?!]*\s*$/i, weight: 10, reasonKey: "reasonCommentWeakEn" },
  { pattern: /\b(its|it's|it is|this is|that is) ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(this|that|it)( is| looks| s)? ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bbro( this| s| is)? ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bdef(initely)? ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bso obviously ai\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\blooks( like)? ai\b/i, weight: 17, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai asf\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\btoo ai\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bthis screams ai\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bmade by ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bwas this made with ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai slop\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\byour ai slop bores me\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bprompt slop\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bmade with ai again\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bgenerated garbage\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bdead internet\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\blooks fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bso fake\b/i, weight: 17, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bdef(initely)? fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bnot real\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bthis aint real\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" }
];

const commentStrongRulesKo: Rule[] = [
  { pattern: /(이거|이건|저거|저건|그거|그건)\s*ai/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /ai\s*(같음|같은데|같다|같네|티남|티\s*남|티\s*나|느낌|냄새)/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /ai\s*(합성|생성|영상|그림|작품|콘텐츠)/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /ai로\s*(만든|만듦|생성한)/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /(너무|개|완전)\s*ai/i, weight: 18, reasonKey: "reasonCommentStrongKo" },
  { pattern: /(가짜\s*같|진짜\s*아닌|사람\s*아닌|합성\s*같)/i, weight: 18, reasonKey: "reasonCommentStrongKo" },
  { pattern: /(ai충|ai\s*충|ai슬롭|ai\s*슬롭)/i, weight: 18, reasonKey: "reasonCommentStrongKo" }
];

const commentStrongRulesDefault: Rule[] = [
  { pattern: /\b((esto|eso) es ai|это ии|это ai)\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai gk sih\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai nya\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(isso|esse v(í|i)deo) [ée] real\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b[ée] ia\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bia me assusta\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" }, // "IA scares me"
  { pattern: /\b(el|este) video es real\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" }, // AI meme "the video is real"
  { pattern: /\bthe video is real\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" } // AI meme English version
];

const AI_LIKE_FRAGMENT_RE = /\b(ai|ia|aigc|artificial intelligence|generated|gen ai|fake|cgi|render|rendered|prompt|slop|ии)\b|인공지능|합성|생성형/i;

function pushMatch(matches: SignalMatch[], match: SignalMatch): void {
  matches.push(match);
}

function applyRules(text: string, rules: Rule[], source: SignalMatch["source"], locale: LocaleBucket, matches: SignalMatch[]): number {
  let total = 0;
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      total += rule.weight;
      pushMatch(matches, {
        reasonKey: rule.reasonKey,
        weight: rule.weight,
        source,
        locale,
        excerpt: text.slice(0, 140)
      });
    }
  }
  return total;
}

function normalizeCommentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[？]/g, "?")
    .replace(/[！]/g, "!")
    // 단순히 a i를 ai로 붙이는 게 아니라, 독립적인 단어 형태로 ai를 숨기려 할 때만 보정
    .replace(/\ba\s+i\b/gi, "ai")
    .replace(/\ba\s*\.\s*i\b/gi, "ai")
    .replace(/a[\s._-]*1/g, "ai")
    .replace(/[\u2019']/g, "")
    .replace(/[^\p{L}\p{N}\s?!]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commentLocaleFromComments(comments: ExtractedSignals["comments"]): LocaleBucket {
  return comments.some((comment) => comment.locale === "ko")
    ? "ko"
    : comments.some((comment) => comment.locale === "en")
      ? "en"
      : "default";
}

function extractSuspicionFeatures(text: string): string[] {
  const features = new Set<string>();
  if (/\breal or ai\b/i.test(text)) features.add("real_or_ai");
  if (/\breal or fake\b/i.test(text)) features.add("real_or_fake");
  if (/\bfake or fake\b/i.test(text)) features.add("fake_or_fake");
  if (/\bis( (it|this|that))? real/i.test(text)) features.add("is_it_real");
  if (/\bis( (it|this|that))? fake/i.test(text)) features.add("is_it_fake");
  if (/\bits ai\b/i.test(text)) features.add("its_ai");
  if (/\b(fake|not real|looks fake|cgi|render)\b/i.test(text)) features.add("fake_cluster");
  if (/\b(ai|ia|ии|aigc|generated|prompt|slop)\b/i.test(text)) features.add("ai_cluster");
  if (/(ai|인공지능).*(같|티|합성|생성|가짜)|(?:가짜|합성).*(같|티)/i.test(text)) features.add("ko_ai_cluster");
  return [...features];
}

function scoreSuspicionFeatures(text: string, locale: LocaleBucket, matches: SignalMatch[]): number {
  const features = extractSuspicionFeatures(text);
  if (!features.length) return 0;

  let total = 0;
  for (const feature of features) {
    const weight = feature.includes("cluster") ? 8 : 14;
    total += weight;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight,
      source: "comments",
      locale,
      excerpt: feature
    });
  }
  return total;
}

function countContradictionSignals(matches: SignalMatch[]): number {
  return matches.filter((match) => match.source === "contradiction" && match.weight < 0).length;
}

function scoreLearnedPhrases(
  text: string,
  locale: LocaleBucket,
  matches: SignalMatch[],
  learnedPhrases: PreparedLearnedPhrase[]
): number {
  let total = 0;

  for (const learnedPhrase of learnedPhrases) {
    if (!phraseMatchesText(text, learnedPhrase.phrase)) continue;

    const weight = learnedPhrase.score > 0 ? learnedPhrase.score * 4 : learnedPhrase.score * 3;
    total += weight;
    pushMatch(matches, {
      reasonKey: learnedPhrase.score > 0 ? "reasonCommentStrongEn" : "reasonContradictionNotAi",
      weight,
      source: "comments",
      locale,
      excerpt: learnedPhrase.phrase
    });
  }
  return Math.max(-24, Math.min(24, total));
}

function normalizeUserPhrase(phrase: string): string {
  return normalizeCommentText(phrase).slice(0, 160);
}

function prepareUserRules(ruleOverrides: UserRuleOverrides): PreparedUserRules {
  return {
    en: prepareUserRuleList(ruleOverrides.en),
    ko: prepareUserRuleList(ruleOverrides.ko),
    default: prepareUserRuleList(ruleOverrides.default)
  };
}

function prepareUserRuleList(phrases: string[]): string[] {
  const seenPhrases = new Set<string>();
  const prepared: string[] = [];

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeUserPhrase(phrase);
    if (!normalizedPhrase || seenPhrases.has(normalizedPhrase)) continue;
    seenPhrases.add(normalizedPhrase);
    prepared.push(normalizedPhrase);
    if (prepared.length >= MAX_RULES_PER_LOCALE_TO_SCORE) {
      break;
    }
  }

  return prepared.sort((left, right) => right.length - left.length);
}

function prepareLearnedPhrases(learnedPhraseScores: Record<string, number>): PreparedLearnedPhrase[] {
  const seenPhrases = new Set<string>();
  const prepared: PreparedLearnedPhrase[] = [];
  const entries = Object.entries(learnedPhraseScores)
    .filter(([, rawScore]) => rawScore !== 0)
    .sort((left, right) => {
      const scoreDelta = Math.abs(right[1]) - Math.abs(left[1]);
      if (scoreDelta !== 0) return scoreDelta;
      return right[0].length - left[0].length;
    });

  for (const [phrase, score] of entries) {
    const normalizedPhrase = normalizeUserPhrase(phrase);
    if (!normalizedPhrase || seenPhrases.has(normalizedPhrase)) continue;
    seenPhrases.add(normalizedPhrase);
    prepared.push({ phrase: normalizedPhrase, score });
    if (prepared.length >= MAX_LEARNED_PHRASES_TO_SCORE) {
      break;
    }
  }

  return prepared;
}

function isAsciiWordChar(char: string | undefined): boolean {
  return Boolean(char && /[a-z0-9_]/i.test(char));
}

function phraseMatchesText(text: string, phrase: string): boolean {
  let fromIndex = 0;
  while (fromIndex <= text.length) {
    const index = text.indexOf(phrase, fromIndex);
    if (index === -1) return false;

    const before = text[index - 1];
    const after = text[index + phrase.length];
    if (!isAsciiWordChar(before) && !isAsciiWordChar(after)) {
      return true;
    }

    fromIndex = index + phrase.length;
  }

  return false;
}

function scoreUserRuleOverrides(
  text: string,
  locale: LocaleBucket,
  source: SignalMatch["source"],
  matches: SignalMatch[],
  ruleOverrides: PreparedUserRules
): number {
  const normalized = normalizeCommentText(text);
  if (!normalized) return 0;

  const candidatePhrases = [...new Set([
    ...ruleOverrides.default,
    ...(locale === "ko" ? ruleOverrides.ko : ruleOverrides.en)
  ])];
  let total = 0;

  for (const phrase of candidatePhrases) {
    if (!phraseMatchesText(normalized, phrase)) continue;

    const weight = source === "caption" ? 60 : 32;
    total += weight;
    pushMatch(matches, {
      reasonKey: source === "caption" ? "reasonCaptionSlopPhrase" : "reasonCommentStrongEn",
      weight,
      source,
      locale,
      excerpt: phrase
    });
  }

  return Math.min(source === "caption" ? 80 : 96, total);
}

export function computeScore(
  signals: ExtractedSignals,
  sensitivity: Sensitivity,
  creatorVote?: CreatorVote,
  thresholdOverride?: number,
  learnedPhraseScores: Record<string, number> = {},
  ruleOverrides: UserRuleOverrides = { en: [], ko: [], default: [] }
): ScoreBreakdown {
  const matches: SignalMatch[] = [];
  let total = 0;
  const preparedRuleOverrides = prepareUserRules(ruleOverrides);
  const preparedLearnedPhrases = prepareLearnedPhrases(learnedPhraseScores);

  if (creatorVote === "allow") {
    pushMatch(matches, { reasonKey: "reasonVoteAllow", weight: -100, source: "vote", locale: "default" });
    return {
      total: -100,
      threshold: thresholdOverride ?? SENSITIVITY_THRESHOLDS[sensitivity],
      sensitivity,
      shouldSkip: false,
      hardBlock: false,
      protectedByAllow: true,
      matches
    };
  }

  if (creatorVote === "slop") {
    total += 100;
    pushMatch(matches, { reasonKey: "reasonVoteSlop", weight: 100, source: "vote", locale: "default" });
  }

  if (signals.isAdvertisement) {
    total += 100;
    pushMatch(matches, {
      reasonKey: "reasonAdvertisement",
      weight: 100,
      source: "official",
      locale: "default"
    });
  }

  if (signals.officialAiLabel) {
    total += 90;
    pushMatch(matches, {
      reasonKey: "reasonOfficialAi",
      weight: 90,
      source: "official",
      locale: "default",
      excerpt: signals.officialAiTexts[0]
    });
  }

  const captionLocale = detectLocaleBucket(signals.caption);
  total += applyRules(signals.caption, captionDisclosureRules, "caption", captionLocale, matches);
  total += applyRules(signals.caption, contradictionRules, "contradiction", captionLocale, matches);
  total += scoreUserRuleOverrides(signals.caption, captionLocale, "caption", matches, preparedRuleOverrides);

  for (const tag of signals.hashtags) {
    total += applyRules(tag, hashtagStrongRules, "hashtags", captionLocale, matches);
    total += applyRules(tag, hashtagWeakRules, "hashtags", captionLocale, matches);
  }

  const seenComments = new Set<string>();
  let commentTotal = 0;
  let aiMentionCount = 0;
  let strongCommentSignalCount = 0;
  let contradictionCommentCount = 0;

  for (const comment of signals.comments) {
    const normalized = normalizeCommentText(comment.text);
    const key = `${comment.authorHint ?? ""}:${normalized}`;
    if (!normalized || seenComments.has(key)) continue;
    seenComments.add(key);

    const contradictionScore = applyRules(normalized, contradictionRules, "contradiction", comment.locale, matches);
    commentTotal += contradictionScore;
    if (contradictionScore < 0) {
      contradictionCommentCount += 1;
      continue;
    }

    let hasStrongSignalInComment = false;
    const defaultStrongScore = applyRules(normalized, commentStrongRulesDefault, "comments", comment.locale, matches);
    commentTotal += defaultStrongScore;
    if (defaultStrongScore > 0) hasStrongSignalInComment = true;

    const suspicionFeatureScore = scoreSuspicionFeatures(normalized, comment.locale, matches);
    commentTotal += suspicionFeatureScore;
    if (suspicionFeatureScore >= 14) hasStrongSignalInComment = true;

    const learnedScore = scoreLearnedPhrases(normalized, comment.locale, matches, preparedLearnedPhrases);
    commentTotal += learnedScore;
    if (learnedScore >= 8) hasStrongSignalInComment = true;

    const userRuleScore = scoreUserRuleOverrides(normalized, comment.locale, "comments", matches, preparedRuleOverrides);
    commentTotal += userRuleScore;
    if (userRuleScore > 0) hasStrongSignalInComment = true;

    if (comment.locale === "ko") {
      const strongScore = applyRules(normalized, commentStrongRulesKo, "comments", comment.locale, matches);
      commentTotal += strongScore;
      if (strongScore > 0) hasStrongSignalInComment = true;
      if (AI_LIKE_FRAGMENT_RE.test(normalized)) {
        aiMentionCount += 1;
        commentTotal += 8;
        pushMatch(matches, {
          reasonKey: "reasonCommentWeakKo",
          weight: 8,
          source: "comments",
          locale: comment.locale,
          excerpt: normalized.slice(0, 140)
        });
      }
    } else {
      const strongScore = applyRules(normalized, commentStrongRulesEn, "comments", comment.locale, matches);
      commentTotal += strongScore;
      if (strongScore > 0) hasStrongSignalInComment = true;
      if (AI_LIKE_FRAGMENT_RE.test(normalized)) {
        aiMentionCount += 1;
        commentTotal += 6;
        pushMatch(matches, {
          reasonKey: "reasonCommentWeakEn",
          weight: 6,
          source: "comments",
          locale: comment.locale,
          excerpt: normalized.slice(0, 140)
        });
      }
    }

    if (hasStrongSignalInComment) {
      strongCommentSignalCount += 1;
    }
  }

  const commentLocale = commentLocaleFromComments(signals.comments);
  if (strongCommentSignalCount >= 2) {
    commentTotal += 28;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight: 28,
      source: "comments",
      locale: commentLocale,
      excerpt: `${strongCommentSignalCount} comments`
    });
  } else if (aiMentionCount >= 2) {
    commentTotal += 20;
    pushMatch(matches, {
      reasonKey: "reasonCommentWeakEn",
      weight: 20,
      source: "comments",
      locale: commentLocale,
      excerpt: `${aiMentionCount} comments`
    });
  }

  if (contradictionCommentCount >= 2) {
    commentTotal -= 20;
    pushMatch(matches, {
      reasonKey: "reasonContradictionNotAi",
      weight: -20,
      source: "contradiction",
      locale: commentLocale,
      excerpt: `${contradictionCommentCount} comments`
    });
  }

  if (strongCommentSignalCount >= 3) {
    commentTotal += 18;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight: 18,
      source: "comments",
      locale: commentLocale,
      excerpt: `pile-on ${strongCommentSignalCount}`
    });
  }

  if (strongCommentSignalCount >= 5) {
    commentTotal += 18;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight: 18,
      source: "comments",
      locale: commentLocale,
      excerpt: `heavy pile-on ${strongCommentSignalCount}`
    });
  }

  total += commentTotal;

  const threshold = thresholdOverride ?? SENSITIVITY_THRESHOLDS[sensitivity];
  const hardBlock = signals.isAdvertisement || signals.officialAiLabel || creatorVote === "slop";
  const hasMediumSignal = matches.some((match) => match.weight >= 15);
  const contradictionSignals = countContradictionSignals(matches);
  const needsExtraEvidence = contradictionSignals >= 2 && !signals.officialAiLabel && !signals.isAdvertisement;
  const hasStrongSignal = matches.some((match) => match.weight >= 25);
  const shouldSkip = hardBlock || (total >= threshold && hasMediumSignal && (!needsExtraEvidence || hasStrongSignal));

  return {
    total,
    threshold,
    sensitivity,
    shouldSkip,
    hardBlock,
    protectedByAllow: false,
    matches
  };
}
