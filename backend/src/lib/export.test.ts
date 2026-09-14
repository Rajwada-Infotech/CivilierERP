import { describe, expect, it } from "vitest";
import { parseCsv } from "./export";

describe("parseCsv", () => {
  it("parses a simple header + row CSV into objects keyed by header", () => {
    const csv = "Name,Code\nCement,CEM-01\nBricks,BRK-01";
    expect(parseCsv(csv)).toEqual([
      { Name: "Cement", Code: "CEM-01" },
      { Name: "Bricks", Code: "BRK-01" },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Name,Description\nCement,"Grade A, 53 type"';
    expect(parseCsv(csv)).toEqual([
      { Name: "Cement", Description: "Grade A, 53 type" },
    ]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const csv = 'Name,Description\nCement,"Brand ""SuperMix"" cement"';
    expect(parseCsv(csv)).toEqual([
      { Name: "Cement", Description: 'Brand "SuperMix" cement' },
    ]);
  });

  it("handles CRLF line endings", () => {
    const csv = "Name,Code\r\nCement,CEM-01\r\nBricks,BRK-01";
    expect(parseCsv(csv)).toEqual([
      { Name: "Cement", Code: "CEM-01" },
      { Name: "Bricks", Code: "BRK-01" },
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    const csv = "\uFEFFName,Code\nCement,CEM-01";
    expect(parseCsv(csv)).toEqual([{ Name: "Cement", Code: "CEM-01" }]);
  });

  it("ignores trailing blank lines", () => {
    const csv = "Name,Code\nCement,CEM-01\n\n";
    expect(parseCsv(csv)).toEqual([{ Name: "Cement", Code: "CEM-01" }]);
  });

  it("trims whitespace around header and cell values", () => {
    const csv = " Name , Code \n Cement , CEM-01 ";
    expect(parseCsv(csv)).toEqual([{ Name: "Cement", Code: "CEM-01" }]);
  });

  it("fills missing trailing cells with an empty string", () => {
    const csv = "Name,Code,Type\nCement,CEM-01";
    expect(parseCsv(csv)).toEqual([
      { Name: "Cement", Code: "CEM-01", Type: "" },
    ]);
  });

  it("returns an empty array for header-only CSV", () => {
    const csv = "Name,Code";
    expect(parseCsv(csv)).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles a multi-line quoted field", () => {
    const csv = 'Name,Description\nCement,"Line one\nLine two"';
    expect(parseCsv(csv)).toEqual([
      { Name: "Cement", Description: "Line one\nLine two" },
    ]);
  });
});
