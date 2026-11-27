import { Judge, Global, Note1, DocumentText, ClipboardTick, Layer, TaskSquare } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Legal navigation — five places:
// - Dashboard   what is waiting for me, and the land summary
// - Lands       every land at every stage; open one → its workspace (stage, details, records, documents, versions)
// - Pipeline    the seven stages in order (Enquiries → … → Post-registration), each a work queue
// - Approvals   one inbox: verification, re-verification, deed L1 / L2, amendments
// - Versions & Amendments   search a land → its versions (PDF / ZIP) and amendments
// - Registers   Land & Projects, Land Sales, RS and LR records
// Reports live on the top Reports page; masters & setup in the top Setup menu.
export const legalNavItems: NavItem[] = [
  { label: "Dashboard", icon: Judge, path: "/legal", isDashboard: true, pageKey: "legal-dashboard" },

  // ── Company Land Records & Verification / Approvals ───────────────────────
  { label: "My tasks", icon: TaskSquare, path: "/legal/my-tasks", pageKey: "legal-land-enquiry" },
  { label: "Verification reports", icon: DocumentText, path: "/legal/verification/reports", pageKey: "legal-land-enquiry" },
  { label: "Land Flowchart", icon: Layer, path: "/legal/versions", pageKey: "legal-land-master" },
  {
    label: "Pipeline", icon: Note1,
    children: [
      { label: "1 · Enquiries", path: "/legal/land/enquiries", pageKey: "legal-land-enquiry" },
      { label: "2 · Land records search", path: "/legal/land/deed-search", pageKey: "legal-land-enquiry" },
      { label: "3 · Legal verification", path: "/legal/land/verification", pageKey: "legal-land-enquiry" },
      { label: "4 · Land conversion", path: "/legal/land/properties?filter=verification", pageKey: "legal-land-master" },
      { label: "5 · Deed Process", path: "/legal/land/deed-process", pageKey: "legal-land-master" },
      { label: "6 · LA & ULC", path: "/legal/land/la-ulc", pageKey: "legal-land-master" },
      { label: "7 · Pre-registration compliance", path: "/legal/land/pre-registration", pageKey: "legal-land-master" },
      { label: "8 · Deed Registration", path: "/legal/deed-registration", pageKey: "legal-approvals" },
      { label: "9 · Post-registration", path: "/legal/land/post-registration", pageKey: "legal-land-master" },
    ],
  },
  { label: "Approvals", icon: ClipboardTick, path: "/legal/approvals", pageKey: "legal-approvals" },
  { label: "Lands", icon: Global, path: "/legal/land/properties", pageKey: "legal-land-master" },
  {
    label: "Registers", icon: DocumentText,
    children: [
      { label: "Land & Projects", path: "/legal/land/projects", pageKey: "legal-land-master" },
      { label: "Land Sales", path: "/legal/land/sales", pageKey: "legal-land-master" },
      { label: "RS records", path: "/legal/land/rs-register", pageKey: "legal-land-master" },
      { label: "LR records (RoR)", path: "/legal/land/lr-register", pageKey: "legal-land-master" },
    ],
  },
];
