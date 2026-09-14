import { Chart2, Receipt21, ClipboardText, Edit2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const engineeringNavItems: NavItem[] = [
  { label: "Dashboard", icon: Chart2, path: "/engineering", pageKey: "engineering-dashboard", isDashboard: true },
  {
    label: "Transaction",
    icon: Receipt21,
    children: [
      { label: "BOQ",        path: "/engineering/boq",        pageKey: "boq" },
      { label: "Work Order", path: "/engineering/work-order", pageKey: "engineering-work-order" },
      { label: "Work Done",  path: "/engineering/work-done",  pageKey: "work-done" },
    ],
  },
  { label: "DPR",       icon: ClipboardText, path: "/engineering/dpr",              pageKey: "dpr" },
  { label: "Amendment", icon: Edit2,         path: "/engineering/amendment",        pageKey: "engineering-amendment" },
];
