import { Cpu, Tag, ArrowSwapHorizontal, UserTag, ShieldTick, Setting2, Barcode, Calculator } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Fixed Asset Module Sidebar:
//   Sidebar  = Daily asset workflows (tagging, inventory, transfer, maintenance, depreciation generation).
//   Setup    = Depreciation Setup, ID Template Master, Inventory Import (in setupMenus.ts).

export const fixedAssetNavItems: NavItem[] = [
  { label: "Dashboard", icon: Cpu, path: "/fixed-asset", isDashboard: true },
  { label: "Depreciation Tag", icon: Cpu, path: "/fixed-asset/record", pageKey: "fixed-asset-record" },
  { label: "FA Inventory", icon: Tag, path: "/fixed-asset/tagging", pageKey: "fixed-asset-tagging" },
  { label: "FA Code Stickers", icon: Barcode, path: "/fixed-asset/depreciation-tag-stickers", pageKey: "fixed-asset-tagging" },
  { label: "Assignment", icon: UserTag, path: "/fixed-asset/assignment", pageKey: "fixed-asset-assignment" },
  { label: "Asset Transfer", icon: ArrowSwapHorizontal, path: "/fixed-asset/transfer", pageKey: "asset-transfer" },
  { label: "Quality Check", icon: ShieldTick, path: "/fixed-asset/quality-check", pageKey: "fixed-asset-quality-check" },
  { label: "Maintenance & Repair", icon: Setting2, path: "/fixed-asset/maintenance", pageKey: "fixed-asset-maintenance" },
  { label: "Depreciation Run", icon: Calculator, path: "/fixed-asset/depreciation-generate", pageKey: "fixed-asset-depreciation-generate" },
];
