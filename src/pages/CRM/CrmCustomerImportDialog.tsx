import React, { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload,
  X, Check, AlertTriangle, Search, Filter, RefreshCw, Clipboard,
  ArrowRight, ArrowLeft, ChevronDown, Sparkles, Pencil, FileText,
  Globe, UserCheck, Layers, Eye, GitCompare, ExternalLink
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { buildWorkbook, downloadBlob, readWorkbook, type XlsxCell, type XlsxSheet } from "@/lib/xlsxBook";
import { parseDelimitedAuto } from "@/lib/sheetFile";

const API = "/api/crm/customers";
const SA_LEADS_API = "/api/sa/leads";

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  description?: string;
  category?: "Identity" | "Contact" | "Address" | "Financial" | "Co-Applicant" | "Other";
};

export type ImportRow = {
  rowNo: number;
  cells: Record<string, string>;
};

export type ImportSummary = {
  total: number;
  new: number;
  existing: number;
  duplicate: number;
  error: number;
  warnings?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
};

export type PreviewRow = {
  rowNo: number;
  status: "new" | "existing" | "duplicate" | "error";
  data: Record<string, string>;
  errors?: string[];
  warnings?: string[];
  reason?: string;
  duplicateOf?: number;
  match?: {
    id: number;
    customerNo: string;
    name: string;
    by: string[];
    current?: Record<string, string>;
  };
  leadMatch?: {
    id: number;
    leadUid: string;
    status: string;
    classification?: string;
  };
};

export type PreviewResult = {
  rows: PreviewRow[];
  summary: ImportSummary;
};

export type ApplyResult = {
  summary: ImportSummary;
  results: {
    rowNo: number;
    name?: string;
    result: "created" | "updated" | "skipped" | "failed";
    customerNo?: string;
    reason?: string;
  }[];
};

const DEFAULT_FIELDS: ImportField[] = [
  { key: "CustomerName", label: "Customer Name", required: true, category: "Identity", description: "Full legal or display name of the customer" },
  { key: "FirstName", label: "First Name (Merges to Name)", category: "Identity", description: "First name to auto-combine into Customer Name" },
  { key: "LastName", label: "Last Name (Merges to Name)", category: "Identity", description: "Last name to auto-combine into Customer Name" },
  { key: "Mobile", label: "Mobile", category: "Contact", description: "Primary 10-digit mobile number used for lookup & uniqueness" },
  { key: "AltMobile", label: "Alternate Mobile", category: "Contact", description: "Secondary phone or emergency contact number" },
  { key: "Email", label: "Email", category: "Contact", description: "Primary email address" },
  { key: "PanNo", label: "PAN", category: "Identity", description: "10-character PAN card number (AAAAA9999A)" },
  { key: "AadhaarNo", label: "Aadhaar", category: "Identity", description: "12-digit Aadhaar number" },
  { key: "DateOfBirth", label: "Date of Birth", category: "Identity", description: "Birth date (DD/MM/YYYY or YYYY-MM-DD)" },
  { key: "Occupation", label: "Occupation", category: "Other", description: "Salaried, Business, Professional, etc." },
  { key: "AnnualIncome", label: "Annual Income", category: "Financial", description: "Yearly income in INR or Lakhs" },
  { key: "PermanentAddress", label: "Permanent Address", category: "Address", description: "House, street, and locality" },
  { key: "AddressLine1", label: "Address Line 1 (Merges)", category: "Address", description: "First line of street address" },
  { key: "AddressLine2", label: "Address Line 2 (Merges)", category: "Address", description: "Second line of street address" },
  { key: "PermanentCity", label: "Permanent City", category: "Address", description: "City / Town" },
  { key: "PermanentState", label: "Permanent State", category: "Address", description: "State / Province" },
  { key: "PermanentPincode", label: "Permanent Pincode", category: "Address", description: "6-digit postal code" },
  { key: "CurrentAddress", label: "Current Address", category: "Address", description: "Present or correspondence address" },
  { key: "CurrentCity", label: "Current City", category: "Address", description: "Current city" },
  { key: "CurrentState", label: "Current State", category: "Address", description: "Current state" },
  { key: "CurrentPincode", label: "Current Pincode", category: "Address", description: "Current 6-digit postal code" },
  { key: "InvoiceMode", label: "Invoice Mode", category: "Financial", description: "Invoice or Non-Invoice (GST)" },
  { key: "Notes", label: "Notes", category: "Other", description: "Remarks, source details, or background notes" },
  { key: "CustomerNo", label: "Customer No", category: "Identity", description: "Optional existing customer code (CUST-XXXXX) for bulk updates" },
  { key: "CoApplicantName", label: "Co-Applicant Name", category: "Co-Applicant", description: "Secondary applicant full name" },
  { key: "CoApplicantMobile", label: "Co-Applicant Mobile", category: "Co-Applicant", description: "Secondary applicant mobile" },
  { key: "CoApplicantPanNo", label: "Co-Applicant PAN", category: "Co-Applicant", description: "Secondary applicant PAN card" },
  { key: "CoApplicantRelation", label: "Co-Applicant Relation", category: "Co-Applicant", description: "Spouse, Son, Business Partner, etc." },
];

