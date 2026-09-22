import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserTick } from "iconsax-react";
import { Pencil, Trash2, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT } from "@/components/hrpayroll/HrPayrollShell";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { getEmployeeCompanyOptions, type EmployeeCompanyOption } from "@/api/employeeMasterApi";
import { getCandidates, type CandidateRow } from "@/api/candidateMasterApi";
import {
  getInterviews,
  addInterview,
  updateInterview,
  deleteInterview,
  updateInterviewStatus,
  type InterviewRow,
  type InterviewStatus,
} from "@/api/interviewApi";

const labelCls = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const inputCls = "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";

const STATUS_META: Record<InterviewStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-muted text-muted-foreground border-border" },
  SELECTED: { label: "Selected", className: "bg-green-500/10 text-green-600 border-green-500/30" },
  REJECTED: { label: "Rejected", className: "bg-red-500/10 text-red-600 border-red-500/30" },
  HOLD: { label: "Hold", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
};

interface FormState {
  candidateId: string;
  companyId: string;
  interviewDate: string;
  remarks: string;
}

const emptyForm: FormState = { candidateId: "", companyId: "", interviewDate: "", remarks: "" };

const exportColumns: ExportColumn[] = [
  { header: "Doc No", accessor: "docNo" },
  { header: "Candidate", accessor: "candidateName" },
  { header: "Company", accessor: "companyName" },
  { header: "Date", accessor: "date" },
  { header: "Status", accessor: "statusLabel" },
  { header: "Remarks", accessor: "remarks" },
];

