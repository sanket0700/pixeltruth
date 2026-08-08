// server-only throws unconditionally unless resolved with Next's
// "react-server" export condition, which only Next's own build pipeline
// sets - Vitest doesn't. Aliased in vitest.config.ts so files with
// `import "server-only"` can still be tested directly under Node, without
// weakening the real guard the app ships with.
export {};
