import { Cpu, Tag, ArrowSwapHorizontal, Import, UserTag, ShieldTick, Setting2, Barcode, Calculator } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const fixedAssetNavItems: NavItem[] = [
  { label: "Dashboard", icon: Cpu, path: "/fixed-asset", isDashboard: true },
  { label: "Depreciation Tag", icon: Cpu, path: "/fixed-asset/record", pageKey: "fixed-asset-record" },
  { label: "FA Inventory", icon: Tag, path: "/fixed-asset/tagging", pageKey: "fixed-asset-tagging" },
  { label: "FA Code Stickers", icon: Barcode, path: "/fixed-asset/depreciation-tag-stickers", pageKey: "fixed-asset-tagging" },
  { label: "Inventory Import", icon: Import, path: "/fixed-asset/inventory-import", pageKey: "fixed-asset-inventory-import" },
  { label: "Assignment", icon: UserTag, path: "/fixed-asset/assignment", pageKey: "fixed-asset-assignment" },
  { label: "Asset Transfer", icon: ArrowSwapHorizontal, path: "/fixed-asset/transfer", pageKey: "asset-transfer" },
  { label: "Quality Check", icon: ShieldTick, path: "/fixed-asset/quality-check", pageKey: "fixed-asset-quality-check" },
  { label: "Maintenance & Repair", icon: Setting2, path: "/fixed-asset/maintenance", pageKey: "fixed-asset-maintenance" },
  { label: "Depreciation Run", icon: Calculator, path: "/fixed-asset/depreciation-generate", pageKey: "fixed-asset-depreciation-generate" },
];
