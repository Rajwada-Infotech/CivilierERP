import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { findDuplicateShortCodes, suggestFreeShortCode, SHORT_CODE_MAX } from "./itemShortCodes";
import { DuplicateShortCodesPanel } from "./DuplicateShortCodesPanel";

const item = (id: string, name: string, shortCode: string) => ({ _id: id, itemName: name, shortCode, itemType: "Goods" });

describe("findDuplicateShortCodes", () => {
  it("groups items that share a code, ignoring case and spaces, and skips items without a code", () => {
    const groups = findDuplicateShortCodes([
      item("1", "Grey Cement", "A"),
      item("2", "White Cement", " a "),
      item("3", "Sand", "S"),
      item("4", "Gravel", ""),
      item("5", "Bricks", "   "),
      item("6", "Steel", "SC"),
      item("7", "Steel Wire", "sc"),
    ]);
    expect(groups.map((g) => [g.code, g.items.map((i) => i._id)])).toEqual([
      ["A", ["1", "2"]],
      ["SC", ["6", "7"]],
    ]);
  });

  it("finds nothing when every code is unique", () => {
    expect(findDuplicateShortCodes([item("1", "a", "A"), item("2", "b", "B")])).toEqual([]);
  });
});

describe("suggestFreeShortCode", () => {
  it("adds the first number nobody uses", () => {
    expect(suggestFreeShortCode("A", [item("1", "x", "A"), item("2", "y", "a2"), item("3", "z", "A3")])).toBe("A4");
    expect(suggestFreeShortCode("S", [item("1", "x", "S")])).toBe("S2");
  });

  it("stays inside the 20-character limit", () => {
    const long = "X".repeat(SHORT_CODE_MAX);
    const suggestion = suggestFreeShortCode(long, [item("1", "x", long)]);
    expect(suggestion.length).toBeLessThanOrEqual(SHORT_CODE_MAX);
    expect(suggestion).not.toBe(long);
    expect(suggestion.endsWith("2")).toBe(true);
  });
});

describe("DuplicateShortCodesPanel", () => {
  const items = [item("1", "Grey Cement", "A"), item("2", "White Cement", "A"), item("3", "Sand", "S")];

  it("shows nothing when there are no duplicates", () => {
    const { container } = render(<DuplicateShortCodesPanel items={[item("1", "x", "A"), item("2", "y", "B")]} canEdit onRename={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many codes are shared, and lists the items only once opened", () => {
    render(<DuplicateShortCodesPanel items={items} canEdit onRename={() => {}} />);
    expect(screen.getByText(/1 short code is/)).toBeInTheDocument();
    expect(screen.queryByText("Grey Cement")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(screen.getByText("Grey Cement")).toBeInTheDocument();
    expect(screen.getByText("White Cement")).toBeInTheDocument();
    expect(screen.queryByText("Sand")).not.toBeInTheDocument(); // unique code, not part of the problem
  });

  it("each shared item can be given a new code", () => {
    const onRename = vi.fn();
    render(<DuplicateShortCodesPanel items={items} canEdit onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /give it a new code/i })[1]);
    expect(onRename).toHaveBeenCalledWith("2");
  });

  it("without edit rights the list is shown but there is nothing to click", () => {
    render(<DuplicateShortCodesPanel items={items} canEdit={false} onRename={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(screen.queryByRole("button", { name: /give it a new code/i })).not.toBeInTheDocument();
  });
});
