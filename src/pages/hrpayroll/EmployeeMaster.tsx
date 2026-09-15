import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Profile2User, Camera } from "iconsax-react";
import { FileText } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT as ACCENT } from "@/components/hrpayroll/HrPayrollShell";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { EmployeeDocumentsModal } from "@/components/hrpayroll/EmployeeDocumentsModal";
import {
  getEmployees,
  addEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeCompanyOptions,
  type EmployeeRow,
  type EmployeePayload,
} from "@/api/employeeMasterApi";
import { getCostCenterOptions } from "@/api/costCenterApi";

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
      <div className="w-16 h-16 rounded-xl border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
        {photo ? (
          <img src={photo} alt="Employee" className="w-full h-full object-cover" />
        ) : (
          <Camera size={20} className="text-muted-foreground" variant="Linear" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <Camera size={13} /> {photo ? "Change Photo" : "Upload Photo"}
        </label>
        {photo && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-destructive hover:underline"
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

export default function EmployeeMaster() {
  const rights = usePageRights("employee-master");
  const queryClient = useQueryClient();
  const [docsFor, setDocsFor] = useState<{ id: number; name: string } | null>(null);

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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["employee-master"] });

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
      render: (p) =>
        p.formData.candidateId ? (
          <div className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground">
            {(p.formData.candidateCode as string) || "-"} {(p.formData.candidateName as string) ? `— ${p.formData.candidateName}` : ""}
            <span className="ml-2 text-[11px] text-muted-foreground">(auto-linked from Offer Letter &amp; Joining)</span>
          </div>
        ) : (
          <div className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-muted-foreground">
            Not linked to a candidate — created directly in Employee Master
          </div>
        ),
    },
    { name: "employeeCode", label: "Employee ID / Employee Code", type: "text", required: true, uppercase: true, placeholder: "e.g. EMP-0001" },
    { name: "employeeName", label: "Employee Name", type: "text", required: true, fullWidth: true },
    { name: "companyId", label: "Company", type: "select", asyncOptions: async () => companyOptions },
    { name: "photoBase64", label: "Photo", type: "custom", fullWidth: true, render: (p) => <PhotoField value={p.value} onChange={p.onChange} /> },
    { name: "dateOfBirth", label: "Date of Birth", type: "date" },
    { name: "gender", label: "Gender", type: "select", options: GENDERS },
    { name: "mobile", label: "Mobile", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "address", label: "Address", type: "textarea", fullWidth: true },
    { name: "emergencyContactName", label: "Emergency Contact Name", type: "text" },
    { name: "emergencyContactPhone", label: "Emergency Contact Phone", type: "text" },

    { name: "sec-employment", label: "Employment Details", type: "section" },
    { name: "joiningDate", label: "Joining Date", type: "date" },
    { name: "confirmationDate", label: "Confirmation Date", type: "date" },
    { name: "department", label: "Department", type: "text" },
    { name: "designation", label: "Designation", type: "text" },
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

    { name: "sec-bank", label: "Bank Details", type: "section" },
    { name: "bankName", label: "Bank Name", type: "text" },
    { name: "bankAccountNumber", label: "Account Number", type: "text" },
    { name: "bankIFSC", label: "IFSC Code", type: "text", uppercase: true },

    { name: "sec-statutory", label: "Statutory Details", type: "section" },
    { name: "pan", label: "PAN", type: "text", uppercase: true },
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
    { key: "isActive", label: "Status" },
  ];

  const columnRenderers: Record<string, (value: unknown, row: RecordWithId) => React.ReactNode> = {
    employeeCode: (value) => <span className="font-mono text-xs font-semibold">{String(value || "-")}</span>,
    candidateCode: (value, row) =>
      value ? (
        <span className="text-xs" title={row.candidateName as string}>{String(value)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
    isActive: (value) => (
      <span
        className={
          "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border " +
          (value
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600"
            : "bg-red-500/10 border-red-500/20 text-red-600")
        }
      >
        <span className={"w-1.5 h-1.5 rounded-full mr-1.5 " + (value ? "bg-emerald-500" : "bg-red-500")} />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    documents: (_value, row) => (
      <button
        type="button"
        onClick={() =>
          setDocsFor({ id: Number(row._id), name: (row.employeeName as string) || "" })
        }
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
      >
        <FileText size={12} /> {Number(row.documentCount || 0)}
      </button>
    ),
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Employee Master.</div>;

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "HR and Payroll", path: "/hr-payroll" }, { label: "Employee Master" }]} />
      <HrPayrollShell title="Employee Master" subtitle="Employees, roles, statutory & bank details" icon={Profile2User}>
        <MasterPage
          title="Employee"
          fields={fields}
          columns={columns}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={rights.canExport ? {
            title: "Employee Master",
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
              { header: "PAN", accessor: "pan" },
              { header: "Aadhaar", accessor: "aadhaar" },
              { header: "Status", accessor: (r) => (r.isActive ? "Active" : "Inactive") },
            ],
          } : undefined}
        />
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
    </>
  );
}
