import "server-only";

import type { AIDetectionResult, AIDetector, DetectionImage } from "./types";

const HIVE_SYNC_TASK_URL = "https://api.thehive.ai/api/v2/task/sync";

export class HiveResponseParseError extends Error {
  constructor(
    message: string,
    public readonly rawBody: unknown,
  ) {
    super(message);
    this.name = "HiveResponseParseError";
  }
}

interface HiveClass {
  class: string;
  score: number;
}

interface HiveSyncResponse {
  status?: Array<{
    response?: {
      output?: Array<{ classes?: HiveClass[] }>;
    };
  }>;
}

// Hive's docs disagree with themselves on the exact multipart field name for
// a local file upload ("media" in one worked curl example, "image" in the
// OpenAPI schema on the reference page) - going with the schema's "image"
// since it's the more authoritative source, but this needs a real API-key
// smoke test (task 43) to confirm before this is trusted in production.
const HIVE_IMAGE_FIELD = "image";

function extractClasses(body: HiveSyncResponse): HiveClass[] {
  const classes = body.status?.[0]?.response?.output?.[0]?.classes;
  if (!classes) {
    throw new HiveResponseParseError(
      "Hive sync response did not contain status[0].response.output[0].classes - the response shape may not match what was inferred from docs.",
      body,
    );
  }
  return classes;
}

export class HiveDetector implements AIDetector {
  constructor(private readonly apiKey: string) {}

  async detect(image: DetectionImage): Promise<AIDetectionResult> {
    const form = new FormData();
    form.append(
      HIVE_IMAGE_FIELD,
      new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      "upload",
    );

    const response = await fetch(HIVE_SYNC_TASK_URL, {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Hive API request failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as HiveSyncResponse;
    const classes = extractClasses(body);

    const aiGenerated = classes.find((c) => c.class === "ai_generated");
    if (!aiGenerated) {
      throw new HiveResponseParseError(
        "Hive response classes did not include an 'ai_generated' class.",
        body,
      );
    }

    const sourceModel =
      classes
        .filter((c) => c.class !== "ai_generated" && c.class !== "not_ai_generated")
        .sort((a, b) => b.score - a.score)[0]?.class ?? null;

    return {
      aiLikelihoodScore: aiGenerated.score,
      sourceModel: sourceModel === "none" || sourceModel === "inconclusive" ? null : sourceModel,
      provider: "hive",
    };
  }
}
