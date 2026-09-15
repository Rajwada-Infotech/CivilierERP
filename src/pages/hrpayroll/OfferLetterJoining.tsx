import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DocumentText1 } from "iconsax-react";
import { Pencil, Trash2, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT } from "@/components/hrpayroll/HrPayrollShell";
import { ExportMenu } from "@/components/ExportMenu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { ExportColumn } from "@/lib/export";
import { getEmployeeCompanyOptions, type EmployeeCompanyOption } from "@/api/employeeMasterApi";
import { getFinYears } from "@/api/finYearApi";
import { getCandidates, type CandidateRow } from "@/api/candidateMasterApi";
import {
  getOfferLetters,
  addOfferLetter,
  updateOfferLetter,
  confirmJoining,
  deleteOfferLetter,
  type OfferLetterRow,
} from "@/api/offerLetterApi";

const labelCls = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const inputCls = "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";

interface FormState {
  candidateId: string;
  companyId: string;
  finYearId: string;
  salary: string;
  candidateAddress: string;
  dateOfJoin: string;
  documentDate: string;
  remarks: string;
}

const emptyForm: FormState = {
  candidateId: "",
  companyId: "",
  finYearId: "",
  salary: "",
  candidateAddress: "",
  dateOfJoin: "",
  documentDate: "",
  remarks: "",
};

const offerExportColumns: ExportColumn[] = [
  { header: "Doc No", accessor: "docNo" },
  { header: "Candidate", accessor: "candidateName" },
  { header: "Company", accessor: "companyName" },
  { header: "Fin Year", accessor: "finYearName" },
  { header: "Salary", accessor: "salary" },
  { header: "Date of Join", accessor: "dateOfJoin" },
  { header: "Document Date", accessor: "documentDate" },
  { header: "Remarks", accessor: "remarks" },
];

