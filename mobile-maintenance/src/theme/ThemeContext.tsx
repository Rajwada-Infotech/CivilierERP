// Dynamic brand theme context — dark/light mode + accent colour picker.
// Wraps the customer portal so every screen can call useBrand() instead of
// importing the static `brand` object directly, enabling live theme switching.
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---------------------------------------------------------------------------
// Accent palette
// ---------------------------------------------------------------------------
export const ACCENTS = {
  gold:    { key: "gold",    hex: "#C9A227", label: "Gold" },
  violet:  { key: "violet",  hex: "#8B5CF6", label: "Violet" },
  emerald: { key: "emerald", hex: "#10B981", label: "Emerald" },
  sky:     { key: "sky",     hex: "#0EA5E9", label: "Sky" },
  rose:    { key: "rose",    hex: "#F43F5E", label: "Rose" },
} as const;
export type AccentKey = keyof typeof ACCENTS;

// ---------------------------------------------------------------------------
// Brand token shape (matches static brand object in colors.ts)
// ---------------------------------------------------------------------------
export type BrandTokens = {
  heroFrom: string; heroMid: string; heroTo: string;
  gold: string; goldLight: string; goldSoft: string;
  surface: string; surfaceCard: string; surfaceGlass: string;
  textPrimary: string; textSecondary: string; textFaint: string;
  success: string; successSoft: string;
  warning: string; warningSoft: string;
  danger: string; dangerSoft: string;
  border: string; borderGold: string;
  // convenience
  accent: string; accentSoft: string; accentBorder: string;
  /** Light → accent → deep: the fill for primary buttons and avatars (LinearGradient colors). */
  accentGradient: readonly [string, string, string];
  /** The page colour, see-through: the floating glass top bar (and anything else laid over scrolling content). */
  chrome: string;
  isDark: boolean;
};

function hex2rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The accent made lighter (t > 0, towards white) or deeper (t < 0, towards black). */
function shade(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => { const c = (n >> s) & 255; return Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)); };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

// Surfaces step up in lightness instead of being outlined (tonal elevation): page → card → raised.
// The home card (hero*) is always deep, in both modes — like a premium bank card — so its text is always light.
function buildTokens(mode: "dark" | "light", accentKey: AccentKey): BrandTokens {
  const accent = ACCENTS[accentKey].hex;
  const isDark  = mode === "dark";
  const accentGradient = [shade(accent, 0.28), accent, shade(accent, -0.22)] as const;
  const hero = {
    // The deep purple gradient (the user's choice, 2026-11-18) — the same in light and dark, so its text is always light.
    heroFrom: "#0F0C29", heroMid: "#1A1448", heroTo: "#302B63",
  };

  if (isDark) {
    return {
      ...hero, accentGradient,
      gold: accent, goldLight: accent, goldSoft: hex2rgba(accent, 0.14),
      surface: "#0B0B10", chrome: hex2rgba("#0B0B10", 0.72), surfaceCard: "#16161E", surfaceGlass: "rgba(255,255,255,0.07)",
      textPrimary: "#F5F5F7", textSecondary: "rgba(245,245,247,0.62)", textFaint: "rgba(245,245,247,0.38)",
      success: "#34D399", successSoft: "rgba(52,211,153,0.14)",
      warning: "#FBBF24", warningSoft: "rgba(251,191,36,0.14)",
      danger: "#F87171", dangerSoft: "rgba(248,113,113,0.14)",
      border: "rgba(255,255,255,0.07)", borderGold: hex2rgba(accent, 0.35),
      accent, accentSoft: hex2rgba(accent, 0.14), accentBorder: hex2rgba(accent, 0.35),
      isDark: true,
    };
  }
  return {
    ...hero, accentGradient,
    gold: accent, goldLight: accent, goldSoft: hex2rgba(accent, 0.13),
    surface: "#F2F3F6", chrome: hex2rgba("#F2F3F6", 0.76), surfaceCard: "#FFFFFF", surfaceGlass: "rgba(15,17,26,0.05)",
    textPrimary: "#0F111A", textSecondary: "rgba(15,17,26,0.62)", textFaint: "rgba(15,17,26,0.38)",
    success: "#059669", successSoft: "rgba(5,150,105,0.11)",
    warning: "#B45309", warningSoft: "rgba(180,83,9,0.10)",
    danger: "#DC2626", dangerSoft: "rgba(220,38,38,0.10)",
    border: "rgba(15,17,26,0.07)", borderGold: hex2rgba(accent, 0.4),
    accent, accentSoft: hex2rgba(accent, 0.13), accentBorder: hex2rgba(accent, 0.4),
    isDark: false,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
type ThemeCtx = {
  mode: "dark" | "light";
  accentKey: AccentKey;
  brand: BrandTokens;
  toggleMode: () => void;
  setAccent: (key: AccentKey) => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

const STORAGE_MODE   = "civ_theme_mode";
const STORAGE_ACCENT = "civ_theme_accent";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode,      setMode]      = useState<"dark" | "light">("dark");
  const [accentKey, setAccentKey] = useState<AccentKey>("gold");

  // Load persisted prefs on mount
  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_MODE, STORAGE_ACCENT]).then((pairs) => {
      const m = pairs[0][1];
      const a = pairs[1][1];
      if (m === "dark" || m === "light") setMode(m);
      if (a && a in ACCENTS) setAccentKey(a as AccentKey);
    });
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      AsyncStorage.setItem(STORAGE_MODE, next);
      return next;
    });
  }, []);

  const setAccent = useCallback((key: AccentKey) => {
    setAccentKey(key);
    AsyncStorage.setItem(STORAGE_ACCENT, key);
  }, []);

  const brand = useMemo(() => buildTokens(mode, accentKey), [mode, accentKey]);

  return (
    <ThemeContext.Provider value={{ mode, accentKey, brand, toggleMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Returns the current dynamic brand token set. Use instead of the static `brand` import in customer screens. */
export function useBrand(): BrandTokens {
  const ctx = useContext(ThemeContext);
  if (!ctx) return buildTokens("dark", "gold"); // fallback outside provider
  return ctx.brand;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
