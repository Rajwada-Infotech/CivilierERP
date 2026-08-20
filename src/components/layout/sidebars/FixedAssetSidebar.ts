import { Cpu, Tag, Setting2, ArrowSwapHorizontal } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const fixedAssetNavItems: NavItem[] = [
  { label: "Dashboard", icon: Cpu, path: "/fixed-asset", isDashboard: true },
  { label: "Fixed Asset Record", icon: Cpu, path: "/fixed-asset/record", pageKey: "fixed-asset-record" },
  { label: "Fixed Asset Tagging", icon: Tag, path: "/fixed-asset/tagging", pageKey: "fixed-asset-tagging" },
  { label: "Asset Transfer", icon: ArrowSwapHorizontal, path: "/fixed-asset/transfer", pageKey: "asset-transfer" },
  { label: "Depreciation Setup", icon: Setting2, path: "/fixed-asset/depreciation-setup", pageKey: "depreciation-setup" },
];
