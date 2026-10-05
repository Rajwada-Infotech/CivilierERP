import { MODULE_SHORTCUTS } from "@/hooks/useGlobalShortcuts";

// What the Shift+C+S cheatsheet shows. Module switches are generated from
// MODULE_SHORTCUTS so they can't drift from what the keys actually do; the
// rest mirror the app-wide hotkeys in useGlobalShortcuts.ts / CompassProvider /
// DocFinderProvider. Add a row here whenever a new global shortcut is added.

export interface ShortcutRow {
  /** Keys shown as separate caps, in press order. */
  keys: string[];
  /** How the keys combine: "+" = held together, "then" = one after the other. */
  joiner?: "+" | "then";
  label: string;
  hint?: string;
}

export interface ShortcutGroup {
  title: string;
  note?: string;
  rows: ShortcutRow[];
}

export const GENERAL_SHORTCUTS: ShortcutGroup = {
  title: "Anywhere in the app",
  rows: [
    { keys: ["Enter", "Space"], label: "Find a page", hint: "Hold Enter, tap Space" },
    { keys: ["Alt", "Shift", "D"], label: "Find a document by number" },
    { keys: ["Space", "C"], label: "Calculator", hint: "Hold Space, press C" },
    { keys: ["Ctrl", "B"], label: "Show or hide the sidebar", hint: "⌘ B on Mac" },
    { keys: ["Shift", "C", "S"], label: "This cheatsheet", hint: "Hold Shift, press C and S" },
  ],
};

export const MODULE_SWITCH_SHORTCUTS: ShortcutGroup = {
  title: "Switch module",
  note: "Hold Shift and press the key. Only modules you have access to respond.",
  rows: MODULE_SHORTCUTS.map((s) => ({ keys: ["Shift", s.keyLabel], label: s.label })),
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [GENERAL_SHORTCUTS, MODULE_SWITCH_SHORTCUTS];
