import { Cpu, Tag, ArrowSwapHorizontal, Import, UserTag, ShieldTick, Setting2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const fixedAssetNavItems: NavItem[] = [
  { label: "Dashboard", icon: Cpu, path: "/fixed-asset", isDashboard: true },
  { label: "Fixed Asset Depreciation Tag", icon: Cpu, path: "/fixed-asset/record", pageKey: "fixed-asset-record" },
  { label: "FA Inventory", icon: Tag, path: "/fixed-asset/tagging", pageKey: "fixed-asset-tagging" },
  { label: "Inventory Import", icon: Import, path: "/fixed-asset/inventory-import", pageKey: "fixed-asset-inventory-import" },
  { label: "Assignment", icon: UserTag, path: "/fixed-asset/assignment", pageKey: "fixed-asset-assignment" },
  { label: "User-Wise Asset Transfer", icon: ArrowSwapHorizontal, path: "/fixed-asset/transfer", pageKey: "asset-transfer" },
  { label: "Owner & Quality Checking", icon: ShieldTick, path: "/fixed-asset/quality-check", pageKey: "fixed-asset-quality-check" },
  { label: "FA Maintenance & Repair", icon: Setting2, path: "/fixed-asset/maintenance", pageKey: "fixed-asset-maintenance" },
];
