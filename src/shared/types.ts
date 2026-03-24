export type PlatformName = "tiktok" | "instagram-reels" | "unsupported";
export type Sensitivity = "conservative" | "balanced" | "aggressive";
export type CreatorVote = "slop" | "allow";
export type LocaleBucket = "en" | "ko" | "default";

export interface CreatorIdentity {
  key: string;
  handle?: string;
  profileUrl?: string;
  rawId?: string;
}

export interface ExtractedComment {
  text: string;
  authorHint?: string;
  locale: LocaleBucket;
}

export interface ExtractedSignals {
  itemId: string;
  platform: PlatformName;
  creator?: CreatorIdentity;
  caption: string;
  hashtags: string[];
  comments: ExtractedComment[];
  isAdvertisement?: boolean;
  officialAiLabel: boolean;
  officialAiTexts: string[];
  visibleTexts: string[];
  aiDisclosureTexts: string[];
  raw?: Record<string, unknown>;
}

export interface SignalMatch {
  reasonKey: string;
  weight: number;
  source: "official" | "caption" | "hashtags" | "comments" | "vote" | "contradiction";
  locale: LocaleBucket;
  excerpt?: string;
}

export interface ScoreBreakdown {
  total: number;
  threshold: number;
  sensitivity: Sensitivity;
  shouldSkip: boolean;
  hardBlock: boolean;
  protectedByAllow: boolean;
  matches: SignalMatch[];
}

export interface DebugSnapshot {
  timestamp: string;
  platform: PlatformName;
  locationHref: string;
  activeItemId?: string;
  creatorKey?: string;
  creatorHandle?: string;
  captionLength?: number;
  hashtagCount?: number;
  commentCount?: number;
  locales?: LocaleBucket[];
  score?: ScoreBreakdown;
  extractionNotes?: string[];
  probe?: Record<string, unknown>;
}

export interface ExtensionSettings {
  enabled: boolean;
  dryRun: boolean;
  reelsAutoExpandCaption: boolean;
  debugMode: boolean;
  pauseOnManualRevisit: boolean;
  showToast: boolean;
  sensitivity: Sensitivity;
  reelsProbeEnabled: boolean;
  thresholdOverrides: Partial<Record<Sensitivity, number>>;
  localeRuleVisibility: "compact" | "full";
}

export interface StorageState {
  schemaVersion: number;
  settings: ExtensionSettings;
  creatorVotes: Record<string, CreatorVote>;
  learnedPhraseScores: Record<string, number>;
  platformFlags: {
    tiktok: { enabled: boolean };
    reelsProbe: { enabled: boolean };
  };
  ruleOverrides: {
    en: string[];
    ko: string[];
    default: string[];
  };
}

export interface PlatformStatus {
  platform: PlatformName;
  supported: boolean;
  currentCreator?: CreatorIdentity;
  currentVote?: CreatorVote;
  currentItemId?: string;
  lastScore?: ScoreBreakdown;
  debugSnapshot?: DebugSnapshot;
}

export interface PlatformAdapter {
  platform: PlatformName;
  detect(): boolean;
  findActiveItem(): HTMLElement | null;
  extractSignals(activeItem: HTMLElement): Promise<ExtractedSignals | null>;
  getCreatorIdentity(activeItem: HTMLElement, signals?: ExtractedSignals | null): CreatorIdentity | undefined;
  skipToNext(activeItem: HTMLElement): Promise<boolean>;
  getDebugSnapshot(activeItem: HTMLElement | null, signals: ExtractedSignals | null): Promise<DebugSnapshot>;
}
