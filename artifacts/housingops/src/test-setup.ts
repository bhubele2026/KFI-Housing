import "./i18n";
import i18n from "./i18n";

class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

if (typeof HTMLElement.prototype.scrollIntoView === "undefined") {
  HTMLElement.prototype.scrollIntoView = function () {};
}

// Force English in tests so existing snapshots / text matchers keep
// asserting against the original copy. Tests that want to exercise
// Spanish translations call `await i18n.changeLanguage("es")` themselves.
void i18n.changeLanguage("en");

// Fail loudly when a `t(...)` call resolves to a key that has no entry
// in the active language bundle. Recorded keys are exposed on
// `globalThis.__missingI18nKeys` so individual tests (e.g. the
// Spanish-coverage suite) can assert zero missing keys.
declare global {
  // eslint-disable-next-line no-var
  var __missingI18nKeys: Array<{ lng: string; key: string }>;
}
globalThis.__missingI18nKeys = [];
i18n.options.saveMissing = true;
i18n.on("missingKey", (lngs, _ns, key) => {
  for (const lng of lngs ?? []) {
    globalThis.__missingI18nKeys.push({ lng, key });
  }
});
