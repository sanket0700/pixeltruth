export interface DetectionImage {
  buffer: Buffer;
  mimeType: string;
}

export interface AIDetectionResult {
  /** 0-1 likelihood the image is AI-generated, per the detector. */
  aiLikelihoodScore: number;
  /** Best-guess source model (e.g. "midjourney"), if the detector reports one. */
  sourceModel: string | null;
  provider: string;
}

/**
 * Swappable so v1 (Hive, bought) can be replaced by a self-hosted model later
 * without touching callers - see pixeltruth_project_direction memory.
 */
export interface AIDetector {
  detect(image: DetectionImage): Promise<AIDetectionResult>;
}

export interface C2paCheckResult {
  /** Whether a C2PA manifest was found at all. */
  present: boolean;
  /** The tool/product that produced the manifest's active claim, if present. */
  claimGenerator: string | null;
  /** Whether the manifest's signature validated, if present. */
  signatureValid: boolean | null;
}

export interface DetectionResult {
  ai: AIDetectionResult;
  c2pa: C2paCheckResult;
}
