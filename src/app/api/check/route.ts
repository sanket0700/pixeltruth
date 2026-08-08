import { runDetection, type DetectionResult } from "@/lib/detection";
import { checkAndConsumeRateLimit } from "@/lib/data/rateLimit";
import { createResult } from "@/lib/data/results";
import { getClientIp } from "@/lib/getClientIp";
import { ImageValidationError, validateImageFile } from "@/lib/validation/image";
import { HiveResponseParseError } from "@/lib/detection/hive";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with an image field." }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "No image file provided." }, { status: 400 });
  }

  try {
    validateImageFile(file);
  } catch (err) {
    if (err instanceof ImageValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Rate limiting exists to bound Hive spend, so it only gates the
  // paid call - free validation failures above don't cost a check.
  const ip = getClientIp(request);
  const rateLimit = await checkAndConsumeRateLimit(ip);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: `Daily limit of ${rateLimit.limit} checks reached. Try again tomorrow.` },
      { status: 429 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let detection: DetectionResult;
  try {
    detection = await runDetection({ buffer, mimeType: file.type });
  } catch (err) {
    if (err instanceof HiveResponseParseError) {
      console.error("Hive response did not match expected shape", err.rawBody);
    } else {
      console.error("Detection failed", err);
    }
    return Response.json(
      { error: "Analysis failed. Please try again in a moment." },
      { status: 502 },
    );
  }

  const result = await createResult(detection);
  return Response.json(result, { status: 201 });
}
