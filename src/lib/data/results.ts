import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import type { DetectionResult } from "@/lib/detection";
import { COLLECTIONS } from "./collections";

export interface StoredResult {
  id: string;
  aiLikelihoodScore: number;
  sourceModel: string | null;
  provider: string;
  c2paPresent: boolean;
  c2paClaimGenerator: string | null;
  c2paSignatureValid: boolean | null;
  createdAt: string;
}

// Deliberately no image field - results are never resolved back to the
// uploaded photo, only to the analysis. See PixelTruth's no-persistent-
// image-storage design.
export async function createResult(detection: DetectionResult): Promise<StoredResult> {
  const db = getAdminDb();
  const docRef = db.collection(COLLECTIONS.RESULTS).doc();

  const result: Omit<StoredResult, "id"> = {
    aiLikelihoodScore: detection.ai.aiLikelihoodScore,
    sourceModel: detection.ai.sourceModel,
    provider: detection.ai.provider,
    c2paPresent: detection.c2pa.present,
    c2paClaimGenerator: detection.c2pa.claimGenerator,
    c2paSignatureValid: detection.c2pa.signatureValid,
    createdAt: new Date().toISOString(),
  };

  await docRef.set(result);
  return { id: docRef.id, ...result };
}

export async function getResult(id: string): Promise<StoredResult | null> {
  const snapshot = await getAdminDb().collection(COLLECTIONS.RESULTS).doc(id).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...(snapshot.data() as Omit<StoredResult, "id">) };
}
