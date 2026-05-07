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
