import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchableNativeSelect } from "./SearchableNativeSelect";

// Shaped like the Payment form's Payee / Party picker: a blank choice, then parties grouped by kind.
function PartyPicker({ value = "", onChange = () => {} }: { value?: string; onChange?: (e: { target: { value: string } }) => void }) {
  return (
    <SearchableNativeSelect value={value} searchPlaceholder="Search party…" onChange={onChange as never}>
      <option value="">Select party…</option>
      <optgroup label="Vendors">
        <option value="11">Sharma Traders</option>
        <option value="12">Bista Departmental Stores</option>
      </optgroup>
      <optgroup label="Contractors">
        <option value="21">Anand Enterprises</option>
        <option value="22">Sharma Construction</option>
      </optgroup>
    </SearchableNativeSelect>
  );
}

const open = () => fireEvent.click(screen.getByRole("button"));

describe("a grouped picker with a search bar (Payee / Party)", () => {
  it("opens with a search box and the whole list", () => {
    render(<PartyPicker />);
    open();
    expect(screen.getByPlaceholderText("Search party…")).toBeInTheDocument();
    expect(screen.getByText(/Sharma Traders/)).toBeInTheDocument();
    expect(screen.getByText(/Anand Enterprises/)).toBeInTheDocument();
  });

  it("typing narrows the list to the matching parties, across groups", () => {
    render(<PartyPicker />);
    open();
    fireEvent.change(screen.getByPlaceholderText("Search party…"), { target: { value: "sharma" } });
    expect(screen.getByText(/Sharma Traders/)).toBeInTheDocument();
    expect(screen.getByText(/Sharma Construction/)).toBeInTheDocument();
    expect(screen.queryByText(/Bista Departmental/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Anand Enterprises/)).not.toBeInTheDocument();
  });

  it("the search also matches the group name", () => {
    render(<PartyPicker />);
    open();
    fireEvent.change(screen.getByPlaceholderText("Search party…"), { target: { value: "contractors" } });
    expect(screen.getByText(/Anand Enterprises/)).toBeInTheDocument();
    expect(screen.queryByText(/Sharma Traders/)).not.toBeInTheDocument();
  });

  it("choosing a party reports its id the way a native select does", () => {
    const onChange = vi.fn();
    render(<PartyPicker onChange={onChange} />);
    open();
    fireEvent.change(screen.getByPlaceholderText("Search party…"), { target: { value: "bista" } });
    fireEvent.click(screen.getByText(/Bista Departmental/));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("12");
  });

  it("a search with no match says so instead of showing a blank list", () => {
    render(<PartyPicker />);
    open();
    fireEvent.change(screen.getByPlaceholderText("Search party…"), { target: { value: "zzzz" } });
    expect(screen.queryByText(/Sharma Traders/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Anand Enterprises/)).not.toBeInTheDocument();
  });
});
