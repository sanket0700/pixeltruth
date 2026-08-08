// Pins the test project id regardless of whatever .env.local happens to be
// pointed at, so tests always target the "demo-" project the emulator
// suite runs under. FIRESTORE_EMULATOR_HOST is injected automatically by
// `firebase emulators:exec`, which is how `npm test` runs this suite.
process.env.FIREBASE_PROJECT_ID = "demo-pixeltruth";
