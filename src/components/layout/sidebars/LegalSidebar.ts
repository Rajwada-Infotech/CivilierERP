import { Judge, Global, Note1, DocumentText, MessageQuestion, MoneySend, ClipboardTick, Building } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Company Land Record Management System navigation:
// - Dashboard
// - Land Enquiries (prospects & leads)
// - Land Register (all company properties)
// - Pending Verification (lands waiting for final verification)
// - Deed Process (verified lands, with the verifier's deed timeline)
// - Register Existing / Backlog Land
// - Land & Projects (which land serves which project; complete vs under process)
// - Land Sales (sale/disposal transactions)
// - Registers of RS & LR records
// - Reports live on the top Reports page (Legal section), like every other module
// - Masters & Setup live in the TopNavbar "Setup" dropdown
export const legalNavItems: NavItem[] = [
  { label: "Dashboard", icon: Judge, path: "/legal", isDashboard: true, pageKey: "legal-dashboard" },

  // ── Company Land Records & Verification / Approvals ───────────────────────
  { label: "Land Enquiries", icon: MessageQuestion, path: "/legal/land/enquiries", pageKey: "legal-land-enquiry" },
  { label: "Land Register", icon: Global, path: "/legal/land/properties", pageKey: "legal-land-master" },
  { label: "Pending Verification", icon: ClipboardTick, path: "/legal/approvals", pageKey: "legal-approvals" },
  { label: "Deed Process", icon: Note1, path: "/legal/land/deed-process", pageKey: "legal-land-master" },
  { label: "Deed Registration", icon: DocumentText, path: "/legal/deed-registration", pageKey: "legal-approvals" },
  { label: "Post-Registration", icon: Note1, path: "/legal/land/post-registration", pageKey: "legal-land-master" },
  { label: "Land & Projects", icon: Building, path: "/legal/land/projects", pageKey: "legal-land-master" },
  { label: "Land Sales", icon: MoneySend, path: "/legal/land/sales", pageKey: "legal-land-master" },
  { label: "RS Record Register", icon: Note1, path: "/legal/land/rs-register", pageKey: "legal-land-master" },
  { label: "LR RoR Register", icon: DocumentText, path: "/legal/land/lr-register", pageKey: "legal-land-master" },
];
