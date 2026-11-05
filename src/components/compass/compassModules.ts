import type React from "react";
import { ModuleIcons } from "@/components/icons/moduleIcons";
import { ALL_MODULES } from "@/components/layout/moduleDefs";

export interface CompassModuleLook {
  Icon: React.ElementType;
  color: string;
}

// The same Tabler icon and module colour the module strip and sidebars use, so a page reads as belonging to the same
// module everywhere. DBA and Super Admin aren't on the strip, so they get their own icons in ink.
const BY_ID = new Map<string, CompassModuleLook>(ALL_MODULES.map((m) => [m.id as string, { Icon: m.icon, color: m.color }]));
const EXTRA: Record<string, CompassModuleLook> = {
  dba: { Icon: ModuleIcons.dba, color: "hsl(var(--foreground))" },
  super_admin: { Icon: ModuleIcons.superAdmin, color: "hsl(var(--foreground))" },
};
const FALLBACK: CompassModuleLook = { Icon: ModuleIcons.records, color: "hsl(var(--muted-foreground))" };

export function moduleLook(moduleId: string): CompassModuleLook {
  return BY_ID.get(moduleId) ?? EXTRA[moduleId] ?? FALLBACK;
}