// ── Joining tab row: local date + remarks, submitted via PATCH .../joining ──
const JoiningRow: React.FC<{
  offer: OfferLetterRow;
  canEdit: boolean;
  onSaved: () => void;
}> = ({ offer, canEdit, onSaved }) => {
  const [date, setDate] = useState(offer.ActualDateOfJoining ? offer.ActualDateOfJoining.slice(0, 10) : "");
  const [remarks, setRemarks] = useState(offer.JoiningRemarks || "");

  const mutation = useMutation({
    mutationFn: () => confirmJoining(offer.OfferId, date, remarks?.trim() || null),
    onSuccess: async () => {
      toast.success("Joining confirmed");
      onSaved();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to confirm joining"),
  });

  return (
    <tr className="border-b border-border/60 hover:bg-muted/20">
      <td className="px-4 py-2.5 font-mono text-xs">{offer.DocNo}</td>
      <td className="px-4 py-2.5">
        <div className="font-medium">{offer.CandidateName}</div>
        <div className="text-[11px] text-muted-foreground">{offer.CandidateCode}</div>
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">{offer.CompanyName || "-"}</td>
      <td className="px-4 py-2.5 hidden sm:table-cell">{offer.DateOfJoin ? offer.DateOfJoin.slice(0, 10) : "-"}</td>
      <td className="px-4 py-2.5">
        {canEdit ? (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-1 rounded-lg text-xs bg-muted border border-border" />
        ) : (
          date || "-"
        )}
      </td>
      <td className="px-4 py-2.5 hidden lg:table-cell">
        {canEdit ? (
          <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks" className="px-2 py-1 rounded-lg text-xs bg-muted border border-border w-full" />
        ) : (
          remarks || "-"
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${offer.JoiningConfirmed ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-muted text-muted-foreground border-border"}`}>
          {offer.JoiningConfirmed ? "Joined" : "Pending"}
        </span>
      </td>
      {canEdit && (
        <td className="px-4 py-2.5 text-right">
          <button
            onClick={() => date && mutation.mutate()}
            disabled={!date || mutation.isPending}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {offer.JoiningConfirmed ? "Update" : "Confirm"}
          </button>
        </td>
      )}
    </tr>
  );
};

const OfferLetterJoining: React.FC = () => {
  const rights = usePageRights("offer-letter-joining");
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["offer-letter"],
    queryFn: getOfferLetters,
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

  const rows: OfferLetterRow[] = Array.isArray(data) ? data : [];
  const allCandidates: CandidateRow[] = Array.isArray(candidateData) ? candidateData : [];
  const selectedCandidates = allCandidates.filter((c) => c.InterviewStatus === "Selected");
  const companies: EmployeeCompanyOption[] = Array.isArray(companyData) ? companyData : [];

  const selectedCandidate = allCandidates.find((c) => String(c.CandidateId) === form.candidateId) || null;

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["offer-letter"] });

  const handleEdit = (row: OfferLetterRow) => {
    setEditingId(row.OfferId);
    setForm({
      candidateId: String(row.CandidateId),
      companyId: row.CompanyId ? String(row.CompanyId) : "",
      finYearId: row.FinYearId ? String(row.FinYearId) : "",
      salary: row.Salary != null ? String(row.Salary) : "",
      candidateAddress: row.CandidateAddress || "",
      dateOfJoin: row.DateOfJoin ? row.DateOfJoin.slice(0, 10) : "",
      documentDate: row.DocumentDate ? row.DocumentDate.slice(0, 10) : "",
      remarks: row.Remarks || "",
    });
  };

  const handleDelete = async (row: OfferLetterRow) => {
    if (!window.confirm(`Delete offer letter "${row.DocNo}"?`)) return;
    try {
      const res = await deleteOfferLetter(row.OfferId);
      toast.success(res?.message || "Offer letter deleted");
      if (editingId === row.OfferId) resetForm();
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.candidateId) return toast.error("Please select a candidate");
    if (!form.documentDate) return toast.error("Please select a document date");

    const payload = {
      CandidateId: Number(form.candidateId),
      CompanyId: form.companyId ? Number(form.companyId) : null,
      FinYearId: form.finYearId ? Number(form.finYearId) : null,
      Salary: form.salary !== "" ? Number(form.salary) : null,
      CandidateAddress: form.candidateAddress?.trim() || null,
      DateOfJoin: form.dateOfJoin || null,
      DocumentDate: form.documentDate,
      Remarks: form.remarks?.trim() || null,
    };

    try {
      if (editingId) {
        await updateOfferLetter(editingId, payload);
        toast.success("Offer letter updated");
      } else {
        await addOfferLetter(payload);
        toast.success("Offer letter added");
      }
      resetForm();
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Save failed");
    }
  };

  const offerExportData = rows.map((r) => ({
    docNo: r.DocNo,
    candidateName: r.CandidateName,
    companyName: r.CompanyName || "-",
    finYearName: r.FinYearName || "-",
    salary: r.Salary ?? "",
    dateOfJoin: r.DateOfJoin ? r.DateOfJoin.slice(0, 10) : "",
    documentDate: r.DocumentDate ? r.DocumentDate.slice(0, 10) : "",
    remarks: r.Remarks || "",
  }));

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading offer letters...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load offer letters.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Offer Letter & Joining"]} />
      <HrPayrollShell title="Offer Letter & Joining" subtitle="Generate offers for selected candidates and confirm joining" icon={DocumentText1}>
        <Tabs defaultValue="offer">
          <TabsList>
            <TabsTrigger value="offer">Offer Letter</TabsTrigger>
            <TabsTrigger value="joining">Joining</TabsTrigger>
          </TabsList>

          {/* ── Offer Letter tab ── */}
          <TabsContent value="offer">
            <div className="space-y-6 mt-4">
              {(rights.canCreate || (editingId && rights.canEdit)) && (
                <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading font-semibold text-foreground text-sm">
                      {editingId ? "Edit Offer Letter" : "Generate Offer Letter"}
                    </h3>
                    {editingId && (
                      <button type="button" onClick={resetForm} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        <X size={13} /> Cancel edit
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Candidate * (Selected in Interview)</label>
                      <select className={inputCls} value={form.candidateId} onChange={(e) => setField("candidateId", e.target.value)}>
                        <option value="">Select...</option>
                        {selectedCandidates.map((c) => (
                          <option key={c.CandidateId} value={c.CandidateId}>
                            {c.CandidateCode} — {c.CandidateName}
                          </option>
                        ))}
                      </select>
                      {selectedCandidates.length === 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1">No candidates marked "Selected" in Interview yet.</p>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Document Number</label>
                      <input className={`${inputCls} font-mono opacity-70`} value={editingId ? rows.find((r) => r.OfferId === editingId)?.DocNo || "" : "(auto-generated on save)"} readOnly disabled />
                    </div>
                  </div>

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
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-medium text-right truncate">{value}</span>
                          </div>
                        ))}
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
                      <label className={labelCls}>Fin Year</label>
                      <FinYearSelect value={form.finYearId} onChange={(v) => setField("finYearId", v)} />
                    </div>
                    <div>
                      <label className={labelCls}>Salary</label>
                      <input type="number" className={inputCls} value={form.salary} onChange={(e) => setField("salary", e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Date of Join</label>
                      <input type="date" className={inputCls} value={form.dateOfJoin} onChange={(e) => setField("dateOfJoin", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Document Date *</label>
                      <input type="date" className={inputCls} value={form.documentDate} onChange={(e) => setField("documentDate", e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Candidate Address</label>
                    <textarea className={inputCls} rows={2} value={form.candidateAddress} onChange={(e) => setField("candidateAddress", e.target.value)} />
                  </div>

                  <div>
                    <label className={labelCls}>Remarks</label>
                    <textarea className={inputCls} rows={2} value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button type="submit" className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                      {editingId ? "Update Offer Letter" : "Save Offer Letter"}
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                  <div>
                    <h3 className="font-heading font-semibold text-foreground text-sm">Offer Letter Records</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
                  </div>
                  <ExportMenu data={offerExportData} columns={offerExportColumns} title="Offer Letter" filename="offer-letter" disabled={rows.length === 0} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Doc No</th>
                        <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Candidate</th>
                        <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Company</th>
                        <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Fin Year</th>
                        <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Date of Join</th>
                        <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No offer letters yet.</td>
                        </tr>
                      )}
                      {rows.map((r) => (
                        <tr key={r.OfferId} className="border-b border-border/60 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono text-xs">{r.DocNo}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium">{r.CandidateName}</div>
                            <div className="text-[11px] text-muted-foreground">{r.CandidateCode}</div>
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">{r.CompanyName || "-"}</td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">{r.FinYearName || "-"}</td>
                          <td className="px-4 py-2.5">{r.DateOfJoin ? r.DateOfJoin.slice(0, 10) : "-"}</td>
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
          </TabsContent>

          {/* ── Joining tab ── */}
          <TabsContent value="joining">
            <div className="bg-card border border-border rounded-xl overflow-hidden mt-4">
              <div className="px-5 py-3.5 border-b border-border">
                <h3 className="font-heading font-semibold text-foreground text-sm">Joining</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Confirm each candidate's actual date of joining</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Doc No</th>
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Candidate</th>
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Company</th>
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Offered Date</th>
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actual Date of Joining</th>
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden lg:table-cell">Remarks</th>
                      <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Status</th>
                      {rights.canEdit && <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No offer letters yet — generate one first.</td>
                      </tr>
                    )}
                    {rows.map((r) => (
                      <JoiningRow key={r.OfferId} offer={r} canEdit={rights.canEdit} onSaved={refresh} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </HrPayrollShell>
    </>
  );
};

// Self-fetching -- see note on the same pattern in DesignationMaster/HolidayMaster.
const FinYearSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const { data } = useQuery({
    queryKey: ["fin-year-options"],
    queryFn: getFinYears,
    staleTime: 5 * 60 * 1000,
  });
  const options = (Array.isArray(data) ? data : []) as any[];
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select...</option>
      {options.map((fy) => (
        <option key={fy.FId} value={fy.FId}>{fy.FName}</option>
      ))}
    </select>
  );
};

export default OfferLetterJoining;
