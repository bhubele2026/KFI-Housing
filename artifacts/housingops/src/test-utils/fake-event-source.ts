// ---------------------------------------------------------------------------
// Hand-rolled EventSource shim — captures the SSE channel that
// `useRuntimeConfigStream` opens so the rotation tests in
// `portfolio-map.test.tsx` and `property-location-map.test.tsx` can dispatch a
// synthetic `config` event mid-render to mimic an api-server restart that
// pushed a freshly-rotated GOOGLE_MAPS_API_KEY without standing up a real
// SSE feed. jsdom does not ship EventSource by default — `useRuntimeConfigStream`
// relies on `typeof EventSource === "undefined"` to silently no-op in that
// environment, so installing this shim in `beforeEach` is what flips the
// SSE-subscription branch on for the surrounding describe block.
//
// Both map test files used to keep their own line-for-line identical copy of
// this shim. Lifting it into one shared module here keeps them honest with a
// single source of truth and makes it obvious where to add coverage for new
// SSE behaviour (error/open events, reconnect, etc.) next time.
// ---------------------------------------------------------------------------

export const fakeEventSources: FakeEventSource[] = [];

export class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  CONNECTING = 0;
  OPEN = 1;
  CLOSED = 2;
  url: string;
  readyState = 1;
  closed = false;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(url: string | URL) {
    this.url = String(url);
    fakeEventSources.push(this);
  }
  addEventListener(event: string, cb: (e: MessageEvent) => void): void {
    const cur = this.listeners.get(event) ?? [];
    cur.push(cb);
    this.listeners.set(event, cur);
  }
  removeEventListener(event: string, cb: (e: MessageEvent) => void): void {
    const cur = this.listeners.get(event);
    if (!cur) return;
    const idx = cur.indexOf(cb);
    if (idx !== -1) cur.splice(idx, 1);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  /** Test-only helper: fire a `config` (or other named) event on this stream. */
  emit(event: string, data: string): void {
    const evt = new MessageEvent(event, { data });
    (this.listeners.get(event) ?? []).forEach((cb) => cb(evt));
  }
}

let originalEventSource: unknown;

export function installFakeEventSource(): void {
  fakeEventSources.length = 0;
  originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
}

export function uninstallFakeEventSource(): void {
  if (originalEventSource === undefined) {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  } else {
    (globalThis as { EventSource?: unknown }).EventSource =
      originalEventSource;
  }
  fakeEventSources.length = 0;
}
