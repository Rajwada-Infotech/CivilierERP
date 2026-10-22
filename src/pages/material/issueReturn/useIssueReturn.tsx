// Everything the Issue Return page holds: the register, the form and its issue lines,
// the open return, delete and CSV import. The page and its parts read from this one object.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv, parseCsv } from "@/lib/export";
import { useFinYear } from "@/contexts/FinYearContext";
import { API, apiFetch, emptyForm, leftOnLine, today, type FormState, type IssueItem, type IssueOption, type ReturnRow } from "./config";
import { IR_TEMPLATE_COLUMNS, planImport, type PlannedReturn } from "./irImport";

export function useIssueReturn() {
  const qc = useQueryClient();
  const rights = usePageRights("material-issue-return");
  const { finYears } = useFinYear();

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPlan, setImportPlan] = useState<{ fileName: string; plan: PlannedReturn[] } | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [editId, setEditId] = useState<number | null>(null);
  const [detailRecord, setDetailRecord] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<ReturnRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading: loading } = useQuery<ReturnRow[]>({
    queryKey: ["issue-returns"],
    queryFn: () => apiFetch<ReturnRow[]>(API),
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["issue-return-companies"],
    queryFn: () => apiFetch<any[]>("/api/enterprises/options?business_type=C"),
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["issue-return-projects"],
    queryFn: () => apiFetch<any[]>("/api/enterprises/options?business_type=P"),
  });

  const { data: issues = [] } = useQuery<IssueOption[]>({
    queryKey: ["issue-return-issues", form.CompanyId, form.ProjectId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (form.CompanyId) p.set("companyId", form.CompanyId);
      if (form.ProjectId) p.set("projectId", form.ProjectId);
      return apiFetch<IssueOption[]>(`${API}/issues?${p}`);
    },
    enabled: view === "form",
  });

  // The issue's lines with what other returns already take back (this return excluded when editing).
  const { data: issueItems = [] } = useQuery<IssueItem[]>({
    queryKey: ["issue-return-items", form.IssueId, editId],
    queryFn: () => apiFetch<IssueItem[]>(`${API}/issues/${form.IssueId}/items${editId ? `?excludeReturnId=${editId}` : ""}`),
    enabled: !!form.IssueId,
  });

  const saveMut = useMutation({
    mutationFn: (payload: any) =>
      editId
        ? apiFetch<{ resubmitted?: boolean }>(`${API}/${editId}`, { method: "PUT", body: JSON.stringify(payload) })
        : apiFetch(API, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["issue-returns"] });
      qc.invalidateQueries({ queryKey: ["issue-return-items"] });
      toast.success(res?.resubmitted ? "Updated and re-submitted for approval" : editId ? "Updated" : "Created and submitted for approval");
      setView("list");
      setEditId(null);
      setForm(emptyForm());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-returns"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredProjects = useMemo(
    () => (form.CompanyId ? (projects as any[]).filter((p: any) => projectBelongsToCompany(p, form.CompanyId)) : projects),
    [projects, form.CompanyId],
  );

  // Every line that still has something out, each set to all of it.
  const loadIssueItems = useCallback(() => {
    setForm((f) => ({
      ...f,
      items: issueItems
        .filter((ii) => leftOnLine(ii) > 0)
        .map((ii) => ({
          origIssueItemId: ii.ItemId,
          M_Id: ii.M_Id,
          ItemName: ii.ItemName,
          Quantity: leftOnLine(ii),
          UOMSymbol: ii.UOMSymbol || "",
          issued: Number(ii.Quantity),
          maxQty: leftOnLine(ii),
        })),
    }));
  }, [issueItems]);

  // A new return fills its lines from the issue as soon as one is picked; an edited return
  // keeps its own lines and only learns each one's issued and still-out quantities.
  useEffect(() => {
    if (!issueItems.length) return;
    if (!editId) {
      loadIssueItems();
      return;
    }
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => {
        const ii = issueItems.find((x) => x.ItemId === it.origIssueItemId);
        return ii ? { ...it, issued: Number(ii.Quantity), maxQty: leftOnLine(ii) } : it;
      }),
    }));
  }, [issueItems, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItemQty = (idx: number, qty: number) =>
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], Quantity: qty };
      return { ...f, items };
    });
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const backToList = () => {
    setView("list");
    setEditId(null);
    setForm(emptyForm());
  };
  const openNew = () => {
    setEditId(null);
    setForm(emptyForm());
    setView("form");
  };
  const openEdit = async (row: { ReturnId: number }) => {
    try {
      const rec = await apiFetch<any>(`${API}/${row.ReturnId}`);
      setEditId(rec.ReturnId);
      setForm({
        ReturnDate: rec.ReturnDate?.split("T")[0] || today(),
        IssueId: String(rec.IssueId || ""),
        CompanyId: String(rec.CompanyId || ""),
        ProjectId: String(rec.ProjectId || ""),
        Reason: rec.Reason || "",
        Remarks: rec.Remarks || "",
        items: (rec.items || []).map((i: any) => ({ origIssueItemId: i.OrigIssueItemId, M_Id: i.M_Id || "", ItemName: i.ItemName || "", Quantity: Number(i.Quantity), UOMSymbol: i.UOMSymbol || "" })),
      });
      setView("form");
    } catch (e: any) {
      toast.error(e?.message || "Could not open this return");
    }
  };
  const openDetail = async (row: ReturnRow) => {
    try {
      setDetailRecord(await apiFetch<any>(`${API}/${row.ReturnId}`));
    } catch (e: any) {
      toast.error(e?.message || "Could not open this return");
    }
  };

  const handleSave = () => {
    if (!form.ReturnDate) return void toast.error("Return date is required");
    if (!form.IssueId) return void toast.error("Select the issue being returned");
    if (!form.items.length) return void toast.error("Add at least one item");
    const overMax = form.items.find((i) => i.maxQty != null && i.Quantity > i.maxQty);
    if (overMax) return void toast.error(`"${overMax.ItemName}": only ${overMax.maxQty} is still out on this issue`);
    if (!form.items.some((i) => i.Quantity > 0)) return void toast.error("All items have zero quantity");
    saveMut.mutate({ ...form });
  };

  const stats = useMemo(
    () => ({
      total: rows.length,
      draft: rows.filter((r) => r.Status === "Draft").length,
      pending: rows.filter((r) => r.Status === "Pending").length,
      approved: rows.filter((r) => r.Status === "Approved").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.DocNo, r.IssueDocNo, r.CompanyName, r.ProjectName, r.GodownName].some((v) => (v || "").toLowerCase().includes(q)));
  }, [rows, search]);

  // ── CSV ──
  const handleDownloadTemplate = () => exportToCsv([], IR_TEMPLATE_COLUMNS, "issue-return-template");
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const parsedRows = parseCsv(await file.text());
      if (!parsedRows.length) {
        toast.error("CSV is empty");
        return;
      }
      const plan = await planImport(parsedRows, {
        companies,
        projects,
        finYears: finYears as any[],
        issuesFor: (cid, pid) => apiFetch<IssueOption[]>(`${API}/issues?companyId=${cid}&projectId=${pid}`),
        linesFor: (issueId) => apiFetch<IssueItem[]>(`${API}/issues/${issueId}/items`),
      });
      if (!plan.length) {
        toast.error("No rows to import");
        return;
      }
      setImportPlan({ fileName: file.name, plan });
    } catch (err: any) {
      toast.error(err?.message || "Failed to read the CSV");
    } finally {
      setImporting(false);
    }
  };

  return {
    qc, rights, importFileInputRef, importing, importPlan, setImportPlan, view, editId, detailRecord, setDetailRecord,
    deleting, setDeleting, form, setForm, search, setSearch, rows, loading, companies, issues, issueItems, saveMut, deleteMut,
    filteredProjects, loadIssueItems, setItemQty, removeItem, backToList, openNew, openEdit, openDetail, handleSave, stats,
    filtered, handleDownloadTemplate, handleImportFileChange,
  };
}

export type IssueReturnState = ReturnType<typeof useIssueReturn>;
