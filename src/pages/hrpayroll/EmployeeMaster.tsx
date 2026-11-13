import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Profile2User, Camera } from "iconsax-react";
import { FileText, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrError, HrSkeleton, HrStatStrip, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED, TONE } from "@/components/sheet/sheetParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { EmployeeDocumentsModal } from "@/components/hrpayroll/EmployeeDocumentsModal";
import {
  getEmployees,
  addEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeCompanyOptions,
  getEmployeeSalaryBreakup,
  type EmployeeRow,
  type EmployeePayload,
  type SalaryBreakupResult,
} from "@/api/employeeMasterApi";
import { getCostCenterOptions } from "@/api/costCenterApi";
import { getUnlinkedEmployeeCandidates, type UnlinkedEmployeeCandidate } from "@/api/offerLetterApi";
import { getSalaryStructureFamilies } from "@/api/salaryStructureApi";
import { getDepartmentOptions } from "@/api/departmentMasterApi";
import { getDesignations } from "@/api/designationMasterApi";
import { Wallet3 } from "iconsax-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

const EMPLOYMENT_TYPES = ["Permanent", "Probation", "Contract", "Consultant", "Intern"];
const GENDERS = ["Male", "Female", "Other"];

const mapRow = (r: EmployeeRow): RecordWithId => ({
  _id: String(r.EmployeeId),
  employeeCode: r.EmployeeCode,
  employeeName: r.EmployeeName,
  photoBase64: r.PhotoBase64 || "",
  dateOfBirth: r.DateOfBirth ? r.DateOfBirth.slice(0, 10) : "",
  gender: r.Gender || "",
  mobile: r.Mobile || "",
  email: r.Email || "",
  address: r.Address || "",
  emergencyContactName: r.EmergencyContactName || "",
  emergencyContactPhone: r.EmergencyContactPhone || "",
  joiningDate: r.JoiningDate ? r.JoiningDate.slice(0, 10) : "",
  confirmationDate: r.ConfirmationDate ? r.ConfirmationDate.slice(0, 10) : "",
  companyId: r.CompanyId ? String(r.CompanyId) : "",
  companyName: r.CompanyName || "-",
  department: r.Department || "",
  designation: r.Designation || "",
  branchLocation: r.BranchLocation || "",
  reportingManagerId: r.ReportingManagerId ? String(r.ReportingManagerId) : "",
  reportingManagerName: r.ReportingManagerName || "-",
  employmentType: r.EmploymentType || "",
  gradeLevel: r.GradeLevel || "",
  costCenterId: r.CostCenterId ? String(r.CostCenterId) : "",
  costCenterName: r.CostCenterName || "-",
  candidateId: r.CandidateId ? String(r.CandidateId) : "",
  candidateCode: r.CandidateCode || "",
  candidateName: r.CandidateName || "",
  bankName: r.BankName || "",
  bankAccountNumber: r.BankAccountNumber || "",
  bankIFSC: r.BankIFSC || "",
  pan: r.PAN || "",
  aadhaar: r.Aadhaar || "",
  uan: r.UAN || "",
  esicNumber: r.ESICNumber || "",
  pfNumber: r.PFNumber || "",
  nomineeName: r.NomineeName || "",
  nomineeRelationship: r.NomineeRelationship || "",
  nomineeContact: r.NomineeContact || "",
  ctcAmount: r.CTCAmount == null ? "" : String(r.CTCAmount),
  ctcFrequency: r.CTCFrequency || "",
  salaryStructureCode: r.SalaryStructureCode || "",
  isActive: r.IsActive,
  documentCount: r.DocumentCount || 0,
});

