import { Cpu, Tag, ArrowSwapHorizontal, UserTag, ShieldTick, Setting2, Barcode, Calculator } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Fixed Asset Module Sidebar:
//   Sidebar  = Daily asset workflows (tagging, inventory, transfer, maintenance, depreciation generation).
//   Setup    = Depreciation Setup, ID Template Master, Inventory Import (in setupMenus.ts).

export const fixedAssetNavItems: NavItem[] = [
  { label: "Dashboard", icon: Cpu, path: "/fixed-asset", isDashboard: true },
  { label: "Asset Tagging", icon: Cpu, path: "/fixed-asset/record", pageKey: "fixed-asset-record" },
  { label: "Asset Inventory", icon: Tag, path: "/fixed-asset/tagging", pageKey: "fixed-asset-tagging" },
  { label: "Barcode Stickers", icon: Barcode, path: "/fixed-asset/depreciation-tag-stickers", pageKey: "fixed-asset-tagging" },
  { label: "Asset Assignment", icon: UserTag, path: "/fixed-asset/assignment", pageKey: "fixed-asset-assignment" },
  { label: "Asset Transfer", icon: ArrowSwapHorizontal, path: "/fixed-asset/transfer", pageKey: "asset-transfer" },
  { label: "Quality Inspection", icon: ShieldTick, path: "/fixed-asset/quality-check", pageKey: "fixed-asset-quality-check" },
  { label: "Maintenance & Repair", icon: Setting2, path: "/fixed-asset/maintenance", pageKey: "fixed-asset-maintenance" },
  { label: "Generate Depreciation", icon: Calculator, path: "/fixed-asset/depreciation-generate", pageKey: "fixed-asset-depreciation-generate" },
];
