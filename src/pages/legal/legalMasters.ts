import {
  Map1, Building, Shield, Home2, Layer, Global, UserTick, UserMinus, Crown1, People, Eye, Judge, Note1, Grid5, DocumentText, Ruler,
  Building4, Link21, Book1, DocumentCopy, ClipboardTick, InfoCircle, MessageQuestion,
  Location, Routing, Category, Profile, ArrowSwapHorizontal, Personalcard, Courthouse, Bank, Status, MoneySend, Receipt1,
  Wallet, Copy, TrendUp, ShieldTick,
} from "iconsax-react";

// The Legal masters and land registers, in menu order. Keys and page keys match backend/routes/legal/masterConfig.js;
// the fields themselves come from the API (GET /api/legal/masters/meta), so they live in one place.
//   area "setup": reusable master data, in the TopNavbar Setup menu, grouped as in the Legal module document.
//   area "land":  operational Land Management records, in the Legal sidebar.
export type LegalMasterGroup =
  | "Locations" | "Land records" | "Ownership" | "Legal & Financial" | "Deed & Registration" | "Workflow" | "Parties"
  | "Land Management" | "Record registers";

export interface LegalMasterEntry {
  key: string;
  label: string;
  pageKey: string;
  group: LegalMasterGroup;
  area: "setup" | "land";
  icon: React.ElementType;
  desc: string;
}

const S = (key: string, label: string, group: LegalMasterGroup, icon: React.ElementType, desc: string, pageKey = `legal-${key}-master`): LegalMasterEntry =>
  ({ key, label, pageKey, group, area: "setup", icon, desc });

