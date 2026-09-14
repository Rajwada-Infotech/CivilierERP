import {
  Laptop, Monitor, Smartphone, Printer, ScanLine, Armchair, Car, Settings2, Package,
} from "lucide-react";

// Seed list — DepreciationSetup is the actual source of truth for what
// categories exist in practice; this is only the starting menu shown before
// any rate has been configured, and the fallback if none are Active yet.
export const ASSET_CATEGORIES = [
  "Laptop", "Desktop", "Mobile Phone", "Printer", "Scanner",
  "Furniture", "Vehicle", "Machinery", "Other",
];

export const CATEGORY_ICONS: Record<string, React.ElementType> = {
  Laptop:         Laptop,
  Desktop:        Monitor,
  "Mobile Phone": Smartphone,
  Printer:        Printer,
  Scanner:        ScanLine,
  Furniture:      Armchair,
  Vehicle:        Car,
  Machinery:      Settings2,
  Other:          Package,
};

export const CATEGORY_COLORS: Record<string, string> = {
  Laptop:         "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Desktop:        "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "Mobile Phone": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Printer:        "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Scanner:        "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  Furniture:      "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  Vehicle:        "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  Machinery:      "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  Other:          "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};
