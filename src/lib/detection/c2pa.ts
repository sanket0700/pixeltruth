import "server-only";

import { Reader } from "@contentauth/c2pa-node";
import type { DetectionImage, C2paCheckResult } from "./types";

// @contentauth/c2pa-node@0.8.3's own types.d.ts imports Manifest/ManifestStore
// from "@contentauth/c2pa-types", but doesn't declare it as a dependency
// (verified: absent from its package.json and not installed), so those types
// resolve to `any` in a real install. Declaring just the fields actually read
// here, shaped from the real runtime response (see __fixtures__/README.md),
// rather than depending on an undeclared upstream package.
interface ValidationStatus {
  code: string;
}
interface ManifestStoreShape {
  active_manifest?: string | null;
  manifests: Record<string, { claim_generator?: string } | undefined>;
  validation_status?: ValidationStatus[] | null;
}

// c2pa-rs's validation_status only ever lists problems, never confirmations -
// an empty array means a fully clean, spec-valid manifest. Confirmed against
// real fixtures (see __fixtures__/README.md): a validly-signed test claim
// still reports `signingCredential.untrusted` (the test CA isn't in any
// trust list - informational, not tampering), while a deliberately broken
// claim reports `claimSignature.mismatch` alongside it. Only "mismatch"
// codes indicate the cryptographic signature/hash itself doesn't check out;
// everything else (untrusted/expired/revoked credentials) means the
// manifest is intact but its signer isn't vouched for, which is a different
// claim than "this was tampered with".
function isHardFailureCode(code: string): boolean {
  return code.includes("mismatch");
}

export async function checkC2pa(image: DetectionImage): Promise<C2paCheckResult> {
  const reader = await Reader.fromAsset({
    buffer: image.buffer,
    mimeType: image.mimeType,
  });

  if (!reader) {
    return { present: false, claimGenerator: null, signatureValid: null };
  }

  const manifestStore = reader.json() as unknown as ManifestStoreShape;
  const activeLabel = manifestStore.active_manifest;
  const activeManifest = activeLabel ? manifestStore.manifests?.[activeLabel] : undefined;
  const codes = manifestStore.validation_status ?? [];

  return {
    present: true,
    claimGenerator: activeManifest?.claim_generator ?? null,
    signatureValid: !codes.some((status) => isHardFailureCode(status.code)),
  };
}
