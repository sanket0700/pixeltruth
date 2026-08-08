import "server-only";

import { type App, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Lazily initialized on first real use, not at module import time - Next.js
// imports Route Handler modules during `next build`'s page-data-collection
// pass and during SSR, with no real config/emulator present at that point.
// Eager initializeApp() here would crash the build (this exact mistake was
// made and fixed once already, in kaleido). Deferring until getAdminDb() is
// actually called means it only ever runs with real config: the emulator
// env var locally, or Cloud Run's attached service account (via
// Application Default Credentials) in production.
//
// No client Firebase SDK exists in this project at all - Firestore here is
// only ever touched server-side, for rate-limit counters and result
// records, never directly by a browser.
function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  return initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

let cachedDb: Firestore | undefined;

export function getAdminDb(): Firestore {
  return (cachedDb ??= getFirestore(getAdminApp()));
}
