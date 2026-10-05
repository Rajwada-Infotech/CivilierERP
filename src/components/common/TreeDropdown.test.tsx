import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
  isLightTheme: () => false,
}));

import TreeDropdown from "./TreeDropdown";

const OPTIONS = [
  { value: "Vendor", label: "Vendor" },
  { value: "Supplier", label: "Supplier" },
  { value: "Landlord", label: "Landlord" },
];

function Harness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = React.useState("");
  return (
    <TreeDropdown
      variant="flat"
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
      options={OPTIONS}
      placeholder="Select type…"
    />
  );
}

beforeEach(() => {
  // jsdom has no layout; give the trigger a real-looking box so positioning has numbers to work with.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 40, y: 300, left: 40, top: 300, right: 300, bottom: 340, width: 260, height: 40, toJSON: () => ({}),
  } as DOMRect);
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof window.requestAnimationFrame;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TreeDropdown opening must not move the page", () => {
  it("focuses the search box with preventScroll, so the browser never scrolls to it", async () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
    render(<Harness />);
    fireEvent.click(screen.getByText("Select type…"));
    await waitFor(() => expect(focus).toHaveBeenCalled());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("never puts the panel on the page without a fixed position (an unpositioned panel sits at the end of the page)", async () => {
    // Record the panel's style at the very moment it is inserted into <body> (not afterwards,
    // when React has long since positioned it).
    const seen: { position: string; visibility: string }[] = [];
    const realAppend = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, node: Node) {
      const el = node as HTMLElement;
      if (this === document.body && el.nodeType === 1 && el.querySelector?.("input[placeholder='Search…']")) {
        seen.push({ position: el.style.position, visibility: el.style.visibility });
      }
      return realAppend.call(this, node) as typeof node;
    } as typeof Node.prototype.appendChild);
    render(<Harness />);
    fireEvent.click(screen.getByText("Select type…"));
    await screen.findByPlaceholderText("Search…");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].position).toBe("fixed"); // fixed from its first moment in the document
  });

  it("is positioned under the trigger and visible once open", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Select type…"));
    const input = await screen.findByPlaceholderText("Search…");
    const panel = input.closest("div[style*='position: fixed']") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.style.top).toBe("344px"); // trigger bottom (340) + 4
    expect(panel.style.left).toBe("40px");
    expect(panel.style.visibility).not.toBe("hidden");
  });
});

describe("TreeDropdown still behaves", () => {
  it("selects an option, reports it and closes", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByText("Select type…"));
    fireEvent.click(await screen.findByText("Landlord"));
    expect(onChange).toHaveBeenCalledWith("Landlord");
    await waitFor(() => expect(screen.queryByPlaceholderText("Search…")).toBeNull());
    expect(screen.getByText("Landlord")).toBeTruthy(); // now shown on the trigger
  });

  it("filters options as you type, with a clear 'No matches' state", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Select type…"));
    const input = await screen.findByPlaceholderText("Search…");
    fireEvent.change(input, { target: { value: "sup" } });
    expect(screen.getByText("Supplier")).toBeTruthy();
    expect(screen.queryByText("Landlord")).toBeNull();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("closes when you click outside it", async () => {
    render(
      <div>
        <Harness />
        <p>elsewhere</p>
      </div>,
    );
    fireEvent.click(screen.getByText("Select type…"));
    await screen.findByPlaceholderText("Search…");
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Search…")).toBeNull());
  });

  it("starts each opening with an empty search", async () => {
    render(<Harness />);
    const trigger = screen.getByText("Select type…");
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByPlaceholderText("Search…"), { target: { value: "sup" } });
    fireEvent.click(trigger); // close
    await waitFor(() => expect(screen.queryByPlaceholderText("Search…")).toBeNull());
    fireEvent.click(trigger);
    expect((await screen.findByPlaceholderText("Search…") as HTMLInputElement).value).toBe("");
  });
});
