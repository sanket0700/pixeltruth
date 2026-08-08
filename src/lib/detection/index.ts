import "server-only";

import { checkC2pa } from "./c2pa";
import { CommunityForensicsDetector } from "./communityForensics";
import { HiveDetector } from "./hive";
import type { AIDetector, DetectionImage, DetectionResult } from "./types";

export type {
  AIDetectionResult,
  AIDetector,
  C2paCheckResult,
  DetectionImage,
  DetectionResult,
} from "./types";

let cachedDetector: AIDetector | undefined;

// The only place that knows which AI detector backend is active - the
// whole reason AIDetector exists as an interface. Default is
// community-forensics, not hive: Hive's Terms of Use turned out to
// restrict PixelTruth's exact use case (displaying their output to
// anonymous end users) without written permission, which hasn't been
// secured yet - see pixeltruth_project_direction/pixeltruth_infra
// memories. Until that's resolved, no request should reach Hive at all,
// not even as an occasional fallback. HiveDetector stays fully built and
// tested so it can be reintroduced (as a primary or as one signal among
// several) the moment permission exists - AI_DETECTOR_PROVIDER=hive is
// there for exactly that, and for comparing the two during evaluation.
function getAIDetector(): AIDetector {
  if (!cachedDetector) {
    const provider = process.env.AI_DETECTOR_PROVIDER ?? "community-forensics";
    if (provider === "hive") {
      const apiKey = process.env.HIVE_API_KEY;
      if (!apiKey) throw new Error("HIVE_API_KEY is not set");
      cachedDetector = new HiveDetector(apiKey);
    } else if (provider === "community-forensics") {
      cachedDetector = new CommunityForensicsDetector();
    } else {
      throw new Error(`Unknown AI_DETECTOR_PROVIDER: ${provider}`);
    }
  }
  return cachedDetector;
}

export async function runDetection(image: DetectionImage): Promise<DetectionResult> {
  const [ai, c2pa] = await Promise.all([getAIDetector().detect(image), checkC2pa(image)]);
  return { ai, c2pa };
}
