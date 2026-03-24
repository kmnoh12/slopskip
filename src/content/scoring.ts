import { COMMENT_SCORE_CAP, SENSITIVITY_THRESHOLDS } from "../shared/constants";
import type { CreatorVote, ExtractedSignals, LocaleBucket, ScoreBreakdown, Sensitivity, SignalMatch } from "../shared/types";
import { detectLocaleBucket } from "./language";

interface Rule {
  pattern: RegExp;
  weight: number;
  reasonKey: string;
}

const captionDisclosureRules: Rule[] = [
  { pattern: /\b(ai[- ]?generated|generated with ai|made with ai|created with ai|ai assisted)\b/i, weight: 55, reasonKey: "reasonCaptionDisclosure" },
  { pattern: /\b(prompt(ed)? with ai|midjourney|chatgpt art|stable diffusion)\b/i, weight: 40, reasonKey: "reasonCaptionAiPhrase" },
  { pattern: /\b(ai로 만든|ai ?생성|ai ?영상|ai ?작품)\b/i, weight: 40, reasonKey: "reasonCaptionAiPhrase" },
  { pattern: /\b(ai 슬롭|ai slop|prompt slop|dead internet)\b/i, weight: 18, reasonKey: "reasonCaptionSlopPhrase" }
];

const hashtagStrongRules: Rule[] = [
  { pattern: /^#?(aigenerated|aiart|aimade|madewithai|generatedwithai)$/i, weight: 25, reasonKey: "reasonHashtagStrong" },
  { pattern: /^#?(ai영상|ai그림|ai생성|ai콘텐츠)$/i, weight: 25, reasonKey: "reasonHashtagStrong" }
];

const hashtagWeakRules: Rule[] = [
  { pattern: /^#?ai$/i, weight: 10, reasonKey: "reasonHashtagWeak" },
  { pattern: /^#?chatgpt$/i, weight: 10, reasonKey: "reasonHashtagWeak" }
];

const contradictionRules: Rule[] = [
  { pattern: /\bnot ai\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\bthis is(n't| not) ai\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\bai 아니\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\b진짜 사람\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" }
];

const commentStrongRulesEn: Rule[] = [
  { pattern: /\bstop ai\b/i, weight: 24, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(real|fake) or ai\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\breal or fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bfake or fake\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bis( (it|this|that))? real/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bis( (it|this|that))? fake/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /^\s*ai\s*[?!]*\s*$/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
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
  { pattern: /\b이거 ai\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 같음\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 티남\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 합성\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 영상이네\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai로 만든 거\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai충\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" }
];

const commentStrongRulesDefault: Rule[] = [
  { pattern: /\b(esto|это)? ?(es )?(ai|ии)\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai gk sih\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai nya\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(isso|esse v(í|i)deo) [ée] real\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b[ée] ia\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bia me assusta\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" }, // "IA scares me"
  { pattern: /\b(el|este) video es real\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" }, // AI meme "the video is real"
  { pattern: /\bthe video is real\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" } // AI meme English version
];

const AI_LIKE_FRAGMENT_RE = /\b(ai|ia|aigc|artificial intelligence|generated|gen ai|fake|cgi|render|rendered|prompt|slop|ии)\b/i;

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

function scoreLearnedPhrases(
  text: string,
  locale: LocaleBucket,
  matches: SignalMatch[],
  learnedPhraseScores: Record<string, number>
): number {
  let total = 0;
  for (const [phrase, rawScore] of Object.entries(learnedPhraseScores)) {
    if (!phrase || rawScore === 0) continue;
    if (!text.includes(phrase)) continue;

    const weight = rawScore > 0 ? rawScore * 4 : rawScore * 3;
    total += weight;
    pushMatch(matches, {
      reasonKey: rawScore > 0 ? "reasonCommentStrongEn" : "reasonContradictionNotAi",
      weight,
      source: "comments",
      locale,
      excerpt: phrase
    });
  }
  return Math.max(-24, Math.min(24, total));
}

export function computeScore(
  signals: ExtractedSignals,
  sensitivity: Sensitivity,
  creatorVote?: CreatorVote,
  thresholdOverride?: number,
  learnedPhraseScores: Record<string, number> = {}
): ScoreBreakdown {
  const matches: SignalMatch[] = [];
  let total = 0;

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

  for (const tag of signals.hashtags) {
    total += applyRules(tag, hashtagStrongRules, "hashtags", captionLocale, matches);
    total += applyRules(tag, hashtagWeakRules, "hashtags", captionLocale, matches);
  }

  const seenComments = new Set<string>();
  let commentTotal = 0;
  let aiMentionCount = 0;
  let strongCommentSignalCount = 0;

  for (const comment of signals.comments) {
    const normalized = normalizeCommentText(comment.text);
    const key = `${comment.authorHint ?? ""}:${normalized}`;
    if (!normalized || seenComments.has(key)) continue;
    seenComments.add(key);

    commentTotal += applyRules(normalized, contradictionRules, "contradiction", comment.locale, matches);

    const defaultStrongScore = applyRules(normalized, commentStrongRulesDefault, "comments", comment.locale, matches);
    commentTotal += defaultStrongScore;
    if (defaultStrongScore > 0) strongCommentSignalCount += 1;

    const suspicionFeatureScore = scoreSuspicionFeatures(normalized, comment.locale, matches);
    commentTotal += suspicionFeatureScore;
    if (suspicionFeatureScore >= 14) strongCommentSignalCount += 1;

    const learnedScore = scoreLearnedPhrases(normalized, comment.locale, matches, learnedPhraseScores);
    commentTotal += learnedScore;
    if (learnedScore >= 8) strongCommentSignalCount += 1;

    if (comment.locale === "ko") {
      const strongScore = applyRules(normalized, commentStrongRulesKo, "comments", comment.locale, matches);
      commentTotal += strongScore;
      if (strongScore > 0) strongCommentSignalCount += 1;
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
      if (strongScore > 0) strongCommentSignalCount += 1;
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
  const hardBlock = signals.officialAiLabel || creatorVote === "slop";
  const hasMediumSignal = matches.some((match) => match.weight >= 15);
  const shouldSkip = hardBlock || (total >= threshold && hasMediumSignal);

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
