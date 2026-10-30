import { Judge, SearchStatus, DocumentUpload, ClipboardTick, Clock, MessageQuestion, Global, Note1, Grid5, DocumentText } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// In accordance with ERP conventions:
// - Reference Masters & Configuration live in the TopNavbar "Setup" dropdown (legalSetupItems).
// - Sidebar is dedicated to daily operational workflow and tasks.
export const legalNavItems: NavItem[] = [
  { label: "Dashboard", icon: Judge, path: "/legal", isDashboard: true, pageKey: "legal-dashboard" },

  // ── Land Management ──────────────────────────────────────────────────────
  { label: "Land Enquiries", icon: MessageQuestion, path: "/legal/land/enquiries", pageKey: "legal-land-enquiry" },
  { label: "Land Properties", icon: Global, path: "/legal/land/properties", pageKey: "legal-land-master" },
  { label: "RS Khatian Register", icon: Note1, path: "/legal/setup/rs-khatian", pageKey: "legal-rs-khatian-master" },
  { label: "RS Plot Register", icon: Grid5, path: "/legal/setup/rs-plot", pageKey: "legal-rs-plot-master" },
  { label: "LR RoR Register", icon: DocumentText, path: "/legal/setup/lr-ror", pageKey: "legal-lr-ror-master" },

  // ── Operations & Workflow ──────────────────────────────────────────────────
  { label: "Registration Search", icon: SearchStatus, path: "/legal/search", pageKey: "legal-registration-search" },
  { label: "Deed Registrations", icon: DocumentUpload, path: "/legal/deeds", pageKey: "legal-deed-registrations" },
  { label: "Pending Approvals", icon: ClipboardTick, path: "/legal/approvals", pageKey: "legal-approvals" },
  { label: "Pending & Overdue", icon: Clock, path: "/legal/pending-queue", pageKey: "legal-pending-queue" },
];