export const LEGAL_MASTERS: LegalMasterEntry[] = [
  // ── Land Management (sidebar) ──
  { key: "land-enquiry", label: "Land Enquiries", pageKey: "legal-land-enquiry", group: "Land Management", area: "land", icon: MessageQuestion, desc: "New land opportunities, converted to a Land ID" },
  { key: "land", label: "Land Properties", pageKey: "legal-land-master", group: "Land Management", area: "land", icon: Global, desc: "The Land Property Master and its pipeline" },
  { key: "rs-khatian", label: "RS Khatian Register", pageKey: "legal-rs-khatian-master", group: "Record registers", area: "land", icon: Note1, desc: "Revisional Survey holder accounts" },
  { key: "rs-plot", label: "RS Plot (Dag) Register", pageKey: "legal-rs-plot-master", group: "Record registers", area: "land", icon: Grid5, desc: "RS plots, area, land class & project" },
  { key: "lr-ror", label: "LR Record of Rights Register", pageKey: "legal-lr-ror-master", group: "Record registers", area: "land", icon: DocumentText, desc: "Land Reforms holder & plot records" },

  // ── Setup: Locations ──
  S("district", "District", "Locations", Map1, "Districts and their state"),
  S("sub-division", "Sub-Division", "Locations", Routing, "Sub-divisions of a district"),
  S("block", "Block", "Locations", Location, "Blocks under a district / sub-division"),
  S("mouza", "Mouza (Revenue Village)", "Locations", Map1, "Revenue villages, J.L. no., district, block, PS"),
  S("police-station", "Police Station", "Locations", Shield, "Police station jurisdictions"),
  S("municipality", "Municipality", "Locations", Building, "Corporations, municipalities, panchayats"),
  S("village", "Village", "Locations", Home2, "Villages with block, PS, local body & Mouza"),
  S("location-type", "Land Location Type", "Locations", Category, "Rural, urban, municipal, industrial"),
  // ── Setup: Land records ──
  S("land-type", "Land Type / Classification", "Land records", Layer, "Sali, Bastu, Danga… & conversion"),
  S("area-unit", "Area Unit", "Land records", Ruler, "Decimal, Cottah, Bigha, Acre… to sq ft"),
  S("copy-type", "Document Copy Type", "Land records", Copy, "Certified, online, office copy, photocopy"),
  S("enquiry-source", "Enquiry Source", "Land records", TrendUp, "Where land enquiries come from"),
  S("portal-link", "Government Site Links", "Land records", Link21, "Banglarbhumi, WB Registration and other official sites"),
  // ── Setup: Ownership ──
  S("ownership-type", "Ownership Type", "Ownership", Profile, "Individual, joint, inherited, company…"),
  S("relationship-type", "Relationship Type", "Ownership", People, "Father, son, wife, legal heir…"),
  S("transfer-type", "Ownership Transfer Type", "Ownership", ArrowSwapHorizontal, "Sale, inheritance, gift, partition…"),
  S("ownership-status", "Ownership Status", "Ownership", Status, "Current, previous, disputed, pending"),
  S("identity-doc-type", "Identity Document Type", "Ownership", Personalcard, "Aadhaar, PAN, voter ID, passport"),
  // ── Setup: Legal & Financial ──
  S("case-type", "Legal Case Type", "Legal & Financial", Courthouse, "Civil, land dispute, acquisition…"),
  S("mortgage-type", "Mortgage Type", "Legal & Financial", Bank, "Bank loan, private loan, charge…"),
  S("legal-status", "Legal Status", "Legal & Financial", InfoCircle, "Open, pending, resolved, appealed"),
  S("txn-type", "Financial Transaction Type", "Legal & Financial", MoneySend, "Advance, payment, receipt, refund"),
  S("expense-type", "Expense Type", "Legal & Financial", Receipt1, "Advocate fee, commission, survey fee"),
  S("payment-mode", "Payment Mode", "Legal & Financial", Wallet, "Cash, bank transfer, cheque, UPI"),
  S("instalment-template", "Instalment Schedule Templates", "Legal & Financial", Wallet, "Payment plans: % of consideration, days after agreement"),
  // ── Setup: Deed & Registration ──
  S("registration-office-type", "Registration Office Types", "Deed & Registration", Building4, "Office types per state, deed search time limit and start year"),
  S("registration-office", "Deed Registration Office", "Deed & Registration", Building4, "ADSR / DSR / ARA offices"),
  S("deed-type", "Deed Type", "Deed & Registration", Book1, "Sale, gift, partition, POA…"),
  S("registration-mode", "Registration Mode", "Deed & Registration", Book1, "Physical, e-Registration, commission"),
  S("igr-status", "IGR Status", "Deed & Registration", ClipboardTick, "Deed status on the IGR site"),
  S("deed-location", "Deed Location", "Deed & Registration", Building4, "Where the physical deed is kept"),
  S("document-type", "Legal Document Type", "Deed & Registration", DocumentCopy, "Evidence catalogue & retention"),
  S("checklist-template", "Document Checklist Template", "Deed & Registration", ClipboardTick, "Versioned document requirements"),
  S("checklist-item", "Checklist Item", "Deed & Registration", ClipboardTick, "Required / conditional / optional rules"),
  // ── Setup: Workflow ──
  S("approval-authority", "Approval Control", "Workflow", ShieldTick, "Who verifies and who approves at L1 / L2 — admin only"),
  // ── Setup: Parties ──
  // We are the company: we buy land from Sellers and sell land to Buyers; Owners are the people in a land's ownership chain.
  // Each list also fills itself when a new name is typed in a purchase, sale or ownership entry.
  S("buyer", "Buyer", "Parties", UserTick, "Who buys land from us (sales)"),
  S("seller", "Seller", "Parties", UserMinus, "Who we buy land from (purchases)"),
  S("owner", "Owner", "Parties", Crown1, "Past and present owners in land ownership chains"),
  S("witness", "Witness", "Parties", Eye, "Deed witnesses & ID proof"),
  S("advocate", "Advocate", "Parties", Judge, "Enrolment, practice & chamber"),
];

export const LEGAL_MASTER_GROUPS = ["Locations", "Land records", "Ownership", "Legal & Financial", "Deed & Registration", "Workflow", "Parties"] as const;
export const LEGAL_SETUP_MASTERS = LEGAL_MASTERS.filter((m) => m.area === "setup");

export const legalMasterPath = (key: string) => (key === "land" ? "/legal/land/properties" : key === "land-enquiry" ? "/legal/land/enquiries" : `/legal/setup/${key}`);
export const legalMasterByKey = (key: string | undefined) => LEGAL_MASTERS.find((m) => m.key === key);
export const LEGAL_PAGE_KEYS = [...new Set(LEGAL_MASTERS.map((m) => m.pageKey))];
