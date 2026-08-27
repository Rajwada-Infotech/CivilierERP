import { Cpu, Tag, ArrowSwapHorizontal } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const fixedAssetNavItems: NavItem[] = [
  { label: "Dashboard", icon: Cpu, path: "/fixed-asset", isDashboard: true },
  { label: "Fixed Asset Record", icon: Cpu, path: "/fixed-asset/record", pageKey: "fixed-asset-record" },
  { label: "FA Inventory", icon: Tag, path: "/fixed-asset/tagging", pageKey: "fixed-asset-tagging" },
  { label: "User-Wise Asset Transfer", icon: ArrowSwapHorizontal, path: "/fixed-asset/transfer", pageKey: "asset-transfer" },
];
