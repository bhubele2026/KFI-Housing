// Per-deploy build identifier served at GET /version. The web client
// records the first value it sees and shows a "new version — refresh"
// prompt when it later changes — i.e. when the app has been republished.
//
// We resolve it once at module load:
//   1. APP_BUILD_ID — explicit pin if a pipeline sets one.
//   2. A boot timestamp — every server reboot (which is what a Replit
//      republish does) mints a new value, so the client reliably detects
//      the new deploy. Deliberately simple: no git/build-time wiring to
//      go stale, and "changes on reboot" is exactly the signal we want.
export const APP_VERSION: string =
  process.env.APP_BUILD_ID && process.env.APP_BUILD_ID.trim()
    ? process.env.APP_BUILD_ID.trim()
    : `boot-${Date.now()}`;
