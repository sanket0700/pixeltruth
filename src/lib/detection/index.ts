import "server-only";

import { checkC2pa } from "./c2pa";
import { HiveDetector } from "./hive";
import type { AIDetector, DetectionImage, DetectionResult } from "./types";

export type { AIDetectionResult, AIDetector, C2paCheckResult, DetectionResult } from "./types";

let cachedDetector: AIDetector | undefined;

// The only place that knows which AI detector backend is active. Swapping
// Hive for a self-hosted model later (see pixeltruth_project_direction
// memory) means adding a new AIDetector implementation and changing the
// line below - runDetection() and every caller stay the same.
function getAIDetector(): AIDetector {
  if (!cachedDetector) {
    const apiKey = process.env.HIVE_API_KEY;
    if (!apiKey) throw new Error("HIVE_API_KEY is not set");
    cachedDetector = new HiveDetector(apiKey);
  }
  return cachedDetector;
}

export async function runDetection(image: DetectionImage): Promise<DetectionResult> {
  const [ai, c2pa] = await Promise.all([getAIDetector().detect(image), checkC2pa(image)]);
  return { ai, c2pa };
}