const InterviewPage: React.FC = () => {
  const rights = usePageRights("interview");
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["interview"],
    queryFn: getInterviews,
    staleTime: 30 * 1000,
  });

  const { data: candidateData } = useQuery({
    queryKey: ["candidate-master"],
    queryFn: getCandidates,
    staleTime: 60 * 1000,
  });

  const { data: companyData } = useQuery({
    queryKey: ["employee-company-options"],
    queryFn: getEmployeeCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  const rows: InterviewRow[] = Array.isArray(data) ? data : [];
  const candidates: CandidateRow[] = Array.isArray(candidateData) ? candidateData : [];
  const companies: EmployeeCompanyOption[] = Array.isArray(companyData) ? companyData : [];

  const selectedCandidate = candidates.find((c) => String(c.CandidateId) === form.candidateId) || null;

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["interview"] });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: InterviewStatus }) => updateInterviewStatus(id, status),
    onSuccess: async () => {
      toast.success("Interview status updated");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["candidate-master"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update status"),
  });

  const handleEdit = (row: InterviewRow) => {
    setEditingId(row.InterviewId);
    setForm({
      candidateId: String(row.CandidateId),
      companyId: row.CompanyId ? String(row.CompanyId) : "",
      interviewDate: row.InterviewDate ? row.InterviewDate.slice(0, 10) : "",
      remarks: row.Remarks || "",
    });
  };

  const handleDelete = async (row: InterviewRow) => {
    if (!window.confirm(`Delete interview "${row.DocNo}"?`)) return;
    try {
      const res = await deleteInterview(row.InterviewId);
      toast.success(res?.message || "Interview deleted");
      if (editingId === row.InterviewId) resetForm();
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.candidateId) return toast.error("Please select a candidate");
    if (!form.interviewDate) return toast.error("Please select a date");

    const payload = {
      CandidateId: Number(form.candidateId),
      CompanyId: form.companyId ? Number(form.companyId) : null,
      ProjectId: null,
      InterviewDate: form.interviewDate,
      Remarks: form.remarks?.trim() || null,
    };

    try {
      if (editingId) {
        await updateInterview(editingId, payload);
        toast.success("Interview updated");
      } else {
        await addInterview(payload);
        toast.success("Interview added");
      }
      resetForm();
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Save failed");
    }
  };

  const exportData = rows.map((r) => ({
    docNo: r.DocNo,
    candidateName: r.CandidateName,
    companyName: r.CompanyName || "-",
    date: r.InterviewDate ? r.InterviewDate.slice(0, 10) : "",
    statusLabel: STATUS_META[r.Status]?.label || r.Status,
    remarks: r.Remarks || "",
  }));

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading interviews...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load interviews.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Interview"]} />
      <HrPayrollShell title="Interview" subtitle="Schedule interviews and record their outcome" icon={UserTick}>
        <div className="space-y-6">
          {/* ── Form ── */}
          {(rights.canCreate || (editingId && rights.canEdit)) && (
            <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-heading font-semibold text-foreground text-sm">
                  {editingId ? "Edit Interview" : "Schedule Interview"}
                </h3>
                {editingId && (
                  <button type="button" onClick={resetForm} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    <X size={13} /> Cancel edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Candidate *</label>
                  <select className={inputCls} value={form.candidateId} onChange={(e) => setField("candidateId", e.target.value)}>
                    <option value="">Select...</option>
                    {candidates.map((c) => (
                      <option key={c.CandidateId} value={c.CandidateId}>
                        {c.CandidateCode} — {c.CandidateName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Document Number</label>
                  <input className={`${inputCls} font-mono opacity-70`} value={editingId ? rows.find((r) => r.InterviewId === editingId)?.DocNo || "" : "(auto-generated on save)"} readOnly disabled />
                </div>
              </div>

              {/* ── Candidate detail (read-only, from Candidate Master) ── */}
              {selectedCandidate && (
                <div className="rounded-lg border p-4" style={{ borderColor: `${HR_PAYROLL_ACCENT}33`, backgroundColor: `${HR_PAYROLL_ACCENT}0D` }}>
                  <p className="text-[11px] uppercase tracking-widest font-heading font-semibold pb-2 mb-2 border-b" style={{ color: HR_PAYROLL_ACCENT, borderColor: `${HR_PAYROLL_ACCENT}33` }}>
                    Candidate Details
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                    {[
                      ["Contact", selectedCandidate.Contact || "—"],
                      ["Email", selectedCandidate.Email || "—"],
                      ["Qualification", selectedCandidate.Qualification || "—"],
                      ["Experience", selectedCandidate.Experience || "—"],
                      ["Expected Salary", selectedCandidate.ExpectedSalary != null ? String(selectedCandidate.ExpectedSalary) : "—"],
                      ["Current Salary", selectedCandidate.CurrentSalary != null ? String(selectedCandidate.CurrentSalary) : "—"],
                      ["Notice Period", selectedCandidate.NoticePeriod || "—"],
                      ["Interview Status", selectedCandidate.InterviewStatus || "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium text-right truncate">{value}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Resume</span>
                      {selectedCandidate.ResumeBase64 ? (
                        <a href={selectedCandidate.ResumeBase64} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline truncate">
                          {selectedCandidate.ResumeFileName || "View"}
                        </a>
                      ) : (
                        <span className="font-medium text-right">—</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Company</label>
                  <select className={inputCls} value={form.companyId} onChange={(e) => setField("companyId", e.target.value)}>
                    <option value="">Select...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Date *</label>
                  <input type="date" className={inputCls} value={form.interviewDate} onChange={(e) => setField("interviewDate", e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Remarks</label>
                <textarea className={inputCls} rows={2} value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} />
              </div>

              <div className="flex justify-end gap-2">
                <button type="submit" className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                  {editingId ? "Update Interview" : "Save Interview"}
                </button>
              </div>
            </form>
          )}

          {/* ── Records ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div>
                <h3 className="font-heading font-semibold text-foreground text-sm">Interview Records</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
              </div>
              <ExportMenu data={exportData} columns={exportColumns} title="Interview" filename="interview" disabled={rows.length === 0} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Doc No</th>
                    <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Candidate</th>
                    <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Company</th>
                    <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Date</th>
                    <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No records yet. Schedule one above.</td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.InterviewId} className="border-b border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-xs">{r.DocNo}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.CandidateName}</div>
                        <div className="text-[11px] text-muted-foreground">{r.CandidateCode}</div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">{r.CompanyName || "-"}</td>
                      <td className="px-4 py-2.5">{r.InterviewDate ? r.InterviewDate.slice(0, 10) : "-"}</td>
                      <td className="px-4 py-2.5">
                        {rights.canEdit ? (
                          <select
                            value={r.Status}
                            disabled={statusMutation.isPending}
                            onChange={(e) => statusMutation.mutate({ id: r.InterviewId, status: e.target.value as InterviewStatus })}
                            className={`text-xs px-2 py-1 rounded-full border font-medium ${STATUS_META[r.Status]?.className}`}
                          >
                            {(Object.keys(STATUS_META) as InterviewStatus[]).map((s) => (
                              <option key={s} value={s}>{STATUS_META[s].label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_META[r.Status]?.className}`}>
                            {STATUS_META[r.Status]?.label}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          {rights.canEdit && (
                            <button onClick={() => handleEdit(r)} className="text-muted-foreground hover:text-foreground" title="Edit">
                              <Pencil size={14} />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button onClick={() => handleDelete(r)} className="text-muted-foreground hover:text-destructive" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </HrPayrollShell>
    </>
  );
};

export default InterviewPage;