const FIELD_ALIASES: Record<string, string[]> = {
  CustomerName: [
    "customername", "customer", "name", "fullname", "applicantname", "applicant",
    "buyername", "buyer", "clientname", "client", "partyname", "party", "purchaser",
    "allottee", "primaryapplicant", "contactname", "leadname", "user_name"
  ],
  FirstName: ["firstname", "first_name", "givenname", "fname"],
  LastName: ["lastname", "last_name", "surname", "familyname", "lname"],
  Mobile: [
    "mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber", "contact",
    "contactno", "contactnumber", "primarymobile", "whatsapp", "whatsappno", "whatsappnumber",
    "tel", "telephone", "cell", "cellphone", "phone_number", "contact_number"
  ],
  AltMobile: [
    "alternatemobile", "altmobile", "alternatephone", "secondarymobile", "secondmobile",
    "othermobile", "otherphone", "phone2", "mobile2", "altcontact", "emergencycontact",
    "officephone", "residencephone"
  ],
  Email: [
    "email", "emailid", "mail", "mailid", "emailaddress", "user_email", "e-mail"
  ],
  PanNo: [
    "pan", "panno", "pannumber", "pancard", "pancardno", "permanentaccountnumber",
    "taxid", "pan_no"
  ],
  AadhaarNo: [
    "aadhaar", "aadhaarno", "aadhaarnumber", "aadhar", "aadharno", "aadharnumber",
    "uid", "uidai", "aadhaarcard", "aadharcard", "aadhar_no"
  ],
  DateOfBirth: [
    "dateofbirth", "dob", "birthdate", "birthdt", "date_of_birth"
  ],
  Occupation: [
    "occupation", "profession", "job", "designation", "work", "employment", "business"
  ],
  AnnualIncome: [
    "annualincome", "income", "yearlyincome", "annualsalary", "salary", "ctc", "grossincome"
  ],
  PermanentAddress: [
    "permanentaddress", "address", "fulladdress", "residentialaddress", "customeraddress",
    "buyeraddress", "applicantaddress", "street", "houseno"
  ],
  AddressLine1: ["addressline1", "address1", "addr1", "line1"],
  AddressLine2: ["addressline2", "address2", "addr2", "line2"],
  PermanentCity: [
    "permanentcity", "city", "town", "district"
  ],
  PermanentState: [
    "permanentstate", "state", "province"
  ],
  PermanentPincode: [
    "permanentpincode", "pincode", "pin", "pinno", "pinnumber", "zipcode", "postalcode", "zip"
  ],
  CurrentAddress: [
    "currentaddress", "communicationaddress", "presentaddress", "correspondenceaddress", "mailingaddress"
  ],
  CurrentCity: [
    "currentcity", "presentcity", "commcity"
  ],
  CurrentState: [
    "currentstate", "presentstate", "commstate"
  ],
  CurrentPincode: [
    "currentpincode", "presentpincode", "correspondencepincode", "commpincode"
  ],
  InvoiceMode: [
    "invoicemode", "invoice", "gstbilling", "billingmode", "gst", "taxinvoice", "billingtype"
  ],
  Notes: [
    "notes", "remarks", "remark", "comment", "comments", "description", "sourcenotes", "leadremarks"
  ],
  CustomerNo: [
    "customerno", "customercode", "custno", "custid", "customerid"
  ],
  CoApplicantName: ["coapplicantname", "coapplicant", "secondaryapplicant", "co_applicant", "co-applicant", "jointapplicant"],
  CoApplicantMobile: ["coapplicantmobile", "coapplicantphone", "co_mobile", "co-mobile"],
  CoApplicantPanNo: ["coapplicantpan", "coapplicantpanno", "co_pan", "co-pan"],
  CoApplicantRelation: ["coapplicantrelation", "relation", "relationship", "co_relation"],
};

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function excelCol(i: number) {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ── Smart Header Detection ───────────────────────────────────────────────────

function autoDetectHeaderIndex(rows: string[][], fields: ImportField[]): number {
  let bestIdx = 0;
  let bestScore = -1;

  rows.slice(0, 30).forEach((row, idx) => {
    if (!row.some((c) => norm(c))) return;
    let score = 0;
    const cleanCells = row.map(norm);
    fields.forEach((f) => {
      const aliases = FIELD_ALIASES[f.key] || [norm(f.label), norm(f.key)];
      if (cleanCells.some((c) => aliases.includes(c))) {
        score += f.required ? 10 : 2;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return bestIdx;
}

function autoMapColumns(headers: string[], fields: ImportField[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const mappedFields = new Set<string>();

  headers.forEach((h, colIdx) => {
    const nh = norm(h);
    if (!nh) return;

    for (const field of fields) {
      if (mappedFields.has(field.key)) continue;
      const aliases = FIELD_ALIASES[field.key] || [norm(field.label), norm(field.key)];
      if (aliases.includes(nh)) {
        mapping[String(colIdx)] = field.key;
        mappedFields.add(field.key);
        break;
      }
    }
  });

  return mapping;
}

// ── Template Generator ───────────────────────────────────────────────────────

async function downloadTemplate(fields: ImportField[]) {
  const exportFields = fields.filter((f) => !["FirstName", "LastName", "AddressLine1", "AddressLine2"].includes(f.key));
  const header = exportFields.map((f) => ({ v: `${f.label}${f.required ? " *" : ""}`, s: f.required ? "required" : "header" }) as XlsxCell);
  const blankRows = Array.from({ length: 150 }, () => exportFields.map(() => ""));

  const sample1 = [
    "Rahul Sharma", "9830012345", "9830099999", "rahul.sharma@example.com", "ABCDE1234F", "123456789012",
    "15/08/1988", "IT Consultant", "1800000", "Flat 4B, Park Street", "Kolkata", "West Bengal", "700016",
    "", "", "", "", "Non-Invoice", "Met at Property Expo Oct 2026", "",
    "Anita Sharma", "9830088888", "ABCDE5678G", "Spouse"
  ];

  const sample2 = [
    "Priya Mukherjee", "9876543210", "", "priya.m@example.com", "XYZPQ9876A", "",
    "22/03/1992", "Doctor", "25 Lakhs", "Plot 12, Salt Lake Sector V", "Kolkata", "West Bengal", "700091",
    "Plot 12, Salt Lake Sector V", "Kolkata", "West Bengal", "700091", "Invoice", "Looking for 3BHK high-rise", "",
    "", "", "", ""
  ];

  const helpRows: XlsxCell[][] = [
    [{ v: "Civilier ERP — Enterprise Customer Bulk Import Template", s: "title" }],
    [{ v: "Instructions for Bulk Entry:", s: "label" }],
    [{ v: "1. Fill in customer details in the 'Customers' sheet. Start entering data from Row 2.", s: "note" }],
    [{ v: "2. Customer Name is mandatory. (You can also map First Name and Last Name separately in the system).", s: "note" }],
    [{ v: "3. Mobile, PAN, Email, Aadhaar, and Customer No are checked against existing ERP records.", s: "note" }],
    [{ v: "4. Multi-number cells (e.g. '9830012345 / 9830099999') will automatically split into Mobile and Alternate Mobile.", s: "note" }],
    [{ v: "5. Date format: DD/MM/YYYY or YYYY-MM-DD. Example: 15/08/1988.", s: "note" }],
    [{ v: "6. Current Address: If left blank, it automatically defaults to 'Same as Permanent Address'.", s: "note" }],
    [{ v: "7. Co-Applicant details: Capture Co-Applicant Name, Mobile, PAN, and Relationship (Spouse, Son, etc.).", s: "note" }],
  ];

  const guideRows: XlsxCell[][] = [
    [{ v: "Field Name", s: "header" }, { v: "Required?", s: "header" }, { v: "Format / Rules", s: "header" }, { v: "Accepted Source Aliases", s: "header" }],
    ...exportFields.map((f) => [
      f.label,
      f.required ? "YES" : "Optional",
      f.description || "Text",
      (FIELD_ALIASES[f.key] || [f.key]).slice(0, 8).join(", "),
    ]),
  ];

  const invoiceIdx = exportFields.findIndex((f) => f.key === "InvoiceMode");
  const lists = invoiceIdx >= 0 ? [{ sqref: `${excelCol(invoiceIdx)}2:${excelCol(invoiceIdx)}1000`, formula: `"Non-Invoice,Invoice"` }] : [];
  const widths = exportFields.map((f) => Math.min(Math.max(f.label.length + 6, 16), 34));
  const textKeys = new Set(["Mobile", "AltMobile", "PanNo", "AadhaarNo", "DateOfBirth", "PermanentPincode", "CurrentPincode", "CustomerNo", "CoApplicantMobile", "CoApplicantPanNo"]);
  const columnStyles = exportFields.map((f) => (textKeys.has(f.key) ? ("text" as const) : undefined));

  const sheets: XlsxSheet[] = [
    { name: "Customers", rows: [header, ...blankRows], widths, columnStyles, freezeBelowRow: 2, lists },
    { name: "Sample Data", rows: [header, sample1, sample2], widths, columnStyles, freezeBelowRow: 2, lists },
    { name: "Field Guide", rows: guideRows, widths: [24, 12, 45, 60], freezeBelowRow: 2 },
    { name: "Instructions", rows: helpRows, widths: [100] },
  ];

  await downloadBlob(await buildWorkbook(sheets), "Civilier_Customer_Import_Template.xlsx");
}

// ── Export Exception Rows to Excel ───────────────────────────────────────────

async function exportSkippedAndFailedRows(
  rows: PreviewRow[],
  applyResults: ApplyResult["results"] | undefined,
  fields: ImportField[]
) {
  const resultMap = new Map<number, { result: string; reason?: string }>();
  (applyResults || []).forEach((res) => resultMap.set(res.rowNo, { result: res.result, reason: res.reason }));

  const targetRows = rows.filter((r) => {
    if (r.status === "error") return true;
    const res = resultMap.get(r.rowNo);
    return res && (res.result === "failed" || res.result === "skipped");
  });

  if (!targetRows.length) {
    toast.info("No failed or skipped rows to export.");
    return;
  }

  const exportFields = fields.filter((f) => !["FirstName", "LastName", "AddressLine1", "AddressLine2"].includes(f.key));
  const header: XlsxCell[] = [
    { v: "Row #", s: "header" },
    { v: "Status", s: "header" },
    { v: "Failure / Skip Reason", s: "required" },
    ...exportFields.map((f) => ({ v: f.label, s: "header" } as XlsxCell)),
  ];

  const dataRows: XlsxCell[][] = targetRows.map((r) => {
    const res = resultMap.get(r.rowNo);
    const status = res?.result || r.status;
    const reason = res?.reason || (r.errors || []).join("; ") || r.reason || "Skipped";

    return [
      r.rowNo,
      status.toUpperCase(),
      reason,
      ...exportFields.map((f) => r.data[f.key] || ""),
    ];
  });

  const widths = [10, 16, 45, ...exportFields.map((f) => Math.max(f.label.length + 4, 15))];

  const blob = await buildWorkbook([
    {
      name: "Failed & Skipped Rows",
      rows: [header, ...dataRows],
      widths,
      freezeBelowRow: 2,
    },
  ]);

  downloadBlob(blob, `Customer_Import_Exceptions_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success(`Exported ${targetRows.length} exception rows for review.`);
}

// ── Stat Badge ───────────────────────────────────────────────────────────────

function StatBadge({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string;
  value: number | undefined;
  tone?: "default" | "good" | "warn" | "bad" | "info";
  active?: boolean;
  onClick?: () => void;
}) {
  const colorMap = {
    default: "border-border bg-muted/20 text-foreground",
    good: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300",
    warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300",
    bad: "border-red-300 bg-red-50 text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300",
    info: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-xl border p-3 text-left transition-all ${colorMap[tone]} ${
        active ? "ring-2 ring-primary shadow-sm" : ""
      } ${onClick ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
    >
      <div className="text-xl font-bold tabular-nums leading-none mb-1">{value ?? 0}</div>
      <div className="text-[0.6875rem] font-semibold uppercase tracking-wider opacity-80">{label}</div>
    </button>
  );
}

// ── Side-by-Side Visual Diff Modal Component ─────────────────────────────────

function VisualDiffModal({
  row,
  onClose,
}: {
  row: PreviewRow;
  onClose: () => void;
}) {
  const current = row.match?.current || {};
  const incoming = row.data || {};

  const fieldsToCompare = [
    { key: "CustomerName", label: "Customer Name" },
    { key: "Mobile", label: "Mobile" },
    { key: "AltMobile", label: "Alternate Mobile" },
    { key: "Email", label: "Email" },
    { key: "PanNo", label: "PAN" },
    { key: "AadhaarNo", label: "Aadhaar" },
    { key: "DateOfBirth", label: "Date of Birth" },
    { key: "Occupation", label: "Occupation" },
    { key: "PermanentAddress", label: "Address", dbKey: "Address" },
    { key: "PermanentCity", label: "City", dbKey: "City" },
  ];

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-background p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <GitCompare size={16} className="text-primary" />
              Side-by-Side Comparison: Existing DB vs Incoming Row #{row.rowNo}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Matched with Customer <strong className="text-foreground">{row.match?.customerNo}</strong> ({row.match?.name}) via {row.match?.by.join(", ")}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-3.5 py-2 font-semibold">Field</th>
                <th className="text-left px-3.5 py-2 font-semibold text-foreground">Current in Database</th>
                <th className="text-left px-3.5 py-2 font-semibold text-primary">Incoming from File</th>
                <th className="text-left px-3.5 py-2 font-semibold">Diff Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fieldsToCompare.map((f) => {
                const dbVal = current[f.dbKey || f.key] || "";
                const fileVal = incoming[f.key] || "";

                let statusText = "Identical";
                let badgeClass = "bg-muted text-muted-foreground";

                if (!dbVal && fileVal) {
                  statusText = "New Data to Fill";
                  badgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold";
                } else if (dbVal && fileVal && dbVal.toLowerCase() !== fileVal.toLowerCase()) {
                  statusText = "Different Value";
                  badgeClass = "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-semibold";
                } else if (dbVal && !fileVal) {
                  statusText = "Preserved from DB";
                  badgeClass = "bg-muted text-muted-foreground";
                }

                return (
                  <tr key={f.key} className="hover:bg-muted/10">
                    <td className="px-3.5 py-2 font-medium text-foreground">{f.label}</td>
                    <td className="px-3.5 py-2 font-mono text-muted-foreground">{dbVal || "—"}</td>
                    <td className="px-3.5 py-2 font-mono font-medium text-foreground">{fileVal || "—"}</td>
                    <td className="px-3.5 py-2">
                      <span className={`px-2 py-0.5 rounded text-[0.625rem] ${badgeClass}`}>
                        {statusText}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl btn-module text-white shadow-sm"
          >
            Close Diff View
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dialog Component ────────────────────────────────────────────────────

export function CrmCustomerImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wizard state: 1 = Source, 2 = Mapping, 3 = Preview & Validate, 4 = Results
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [fields, setFields] = useState<ImportField[]>(DEFAULT_FIELDS);
  const [sourceType, setSourceType] = useState<"file" | "paste" | "leads" | "url">("file");
  const [pastedText, setPastedText] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [fetchingLeads, setFetchingLeads] = useState(false);
  const [availableLeadsCount, setAvailableLeadsCount] = useState<number | null>(null);

  const [file, setFile] = useState<File | null>(null);

  // Multi-sheet support
  const [allSheets, setAllSheets] = useState<Record<string, string[][]>>({});
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  // Raw table from file/paste/remote
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [headers, setHeaders] = useState<string[]>([]);

  // Column mapping: colIndex (as string) → fieldKey
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // Configuration options
  const [sourceTag, setSourceTag] = useState("Bulk Excel Import");
  const [defaultInvoiceMode, setDefaultInvoiceMode] = useState<"NonInvoice" | "Invoice">("NonInvoice");
  const [existingMode, setExistingMode] = useState<"skip" | "fill" | "update">("skip");

  // Preview & Processing state
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);

  // Row selection in Preview
  const [excludedRowNos, setExcludedRowNos] = useState<Set<number>>(new Set());
  const [previewFilter, setPreviewFilter] = useState<"all" | "new" | "existing" | "duplicate" | "error" | "warnings">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals inside dialog
  const [editingRow, setEditingRow] = useState<PreviewRow | null>(null);
  const [diffRow, setDiffRow] = useState<PreviewRow | null>(null);

  // Load field metadata & converted leads count from server
  useEffect(() => {
    fetchWithAuth(`${API}/import/fields`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.fields && Array.isArray(data.fields)) {
          setFields(data.fields);
        }
      })
      .catch(() => {});

    // Check how many converted leads are available
    fetchWithAuth(`${SA_LEADS_API}?status=Converted`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailableLeadsCount(data.length);
        }
      })
      .catch(() => {});
  }, []);

  // ── Source Loader: Local File ─────────────────────────────────────────────

  const handleFileChange = async (f: File | null) => {
    setFile(f);
    setPastedText("");
    setAllSheets({});
    setSelectedSheet("");
    setRawRows([]);
    setPreview(null);
    setApplied(null);
    if (!f) return;

    try {
      if (/\.(xlsx)$/i.test(f.name)) {
        const buf = await f.arrayBuffer();
        const sheets = await readWorkbook(buf);
        const sheetNames = Object.keys(sheets);
        if (!sheetNames.length) throw new Error("No readable sheets found in this workbook.");
        setAllSheets(sheets);
        const firstSheet = sheetNames[0];
        setSelectedSheet(firstSheet);
        setupSheetData(sheets[firstSheet]);
      } else if (/\.(csv|tsv|txt)$/i.test(f.name)) {
        const text = await f.text();
        const parsed = parseDelimitedAuto(text);
        if (!parsed.rows.length) throw new Error("File is empty.");
        setRawRows(parsed.rows);
        initHeaderAndMapping(parsed.rows);
      } else {
        throw new Error("Supported formats: .xlsx, .csv, .tsv, .txt");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to parse file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const setupSheetData = (rows: string[][]) => {
    if (!rows || !rows.length) {
      toast.error("Selected sheet contains no rows.");
      return;
    }
    setRawRows(rows);
    initHeaderAndMapping(rows);
  };

  const handleSheetSelect = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (allSheets[sheetName]) {
      setupSheetData(allSheets[sheetName]);
    }
  };

  // ── Source Loader: Clipboard Paste ────────────────────────────────────────

  const handlePasteChange = (text: string) => {
    setPastedText(text);
    setFile(null);
    setAllSheets({});
    setSelectedSheet("");
    if (!text.trim()) {
      setRawRows([]);
      return;
    }
    const parsed = parseDelimitedAuto(text);
    if (parsed.rows.length > 0) {
      setRawRows(parsed.rows);
      initHeaderAndMapping(parsed.rows);
    }
  };

  // ── Source Loader: Remote Web / Google Sheets URL ─────────────────────────

  const handleFetchRemoteUrl = async () => {
    if (!remoteUrl.trim()) return;
    setFetchingRemote(true);
    try {
      let fetchUrl = remoteUrl.trim();
      // Handle Google Sheets URL format conversion
      if (/docs\.google\.com\/spreadsheets\/d\//i.test(fetchUrl) && !/export\?format=csv/i.test(fetchUrl)) {
        fetchUrl = fetchUrl.replace(/\/edit.*$/, "") + "/export?format=csv";
      }

      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP Error ${res.status}: Could not fetch remote file`);
      const text = await res.text();
      const parsed = parseDelimitedAuto(text);
      if (!parsed.rows.length) throw new Error("Remote URL returned empty data.");

      setRawRows(parsed.rows);
      initHeaderAndMapping(parsed.rows);
      setSourceTag(`Remote URL: ${new URL(fetchUrl).hostname}`);
      toast.success(`Fetched ${parsed.rows.length} rows from remote link.`);
    } catch (e: any) {
      toast.error(e.message || "Failed to fetch remote spreadsheet.");
    } finally {
      setFetchingRemote(false);
    }
  };

  // ── Source Loader: Fetch directly from Converted Leads Pool ───────────────

  const handleFetchConvertedLeads = async () => {
    setFetchingLeads(true);
    try {
      const res = await fetchWithAuth(`${SA_LEADS_API}?status=Converted`);
      if (!res.ok) throw new Error("Could not fetch converted leads.");
      const leads: any[] = await res.json();
      if (!leads.length) {
        toast.info("No converted leads found in Sales Automation pool.");
        return;
      }

      // Convert leads array into tabular 2D array
      const leadHeaders = [
        "Customer Name", "Mobile", "Alternate Mobile", "Email",
        "Lead UID", "Classification", "Property Type", "Budget Max", "Remarks"
      ];

      const leadRows = leads.map((l) => [
        l.CustomerName || "",
        l.Mobile || "",
        l.AltMobile || "",
        l.Email || "",
        l.LeadUid || "",
        l.Classification || "",
        l.PropertyType || "",
        l.BudgetMax ? String(l.BudgetMax) : "",
        l.CustomerRemarks || "",
      ]);

      const fullRows = [leadHeaders, ...leadRows];
      setRawRows(fullRows);
      initHeaderAndMapping(fullRows);
      setSourceTag("Converted Leads Pool Migration");
      toast.success(`Loaded ${leads.length} converted leads into the import staging grid.`);
    } catch (e: any) {
      toast.error(e.message || "Failed to load leads pool.");
    } finally {
      setFetchingLeads(false);
    }
  };

  const initHeaderAndMapping = (rows: string[][]) => {
    const detectedIdx = autoDetectHeaderIndex(rows, fields);
    setHeaderRowIdx(detectedIdx);
    const rawHeader = rows[detectedIdx] || [];
    const cleanHeader = rawHeader.map((h, i) => (h && h.trim() ? h.trim() : `Column ${excelCol(i)}`));
    setHeaders(cleanHeader);
    const autoMap = autoMapColumns(cleanHeader, fields);
    setColumnMapping(autoMap);
  };

  const handleHeaderRowChange = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= rawRows.length) return;
    setHeaderRowIdx(newIdx);
    const rawHeader = rawRows[newIdx] || [];
    const cleanHeader = rawHeader.map((h, i) => (h && h.trim() ? h.trim() : `Column ${excelCol(i)}`));
    setHeaders(cleanHeader);
    const autoMap = autoMapColumns(cleanHeader, fields);
    setColumnMapping(autoMap);
  };

  // ── Step 2: Mapping Helpers ──────────────────────────────────────────────

  const isNameMapped = useMemo(() => {
    const vals = Object.values(columnMapping);
    return vals.includes("CustomerName") || vals.includes("FirstName");
  }, [columnMapping]);

  const mappedCount = useMemo(() => {
    return Object.values(columnMapping).filter(Boolean).length;
  }, [columnMapping]);

  const sampleRows = useMemo(() => {
    return rawRows.slice(headerRowIdx + 1, headerRowIdx + 4);
  }, [rawRows, headerRowIdx]);

  const convertMappedToImportRows = (): ImportRow[] => {
    const importRows: ImportRow[] = [];
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      if (!row.some((c) => String(c ?? "").trim() !== "")) continue;

      const cells: Record<string, string> = {
        InvoiceMode: defaultInvoiceMode,
      };

      Object.entries(columnMapping).forEach(([colIdxStr, fieldKey]) => {
        if (!fieldKey) return;
        const colIdx = parseInt(colIdxStr, 10);
        cells[fieldKey] = String(row[colIdx] ?? "").trim();
      });

      // Composite First Name + Last Name support
      if (!cells.CustomerName && (cells.FirstName || cells.LastName)) {
        cells.CustomerName = [cells.FirstName, cells.LastName].filter(Boolean).join(" ");
      }

      // Composite Address Line 1 + 2 support
      if (!cells.PermanentAddress && (cells.AddressLine1 || cells.AddressLine2)) {
        cells.PermanentAddress = [cells.AddressLine1, cells.AddressLine2].filter(Boolean).join(", ");
      }

      importRows.push({
        rowNo: r + 1,
        cells,
      });
    }
    return importRows;
  };

  // ── Step 3: Trigger Deep Lookup Preview ──────────────────────────────────

  const runPreview = async () => {
    if (!isNameMapped) {
      toast.error("Customer Name (or First Name) is mandatory and must be mapped.");
      return;
    }

    const payloadRows = convertMappedToImportRows();
    if (!payloadRows.length) {
      toast.error("No valid customer data rows found.");
      return;
    }

    setChecking(true);
    try {
      const res = await fetchWithAuth(`${API}/import/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payloadRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");

      setPreview(data);
      setExcludedRowNos(new Set());
      setStep(3);
    } catch (e: any) {
      toast.error(e.message || "Failed to inspect records.");
    } finally {
      setChecking(false);
    }
  };

  // ── Step 4: Execute Batch Apply ──────────────────────────────────────────

  const handleApply = async () => {
    if (!preview) return;

    const payloadRows = preview.rows.map((r) => ({
      rowNo: r.rowNo,
      cells: r.data,
    }));

    setApplying(true);
    try {
      const res = await fetchWithAuth(`${API}/import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: payloadRows,
          existing: existingMode,
          fileName: file?.name || (sourceType === "leads" ? "SaLeads_Pool" : "Direct_Entry"),
          sourceTag: sourceTag.trim(),
          excludedRowNos: Array.from(excludedRowNos),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import apply failed");

      setApplied(data);
      setStep(4);
      toast.success(
        `Import complete: ${data.summary.created || 0} created, ${data.summary.updated || 0} updated, ${data.summary.skipped || 0} skipped.`
      );
      onImported();
    } catch (e: any) {
      toast.error(e.message || "Failed to execute customer import.");
    } finally {
      setApplying(false);
    }
  };

  // ── Filtered & Searched Preview Rows ─────────────────────────────────────

  const filteredPreviewRows = useMemo(() => {
    if (!preview) return [];
    let list = preview.rows;

    if (previewFilter !== "all") {
      if (previewFilter === "warnings") {
        list = list.filter((r) => (r.warnings || []).length > 0);
      } else {
        list = list.filter((r) => r.status === previewFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) =>
        Object.values(r.data).some((val) => String(val || "").toLowerCase().includes(q)) ||
        (r.reason || "").toLowerCase().includes(q) ||
        (r.match?.customerNo || "").toLowerCase().includes(q) ||
        (r.match?.name || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [preview, previewFilter, searchQuery]);

  const activeErrorsCount = useMemo(() => {
    if (!preview) return 0;
    return preview.rows.filter((r) => !excludedRowNos.has(r.rowNo) && r.status === "error").length;
  }, [preview, excludedRowNos]);

  const approvedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.rows.filter((r) => !excludedRowNos.has(r.rowNo)).length;
  }, [preview, excludedRowNos]);
  // What the import will actually do: errors and in-file repeats are never
  // saved, and existing customers only when filling / updating.
  const willCreate = useMemo(() => (preview ? preview.rows.filter((r) => !excludedRowNos.has(r.rowNo) && r.status === "new").length : 0), [preview, excludedRowNos]);
  const willTouchExisting = useMemo(() => (preview && existingMode !== "skip"
    ? preview.rows.filter((r) => !excludedRowNos.has(r.rowNo) && r.status === "existing").length : 0), [preview, excludedRowNos, existingMode]);

  // Toggle single row exclusion
  const toggleRowExclusion = (rowNo: number) => {
    setExcludedRowNos((prev) => {
      const next = new Set(prev);
      if (next.has(rowNo)) next.delete(rowNo);
      else next.add(rowNo);
      return next;
    });
  };

  // Bulk Selection Helpers
  const selectOnlyNew = () => {
    if (!preview) return;
    const nonNewNos = preview.rows.filter((r) => r.status !== "new").map((r) => r.rowNo);
    setExcludedRowNos(new Set(nonNewNos));
    toast.info("Selected only brand-new customers.");
  };

  const selectOnlyExisting = () => {
    if (!preview) return;
    const nonExistingNos = preview.rows.filter((r) => r.status !== "existing").map((r) => r.rowNo);
    setExcludedRowNos(new Set(nonExistingNos));
    toast.info("Selected only matched existing customers.");
  };

  const excludeAllErrors = () => {
    if (!preview) return;
    const errorRowNos = preview.rows.filter((r) => r.status === "error").map((r) => r.rowNo);
    setExcludedRowNos((prev) => new Set([...prev, ...errorRowNos]));
    toast.info(`Excluded ${errorRowNos.length} invalid rows.`);
  };

  const excludeAllDuplicates = () => {
    if (!preview) return;
    const dupRowNos = preview.rows.filter((r) => r.status === "duplicate").map((r) => r.rowNo);
    setExcludedRowNos((prev) => new Set([...prev, ...dupRowNos]));
    toast.info(`Excluded ${dupRowNos.length} in-file duplicate rows.`);
  };

  // Save inline edit to a preview row
  const saveInlineEdit = (updatedData: Record<string, string>) => {
    if (!preview || !editingRow) return;
    const updatedRows = preview.rows.map((r) => {
      if (r.rowNo === editingRow.rowNo) {
        const nameValid = !!updatedData.CustomerName?.trim();
        const mobClean = (updatedData.Mobile || "").replace(/\D/g, "");
        const mobValid = !mobClean || mobClean.length === 10;
        const panClean = (updatedData.PanNo || "").toUpperCase().trim();
        const panValid = !panClean || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panClean);

        const newErrors = [];
        if (!nameValid) newErrors.push("Customer Name missing");
        if (!mobValid) newErrors.push("Mobile must be 10 digits");
        if (!panValid) newErrors.push("PAN format must be AAAAA9999A");

        return {
          ...r,
          data: updatedData,
          status: newErrors.length ? ("error" as const) : r.status === "error" ? ("new" as const) : r.status,
          errors: newErrors,
        };
      }
      return r;
    });

    const errorCount = updatedRows.filter((r) => r.status === "error").length;
    setPreview({
      rows: updatedRows,
      summary: {
        ...preview.summary,
        error: errorCount,
      },
    });
    setEditingRow(null);
    toast.success(`Row #${editingRow.rowNo} corrected & re-validated.`);
  };

  // Rendered into <body>: inside the page it sat under the page header and
  // the sidebar. Closes only with ✕ / Cancel — a stray click outside must not
  // throw away an uploaded, mapped file.
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="Import customers">
      <div
        className="w-full max-w-6xl max-h-[94vh] flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shadow-xs">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                Import customers
                <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  Step {step} of 4
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                From an Excel or CSV file, a copied table or converted leads. Every row is checked first — nothing is saved until you confirm.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadTemplate(fields)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
            >
              <Download size={13} /> Download Template (.xlsx)
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Step Indicator Bar */}
        <div className="grid grid-cols-4 border-b border-border text-xs bg-muted/10">
          {[
            { n: 1, label: "1. Choose source" },
            { n: 2, label: "2. Match columns" },
            { n: 3, label: "3. Check & confirm" },
            { n: 4, label: "4. Result" },
          ].map((st) => (
            <div
              key={st.n}
              className={`py-2 px-3 text-center font-medium border-r last:border-r-0 border-border transition-colors ${
                step === st.n
                  ? "bg-primary/10 text-primary border-b-2 border-b-primary font-semibold"
                  : step > st.n
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground opacity-60"
              }`}
            >
              {st.label}
            </div>
          ))}
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: Source & Sheet Selection */}
          {step === 1 && (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Source Selector Tabs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl bg-muted/40 p-1 border border-border">
                <button
                  type="button"
                  onClick={() => setSourceType("file")}
                  className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                    sourceType === "file" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Upload size={13} /> Spreadsheet File
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("paste")}
                  className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                    sourceType === "paste" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Clipboard size={13} /> Paste Clipboard
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("leads")}
                  className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                    sourceType === "leads" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <UserCheck size={13} /> Converted Leads {availableLeadsCount !== null ? `(${availableLeadsCount})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("url")}
                  className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                    sourceType === "url" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Globe size={13} /> Google Sheets / URL
                </button>
              </div>

              {/* Source 1: Local File */}
              {sourceType === "file" && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    file
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/60 hover:bg-muted/20"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.tsv,.txt"
                    className="hidden"
                    onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  />
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
                    <Upload size={22} />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">
                    {file ? file.name : "Select or drag and drop customer file"}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Supports Microsoft Excel (.xlsx, .xls), CSV (.csv), or Tab-Delimited (.tsv, .txt)
                  </p>
                  {file && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 size={13} /> {rawRows.length} total rows recognized
                    </span>
                  )}
                </div>
              )}

              {/* Source 2: Clipboard Paste */}
              {sourceType === "paste" && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span>Paste tabular data copied from Excel, Google Sheets, or web portals:</span>
                    <span className="text-muted-foreground font-normal">Auto-detects tabs or commas</span>
                  </label>
                  <textarea
                    rows={8}
                    value={pastedText}
                    onChange={(e) => handlePasteChange(e.target.value)}
                    placeholder="Customer Name&#9;Mobile&#9;Email&#9;PAN&#10;Rahul Sharma&#9;9830012345&#9;rahul@example.com&#9;ABCDE1234F"
                    className="w-full text-xs font-mono rounded-xl border border-border bg-background p-3 resize-y focus:ring-1 focus:ring-primary"
                  />
                  {rawRows.length > 0 && (
                    <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 size={13} /> {rawRows.length} rows recognized from pasted text.
                    </p>
                  )}
                </div>
              )}

              {/* Source 3: Converted Leads Pool */}
              {sourceType === "leads" && (
                <div className="rounded-2xl border border-border p-6 bg-muted/20 text-center space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 flex items-center justify-center mx-auto">
                    <UserCheck size={24} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      Direct Ingestion from CRM Leads Pool
                    </h3>
                    <p className="text-xs text-muted-foreground max-w-lg mx-auto mt-1">
                      Load converted marketing leads directly from Sales Automation into the customer staging pipeline.
                      All leads will retain their original Lead UID, UTM campaign parameters, and sales notes.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={fetchingLeads}
                    onClick={handleFetchConvertedLeads}
                    className="btn-module inline-flex items-center gap-2 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all"
                  >
                    {fetchingLeads ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Fetch Available Converted Leads {availableLeadsCount !== null ? `(${availableLeadsCount})` : ""}
                  </button>
                  {rawRows.length > 0 && (
                    <p className="text-xs text-emerald-600 font-medium">
                      ✓ Successfully loaded {rawRows.length - 1} leads into staging! Click "Next: Map Columns" below.
                    </p>
                  )}
                </div>
              )}

              {/* Source 4: Remote Google Sheets / Web CSV URL */}
              {sourceType === "url" && (
                <div className="space-y-4 rounded-2xl border border-border p-6 bg-muted/20">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Globe size={16} className="text-primary" />
                    <span>Enter Live Public Google Sheets Link or Web CSV URL:</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/.../edit or https://example.com/customers.csv"
                      className="flex-1 text-xs border border-border rounded-xl px-3 py-2 bg-background"
                    />
                    <button
                      type="button"
                      disabled={fetchingRemote || !remoteUrl.trim()}
                      onClick={handleFetchRemoteUrl}
                      className="btn-module text-white text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-50"
                    >
                      {fetchingRemote ? <Loader2 size={13} className="animate-spin" /> : "Fetch Live Data"}
                    </button>
                  </div>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    Tip: For Google Sheets, make sure the sheet is shared as "Anyone with link can view". We'll automatically export it as CSV.
                  </p>
                  {rawRows.length > 0 && (
                    <p className="text-xs text-emerald-600 font-medium">
                      ✓ Successfully loaded {rawRows.length} rows from remote spreadsheet!
                    </p>
                  )}
                </div>
              )}

              {/* Multi-Sheet Selector */}
              {Object.keys(allSheets).length > 1 && (
                <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-2">
                  <label className="text-xs font-semibold text-foreground block">
                    Workbook contains multiple sheets. Choose active sheet:
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(allSheets).map(([shName, shRows]) => (
                      <button
                        key={shName}
                        type="button"
                        onClick={() => handleSheetSelect(shName)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          selectedSheet === shName
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {shName} ({shRows.length} rows)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Header Row Index Offset */}
              {rawRows.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-border p-4 bg-muted/10">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Header Row Location:
                    </label>
                    <select
                      value={headerRowIdx}
                      onChange={(e) => handleHeaderRowChange(parseInt(e.target.value, 10))}
                      className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-background"
                    >
                      {rawRows.slice(0, 15).map((row, idx) => (
                        <option key={idx} value={idx}>
                          Row {idx + 1}: {row.slice(0, 4).filter(Boolean).join(" | ") || "(Empty row)"}
                        </option>
                      ))}
                    </select>
                    <p className="text-[0.6875rem] text-muted-foreground mt-1">
                      Auto-detected header row. Change if your file has title banners at the top.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Campaign / Sourcing Tag (Audit Provenance):
                    </label>
                    <input
                      type="text"
                      value={sourceTag}
                      onChange={(e) => setSourceTag(e.target.value)}
                      placeholder="e.g. 99acres Expo Oct 2026, Magicbricks, Walk-in"
                      className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-background"
                    />
                    <p className="text-[0.6875rem] text-muted-foreground mt-1">
                      Appended to customer notes for complete source attribution.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Interactive Column Mapper */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-3 p-4 rounded-xl border border-border bg-muted/20">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Sparkles size={16} className="text-primary" />
                    Visual Column Mapping & Composite Rules
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Verify how each spreadsheet column maps to Civilier CRM fields. Multi-phone cells and First/Last name columns are automatically handled.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                    isNameMapped
                      ? "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-red-50 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300"
                  }`}>
                    {isNameMapped ? "✓ Name column mapped" : "⚠ Customer Name or First Name required"}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted font-medium text-muted-foreground">
                    {mappedCount} of {headers.length} mapped
                  </span>
                </div>
              </div>

              {/* Mapping Table */}
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold w-12">Col</th>
                      <th className="text-left px-4 py-2.5 font-semibold w-56">Spreadsheet Column</th>
                      <th className="text-left px-4 py-2.5 font-semibold">Sample Data (First 3 Rows)</th>
                      <th className="text-left px-4 py-2.5 font-semibold w-80">Map to CRM Field</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {headers.map((hdr, colIdx) => {
                      const colKey = String(colIdx);
                      const currentField = columnMapping[colKey] || "";
                      const samples = sampleRows.map((r) => r[colIdx]).filter(Boolean);

                      return (
                        <tr key={colIdx} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3 font-mono text-muted-foreground">{excelCol(colIdx)}</td>
                          <td className="px-4 py-3 font-semibold text-foreground">{hdr}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {samples.length > 0 ? (
                              <div className="flex gap-1.5 flex-wrap">
                                {samples.map((s, si) => (
                                  <span key={si} className="px-2 py-0.5 rounded bg-muted text-[0.6875rem] font-mono truncate max-w-[200px]">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40 italic">Empty in sample rows</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={currentField}
                              onChange={(e) => {
                                const val = e.target.value;
                                setColumnMapping((prev) => ({
                                  ...prev,
                                  [colKey]: val,
                                }));
                              }}
                              className={`w-full text-xs border rounded-lg px-2.5 py-1.5 bg-background font-medium ${
                                currentField === "CustomerName" || currentField === "FirstName"
                                  ? "border-emerald-500 text-emerald-700 dark:text-emerald-400 font-semibold"
                                  : currentField
                                  ? "border-primary/50 text-foreground"
                                  : "border-border text-muted-foreground"
                              }`}
                            >
                              <option value="">[ Do Not Import / Skip ]</option>
                              {fields.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label} {f.required ? " *" : ""} ({f.category || "General"})
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Default Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-border p-4 bg-muted/10">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Default Invoice Mode for this Batch:
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="invMode"
                        checked={defaultInvoiceMode === "NonInvoice"}
                        onChange={() => setDefaultInvoiceMode("NonInvoice")}
                      />
                      <span>Non-Invoice (Standard)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="invMode"
                        checked={defaultInvoiceMode === "Invoice"}
                        onChange={() => setDefaultInvoiceMode("Invoice")}
                      />
                      <span>Invoice (GST Billing)</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setColumnMapping(autoMapColumns(headers, fields))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted text-muted-foreground"
                  >
                    <RefreshCw size={13} /> Auto-Map All
                  </button>
                  <button
                    type="button"
                    onClick={() => setColumnMapping({})}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted text-muted-foreground"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Deep Lookup, Review Grid & Diff Viewer */}
          {step === 3 && preview && (
            <div className="space-y-6">
              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <StatBadge label="Total Rows" value={preview.summary.total} active={previewFilter === "all"} onClick={() => setPreviewFilter("all")} />
                <StatBadge label="New Customers" value={preview.summary.new} tone="good" active={previewFilter === "new"} onClick={() => setPreviewFilter("new")} />
                <StatBadge label="Existing Matches" value={preview.summary.existing} tone="warn" active={previewFilter === "existing"} onClick={() => setPreviewFilter("existing")} />
                <StatBadge label="File Duplicates" value={preview.summary.duplicate} tone="warn" active={previewFilter === "duplicate"} onClick={() => setPreviewFilter("duplicate")} />
                <StatBadge label="Errors" value={preview.summary.error} tone={preview.summary.error ? "bad" : "good"} active={previewFilter === "error"} onClick={() => setPreviewFilter("error")} />
                <StatBadge label="Warnings" value={preview.summary.warnings} tone="info" active={previewFilter === "warnings"} onClick={() => setPreviewFilter("warnings")} />
              </div>

              {/* Conflict Resolution Strategy Selector */}
              <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Action Policy for Existing Database Matches ({preview.summary.existing} detected)
                  </h4>
                  {/* Quick Bulk Action Buttons */}
                  <div className="flex gap-2 flex-wrap text-xs">
                    <button
                      type="button"
                      onClick={selectOnlyNew}
                      className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-muted-foreground font-medium"
                    >
                      Select Only New
                    </button>
                    <button
                      type="button"
                      onClick={selectOnlyExisting}
                      className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-muted-foreground font-medium"
                    >
                      Select Only Existing
                    </button>
                    {preview.summary.error > 0 && (
                      <button
                        type="button"
                        onClick={excludeAllErrors}
                        className="px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 font-medium"
                      >
                        Exclude All Errors ({preview.summary.error})
                      </button>
                    )}
                    {preview.summary.duplicate > 0 && (
                      <button
                        type="button"
                        onClick={excludeAllDuplicates}
                        className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-muted-foreground font-medium"
                      >
                        Exclude In-File Duplicates
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setExistingMode("skip")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      existingMode === "skip"
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border bg-background hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <span className="font-semibold block text-xs">1. Leave existing customers as they are</span>
                    <span className="text-[0.6875rem] text-muted-foreground block mt-0.5">
                      Matched customers are not touched; only brand-new customers will be created.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExistingMode("fill")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      existingMode === "fill"
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border bg-background hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <span className="font-semibold block text-xs">2. Fill in their blank details only</span>
                    <span className="text-[0.6875rem] text-muted-foreground block mt-0.5">
                      Only fills fields that are currently empty on their profile. Existing data stays safe.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExistingMode("update")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      existingMode === "update"
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border bg-background hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <span className="font-semibold block text-xs">3. Update their details from the file</span>
                    <span className="text-[0.6875rem] text-muted-foreground block mt-0.5">
                      Replaces contact, address and profile details with the file's values. Name, mobile, PAN, Aadhaar and email of a customer who already has an application are never changed here — use the customer's own edit for those.
                    </span>
                  </button>
                </div>
              </div>

              {/* Search & Action Filter Bar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[240px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, phone, PAN, email, or row number..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {willCreate} new customer{willCreate === 1 ? "" : "s"} to create{willTouchExisting ? ` · ${willTouchExisting} existing to ${existingMode === "fill" ? "fill in" : "update"}` : ""} · errors and repeats are not saved ({excludedRowNos.size} excluded by you)
                  </span>
                  <button
                    type="button"
                    onClick={() => setExcludedRowNos(new Set())}
                    className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-muted-foreground font-medium"
                  >
                    Include All
                  </button>
                </div>
              </div>

              {/* Data Review Grid */}
              <div className="rounded-xl border border-border overflow-hidden max-h-[380px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs text-muted-foreground border-b border-border z-10">
                    <tr>
                      <th className="px-3 py-2 text-center w-10">Import</th>
                      <th className="px-3 py-2 text-left w-14">Row</th>
                      <th className="px-3 py-2 text-left w-24">Status</th>
                      <th className="px-3 py-2 text-left w-48">Customer Name</th>
                      <th className="px-3 py-2 text-left w-32">Mobile</th>
                      <th className="px-3 py-2 text-left w-28">PAN</th>
                      <th className="px-3 py-2 text-left">Lookup Details & Warnings</th>
                      <th className="px-3 py-2 text-center w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredPreviewRows.map((r) => {
                      const isExcluded = excludedRowNos.has(r.rowNo);

                      const statusBadge = {
                        new: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
                        existing: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
                        duplicate: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
                        error: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 font-semibold",
                      }[r.status];

                      return (
                        <tr
                          key={r.rowNo}
                          className={`transition-colors ${
                            isExcluded
                              ? "opacity-40 bg-muted/20 line-through"
                              : r.status === "error"
                              ? "bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/70"
                              : "hover:bg-muted/10"
                          }`}
                        >
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleRowExclusion(r.rowNo)}
                              className="rounded border-border text-primary focus:ring-primary"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{r.rowNo}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[0.625rem] capitalize ${statusBadge}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium text-foreground">
                            {r.data.CustomerName || "—"}
                            {r.data.CoApplicantName && (
                              <span className="block text-[0.625rem] text-muted-foreground">
                                Co-App: {r.data.CoApplicantName} ({r.data.CoApplicantRelation || "Co-Applicant"})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {r.data.Mobile || "—"}
                            {r.data.AltMobile && (
                              <span className="block text-[0.625rem] text-muted-foreground">
                                Alt: {r.data.AltMobile}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono uppercase">{r.data.PanNo || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.status === "existing" && r.match && (
                              <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
                                <AlertTriangle size={13} className="shrink-0" />
                                <span>
                                  Matched {r.match.customerNo} ({r.match.name}) via {r.match.by.join(", ")}
                                </span>
                              </div>
                            )}
                            {r.status === "duplicate" && (
                              <span className="text-orange-700 dark:text-orange-300">{r.reason}</span>
                            )}
                            {r.status === "error" && (
                              <span className="text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
                                <AlertCircle size={13} className="shrink-0" />
                                {(r.errors || []).join("; ")}
                              </span>
                            )}
                            {r.leadMatch && (
                              <span className="inline-flex items-center gap-1 text-[0.6875rem] px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 mr-1.5">
                                Linked Lead {r.leadMatch.leadUid} ({r.leadMatch.status})
                              </span>
                            )}
                            {(r.warnings || []).length > 0 && r.status !== "error" && (
                              <span className="text-amber-600 dark:text-amber-400 text-[0.6875rem]">
                                {(r.warnings || []).join("; ")}
                              </span>
                            )}
                            {r.status === "new" && !r.errors?.length && !r.warnings?.length && !r.leadMatch && (
                              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                <Check size={12} /> Ready to register
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {r.status === "existing" && r.match?.current && (
                                <button
                                  type="button"
                                  onClick={() => setDiffRow(r)}
                                  className="p-1 rounded hover:bg-muted text-primary"
                                  title="Compare incoming values with existing database record (Visual Diff)"
                                >
                                  <GitCompare size={13} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingRow(r)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                title="Edit this row directly"
                              >
                                <Pencil size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 4: Execution Results & Audit */}
          {step === 4 && applied && (
            <div className="space-y-6">
              <div className="text-center p-6 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40">
                <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 size={24} />
                </div>
                <h3 className="text-base font-bold text-emerald-950 dark:text-emerald-200">
                  Bulk Customer Entry Completed Successfully
                </h3>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                  Customer account numbers and General Ledger heads were synchronized in real time.
                </p>
              </div>

              {/* Results KPI Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBadge label="Customers Created" value={applied.summary.created} tone="good" />
                <StatBadge label="Customers Updated" value={applied.summary.updated} tone="good" />
                <StatBadge label="Skipped" value={applied.summary.skipped} tone="warn" />
                <StatBadge label="Failed" value={applied.summary.failed} tone={applied.summary.failed ? "bad" : "default"} />
              </div>

              {/* Action Toolbar for Results */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Processed Records Log ({applied.results.length} total)
                </h4>
                {(applied.summary.skipped || 0) + (applied.summary.failed || 0) > 0 && preview && (
                  <button
                    type="button"
                    onClick={() => exportSkippedAndFailedRows(preview.rows, applied.results, fields)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-all"
                  >
                    <Download size={13} /> Download Skipped / Failed Rows (.xlsx)
                  </button>
                )}
              </div>

              {/* Execution Audit Log Table */}
              <div className="rounded-xl border border-border overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left w-14">Row</th>
                      <th className="px-3 py-2 text-left w-24">Result</th>
                      <th className="px-3 py-2 text-left w-48">Customer No / Name</th>
                      <th className="px-3 py-2 text-left">Execution Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {applied.results.map((res) => {
                      const badgeClass = {
                        created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
                        updated: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
                        skipped: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
                        failed: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 font-semibold",
                      }[res.result];

                      return (
                        <tr key={res.rowNo} className="hover:bg-muted/10">
                          <td className="px-3 py-2 font-mono text-muted-foreground">{res.rowNo}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[0.625rem] capitalize ${badgeClass}`}>
                              {res.result}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-semibold text-foreground">
                            {res.customerNo || res.name || "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{res.reason || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation Buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/10">
          <div>
            {step > 1 && step < 4 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as any)}
                disabled={checking || applying}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
              >
                <ArrowLeft size={13} /> Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={checking || applying}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-border hover:bg-muted text-muted-foreground transition-all"
            >
              {step === 4 ? "Done & Return" : "Cancel"}
            </button>

            {step === 1 && (
              <button
                type="button"
                disabled={rawRows.length === 0}
                onClick={() => setStep(2)}
                className="btn-module inline-flex items-center gap-1.5 text-white text-xs font-semibold px-5 py-2 rounded-xl disabled:opacity-40 transition-all shadow-sm"
              >
                Next: Map Columns <ArrowRight size={13} />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={!isNameMapped || checking}
                onClick={runPreview}
                className="btn-module inline-flex items-center gap-1.5 text-white text-xs font-semibold px-5 py-2 rounded-xl disabled:opacity-40 transition-all shadow-sm"
              >
                {checking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Check rows
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                disabled={applying || approvedCount === 0 || activeErrorsCount > 0 || (!willCreate && !willTouchExisting)}
                onClick={handleApply}
                className="btn-module inline-flex items-center gap-1.5 text-white text-xs font-semibold px-5 py-2 rounded-xl disabled:opacity-40 transition-all shadow-sm"
              >
                {applying ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {willCreate || willTouchExisting ? `Import ${willCreate} new${willTouchExisting ? ` + ${willTouchExisting} existing` : ""}` : "Nothing to import"}
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={onClose}
                className="btn-module text-white text-xs font-semibold px-6 py-2 rounded-xl shadow-sm"
              >
                Done & View Customers
              </button>
            )}
          </div>
        </div>

        {/* Side-by-Side Diff Modal */}
        {diffRow && (
          <VisualDiffModal
            row={diffRow}
            onClose={() => setDiffRow(null)}
          />
        )}

        {/* Quick Inline Row Editing Modal */}
        {editingRow && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingRow(null)}>
            <div
              className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Pencil size={14} className="text-primary" /> Edit Row #{editingRow.rowNo}
                </h3>
                <button onClick={() => setEditingRow(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                  <X size={15} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs max-h-[60vh] overflow-y-auto pr-1">
                <div className="col-span-2">
                  <label className="font-semibold block mb-1">Customer Name *</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.CustomerName || ""}
                    id="edit_CustomerName"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Mobile</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.Mobile || ""}
                    id="edit_Mobile"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Alternate Mobile</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.AltMobile || ""}
                    id="edit_AltMobile"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">PAN Card</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.PanNo || ""}
                    id="edit_PanNo"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background uppercase"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Aadhaar</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.AadhaarNo || ""}
                    id="edit_AadhaarNo"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div className="col-span-2">
                  <label className="font-semibold block mb-1">Email</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.Email || ""}
                    id="edit_Email"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div className="col-span-2">
                  <label className="font-semibold block mb-1">Permanent Address</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.PermanentAddress || ""}
                    id="edit_PermanentAddress"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">City</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.PermanentCity || ""}
                    id="edit_PermanentCity"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Pincode</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.PermanentPincode || ""}
                    id="edit_PermanentPincode"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Co-Applicant Name</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.CoApplicantName || ""}
                    id="edit_CoApplicantName"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Co-Applicant Relation</label>
                  <input
                    type="text"
                    defaultValue={editingRow.data.CoApplicantRelation || ""}
                    id="edit_CoApplicantRelation"
                    className="w-full border border-border rounded-lg px-2.5 py-1.5 bg-background"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingRow(null)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated = { ...editingRow.data };
                    [
                      "CustomerName", "Mobile", "AltMobile", "PanNo", "AadhaarNo",
                      "Email", "PermanentAddress", "PermanentCity", "PermanentPincode",
                      "CoApplicantName", "CoApplicantRelation"
                    ].forEach((k) => {
                      const el = document.getElementById(`edit_${k}`) as HTMLInputElement | null;
                      if (el) updated[k] = el.value.trim();
                    });
                    saveInlineEdit(updated);
                  }}
                  className="btn-module text-white text-xs font-semibold px-4 py-1.5 rounded-lg"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  , document.body);
}
