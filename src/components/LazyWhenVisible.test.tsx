import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { LazyWhenVisible } from "./LazyWhenVisible";

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let callback: Callback;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  observe.mockReset();
  disconnect.mockReset();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LazyWhenVisible", () => {
  it("holds the space but renders nothing until it scrolls into view", () => {
    const { container } = render(
      <LazyWhenVisible minHeight={300}>
        <p>heavy panel</p>
      </LazyWhenVisible>,
    );
    expect(screen.queryByText("heavy panel")).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.minHeight).toBe("300px");
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("renders the content when it comes into view, and stops watching", () => {
    render(
      <LazyWhenVisible>
        <p>heavy panel</p>
      </LazyWhenVisible>,
    );
    act(() => callback([{ isIntersecting: false }]));
    expect(screen.queryByText("heavy panel")).not.toBeInTheDocument();
    act(() => callback([{ isIntersecting: true }]));
    expect(screen.getByText("heavy panel")).toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
  });

  it("renders straight away where IntersectionObserver does not exist", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <LazyWhenVisible>
        <p>heavy panel</p>
      </LazyWhenVisible>,
    );
    expect(screen.getByText("heavy panel")).toBeInTheDocument();
  });
});
