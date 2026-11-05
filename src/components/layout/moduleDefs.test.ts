import { describe, expect, it } from "vitest";
import { ADMIN_MODULE, ALL_MODULES, MODULES, hexToHsl } from "./moduleDefs";

// The desktop module strip, the top bar and the mobile nav all read this one list.
describe("shared module list", () => {
  it("every module has a unique id and a name, icon and colour", () => {
    const ids = ALL_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ALL_MODULES) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.icon).toBeTruthy();
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("each module's glow RGB matches its colour (they can't drift apart)", () => {
    for (const m of ALL_MODULES) {
      const n = parseInt(m.color.slice(1), 16);
      expect(m.ringRgb).toBe(`${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    }
  });

  it("Records stays last of the regular modules and Admin comes after them", () => {
    expect(MODULES[MODULES.length - 1].id).toBe("records");
    expect(ALL_MODULES[ALL_MODULES.length - 1]).toBe(ADMIN_MODULE);
  });

  it("includes HR and Payroll — the mobile nav used to leave it out", () => {
    expect(ALL_MODULES.map((m) => m.id)).toContain("hr-payroll");
  });

  it("is called Follow-Up, as on the desktop strip (mobile said 'Follow Up')", () => {
    expect(ALL_MODULES.find((m) => m.id === "followup")?.label).toBe("Follow-Up");
  });
});

describe("hexToHsl", () => {
  it("matches the colours the top bar used to hard-code", () => {
    expect(hexToHsl("#6366f1")).toEqual({ h: 239, s: 84, l: 67 });
    expect(hexToHsl("#10b981")).toEqual({ h: 160, s: 84, l: 39 });
    expect(hexToHsl("#0d9488")).toEqual({ h: 175, s: 84, l: 32 });
    expect(hexToHsl("#e11d48")).toEqual({ h: 347, s: 77, l: 50 });
  });

  it("handles greys", () => {
    expect(hexToHsl("#808080")).toEqual({ h: 0, s: 0, l: 50 });
  });
});
