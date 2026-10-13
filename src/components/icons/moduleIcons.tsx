import React from "react";
import {
  IconArchive,
  IconBell,
  IconBuildingBank,
  IconChartBar,
  IconChecklist,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCoinRupee,
  IconCpu,
  IconCrown,
  IconDatabase,
  IconHeartHandshake,
  IconHelmet,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconMenu2,
  IconLayoutSidebarLeftExpand,
  IconPackage,
  IconPalette,
  IconSettings,
  IconShieldCheck,
  IconShoppingCart,
  IconSpeakerphone,
  IconTicket,
  IconTimeline,
  IconTool,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";

// The icons of the app's chrome - module strip, sidebar headers, top bar - come from one pack (Tabler Icons: a single
// 1.5px outline weight on a 24px grid, which sits well beside the ruled, drawing-sheet look of those surfaces).
//
// Callers written for the previous pack pass `variant` ("Bold" / "Outline") and sometimes `strokeWidth`; the adapter
// accepts both so every icon here drops into the same slots. "Bold" just draws a slightly heavier line.

type ChromeIconProps = { size?: number; variant?: string; className?: string; style?: React.CSSProperties; color?: string; strokeWidth?: number };

const adapt = (Icon: React.ElementType): React.FC<ChromeIconProps> => {
  const Adapted: React.FC<ChromeIconProps> = ({ variant, strokeWidth, size = 18, ...rest }) => (
    <Icon size={size} stroke={strokeWidth ?? (variant === "Bold" ? 2 : 1.5)} {...rest} />
  );
  return Adapted;
};

export const ModuleIcons = {
  finance: adapt(IconBuildingBank),
  material: adapt(IconPackage),
  fixedAsset: adapt(IconCpu),
  loan: adapt(IconCoinRupee),
  engineering: adapt(IconHelmet),
  civilWorkDpr: adapt(IconTimeline),
  followup: adapt(IconChecklist),
  ticket: adapt(IconTicket),
  sales: adapt(IconShoppingCart),
  salesAutomation: adapt(IconSpeakerphone),
  crm: adapt(IconHeartHandshake),
  maintenance: adapt(IconTool),
  hrPayroll: adapt(IconUsers),
  records: adapt(IconArchive),
  admin: adapt(IconShieldCheck),
  superAdmin: adapt(IconCrown),
  dba: adapt(IconDatabase),
  profile: adapt(IconUser),
};

export const ChromeIcons = {
  reports: adapt(IconChartBar),
  widgets: adapt(IconLayoutGrid),
  setup: adapt(IconSettings),
  sidebarCollapse: adapt(IconLayoutSidebarLeftCollapse),
  sidebarExpand: adapt(IconLayoutSidebarLeftExpand),
  menu: adapt(IconMenu2),
  bell: adapt(IconBell),
  announce: adapt(IconSpeakerphone),
  theme: adapt(IconPalette),
  left: adapt(IconChevronLeft),
  right: adapt(IconChevronRight),
  down: adapt(IconChevronDown),
  up: adapt(IconChevronUp),
};
