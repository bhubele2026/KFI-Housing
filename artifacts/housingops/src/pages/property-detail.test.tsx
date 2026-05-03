import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";

import { InlineEdit, NotesEditor } from "./property-detail";

// These tests exercise the "snap-back on failed save" behavior of the two
// inline editors on Property Detail. The behavior they protect:
//
//   1. When the persisted `value` prop changes from the outside (e.g. an
//      optimistic patch is reverted because the server save failed), the
//      editor's local draft must resync to that new value. Otherwise the
//      typed text would silently linger and the user would see a "reverted"
//      toast while the field still showed their typed (unsaved) value.
//   2. When the parent re-renders with the SAME persisted value, the resync
//      effect must NOT call setState — that would cause flicker and wipe out
//      an in-progress draft.
//
// The data-store flow these tests mimic (see context/data-store.tsx):
//   - User commits a draft → onSave fires
//   - Store applies an optimistic patch → parent re-renders with NEW value
//   - Server save fails → store reverts → parent re-renders with ORIGINAL value
//   - The resync effect inside the editor must catch step 3 and reset draft.

// React tracks controlled-input values via a hidden `_valueTracker` property,
// so simply assigning `input.value = "x"` and firing an "input" event does
// NOT cause React to invoke onChange — React sees no change. The supported
// workaround is to call the native value setter, which clears the tracker.
function setReactInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("Could not get native value setter");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("NotesEditor — resync on persisted value change", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
  });

  function getTextarea(): HTMLTextAreaElement {
    const el = container.querySelector("textarea");
    if (!el) throw new Error("Could not find textarea");
    return el as HTMLTextAreaElement;
  }

  async function render(node: React.ReactElement) {
    await act(async () => {
      root = createRoot(container);
      root.render(node);
    });
  }

  async function rerender(node: React.ReactElement) {
    if (!root) throw new Error("Must render before rerender");
    const r = root;
    await act(async () => {
      r.render(node);
    });
  }

  it("renders the persisted value as the initial draft", async () => {
    await render(<NotesEditor value="hello" onSave={() => {}} />);
    expect(getTextarea().value).toBe("hello");
  });

  it("snaps the textarea back when an optimistic patch is reverted (failed save)", async () => {
    const onSave = vi.fn();
    await render(<NotesEditor value="original" onSave={onSave} />);
    expect(getTextarea().value).toBe("original");

    // User types — local draft diverges from persisted value.
    await act(async () => {
      setReactInputValue(getTextarea(), "user typed something");
    });
    expect(getTextarea().value).toBe("user typed something");

    // Step 1 of the optimistic flow: store applies the patch, parent
    // re-renders with the NEW value matching the draft. This is the
    // happy-path mid-state — no visible change to the textarea.
    await rerender(
      <NotesEditor value="user typed something" onSave={onSave} />,
    );
    expect(getTextarea().value).toBe("user typed something");

    // Step 2: server rejects the save, store reverts, parent re-renders
    // with the ORIGINAL value. The resync effect must fire here and snap
    // the textarea back to "original".
    await rerender(<NotesEditor value="original" onSave={onSave} />);
    expect(getTextarea().value).toBe("original");
  });

  it("does not flicker on a successful save (draft already matches new value)", async () => {
    await render(<NotesEditor value="v1" onSave={() => {}} />);

    // User types "v2".
    await act(async () => {
      setReactInputValue(getTextarea(), "v2");
    });
    expect(getTextarea().value).toBe("v2");

    // Successful save: parent re-renders with value="v2" (matches draft).
    // The textarea must continue to show "v2" — no glitch back to v1, no
    // intermediate empty state.
    await rerender(<NotesEditor value="v2" onSave={() => {}} />);
    expect(getTextarea().value).toBe("v2");
  });

  it("does not cause a render storm when re-rendered with an unchanged value", async () => {
    // Wrap the editor in a React Profiler so we count commits to the
    // EDITOR subtree itself (not the parent). If the resync effect were
    // calling setState on every render — i.e. the lastIncomingRef guard
    // were broken — every parent re-render would schedule an extra
    // editor-only commit and the count would exceed the parent commits.
    let editorCommits = 0;
    const onRender = () => {
      editorCommits += 1;
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <Profiler id="notes-editor" onRender={onRender}>
          <NotesEditor value="same" onSave={() => {}} />
        </Profiler>,
      );
    });
    const baseCommits = editorCommits;

    for (let i = 0; i < 5; i++) {
      await rerender(
        <Profiler id="notes-editor" onRender={onRender}>
          <NotesEditor value="same" onSave={() => {}} />
        </Profiler>,
      );
    }

    // Exactly 5 additional commits — one per parent re-render. A spurious
    // setDraft from the resync effect would schedule a follow-up commit
    // (or more) on top of each, pushing this number higher.
    expect(editorCommits).toBe(baseCommits + 5);
    expect(getTextarea().value).toBe("same");
  });

  it("flushes an unsaved draft through onSave on unmount (task #76)", async () => {
    // Notes draft protection: if the operator types into the textarea and
    // navigates away (component unmounts) before the field blurs, the
    // unmount cleanup must still call onSave so the optimistic patch +
    // server save fire. Otherwise the in-progress text is silently lost.
    const onSave = vi.fn();
    await render(<NotesEditor value="original" onSave={onSave} />);
    await act(async () => {
      setReactInputValue(getTextarea(), "in-progress note");
    });
    expect(onSave).not.toHaveBeenCalled();

    const r = root!;
    await act(async () => {
      r.unmount();
    });
    root = null;

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("in-progress note");
  });

  it("does NOT double-save on unmount when blur already saved the same draft", async () => {
    // Edge case from code review: if a blur-triggered save is in flight
    // (so `value` hasn't yet caught up to the saved draft) and the
    // component unmounts, the unmount cleanup must not re-fire an
    // identical save. The lastSavedDraftRef dedupe guard prevents this.
    const onSave = vi.fn();
    await render(<NotesEditor value="original" onSave={onSave} />);

    await act(async () => {
      setReactInputValue(getTextarea(), "edited once");
    });
    await act(async () => {
      // React 18+ delegates focus/blur via the bubbling `focusout` event at
      // the root listener, so a non-bubbling `blur` Event won't fire the
      // onBlur prop. Dispatch `focusout` (which bubbles) instead.
      getTextarea().dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("edited once");

    // Unmount before the parent re-renders with the persisted value. The
    // unmount flush must NOT call onSave again with the identical draft.
    const r = root!;
    await act(async () => {
      r.unmount();
    });
    root = null;

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onSave on unmount when the draft was never edited", async () => {
    const onSave = vi.fn();
    await render(<NotesEditor value="hello" onSave={onSave} />);

    const r = root!;
    await act(async () => {
      r.unmount();
    });
    root = null;

    expect(onSave).not.toHaveBeenCalled();
  });

  it("warns on beforeunload while the draft is dirty (task #76)", async () => {
    await render(<NotesEditor value="original" onSave={() => {}} />);

    // Clean state — beforeunload should NOT prompt.
    const cleanEvent = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    // User types — draft becomes dirty.
    await act(async () => {
      setReactInputValue(getTextarea(), "unsaved typing");
    });

    const dirtyEvent = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it("preserves an in-progress draft across re-renders that do not change value", async () => {
    // Critical: the lastIncomingRef guard is what stops the effect from
    // overwriting the user's typing when the parent re-renders for an
    // unrelated reason (e.g. data-store update for some other property).
    await render(<NotesEditor value="hello" onSave={() => {}} />);

    await act(async () => {
      setReactInputValue(getTextarea(), "I am still typing...");
    });
    expect(getTextarea().value).toBe("I am still typing...");

    // Parent re-renders 3 times with the SAME value. Draft must survive.
    for (let i = 0; i < 3; i++) {
      await rerender(<NotesEditor value="hello" onSave={() => {}} />);
    }

    expect(getTextarea().value).toBe("I am still typing...");
  });
});

describe("InlineEdit — resync on persisted value change", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
  });

  async function render(node: React.ReactElement) {
    await act(async () => {
      root = createRoot(container);
      root.render(node);
    });
  }

  async function rerender(node: React.ReactElement) {
    if (!root) throw new Error("Must render before rerender");
    const r = root;
    await act(async () => {
      r.render(node);
    });
  }

  function getCollapsedText(): string {
    // The collapsed view is a wrapping span with class "group" containing
    // an inner span with the visible text.
    const wrapper = container.querySelector(".group");
    if (!wrapper) throw new Error("Could not find collapsed InlineEdit wrapper");
    const inner = wrapper.querySelector("span");
    if (!inner) throw new Error("Could not find inner text span");
    return inner.textContent ?? "";
  }

  function getInput(): HTMLInputElement | null {
    return container.querySelector("input");
  }

  function requireInput(label: string): HTMLInputElement {
    const el = container.querySelector("input");
    if (!el) throw new Error(`Editor input did not appear (${label})`);
    return el as HTMLInputElement;
  }

  async function openEditor() {
    const wrapper = container.querySelector(".group") as HTMLElement | null;
    if (!wrapper) throw new Error("Could not find collapsed InlineEdit wrapper");
    await act(async () => {
      wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function pressEnter(input: HTMLInputElement) {
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  }

  it("collapsed view always reflects the persisted value", async () => {
    // The collapsed display reads `value` directly (not draft), so it
    // already snaps back on its own. Lock that contract down so a future
    // refactor that switches it to read from `draft` would fail loudly.
    await render(<InlineEdit value="123 Main St" onSave={() => {}} />);
    expect(getCollapsedText()).toBe("123 Main St");

    await rerender(<InlineEdit value="456 Oak Ave" onSave={() => {}} />);
    expect(getCollapsedText()).toBe("456 Oak Ave");

    await rerender(<InlineEdit value="123 Main St" onSave={() => {}} />);
    expect(getCollapsedText()).toBe("123 Main St");
  });

  it("next-opened editor draft reflects the persisted value after a failed save", async () => {
    // This is the core regression this whole test file guards against.
    const onSave = vi.fn();
    await render(<InlineEdit value="apple" onSave={onSave} />);

    // User edits and commits "banana".
    await openEditor();
    const input = requireInput("first open");
    await act(async () => {
      setReactInputValue(input, "banana");
    });
    await pressEnter(input);
    expect(onSave).toHaveBeenCalledWith("banana");

    // Step 1 of optimistic flow: store applies the patch, parent
    // re-renders with NEW value. lastIncomingRef advances to "banana".
    await rerender(<InlineEdit value="banana" onSave={onSave} />);
    expect(getCollapsedText()).toBe("banana");

    // Step 2: server fails, store reverts. Parent re-renders with the
    // original value. The resync effect MUST detect that incoming
    // ("apple") differs from lastIncomingRef ("banana") and reset draft.
    await rerender(<InlineEdit value="apple" onSave={onSave} />);
    expect(getCollapsedText()).toBe("apple");

    // The user opens the editor again. The draft inside the input must
    // be "apple" (the persisted value), NOT "banana" (the previously
    // typed value that didn't save).
    await openEditor();
    const reopenedInput = requireInput("second open");
    expect(reopenedInput.value).toBe("apple");
  });

  it("next-opened editor draft reflects a successful save's new value", async () => {
    const onSave = vi.fn();
    await render(<InlineEdit value="v1" onSave={onSave} />);

    await openEditor();
    const input = requireInput("first open");
    await act(async () => {
      setReactInputValue(input, "v2");
    });
    await pressEnter(input);
    expect(onSave).toHaveBeenCalledWith("v2");

    // Successful save: persisted value settles to "v2".
    await rerender(<InlineEdit value="v2" onSave={onSave} />);
    expect(getCollapsedText()).toBe("v2");

    // Reopen — draft should be "v2" (carried over from the save).
    await openEditor();
    const inputAfter = requireInput("reopen");
    expect(inputAfter.value).toBe("v2");
  });

  it("does not cause a render storm when re-rendered with an unchanged value", async () => {
    // Same Profiler-based instrumentation as the NotesEditor test: count
    // commits to the editor subtree directly, so a spurious setDraft from
    // the resync effect would manifest as more commits than parent
    // re-renders.
    let editorCommits = 0;
    const onRender = () => {
      editorCommits += 1;
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <Profiler id="inline-edit" onRender={onRender}>
          <InlineEdit value="same" onSave={() => {}} />
        </Profiler>,
      );
    });
    const baseCommits = editorCommits;

    for (let i = 0; i < 5; i++) {
      await rerender(
        <Profiler id="inline-edit" onRender={onRender}>
          <InlineEdit value="same" onSave={() => {}} />
        </Profiler>,
      );
    }

    expect(editorCommits).toBe(baseCommits + 5);
    expect(getCollapsedText()).toBe("same");
  });

  it("preserves an in-progress draft across re-renders that do not change value", async () => {
    // Without the lastIncomingRef guard, the effect would call
    // setDraft(String(value)) on every render and wipe the user's typing
    // whenever the parent re-rendered for unrelated reasons.
    await render(<InlineEdit value="hello" onSave={() => {}} />);
    await openEditor();
    const input = getInput();
    if (!input) throw new Error("Editor input did not appear");

    await act(async () => {
      setReactInputValue(input, "hello world");
    });
    expect(input.value).toBe("hello world");

    // Parent re-renders 3 times with the same value. The user's
    // in-progress draft must survive.
    for (let i = 0; i < 3; i++) {
      await rerender(<InlineEdit value="hello" onSave={() => {}} />);
    }

    const inputAfter = container.querySelector("input") as HTMLInputElement;
    expect(inputAfter.value).toBe("hello world");
  });

  it("handles numeric values: a reverted save snaps the next-open editor back", async () => {
    // The Property Detail page passes both string and numeric values into
    // InlineEdit. The component coerces with String(value), so the same
    // resync logic must work for numbers.
    const onSave = vi.fn();
    await render(<InlineEdit value={100} onSave={onSave} type="number" />);
    expect(getCollapsedText()).toBe("100");

    await openEditor();
    const input = requireInput("first open");
    await act(async () => {
      setReactInputValue(input, "250");
    });
    await pressEnter(input);
    expect(onSave).toHaveBeenCalledWith("250");

    // Optimistic patch then revert.
    await rerender(<InlineEdit value={250} onSave={onSave} type="number" />);
    expect(getCollapsedText()).toBe("250");

    await rerender(<InlineEdit value={100} onSave={onSave} type="number" />);
    expect(getCollapsedText()).toBe("100");

    // Reopen — draft must be "100", not "250".
    await openEditor();
    const inputAfter = requireInput("reopen");
    expect(inputAfter.value).toBe("100");
  });
});

describe("module exports", () => {
  it("exports InlineEdit and NotesEditor as functions", () => {
    // Sanity check: if these become undefined (e.g. someone removes the
    // `export` keyword from one of them), every test above would fail
    // confusingly. This test fails first and explains why.
    expect(typeof InlineEdit).toBe("function");
    expect(typeof NotesEditor).toBe("function");
  });
});
