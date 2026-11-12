import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserTick } from "iconsax-react";
import { Pencil, Trash2, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrError, HrSkeleton, hrCard, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { KEY_INK, KEY_LINE, TONE } from "@/components/sheet/sheetParts";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
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
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

// Sheet fields, table heads and row actions (docs/DESIGN.md).
const labelCls = `block ${HR_LBL} mb-1.5`;
const inputCls = HR_FIELD;
const TH = `${HR_LBL} px-4 py-2.5 font-semibold`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

// Each outcome's word, its colour on the sheet and its status mark: selected settled (blue), rejected stopped (red),
// on hold waiting (ink), pending not yet decided (graphite).
const STATUS_META: Record<InterviewStatus, { label: string; color: string; tone: MarkTone }> = {
  PENDING: { label: "Pending", color: TONE.graphite, tone: "draft" },
  SELECTED: { label: "Selected", color: TONE.blue, tone: "done" },
  REJECTED: { label: "Rejected", color: TONE.red, tone: "stopped" },
  HOLD: { label: "Hold", color: TONE.ink, tone: "waiting" },
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
  // Pipeline filter (display only — the export still covers every row).
  const [stageFilter, setStageFilter] = useState<InterviewStatus | "ALL">("ALL");
  const shownRows = stageFilter === "ALL" ? rows : rows.filter((r) => r.Status === stageFilter);
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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Interviews"]} />
      <HrPayrollShell title="Interviews" subtitle="Schedule interviews and record their outcome" icon={UserTick}>
        {isLoading ? (
          <HrSkeleton rows={2} />
        ) : error ? (
          <HrError text="Failed to load interviews." />
        ) : (
        <div className="space-y-6">
          {/* ── Hiring pipeline: ruled cells, open one to filter the list below ── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 bg-card" style={{ border: HR_RULE }}>
            {([["ALL", "All interviews", TONE.ink] as const, ...(["PENDING", "HOLD", "SELECTED", "REJECTED"] as InterviewStatus[]).map((st) => [st, STATUS_META[st].label, STATUS_META[st].color] as const)]).map(([key, label, color], i) => {
              const n = key === "ALL" ? rows.length : rows.filter((r) => r.Status === key).length;
              const on = stageFilter === key;
              return (
                <button key={key} type="button" onClick={() => setStageFilter(key as InterviewStatus | "ALL")} aria-pressed={on}
                  className={`relative px-4 py-3 text-left transition-colors ${on ? "bg-primary/5" : "hover:bg-primary/5"}`}
                  style={{ borderLeft: i ? "1px solid hsl(var(--foreground) / 0.15)" : undefined }}>
                  <p className={HR_LBL} style={{ color: on ? "hsl(var(--foreground))" : undefined }}>{label}</p>
                  <p className={`${HR_NUM} mt-1.5 text-xl font-bold leading-tight`} style={{ color }}>{n}</p>
                  <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: on ? "hsl(var(--foreground))" : "transparent" }} />
                </button>
              );
            })}
          </div>

          {/* ── Form ── */}
          {(rights.canCreate || (editingId && rights.canEdit)) && (
            <form onSubmit={handleSubmit} className={hrCard}>
              <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
                <h3 className={HR_HEAD}>{editingId ? "Edit interview" : "Schedule interview"}</h3>
                {editingId && (
                  <button type="button" onClick={resetForm} className={`${KEY_LINE} h-8 px-3`}>
                    <X size={12} /> Cancel edit
                  </button>
                )}
              </div>

              <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Candidate *</label>
                    <SearchableNativeSelect className={inputCls} value={form.candidateId} onChange={(e) => setField("candidateId", e.target.value)}>
                      <option value="">Select...</option>
                      {candidates.map((c) => (
                        <option key={c.CandidateId} value={c.CandidateId}>
                          {c.CandidateCode} — {c.CandidateName}
                        </option>
                      ))}
                    </SearchableNativeSelect>
                  </div>
                  <div>
                    <label className={labelCls}>Document Number</label>
                    <div className={`w-full h-9 px-2.5 flex items-center border border-foreground/20 bg-foreground/5 text-sm text-muted-foreground ${editingId ? HR_NUM : ""}`}>
                      {editingId ? rows.find((r) => r.InterviewId === editingId)?.DocNo || "" : "Auto-generated on save"}
                    </div>
                  </div>
                </div>

                {/* ── Candidate detail (read-only, from Candidate Master) ── */}
                {selectedCandidate && (
                  <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground) / 0.25)" }}>
                    <p className={`${HR_LBL} px-4 py-2.5`} style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.15)" }}>Candidate details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 px-4 py-3 text-xs">
                      {[
                        ["Contact", selectedCandidate.Contact || "—"],
                        ["Email", selectedCandidate.Email || "—"],
                        ["Qualification", selectedCandidate.Qualification || "—"],
                        ["Experience", selectedCandidate.Experience || "—"],
                        ["Expected Salary", selectedCandidate.ExpectedSalary != null ? `₹${Number(selectedCandidate.ExpectedSalary).toLocaleString("en-IN")}` : "—"],
                        ["Current Salary", selectedCandidate.CurrentSalary != null ? `₹${Number(selectedCandidate.CurrentSalary).toLocaleString("en-IN")}` : "—"],
                        ["Notice Period", selectedCandidate.NoticePeriod || "—"],
                        ["Interview Status", selectedCandidate.InterviewStatus || "—"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-2 py-0.5" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.08)" }}>
                          <span className="text-muted-foreground">{label}</span>
                          <span className={`font-medium text-right truncate ${/Salary/.test(label) ? HR_NUM : ""}`}>{value}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 py-0.5" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.08)" }}>
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
                    <DateInput className={inputCls} value={form.interviewDate} onChange={(e) => setField("interviewDate", e.target.value)} />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Remarks</label>
                  <textarea className={`${inputCls} !h-auto py-2`} rows={2} value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} />
                </div>
              </div>

              <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: HR_RULE }}>
                <button type="submit" className={`${KEY_INK} h-9 px-5`}>
                  {editingId ? "Update interview" : "Save interview"}
                </button>
              </div>
            </form>
          )}

          {/* ── Records ── */}
          <div className={`${hrCard} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
              <div className="flex items-baseline gap-2.5">
                <h3 className={HR_HEAD}>Interview records</h3>
                <span className={`${HR_NUM} text-[0.6875rem] text-muted-foreground`}>{shownRows.length}{stageFilter !== "ALL" ? ` of ${rows.length}` : ""}</span>
              </div>
              <ExportMenu data={exportData} columns={exportColumns} title="Interview" filename="interview" disabled={rows.length === 0} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: HR_RULE }}>
                    <th className={`${TH} text-left`}>Doc No</th>
                    <th className={`${TH} text-left`}>Candidate</th>
                    <th className={`${TH} text-left hidden sm:table-cell`}>Company</th>
                    <th className={`${TH} text-left`}>Date</th>
                    <th className={`${TH} text-left`}>Status</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/15">
                  {shownRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No records yet. Schedule one above.</td>
                    </tr>
                  )}
                  {shownRows.map((r) => (
                    <tr key={r.InterviewId} className={`transition-colors ${editingId === r.InterviewId ? "bg-primary/5" : "hover:bg-primary/5"}`}>
                      <td className={`px-4 py-2.5 text-xs ${HR_NUM}`}>{r.DocNo}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.CandidateName}</div>
                        <div className={`text-[0.6875rem] text-muted-foreground ${HR_NUM}`}>{r.CandidateCode}</div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">{r.CompanyName || "—"}</td>
                      <td className={`px-4 py-2.5 ${HR_NUM}`}>{r.InterviewDate ? r.InterviewDate.slice(0, 10) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {rights.canEdit ? (
                          <select
                            value={r.Status}
                            disabled={statusMutation.isPending}
                            onChange={(e) => statusMutation.mutate({ id: r.InterviewId, status: e.target.value as InterviewStatus })}
                            className="h-8 px-2 border bg-card font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] outline-none"
                            style={{ color: STATUS_META[r.Status]?.color, borderColor: STATUS_META[r.Status]?.color }}
                          >
                            {(Object.keys(STATUS_META) as InterviewStatus[]).map((s) => (
                              <option key={s} value={s}>{STATUS_META[s].label}</option>
                            ))}
                          </select>
                        ) : (
                          <SheetMark text={STATUS_META[r.Status]?.label || r.Status} tone={STATUS_META[r.Status]?.tone ?? "waiting"} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {rights.canEdit && (
                            <button onClick={() => handleEdit(r)} className={ACT} title="Edit">
                              <Pencil size={13} />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button onClick={() => handleDelete(r)} className={`${ACT} hover:text-destructive hover:border-destructive`} title="Delete">
                              <Trash2 size={13} />
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
        )}
      </HrPayrollShell>
    </>
  );
};

export default InterviewPage;