const toPayload = (form: Record<string, unknown>): EmployeePayload => ({
  EmployeeCode: String(form.employeeCode || "").trim(),
  EmployeeName: String(form.employeeName || "").trim(),
  PhotoBase64: (form.photoBase64 as string) || null,
  DateOfBirth: (form.dateOfBirth as string) || null,
  Gender: (form.gender as string) || null,
  Mobile: (form.mobile as string) || null,
  Email: (form.email as string) || null,
  Address: (form.address as string) || null,
  EmergencyContactName: (form.emergencyContactName as string) || null,
  EmergencyContactPhone: (form.emergencyContactPhone as string) || null,
  JoiningDate: (form.joiningDate as string) || null,
  ConfirmationDate: (form.confirmationDate as string) || null,
  CompanyId: form.companyId ? Number(form.companyId) : null,
  Department: (form.department as string) || null,
  Designation: (form.designation as string) || null,
  BranchLocation: (form.branchLocation as string) || null,
  ReportingManagerId: form.reportingManagerId ? Number(form.reportingManagerId) : null,
  EmploymentType: (form.employmentType as string) || null,
  GradeLevel: (form.gradeLevel as string) || null,
  CostCenterId: form.costCenterId ? Number(form.costCenterId) : null,
  CandidateId: form.candidateId ? Number(form.candidateId) : null,
  BankName: (form.bankName as string) || null,
  BankAccountNumber: (form.bankAccountNumber as string) || null,
  BankIFSC: (form.bankIFSC as string) || null,
  PAN: (form.pan as string) || null,
  Aadhaar: (form.aadhaar as string) || null,
  UAN: (form.uan as string) || null,
  ESICNumber: (form.esicNumber as string) || null,
  PFNumber: (form.pfNumber as string) || null,
  NomineeName: (form.nomineeName as string) || null,
  NomineeRelationship: (form.nomineeRelationship as string) || null,
  NomineeContact: (form.nomineeContact as string) || null,
  CTCAmount: form.ctcAmount ? Number(form.ctcAmount) : null,
  CTCFrequency: (form.ctcFrequency as "Annual" | "Monthly") || null,
  SalaryStructureCode: (form.salaryStructureCode as string) || null,
  IsActive: form.isActive !== false,
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Small self-contained photo upload field for the "custom" FieldDef slot --
// stores a data URI directly on the employee record (small profile photos
// only; large attachments belong in the Documents sub-resource instead).
const PhotoField: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ value, onChange }) => {
  const photo = (value as string) || "";
  const inputId = "employee-photo-input";
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 border border-foreground/40 bg-foreground/5 flex items-center justify-center overflow-hidden shrink-0">
        {photo ? (
          <img src={photo} alt="Employee" className="w-full h-full object-cover" />
        ) : (
          <Camera size={20} className="text-muted-foreground" variant="Linear" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className={`${KEY_LINE} h-9 px-3 cursor-pointer`}
        >
          <Camera size={13} /> {photo ? "Change Photo" : "Upload Photo"}
        </label>
        {photo && (
          <button
            type="button"
            onClick={() => onChange("")}
            className={`${KEY_RED} h-9 px-3`}
          >
            Remove
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            toast.error("Photo must be under 2 MB");
            return;
          }
          const dataUri = await fileToBase64(file);
          onChange(dataUri);
          e.target.value = "";
        }}
      />
    </div>
  );
};

