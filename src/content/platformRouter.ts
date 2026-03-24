import type { PlatformAdapter } from "../shared/types";
import { ReelsProbeAdapter } from "./platforms/reelsProbeAdapter";
import { TikTokAdapter } from "./platforms/tiktokAdapter";

export function resolvePlatformAdapter(): PlatformAdapter | null {
  const hostname = window.location.hostname;
  if (hostname.includes("tiktok.com")) {
    return new TikTokAdapter();
  }
  if (hostname.includes("instagram.com")) {
    return new ReelsProbeAdapter();
  }
  return null;
}
