import { FileText } from "lucide-react";
import type { ReportDef } from "@/pages/reports/types";

// Legal (land) reports, shown inline on the Reports page like every other module. Part of the one report list
// assembled in ../registry.ts. Each reads /api/legal/land-reports/:key ({ columns, rows }); the column names are the
// report's own (backend/routes/legal/landReports.js) — keep the two in step when a report changes.

// Dates as dd Mon yyyy; numbers and text as they come.
const cell = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—"
    : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

// No company / date filters: land is not split by company or financial year.
const LEGAL_FILTERS = { companyParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null, dataKey: "rows" } as const;

const legal = (key: string, label: string, description: string, columns: string[]): ReportDef => ({
  id: `legal-${key}`, label, description, icon: FileText, color: "#7c4a2e",
  apiPath: `/api/legal/land-reports/${key}`,
  columns: columns.map((c) => ({ header: c, accessor: (r: Record<string, unknown>) => cell(r[c]) })),
  filterConfig: LEGAL_FILTERS,
});

export const LEGAL_REPORTS: ReportDef[] = [
  legal("land-register", "Land Property Register", "Every land with location, area, entry type and status", ["Land ID","Land","Mouza","District","Area","Unit","Entry type","Land status","Approval status","Current owners"]),
  legal("enquiry-register", "Land Enquiry Register", "All land enquiries with source, status and the land they became", ["Enquiry","Date","Source","Location","Mouza","Contact","Expected price","Status","Land ID"]),
  legal("current-ownership", "Current Ownership", "Who owns each land now, with shares", ["Land ID","Land","Owner","Father / husband","Share %","Since","Verification"]),
  legal("ownership-history", "Complete Ownership History", "The full chain of owners of each land", ["Land ID","Land","Date","Transfer","From","To","Share %","Document no.","Verification"]),
  legal("joint-ownership", "Joint Ownership", "Land held by more than one owner", ["Land ID","Land","Current owners","Total share %","Owners"]),
  legal("inheritance", "Inheritance", "Inheritance cases and legal heirs", ["Land ID","Land","Deceased","Date of death","Supporting record","Heirs","Verification"]),
  legal("pending-ownership", "Pending Ownership Verification", "Ownership records still waiting for verification", ["Land ID","Land","Record","Detail","Status"]),
  legal("pending-documents", "Pending Documents", "Documents not yet reviewed", ["Land ID","Land","Document","Requirement","Needed by","State"]),
  legal("rejected-documents", "Rejected Documents", "Documents sent back for correction", ["Land ID","Land","Document","Title","Version","Review","Remarks","Reviewed"]),
  legal("legal-cases", "Legal Case Register", "Court cases and disputes on company land", ["Land ID","Land","Case","Type","Court","Status","Next hearing","Verification"]),
  legal("mortgages", "Mortgage & Loan Register", "Loans and mortgages against company land", ["Land ID","Land","Lender","Type","Loan","Outstanding","Status","Verification"]),
  legal("legal-hold", "Legal Hold / Dispute", "Land put on hold, with reason and review date", ["Land ID","Land","Category","Reason","Since","Review by","Status"]),
  legal("purchases", "Purchase Register", "Purchase transactions, value and payments", ["Land ID","Land","Transaction","Buyer","Seller(s)","Area","Unit","Value","Verified paid","Balance","Status"]),
  legal("sales", "Sale Register", "Sale transactions, value, received and balance", ["Land ID","Land","Transaction","Buyer","Seller(s)","Area","Unit","Value","Verified paid","Balance","Status"]),
  legal("valuations", "Land Valuation", "Market and government valuations", ["Land ID","Land","Date","Market rate","Market value","Govt. value","Source","Verification"]),
  legal("registered-deeds", "Deed Register", "Deeds recorded on each land: number, date, registration office", ["Land ID","Land","Date","Transfer","From","To","Deed no.","Registered","Office","Verification"]),
  legal("mutation-pending", "Mutation Pending", "Mutation applications not yet decided", ["Land ID","Land","Application","Applied","Office","New owner(s)","Status","Hearing","Order no.","Order date"]),
  legal("mutation-completed", "Mutation Completed", "Mutations approved, with the new Khatian", ["Land ID","Land","Application","Applied","Office","New owner(s)","Status","Hearing","Order no.","Order date"]),
  legal("workflow-status", "Approval Status & Waiting Time", "Approval status (L1 / L2) and days waiting", ["Land ID","Land","Entry type","Approval status","L1","L2","Last changed","Days waiting"]),
  legal("audit", "User Activity / Audit", "Who changed what in the Legal module", ["When","User","Action","Record","Id","Land ID","Remarks"]),
];