// Spec 6's "Employee Salary Details" -- read-only calculated breakup for
// one employee, using their own CTC + assigned Salary Structure. Same
// modal pattern as EmployeeDocumentsModal.
const SalaryBreakupModal: React.FC<{
  employeeId: number;
  employeeName: string;
  onClose: () => void;
}> = ({ employeeId, employeeName, onClose }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ["employee-salary-breakup", employeeId],
    queryFn: () => getEmployeeSalaryBreakup(employeeId),
  });
  const result = data as SalaryBreakupResult | undefined;

  return (
    <BodyPortal><div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-2xl max-h-[85vh] overflow-y-auto" style={{ border: HR_RULE }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
          <div>
            <h3 className={HR_HEAD}>Salary details</h3>
            <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{employeeName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"><X size={14} /></button>
        </div>
        <div className="p-5">
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message || "Failed to load salary breakup"}</p>}
          {result && !result.valid && (
            <div className="space-y-1">
              {result.errors.map((e, i) => (
                <p key={i} className="text-sm text-destructive">{e.message}</p>
              ))}
            </div>
          )}
          {result && result.valid && result.totals && (
            <div className="space-y-3">
              <p className="text-[0.6875rem] text-muted-foreground">
                Structure: {result.SalaryStructureName} (v{result.SalaryStructureVersion})
              </p>
              <div className="overflow-hidden" style={{ border: HR_RULE }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={HR_LBL} style={{ borderBottom: HR_RULE }}>
                      <th className="text-left px-3 py-2">Salary Head</th>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-left px-3 py-2">Calculation</th>
                      <th className="text-right px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/15">
                    {result.lines.map((l) => (
                      <tr key={l.DeductionAdditionId}>
                        <td className="px-3 py-2 font-medium">{l.HeadName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.HeadType}</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.Calculation}</td>
                        <td className="px-3 py-2 text-right font-heading tabular-nums">₹{l.Amount.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold" style={{ borderTop: HR_RULE }}>
                      <td className="px-3 py-2" colSpan={3}>Gross Salary</td>
                      <td className="px-3 py-2 text-right font-heading tabular-nums">₹{result.totals.GrossSalary.toLocaleString("en-IN")}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td className="px-3 py-2" colSpan={3}>Total Employee Deduction</td>
                      <td className="px-3 py-2 text-right font-heading tabular-nums">₹{result.totals.TotalEmployeeDeduction.toLocaleString("en-IN")}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td className="px-3 py-2" colSpan={3}>Net Salary</td>
                      <td className="px-3 py-2 text-right font-heading tabular-nums">₹{result.totals.NetSalary.toLocaleString("en-IN")}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td className="px-3 py-2" colSpan={3}>Employer Contribution</td>
                      <td className="px-3 py-2 text-right font-heading tabular-nums">₹{result.totals.TotalEmployerContribution.toLocaleString("en-IN")}</td>
                    </tr>
                    <tr className="bg-primary/5 font-bold" style={{ borderTop: HR_RULE }}>
                      <td className="px-3 py-2" colSpan={3}>Total CTC</td>
                      <td className="px-3 py-2 text-right font-heading tabular-nums">₹{result.totals.TotalCTC.toLocaleString("en-IN")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div></BodyPortal>
  );
};

export default function EmployeeMaster() {
  const rights = usePageRights("employee-master");
  const queryClient = useQueryClient();
  const [docsFor, setDocsFor] = useState<{ id: number; name: string } | null>(null);
  const [breakupFor, setBreakupFor] = useState<{ id: number; name: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["employee-master"],
    queryFn: getEmployees,
    staleTime: 60 * 1000,
  });

  const { data: costCenterData } = useQuery({
    queryKey: ["cost-center-options"],
    queryFn: getCostCenterOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: companyData } = useQuery({
    queryKey: ["employee-company-options"],
    queryFn: getEmployeeCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  // Department and Designation come from their masters (Department Master / Designation Master).
  const { data: departmentData } = useQuery({ queryKey: ["department-master-options"], queryFn: getDepartmentOptions, staleTime: 5 * 60 * 1000 });
  const { data: designationData } = useQuery({ queryKey: ["designation-master"], queryFn: getDesignations, staleTime: 5 * 60 * 1000 });
  const departmentNames = (Array.isArray(departmentData) ? departmentData : []).filter((d) => d.IsActive !== false).map((d) => d.DepartmentName);
  const designationList = (Array.isArray(designationData) ? designationData : []).filter((d) => d.IsActive !== false);

  const { data: unlinkedData } = useQuery({
    queryKey: ["offer-letter-unlinked-employees"],
    queryFn: getUnlinkedEmployeeCandidates,
    staleTime: 30 * 1000,
  });

  const rows: EmployeeRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);
  const costCenterOptions = (Array.isArray(costCenterData) ? costCenterData : []).map((c) => ({
    value: String(c.id),
    label: c.code ? c.code + " - " + c.label : c.label,
  }));
  const companyOptions = (Array.isArray(companyData) ? companyData : []).map((c) => ({
    value: String(c.id),
    label: c.label,
  }));
  const unlinkedCandidates: UnlinkedEmployeeCandidate[] = Array.isArray(unlinkedData) ? unlinkedData : [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["employee-master"] });
    queryClient.invalidateQueries({ queryKey: ["offer-letter-unlinked-employees"] });
  };

  // Selecting a candidate in the (new-record-only) Candidate dropdown
  // auto-fills the rest of the form from their Offer Letter & Joining
  // record, via MasterPage's externalFormPatch mechanism (applied in its
  // own effect -- safe from the render-order races that come with driving
  // several field updates off onFormChange's nested setState). Cleared
  // right after so a later Edit on an unrelated row never gets it merged
  // in via handleEdit's unconditional externalFormPatch spread.
  const [pickedCandidateId, setPickedCandidateId] = useState("");
  const pickedCandidate = unlinkedCandidates.find((c) => String(c.CandidateId) === pickedCandidateId);
  const candidatePatch = pickedCandidate
    ? {
        candidateId: pickedCandidateId,
        employeeName: pickedCandidate.CandidateName || "",
        mobile: pickedCandidate.Contact || "",
        email: pickedCandidate.Email || "",
        address: pickedCandidate.CandidateAddress || "",
        companyId: pickedCandidate.CompanyId ? String(pickedCandidate.CompanyId) : "",
        department: pickedCandidate.DepartmentName || "",
        designation: pickedCandidate.DesignationName || "",
        joiningDate: pickedCandidate.ActualDateOfJoining ? pickedCandidate.ActualDateOfJoining.slice(0, 10) : "",
        candidateCode: pickedCandidate.CandidateCode || "",
        candidateName: pickedCandidate.CandidateName || "",
      }
    : null;
  const handlePickCandidate = (candidateId: string) => {
    setPickedCandidateId(candidateId);
    if (candidateId) setTimeout(() => setPickedCandidateId(""), 0);
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addEmployee(toPayload(event.record));
        toast.success("Employee added");
        await refresh();
      } catch (err: any) {
        toast.error("Save failed: " + (err?.message || "Unknown error"));
      }
    }
    if (event.action === "update") {
      try {
        await updateEmployee(Number(event.id), toPayload(event.record));
        toast.success("Employee updated");
        await refresh();
      } catch (err: any) {
        toast.error("Update failed: " + (err?.message || "Unknown error"));
      }
    }
    if (event.action === "delete") {
      try {
        const res = await deleteEmployee(Number(event.id));
        toast.success(res?.message || "Employee removed");
        await refresh();
      } catch (err: any) {
        toast.error("Delete failed: " + (err?.message || "Unknown error"));
      }
    }
  };

  const fields: FieldDef[] = [
    { name: "sec-basic", label: "Basic Information", type: "section" },
    {
      name: "candidateId",
      label: "Candidate",
      type: "custom",
      fullWidth: true,
      render: (p) => {
        const isExistingRecord = !!p.formData._id;
        if (isExistingRecord) {
          return p.formData.candidateId ? (
            <div className="w-full min-h-9 px-2.5 py-2 border border-foreground/20 bg-foreground/5 text-sm text-foreground">
              <span className={HR_NUM}>{(p.formData.candidateCode as string) || "-"}</span> {(p.formData.candidateName as string) ? `— ${p.formData.candidateName}` : ""}
              <span className="ml-2 text-[0.6875rem] text-muted-foreground">(auto-linked from Offer Letter &amp; Joining)</span>
            </div>
          ) : (
            <div className="w-full h-9 px-2.5 flex items-center border border-foreground/20 bg-foreground/5 text-sm text-muted-foreground">
              Not linked to a candidate — created directly in Employees
            </div>
          );
        }
        return (
          <div>
            <SearchableNativeSelect
              value={(p.value as string) || ""}
              onChange={(e) => {
                p.onChange(e.target.value);
                handlePickCandidate(e.target.value);
              }}
              className={HR_FIELD}
            >
              <option value="">— Not linked (fill in manually) —</option>
              {unlinkedCandidates.map((c) => (
                <option key={c.CandidateId} value={String(c.CandidateId)}>
                  {c.CandidateCode} — {c.CandidateName}
                </option>
              ))}
            </SearchableNativeSelect>
            <p className="text-[0.6875rem] text-muted-foreground mt-1">
              Only candidates with a confirmed Offer Letter &amp; Joining who aren't already an employee are listed. Picking one fills in the fields below.
            </p>
          </div>
        );
      },
    },
    // Rows of three on desktop: identity → contact → personal → photo/address.
    { name: "employeeCode", label: "Employee ID / Employee Code", type: "text", required: true, uppercase: true, placeholder: "e.g. EMP-0001" },
    { name: "employeeName", label: "Employee Name", type: "text", required: true },
    { name: "companyId", label: "Company", type: "select", asyncOptions: async () => companyOptions },
    { name: "mobile", label: "Mobile", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "dateOfBirth", label: "Date of Birth", type: "date" },
    { name: "gender", label: "Gender", type: "select", options: GENDERS },
    { name: "emergencyContactName", label: "Emergency Contact Name", type: "text" },
    { name: "emergencyContactPhone", label: "Emergency Contact Phone", type: "text" },
    { name: "photoBase64", label: "Photo", type: "custom", fullWidth: true, render: (p) => <PhotoField value={p.value} onChange={p.onChange} /> },
    { name: "address", label: "Address", type: "textarea", fullWidth: true },

    { name: "sec-employment", label: "Employment Details", type: "section" },
    { name: "joiningDate", label: "Joining Date", type: "date" },
    { name: "confirmationDate", label: "Confirmation Date", type: "date" },
    {
      name: "department",
      label: "Department",
      type: "select",
      optionsProvider: (_all, _id, form) => {
        const names = [...departmentNames];
        const cur = String(form?.department ?? "");
        // An older record may carry a department name typed before the master existed — keep it selectable.
        if (cur && !names.includes(cur)) names.unshift(cur);
        return names.map((n) => ({ value: n, label: n }));
      },
    },
    {
      name: "designation",
      label: "Designation",
      type: "select",
      optionsProvider: (_all, _id, form) => {
        const dept = String(form?.department ?? "");
        // With a department chosen, offer that department's designations plus the ones not tied to any department.
        const names = designationList
          .filter((d) => !dept || !d.DepartmentName || d.DepartmentName === dept)
          .map((d) => d.DesignationName);
        const cur = String(form?.designation ?? "");
        if (cur && !names.includes(cur)) names.unshift(cur);
        return Array.from(new Set(names)).map((n) => ({ value: n, label: n }));
      },
    },
    { name: "branchLocation", label: "Branch / Location", type: "text" },
    {
      name: "reportingManagerId",
      label: "Reporting To",
      type: "select",
      optionsProvider: (allData, currentId) =>
        allData
          .filter((r) => r._id !== currentId)
          .map((r) => ({
            value: r._id,
            label: (r.employeeName as string) + (r.employeeCode ? " (" + r.employeeCode + ")" : ""),
          })),
    },
    { name: "employmentType", label: "Employment Type", type: "select", options: EMPLOYMENT_TYPES },
    { name: "gradeLevel", label: "Grade / Level", type: "text" },
    { name: "costCenterId", label: "Cost Centre", type: "select", asyncOptions: async () => costCenterOptions },

    { name: "sec-payroll", label: "Payroll", type: "section" },
    { name: "ctcAmount", label: "CTC Amount", type: "number" },
    { name: "ctcFrequency", label: "CTC Frequency", type: "select", options: ["Annual", "Monthly"] },
    {
      name: "salaryStructureCode",
      label: "Salary Structure",
      type: "select",
      asyncOptions: async () => {
        const list = await getSalaryStructureFamilies();
        return (Array.isArray(list) ? list : []).map((s) => ({ value: s.Code, label: s.Name }));
      },
    },

    { name: "sec-bank", label: "Bank Details", type: "section" },
    { name: "bankName", label: "Bank Name", type: "text" },
    { name: "bankAccountNumber", label: "Account Number", type: "text" },
    { name: "bankIFSC", label: "IFSC Code", type: "text", uppercase: true },

    { name: "sec-statutory", label: "Statutory Details", type: "section" },
    { name: "pan", label: "PAN (Permanent Account Number)", type: "text", uppercase: true },
    { name: "aadhaar", label: "Aadhaar", type: "text" },
    { name: "uan", label: "UAN", type: "text" },
    { name: "esicNumber", label: "ESIC Number", type: "text" },
    { name: "pfNumber", label: "PF Number", type: "text" },

    { name: "sec-nominee", label: "Nominee Details", type: "section" },
    { name: "nomineeName", label: "Nominee Name", type: "text" },
    { name: "nomineeRelationship", label: "Nominee Relationship", type: "text" },
    { name: "nomineeContact", label: "Nominee Contact", type: "text" },

    { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
  ];

  const columns: ColumnDef[] = [
    { key: "employeeCode", label: "Code" },
    { key: "employeeName", label: "Name" },
    { key: "companyName", label: "Company", hideOnMobile: true, sortable: false },
    { key: "candidateCode", label: "Candidate", hideOnMobile: true, sortable: false },
    { key: "designation", label: "Designation", hideOnMobile: true },
    { key: "department", label: "Department", hideOnMobile: true },
    { key: "employmentType", label: "Type", hideOnMobile: true },
    { key: "reportingManagerName", label: "Reporting To", hideOnMobile: true, sortable: false },
    { key: "documents", label: "Documents", sortable: false },
    { key: "salaryBreakup", label: "Salary", sortable: false },
    { key: "isActive", label: "Status" },
  ];

  // A small ruled tag for a word in a cell.
  const chip = "inline-flex items-center px-1.5 py-0.5 border border-foreground/30 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground";

  const columnRenderers: Record<string, (value: unknown, row: RecordWithId) => React.ReactNode> = {
    employeeCode: (value) => (
      <span className={`${HR_NUM} text-[0.6875rem] font-semibold`}>{String(value || "—")}</span>
    ),
    employeeName: (value, row) => (
      <div className="flex items-center gap-2.5 min-w-0">
        <HrAvatar name={String(value || "")} size={28} />
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{String(value || "-")}</p>
          {(row.mobile || row.email) && (
            <p className="text-[0.6875rem] text-muted-foreground truncate">{String(row.mobile || row.email)}</p>
          )}
        </div>
      </div>
    ),
    designation: (value) => (value ? <span className="text-sm text-foreground">{String(value)}</span> : <span className="text-xs text-muted-foreground">-</span>),
    department: (value) =>
      value ? <span className={chip}>{String(value)}</span> : <span className="text-xs text-muted-foreground">—</span>,
    employmentType: (value) =>
      value ? (
        <span className={chip}>{String(value)}</span>
      ) : <span className="text-xs text-muted-foreground">-</span>,
    candidateCode: (value, row) =>
      value ? (
        <span className={`text-xs ${HR_NUM}`} title={row.candidateName as string}>{String(value)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
    isActive: (value) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "draft"} />,
    documents: (_value, row) => (
      <button
        type="button"
        onClick={() =>
          setDocsFor({ id: Number(row._id), name: (row.employeeName as string) || "" })
        }
        className={`${KEY_LINE} h-8 px-3`}
        title="Documents"
      >
        <FileText size={12} /> <span className="font-heading tabular-nums">{Number(row.documentCount || 0)}</span>
      </button>
    ),
    salaryBreakup: (_value, row) =>
      row.ctcAmount && row.salaryStructureCode ? (
        <button
          type="button"
          onClick={() => setBreakupFor({ id: Number(row._id), name: (row.employeeName as string) || "" })}
          className={`${KEY_INK} h-8 px-3`}
        >
          <Wallet3 size={12} /> View
        </button>
      ) : (
        <span className="text-[0.6875rem] text-muted-foreground">No CTC</span>
      ),
  };

  // Display-only summary from the rows already loaded.
  const summary = (() => {
    const active = mappedData.filter((r) => r.isActive).length;
    const depts = new Set(mappedData.map((r) => String(r.department || "")).filter(Boolean)).size;
    const withCtc = mappedData.filter((r) => r.ctcAmount && r.salaryStructureCode).length;
    return [
      ["Total", mappedData.length],
      ["Active", active],
      ["Inactive", mappedData.length - active],
      ["Departments", depts],
      ["With salary / CTC", withCtc],
    ] as const;
  })();

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "HR and Payroll", path: "/hr-payroll" }, { label: "Setup" }, { label: "Employees" }]} />
      <HrPayrollShell title="Employees" subtitle="Employees, roles, statutory & bank details" icon={Profile2User}>
        {isLoading ? (
          <HrSkeleton rows={2} />
        ) : error ? (
          <HrError text="Failed to load employees." />
        ) : (
        <>
        <div className="mb-4">
          <HrStatStrip items={summary.map(([label, n], i) => ({ label, value: n, tone: i === 1 ? TONE.blue : i === 2 && n ? TONE.red : undefined }))} />
        </div>
        <MasterPage
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          title="Employee"
          gridCols={3}
          collapsibleAddForm
          fields={fields}
          columns={columns}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          onFieldChange={(next, fieldName) => {
            if (fieldName !== "department") return next;
            const dept = String(next.department ?? "");
            const des = String(next.designation ?? "");
            if (!des) return next;
            const d = designationList.find((x) => x.DesignationName === des);
            // Keep the designation if it is unassigned or belongs to the chosen department; otherwise clear it.
            return !dept || !d || !d.DepartmentName || d.DepartmentName === dept ? next : { ...next, designation: "" };
          }}
          externalFormPatch={candidatePatch}
          externalFormPatchKey={pickedCandidateId || null}
          exportConfig={rights.canExport ? {
            title: "Employees",
            filename: "employee-master",
            columns: [
              { header: "Employee Code", accessor: "employeeCode" },
              { header: "Employee Name", accessor: "employeeName" },
              { header: "Company", accessor: "companyName" },
              { header: "Department", accessor: "department" },
              { header: "Designation", accessor: "designation" },
              { header: "Branch / Location", accessor: "branchLocation" },
              { header: "Reporting To", accessor: "reportingManagerName" },
              { header: "Employment Type", accessor: "employmentType" },
              { header: "Grade / Level", accessor: "gradeLevel" },
              { header: "Cost Centre", accessor: "costCenterName" },
              { header: "Mobile", accessor: "mobile" },
              { header: "Email", accessor: "email" },
              { header: "PAN (Permanent Account Number)", accessor: "pan" },
              { header: "Aadhaar", accessor: "aadhaar" },
              { header: "Status", accessor: (r) => (r.isActive ? "Active" : "Inactive") },
            ],
          } : undefined}
        />
        </>
        )}
      </HrPayrollShell>
      {docsFor && (
        <EmployeeDocumentsModal
          employeeId={docsFor.id}
          employeeName={docsFor.name}
          onClose={() => {
            setDocsFor(null);
            refresh();
          }}
        />
      )}
      {breakupFor && (
        <SalaryBreakupModal
          employeeId={breakupFor.id}
          employeeName={breakupFor.name}
          onClose={() => setBreakupFor(null)}
        />
      )}
    </>
  );
}
