import { createLucideIcon, type LucideProps } from "lucide-react";

/**
 * lucide's "timeline" icon isn't in the installed lucide-react (0.571) yet —
 * recreated here from the official icon node so it behaves like any other
 * lucide icon (size / color / stroke props). Shared by the Civil Work DPR
 * module rail (ModuleStrip) and sidebar header (AppSidebar).
 * Source: https://lucide.dev/icons/timeline
 */
const TimelineBase = createLucideIcon("Timeline", [
  ["path", { d: "M4 12h.01", key: "t1" }],
  ["path", { d: "M4 16h.01", key: "t2" }],
  ["path", { d: "M4 20h.01", key: "t3" }],
  ["path", { d: "M4 4h.01", key: "t4" }],
  ["path", { d: "M4 8h.01", key: "t5" }],
  [
    "path",
    {
      d: "M9.414 13.414a2 2 0 0 0 1.414.586H19a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-8.172a2 2 0 0 0-1.414.586L8 12z",
      key: "t6",
    },
  ],
  [
    "path",
    {
      d: "M9.414 21.414a2 2 0 0 0 1.414.586H19a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-8.172a2 2 0 0 0-1.414.586L8 20z",
      key: "t7",
    },
  ],
  [
    "path",
    {
      d: "M9.414 5.414A2 2 0 0 0 10.828 6H19a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-8.172a2 2 0 0 0-1.414.586L8 4z",
      key: "t8",
    },
  ],
]);

/**
 * Wrapper that also accepts (and ignores) iconsax's `variant` prop, so it's a
 * drop-in for the module-icon slots that render both icon libraries — the same
 * shim pattern ModuleStrip already uses for its lucide HardHat / Wrench icons.
 */
export function TimelineIcon({
  variant,
  ...props
}: LucideProps & { variant?: string }) {
  void variant;
  return <TimelineBase {...props} />;
}
