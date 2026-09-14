import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProfileAdd, DocumentText } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
  type ColumnDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import {
  getCandidates,
  addCandidate,
  updateCandidate,
  deleteCandidate,
  type CandidateRow,
} from "@/api/candidateMasterApi";

const INTERVIEW_STATUSES = [
  "Applied",
  "Shortlisted",
  "Interview Scheduled",
  "Selected",
  "Rejected",
  "On Hold",
  "Offered",
  "Joined",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Read-only display for the server-generated Candidate ID (CAND-00001
// style) — same "(auto-generated on save)" placeholder pattern as
// Interview's Document Number field. formData._id is only present once
// MasterPage has seeded the form from an existing row (edit mode), so
// that's what distinguishes "show the real code" from "still unsaved".
const CandidateIdField: React.FC<{
  value: unknown;
  formData: Record<string, unknown>;
}> = ({ value, formData }) => (
  <input
    className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border font-mono opacity-70 text-foreground"
    value={formData._id ? (value as string) || "" : "(auto-generated on save)"}
    readOnly
    disabled
  />
);

// Resume upload for the "custom" FieldDef slot — stores a data URI + the
// original filename directly on the candidate record (same approach as
// Employee Master's Photo field), no separate attachment table needed for
// a single resume per candidate.
const ResumeField: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ value, onChange }) => {
  const resume = (value as { name: string; dataUri: string } | null) || null;
  const inputId = "candidate-resume-input";
  return (
    <div className="flex items-center gap-3">
      {resume ? (
        <a
          href={resume.dataUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors max-w-[220px] truncate"
        >
          <DocumentText size={13} className="shrink-0" /> <span className="truncate">{resume.name}</span>
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">No resume uploaded</span>
      )}
      <label
        htmlFor={inputId}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
      >
        {resume ? "Replace" : "Upload Resume"}
      </label>
      {resume && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-destructive hover:underline"
        >
          Remove
        </button>
      )}
      <input
        id={inputId}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            toast.error("Resume must be under 5 MB");
            return;
          }
          const dataUri = await fileToBase64(file);
          onChange({ name: file.name, dataUri });
          e.target.value = "";
        }}
      />
    </div>
  );
};

const mapRow = (r: CandidateRow): RecordWithId => ({
  _id: String(r.CandidateId),
  candidateCode: r.CandidateCode,
  candidateName: r.CandidateName,
  contact: r.Contact || "",
  email: r.Email || "",
  qualification: r.Qualification || "",
  experience: r.Experience || "",
  expectedSalary: r.ExpectedSalary ?? "",
  currentSalary: r.CurrentSalary ?? "",
  noticePeriod: r.NoticePeriod || "",
  resume: r.ResumeBase64 ? { name: r.ResumeFileName || "resume", dataUri: r.ResumeBase64 } : null,
  interviewStatus: r.InterviewStatus || "",
  remarks: r.Remarks || "",
  isActive: Boolean(r.IsActive),
});

const toPayload = (r: Record<string, any>) => {
  const resume = r.resume as { name: string; dataUri: string } | null;
  return {
    CandidateCode: r.candidateCode?.trim() || "",
    CandidateName: r.candidateName?.trim() || "",
    Contact: r.contact?.trim() || null,
    Email: r.email?.trim() || null,
    Qualification: r.qualification?.trim() || null,
    Experience: r.experience?.trim() || null,
    ExpectedSalary: r.expectedSalary !== "" && r.expectedSalary != null ? Number(r.expectedSalary) : null,
    CurrentSalary: r.currentSalary !== "" && r.currentSalary != null ? Number(r.currentSalary) : null,
    NoticePeriod: r.noticePeriod?.trim() || null,
    ResumeFileName: resume?.name || null,
    ResumeBase64: resume?.dataUri || null,
    InterviewStatus: r.interviewStatus || null,
    Remarks: r.remarks?.trim() || null,
    IsActive: r.isActive !== false,
  };
};

const fields: FieldDef[] = [
  {
    name: "candidateCode",
    label: "Candidate ID",
    type: "custom",
    render: (p) => <CandidateIdField value={p.value} formData={p.formData} />,
  },
  { name: "candidateName", label: "Name", type: "text", required: true },
  { name: "contact", label: "Contact", type: "text" },
  { name: "email", label: "Email", type: "text" },
  { name: "qualification", label: "Qualification", type: "text" },
  { name: "experience", label: "Experience", type: "text", placeholder: "e.g. 3 years 6 months" },
  { name: "expectedSalary", label: "Expected Salary", type: "number" },
  { name: "currentSalary", label: "Current Salary", type: "number" },
  { name: "noticePeriod", label: "Notice Period", type: "text", placeholder: "e.g. 30 days / Immediate" },
  { name: "resume", label: "Resume", type: "custom", fullWidth: true, render: (p) => <ResumeField value={p.value} onChange={p.onChange} /> },
  { name: "interviewStatus", label: "Interview Status", type: "select", options: INTERVIEW_STATUSES },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
  { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "candidateCode", label: "Candidate ID" },
  { key: "candidateName", label: "Name" },
  { key: "contact", label: "Contact", hideOnMobile: true },
  { key: "email", label: "Email", hideOnMobile: true },
  { key: "experience", label: "Experience", hideOnMobile: true },
  { key: "interviewStatus", label: "Interview Status" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Candidate ID", accessor: "candidateCode" },
  { header: "Name", accessor: "candidateName" },
  { header: "Contact", accessor: "contact" },
  { header: "Email", accessor: "email" },
  { header: "Qualification", accessor: "qualification" },
  { header: "Experience", accessor: "experience" },
  { header: "Expected Salary", accessor: "expectedSalary" },
  { header: "Current Salary", accessor: "currentSalary" },
  { header: "Notice Period", accessor: "noticePeriod" },
  { header: "Interview Status", accessor: "interviewStatus" },
  { header: "Remarks", accessor: "remarks" },
  { header: "Status", accessor: "isActive" },
];

const CandidateMaster: React.FC = () => {
  const rights = usePageRights("candidate-master");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["candidate-master"],
    queryFn: getCandidates,
    staleTime: 60 * 1000,
  });

  const rows: CandidateRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["candidate-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addCandidate(toPayload(event.record));
        toast.success("Candidate added!");
      }
      if (event.action === "update") {
        await updateCandidate(Number(event.id), toPayload(event.record));
        toast.success("Candidate updated!");
      }
      if (event.action === "delete") {
        const res = await deleteCandidate(Number(event.id));
        toast.success(res?.message || "Candidate deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading candidates...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load candidates.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Candidate Master"]} />
      <HrPayrollShell title="Candidate Master" subtitle="Recruitment pipeline & interview tracking" icon={ProfileAdd}>
        <MasterPage
          title="Candidate"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Candidate Master",
            filename: "candidate-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Candidate Details",
            fields: [
              { key: "candidateCode", label: "Candidate ID" },
              { key: "candidateName", label: "Name" },
              { key: "contact", label: "Contact" },
              { key: "email", label: "Email" },
              { key: "qualification", label: "Qualification" },
              { key: "experience", label: "Experience" },
              { key: "expectedSalary", label: "Expected Salary" },
              { key: "currentSalary", label: "Current Salary" },
              { key: "noticePeriod", label: "Notice Period" },
              { key: "interviewStatus", label: "Interview Status" },
              { key: "remarks", label: "Remarks" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </HrPayrollShell>
    </>
  );
};

export default CandidateMaster;
