import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDraftForm, preventEnterSubmit, wasPageReloaded } from "@/hooks/useDraftForm";
import {
  Plus, X, Check, FileText, Upload, Eye,
  RefreshCw, Search, Trash2, ArrowLeft, ChevronDown,
  Wallet, ArrowDownCircle, ArrowUpCircle, AlertTriangle,
} from "lucide-react";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getFinYears } from "@/api/finYearApi";
import { getTCRecords } from "@/api/tcMasterApi";
import {
  getContracts, getContract,
  createContract, updateContract, deleteContract,
  getContractLedger,
  type ContractListItem, type ContractDetail, type Attachment,
} from "@/api/contractApi";
import {
  fetchDocTypes, fetchNextDocNumber, type DocType,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

function ensureArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object" && "data" in v) return ensureArray((v as { data: unknown }).data);
  return [];
}

interface TCRecord { id: number; name: string; terms: string; }
interface PartyPill { type: "Supplier" | "Contractor" | "Applicant"; id: number; name: string; }

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtAmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

// ── Empty form ────────────────────────────────────────────────────────────────
const emptyForm = () => ({
  docTypeId: null as number | null,
  docNo: "",
  docDate: new Date().toISOString().slice(0, 10),
  contractDate: new Date().toISOString().slice(0, 10),
  companyId: "" as string | number,
  projectId: "" as string | number,
  finYear: "",
  contactPerson: "",
  reason: "",
  natureOfContract: "",
  contractAmount: "" as string | number,
  contractStartDate: "",
  contractEndDate: "",
  remarks: "",
});

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = (status || "Draft").toLowerCase();
  const cfg =
    s === "active"   ? "bg-violet-500/10 text-violet-600 border-violet-200 dark:border-violet-800" :
    s === "expired"  ? "bg-red-500/10 text-red-500 border-red-200 dark:border-red-800" :
    s === "draft"    ? "bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-800" :
    s === "deleted"  ? "bg-red-900/10 text-red-400 border-red-900/20" :
                       "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center text-[10px] font-heading uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold border ${cfg}`}>
      {status || "Draft"}
    </span>
  );
}

// ── File attachment helpers ────────────────────────────────────────────────────
function AttachmentRow({ att, onRemove, readOnly }: { att: Attachment; onRemove: () => void; readOnly: boolean }) {
  const ext = att.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-muted/20">
      {isImage
        ? <img src={att.url} alt={att.name} className="w-8 h-8 object-cover rounded" />
        : <div className="w-8 h-8 flex items-center justify-center rounded bg-violet-500/10 text-violet-600"><FileText size={14} /></div>
      }
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{att.name}</p>
        {att.size && <p className="text-[10px] text-muted-foreground">{(att.size / 1024).toFixed(1)} KB</p>}
      </div>
      <div className="flex items-center gap-1">
        <a href={att.url} target="_blank" rel="noreferrer"
           className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition">
          <Eye size={13} />
        </a>
        {!readOnly && (
          <button onClick={onRemove}
            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Contract() {
  const qc = useQueryClient();
  // FinYearContext exposes the full list, not a single "current" value —
  // derive it the same way the rest of Finance does: the one row flagged
  // Active. Named distinctly from the raw `finYears` query result below
  // (different shape: FinYear[] from context vs the raw API rows used for
  // the dropdown).
  const { finYears: ctxFinYears } = useFinYear();
  const ctxFinYear = ctxFinYears.find((f) => f.status === "Active")?.year || "";

  // ── view state ───────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"list" | "form" | "detail">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingContract, setViewingContract] = useState<ContractDetail | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── form state ───────────────────────────────────────────────────────────────
  // This form only shows when viewMode === "form" (a full-page swap, not an
  // always-visible card), so a refresh loses more than just the field
  // values — it also drops back to the list view. Restore both together:
  // rehydrate the draft here, then the mount effect below switches back to
  // "form" view if anything was actually restored. resetForm() below always
  // seeds finYear from context rather than "", so that has to be the real
  // "empty" baseline too, or a freshly-reset form looks dirty and gets
  // persisted right back.
  const [form, setForm] = useDraftForm("finance-contract", { ...emptyForm(), finYear: ctxFinYear || "" }, {
    skip: editingId !== null,
  });

  // Only reopen on an actual browser reload, not a plain in-app navigation
  // (e.g. clicking "Contract" in the sidebar remounts this component too;
  // without this check, an old leftover draft would hijack that link into
  // always opening the form instead of the list).
  useEffect(() => {
    if (!wasPageReloaded()) return;
    if (form.docNo || form.reason || form.natureOfContract || form.contractAmount) {
      setViewMode("form");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [docTypeLoading, setDocTypeLoading] = useState(false);
  const [contactPersonOpen, setContactPersonOpen] = useState(false);
  const [selectedParties, setSelectedParties] = useState<PartyPill[]>([]);
  const [partyTab, setPartyTab] = useState<"Supplier" | "Contractor" | "Applicant">("Supplier");
  const [partySearch, setPartySearch] = useState("");

  const setField = <K extends keyof ReturnType<typeof emptyForm>>(
    k: K, v: ReturnType<typeof emptyForm>[K],
  ) => setForm((p) => ({ ...p, [k]: v }));

  // ── queries ──────────────────────────────────────────────────────────────────
  const { data: rawContracts = [], isLoading: listLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => getContracts(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
  });

  const { data: finYears = [] } = useQuery({
    queryKey: ["fin-years"],
    queryFn: getFinYears,
  });

  const { data: contactPersonsRaw = [] } = useQuery<{
    name: string; type: string; partyId: number; partyName: string;
    partyCode: string; phone: string | null; email: string | null;
    address: string | null; gst: string | null; pan: string | null;
  }[]>({
    queryKey: ["contract-contact-persons"],
    queryFn: () => fetchWithAuth("/api/contract/contact-persons").then((r) => r.json()),
  });

  const { data: tcRaw = [] } = useQuery({
    queryKey: ["tc-master"],
    queryFn: getTCRecords,
  });

  // Advance/adjustment history + live balance summary for the contract
  // currently open in detail view — dbo.ContractLedger via contractLedger.js,
  // the single source of truth for a contract's running balance.
  const { data: contractLedgerData, isLoading: contractLedgerLoading } = useQuery({
    queryKey: ["contract-ledger", viewingContract?.ContractId],
    queryFn: () => getContractLedger(viewingContract!.ContractId),
    enabled: viewMode === "detail" && !!viewingContract?.ContractId,
    staleTime: 30_000,
  });


  const contracts = useMemo(() =>
    ensureArray<ContractListItem>(rawContracts).filter(
      (c) => c.Status !== "Deleted" &&
        (!searchQ || [c.DocNo, c.ContactPerson, c.NatureOfContract, c.CompanyName, c.ProjectName]
          .some((f) => f?.toLowerCase().includes(searchQ.toLowerCase())))
    ),
    [rawContracts, searchQ]
  );

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; belongs_to: string | null; company_id: number | null }>(allProjects)
      .filter((e) => e.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const tcRecords = useMemo(() => {
    // Backend returns PascalCase columns: Id, Name, TermsAndCondition, isActive
    type RawTC = { Id?: number; id?: number; Name?: string; name?: string; TermsAndCondition?: string; terms?: string; isActive?: boolean };
    return ensureArray<RawTC>(tcRaw)
      .filter((t) => t.isActive !== false)
      .map((t): TCRecord => ({
        id:    (t.Id    ?? t.id    ?? 0),
        name:  (t.Name  ?? t.name  ?? ""),
        terms: (t.TermsAndCondition ?? t.terms ?? ""),
      }));
  }, [tcRaw]);

  const selectedContactDetail = useMemo(
    () => contactPersonsRaw.find((p) => p.name === form.contactPerson) ?? null,
    [contactPersonsRaw, form.contactPerson]
  );

  const fyOptions = useMemo(
    () => ensureArray<Record<string, unknown>>(finYears).map((f) => ({
      id:       (f.FId      ?? f.id)       as number,
      fy_label: (f.FName    ?? f.fy_label) as string,
      is_active: f.FStatus === 1 || f.FStatus === true || f.is_active === true,
    })).filter((f) => f.is_active),
    [finYears]
  );

  // ── mutations ─────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.docTypeId) throw new Error("Please select a document type.");
      const tc = selectedTCs.length > 0
        ? selectedTCs.map((t) => `${t.name}: ${t.terms}`).join("\n\n")
        : undefined;
      const payload = {
        docTypeId: form.docTypeId,
        docDate: form.docDate || undefined,
        contractDate: form.contractDate || undefined,
        companyId: form.companyId ? Number(form.companyId) : undefined,
        projectId: form.projectId ? Number(form.projectId) : undefined,
        finYear: form.finYear || undefined,
        contactPerson: form.contactPerson || undefined,
        contactPartyId: selectedContactDetail?.partyId ?? undefined,
        reason: form.reason || undefined,
        natureOfContract: form.natureOfContract || undefined,
        contractAmount: form.contractAmount !== "" ? Number(form.contractAmount) : undefined,
        contractStartDate: form.contractStartDate || undefined,
        contractEndDate: form.contractEndDate || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        termsAndConditions: tc,
        remarks: form.remarks || undefined,
        parties: selectedParties.length > 0 ? selectedParties : undefined,
      };
      if (editingId) {
        await updateContract(editingId, payload);
        return { contractId: editingId, docNo: form.docNo };
      } else {
        return createContract(payload);
      }
    },
    onSuccess: (result) => {
      toast.success(editingId ? "Contract updated" : `Contract created — ${result.docNo}`);
      qc.invalidateQueries({ queryKey: ["contracts"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteContract(id),
    onSuccess: () => {
      toast.success("Contract deleted");
      qc.invalidateQueries({ queryKey: ["contracts"] });
      setDeleteConfirmId(null);
      if (viewMode === "detail") setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── helpers ──────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setForm({ ...emptyForm(), finYear: ctxFinYear || "" });
    setSelectedTCs([]);
    setAttachments([]);
    setSelectedParties([]);
    setPartySearch("");
    setContactPersonOpen(false);
    setEditingId(null);
  };

  const goToCreate = useCallback(async () => {
    resetForm();
    setViewMode("form");
    setDocTypeLoading(true);
    try {
      const types = await fetchDocTypes("CON" as never);
      setDocTypes(types);
      if (types.length > 0) {
        const first = types[0];
        const fy = ctxFinYear || "";
        const preview = await fetchNextDocNumber(first.TypeOfDocId, fy);
        setField("docTypeId", first.TypeOfDocId);
        setField("docNo", preview);
        if (fy) setField("finYear", fy);
      }
    } catch { /* silent */ }
    setDocTypeLoading(false);
  }, [ctxFinYear]);

  const goToEdit = useCallback(async (c: ContractListItem | ContractDetail) => {
    setEditingId(c.ContractId);
    const detail = "Reason" in c ? c : await getContract(c.ContractId);
    let existingAttachments: Attachment[] = [];
    try { existingAttachments = detail.Attachments ? JSON.parse(detail.Attachments) : []; } catch { /* */ }
    let existingTCs: TCRecord[] = [];
    if (detail.TermsAndConditions) {
      existingTCs = tcRecords.filter((t) => detail.TermsAndConditions!.includes(t.name));
    }
    setForm({
      docTypeId: null,
      docNo: detail.DocNo || "",
      docDate: detail.DocDate?.slice(0, 10) || "",
      contractDate: detail.ContractDate?.slice(0, 10) || "",
      companyId: detail.CompanyId || "",
      projectId: detail.ProjectId || "",
      finYear: detail.FinYear || "",
      contactPerson: detail.ContactPerson || "",
      reason: (detail as ContractDetail).Reason || "",
      natureOfContract: detail.NatureOfContract || "",
      contractAmount: detail.ContractAmount ?? "",
      contractStartDate: detail.ContractStartDate?.slice(0, 10) || "",
      contractEndDate: detail.ContractEndDate?.slice(0, 10) || "",
      remarks: (detail as ContractDetail).Remarks || "",
    });
    let existingParties: PartyPill[] = [];
    try { existingParties = detail.Parties ? JSON.parse(detail.Parties) : []; } catch { /* */ }
    setAttachments(existingAttachments);
    setSelectedTCs(existingTCs);
    setSelectedParties(existingParties);
    setViewMode("form");
  }, [tcRecords]);

  const openDetail = async (c: ContractListItem) => {
    const detail = await getContract(c.ContractId);
    setViewingContract(detail);
    setViewMode("detail");
  };

  // ── file upload ───────────────────────────────────────────────────────────────
  // No dedicated attachments table/endpoint — files are base64-encoded
  // client-side and stored directly in dbo.Contract.Attachments (JSON array),
  // the same column that already round-trips on save/edit/detail-view.
  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const newAtts: Attachment[] = [];
      for (const file of Array.from(files)) {
        const url = await readFileAsDataUrl(file);
        newAtts.push({ name: file.name, url, type: file.type, size: file.size });
      }
      setAttachments((prev) => [...prev, ...newAtts]);
    } catch {
      toast.error("Failed to read file(s)");
    }
    setUploading(false);
  };

  // ── TABLE COLUMNS ─────────────────────────────────────────────────────────────
  const columns: ColumnDef<ContractListItem, unknown>[] = [
    {
      id: "docNo",
      accessorKey: "DocNo",
      header: "Contract No",
      size: 150,
      cell: ({ row }: any) => (
        <span className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400">
          {row.original.DocNo || "—"}
        </span>
      ),
    },
    {
      id: "docDate",
      accessorKey: "DocDate",
      header: "Date",
      size: 110,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm text-muted-foreground">{fmtDate(getValue() as string)}</span>
      ),
    },
    {
      id: "company",
      header: "Company / Project",
      size: 180,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }: any) => (
        <div>
          <p className="text-sm font-medium">{row.original.CompanyName || "—"}</p>
          {row.original.ProjectName && (
            <p className="text-[11px] text-muted-foreground">{row.original.ProjectName}</p>
          )}
        </div>
      ),
    },
    {
      id: "contactPerson",
      accessorKey: "ContactPerson",
      header: "Contact Person",
      size: 140,
      meta: { className: "hidden md:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "nature",
      accessorKey: "NatureOfContract",
      header: "Type",
      size: 160,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm text-muted-foreground truncate max-w-[160px] block">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "amount",
      accessorKey: "ContractAmount",
      header: "Amount",
      size: 120,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm font-semibold">{fmtAmt(getValue() as number)}</span>
      ),
    },
    {
      id: "status",
      accessorKey: "Status",
      header: "Status",
      size: 160,
      cell: ({ getValue, row }: any) => (
        <div className="flex items-center">
          <ApprovalStatusChain
            table="Contract"
            recordId={(row.original as ContractListItem).ContractId}
            fallback={<StatusBadge status={getValue() as string} />}
          />
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      size: 100,
      cell: ({ row }: any) => {
        const item = row.original as ContractListItem;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); openDetail(item); }}
              className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View">
              <Eye size={15} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goToEdit(item); }}
              className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors"
              title="Edit">
              <FileText size={15} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(item.ContractId); }}
              className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete">
              <Trash2 size={15} />
            </button>
          </div>
        );
      },
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: LIST
  // ─────────────────────────────────────────────────────────────────────────────
  if (viewMode === "list") {
    return (
      <>
        <Breadcrumbs items={["Dashboard", "Finance", "Contracts"]} />
        <FinanceShell
          title="Contracts"
          subtitle="Create and manage contracts"
          icon={FileText}
          action={
            <button
              onClick={goToCreate}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 transition-all hover:shadow-lg hover:shadow-violet-500/20"
            >
              <Plus size={13} />
              New Contract
            </button>
          }
        >
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold">Contract Register</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {contracts.length} record{contracts.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search contract, company…"
                    className="pl-9 h-9 text-sm focus-visible:ring-violet-500/30 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                data={contracts}
                loading={listLoading}
                searchable={false}
                paginated={false}
                emptyMessage="No contracts yet. Click 'New Contract' to create one."
                columns={columns}
              />
            </CardContent>
          </Card>

          {/* Delete confirm dialog */}
          <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Contract?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                <Button variant="destructive" onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </FinanceShell>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: FORM (create / edit)
  // ─────────────────────────────────────────────────────────────────────────────
  if (viewMode === "form") {
    return (
      <>
        <Breadcrumbs items={["Dashboard", "Finance", "Contracts", editingId ? "Edit" : "New"]} />
        <FinanceShell
          title={editingId ? "Edit Contract" : "New Contract"}
          subtitle={form.docNo || "Auto-numbered on save"}
          icon={FileText}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => { resetForm(); setViewMode("list"); }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition"
              >
                <ArrowLeft size={14} /> Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-violet-500/20 transition disabled:opacity-50"
              >
                {saveMutation.isPending ? "Saving…" : editingId ? "Update Contract" : "Create Contract"}
              </button>
            </div>
          }
        >
          <div className="space-y-6" onKeyDown={preventEnterSubmit}>

            {/* ── Document Info ──────────────────────────────────────────────── */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Document Info
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {!editingId && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Document Type</label>
                      <div className={`${inputCls} bg-muted/30 text-muted-foreground cursor-not-allowed select-none`}>
                        {docTypeLoading ? "Loading…" : (docTypes[0]?.Description || "Contract")}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Document No.</label>
                      <div className="relative">
                        <input value={form.docNo} readOnly className={`${inputCls} bg-muted/30 font-mono`} placeholder="Auto-generated" />
                        {form.docTypeId && (
                          <button
                            onClick={async () => {
                              const preview = await fetchNextDocNumber(form.docTypeId!, form.finYear || ctxFinYear || "");
                              setField("docNo", preview);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                            title="Refresh">
                            <RefreshCw size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Doc Date</label>
                    <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Contract Date</label>
                    <input type="date" value={form.contractDate} onChange={(e) => setField("contractDate", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Financial Year</label>
                    <select value={form.finYear} onChange={(e) => setField("finYear", e.target.value)} className={inputCls}>
                      <option value="">Select FY…</option>
                      {fyOptions.map((f) => (
                        <option key={f.id} value={f.fy_label}>{f.fy_label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Company</label>
                    <select
                      value={form.companyId}
                      onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); }}
                      className={inputCls}
                    >
                      <option value="">Select company…</option>
                      {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Project</label>
                    <select
                      value={form.projectId}
                      onChange={(e) => setField("projectId", e.target.value)}
                      disabled={!form.companyId}
                      className={inputCls}
                    >
                      <option value="">Select project…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Remarks</label>
                  <textarea
                    rows={2}
                    value={form.remarks}
                    onChange={(e) => setField("remarks", e.target.value)}
                    placeholder="Internal remarks…"
                    className={inputCls}
                  />
                </div>
              </CardContent>
            </Card>

            {/* ── Contract Details ───────────────────────────────────────────── */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Contract Details
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="relative">
                  <label className={labelCls}>Contact Person</label>
                  <button
                    type="button"
                    onClick={() => setContactPersonOpen((o) => !o)}
                    className={`${inputCls} flex items-center justify-between text-left`}
                  >
                    <span className={form.contactPerson ? "text-foreground" : "text-muted-foreground/40"}>
                      {form.contactPerson || "Select contact person…"}
                    </span>
                    <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${contactPersonOpen ? "rotate-180" : ""}`} />
                  </button>

                  {contactPersonOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setContactPersonOpen(false)} />
                      <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                        {/* Category tabs */}
                        <div className="flex border-b border-border">
                          {(["S", "C", "A"] as const).map((typeCode) => {
                            const label = typeCode === "S" ? "Supplier" : typeCode === "C" ? "Contractor" : "Applicant";
                            const count = contactPersonsRaw.filter((p) => p.type === typeCode).length;
                            const isActive = partyTab === (typeCode === "S" ? "Supplier" : typeCode === "C" ? "Contractor" : "Applicant");
                            return (
                              <button key={typeCode} type="button"
                                onClick={() => setPartyTab(typeCode === "S" ? "Supplier" : typeCode === "C" ? "Contractor" : "Applicant")}
                                className={`flex-1 py-2 text-xs font-semibold transition-colors border-b-2 ${isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                              >
                                {label} <span className="opacity-60">({count})</span>
                              </button>
                            );
                          })}
                        </div>
                        {/* Search */}
                        <div className="p-2.5 border-b border-border">
                          <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                              autoFocus
                              type="text"
                              value={partySearch}
                              onChange={(e) => setPartySearch(e.target.value)}
                              placeholder={`Search ${partyTab.toLowerCase()}s…`}
                              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </div>
                        </div>
                        {/* List */}
                        <div className="max-h-56 overflow-y-auto divide-y divide-border/50">
                          {(() => {
                            const typeCode = partyTab === "Supplier" ? "S" : partyTab === "Contractor" ? "C" : "A";
                            const filtered = contactPersonsRaw
                              .filter((p) => p.type === typeCode && p.name.toLowerCase().includes(partySearch.toLowerCase()));
                            if (!filtered.length) return (
                              <div className="px-4 py-6 text-center text-xs text-muted-foreground">No matches found</div>
                            );
                            return filtered.map((p) => (
                              <button key={p.name} type="button"
                                onClick={() => { setField("contactPerson", p.name); setContactPersonOpen(false); setPartySearch(""); }}
                                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-muted/60 transition-colors text-sm ${form.contactPerson === p.name ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
                              >
                                <Check size={13} className={`shrink-0 ${form.contactPerson === p.name ? "opacity-100 text-primary" : "opacity-0"}`} />
                                {p.name}
                              </button>
                            ));
                          })()}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {selectedContactDetail && (
                  <div className="rounded-xl border border-border bg-muted/10 px-4 py-3 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{selectedContactDetail.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{selectedContactDetail.partyName}
                          {selectedContactDetail.partyCode && <span className="ml-1.5 text-[10px] font-mono opacity-60">({selectedContactDetail.partyCode})</span>}
                        </p>
                      </div>
                      {(() => {
                        const t = selectedContactDetail.type;
                        const cfg = t === "S"
                          ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                          : t === "C"
                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                        const lbl = t === "S" ? "Supplier" : t === "C" ? "Contractor" : "Applicant";
                        return (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${cfg}`}>{lbl}</span>
                        );
                      })()}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                      {selectedContactDetail.phone && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="opacity-50">📞</span> {selectedContactDetail.phone}
                        </div>
                      )}
                      {selectedContactDetail.email && (
                        <div className="flex items-center gap-1.5 text-muted-foreground truncate">
                          <span className="opacity-50">✉️</span> {selectedContactDetail.email}
                        </div>
                      )}
                      {selectedContactDetail.address && (
                        <div className="flex items-start gap-1.5 text-muted-foreground col-span-full">
                          <span className="opacity-50 mt-0.5">📍</span> {selectedContactDetail.address}
                        </div>
                      )}
                      {selectedContactDetail.gst && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="opacity-50 text-[10px] font-bold">GST</span> {selectedContactDetail.gst}
                        </div>
                      )}
                      {selectedContactDetail.pan && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="opacity-50 text-[10px] font-bold">PAN</span> {selectedContactDetail.pan}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelCls}>Purpose / Description</label>
                  <textarea
                    rows={3}
                    value={form.reason}
                    onChange={(e) => setField("reason", e.target.value)}
                    placeholder="Describe the reason / purpose of this contract…"
                    className={inputCls}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Contract Type</label>
                    <input
                      value={form.natureOfContract}
                      onChange={(e) => setField("natureOfContract", e.target.value)}
                      placeholder="e.g. Advance on A/c, Service Agreement…"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Contract Amount (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.contractAmount}
                      onChange={(e) => setField("contractAmount", e.target.value)}
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Contract Start Date</label>
                    <input type="date" value={form.contractStartDate} onChange={(e) => setField("contractStartDate", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Contract End Date</label>
                    <input type="date" value={form.contractEndDate} onChange={(e) => setField("contractEndDate", e.target.value)} className={inputCls} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Attachments ────────────────────────────────────────────────── */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Attachments
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {attachments.map((att, i) => (
                  <AttachmentRow key={i} att={att} readOnly={false}
                    onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
                ))}
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/10 hover:bg-muted/20 cursor-pointer transition py-8">
                  <Upload size={24} className="text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {uploading ? "Uploading…" : "Drop files here or click to browse"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">Images, PDFs, Word docs — multiple files supported</p>
                </div>
                <input ref={fileRef} type="file" multiple className="hidden"
                  onChange={(e) => handleFiles(e.target.files)} />
              </CardContent>
            </Card>

            {/* ── Terms & Conditions ─────────────────────────────────────────── */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Terms &amp; Conditions
                  </CardTitle>
                  <div className="relative">
                    <button
                      onClick={() => setTcDropdownOpen((o) => !o)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted transition-colors">
                      <Plus size={13} /> Add T&amp;C
                    </button>
                    {tcDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setTcDropdownOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                          <div className="px-3 py-2 border-b border-border">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                              Select Terms &amp; Conditions
                            </p>
                          </div>
                          <div className="max-h-56 overflow-y-auto divide-y divide-border">
                            {tcRecords.length === 0 ? (
                              <p className="px-4 py-6 text-xs text-center text-muted-foreground">No T&C records found</p>
                            ) : tcRecords.map((tc) => {
                              const isSel = selectedTCs.some((s) => s.id === tc.id);
                              return (
                                <button key={tc.id}
                                  onClick={() => setSelectedTCs((prev) => isSel ? prev.filter((s) => s.id !== tc.id) : [...prev, tc])}
                                  className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSel ? "bg-violet-500/[0.05]" : ""}`}>
                                  <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSel ? "bg-violet-500 border-violet-500" : "border-border"}`}>
                                    {isSel && <Check size={10} className="text-primary-foreground" />}
                                  </span>
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-medium text-foreground truncate">{tc.name}</span>
                                    <span className="block text-[11px] text-muted-foreground truncate mt-0.5">{tc.terms}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="px-3 py-2 border-t border-border">
                            <button onClick={() => setTcDropdownOpen(false)}
                              className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition py-1">
                              Done
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {selectedTCs.length > 0 ? (
                  <div className="space-y-2">
                    {selectedTCs.map((tc, idx) => (
                      <div key={tc.id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-bold flex items-center justify-center mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{tc.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{tc.terms}</p>
                        </div>
                        <button onClick={() => setSelectedTCs((prev) => prev.filter((s) => s.id !== tc.id))}
                          className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/10 py-8 flex items-center justify-center">
                    <p className="text-xs text-muted-foreground">No T&amp;C selected — click "Add T&amp;C" above</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </FinanceShell>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: DETAIL
  // ─────────────────────────────────────────────────────────────────────────────
  if (viewMode === "detail" && viewingContract) {
    const c = viewingContract;
    let atts: Attachment[] = [];
    try { atts = c.Attachments ? JSON.parse(c.Attachments) : []; } catch { /* */ }
    let detailParties: PartyPill[] = [];
    try { detailParties = c.Parties ? JSON.parse(c.Parties) : []; } catch { /* */ }

    return (
      <>
        <Breadcrumbs items={["Dashboard", "Finance", "Contracts", c.DocNo || "Detail"]} />
        <FinanceShell
          title={c.DocNo || "Contract"}
          subtitle={`${fmtDate(c.DocDate)} · ${c.FinYear || ""}`}
          icon={FileText}
          action={
            <div className="flex items-center gap-2">
              <button onClick={() => setViewMode("list")}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition">
                <ArrowLeft size={14} /> Back
              </button>
              {c.Status !== "Pending" && c.Status !== "Approved" && (
                <button onClick={() => goToEdit(c)}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-violet-500/20 transition">
                  Edit
                </button>
              )}
              <button
                onClick={() => setDeleteConfirmId(c.ContractId)}
                className="h-9 px-4 rounded-lg border border-red-200 dark:border-red-900/50 text-red-500 text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition">
                Delete
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                ["Status", (
                  <ApprovalStatusChain
                    key="s"
                    table="Contract"
                    recordId={c.ContractId}
                    fallback={<StatusBadge status={c.Status} />}
                  />
                )],
                ["Doc Date", fmtDate(c.DocDate)],
                ["Contract Date", fmtDate(c.ContractDate)],
                ["Financial Year", c.FinYear || "—"],
                ["Company", c.CompanyName || "—"],
                ["Project", c.ProjectName || "—"],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-border bg-muted/10 px-4 py-3">
                  <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</p>
                  <div className="text-sm font-medium text-foreground">{value}</div>
                </div>
              ))}
            </div>

            {/* Contract details card */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Contract Details</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Contact Person</p>
                    <p className="text-sm">{c.ContactPerson || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Contract Type</p>
                    <p className="text-sm">{c.NatureOfContract || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Contract Amount</p>
                    <p className="text-sm font-semibold text-violet-600 dark:text-violet-400">{fmtAmt(c.ContractAmount)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Period</p>
                    <p className="text-sm">
                      {c.ContractStartDate ? fmtDate(c.ContractStartDate) : ""}
                      {c.ContractStartDate && c.ContractEndDate ? " – " : ""}
                      {c.ContractEndDate ? fmtDate(c.ContractEndDate) : ""}
                      {!c.ContractStartDate && !c.ContractEndDate && "—"}
                    </p>
                  </div>
                </div>
                {c.Reason && (
                  <div>
                    <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Purpose / Description</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.Reason}</p>
                  </div>
                )}
                {c.Remarks && (
                  <div>
                    <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Remarks</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.Remarks}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Contract Ledger — advances paid/received against this contract,
                automatic adjustments applied when an invoice/expense booking is
                raised against it, and the live unallocated balance. Same party
                (the supplier/contractor this contract is tagged to) that the
                amounts post to in the General Ledger / Trial Balance — no
                separate account group needed, this is just the transparency
                view for that same money. ── */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Wallet size={14} className="text-violet-500" />
                  Contract Ledger
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {contractLedgerLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                    <RefreshCw size={14} className="animate-spin" /> Loading ledger…
                  </div>
                ) : contractLedgerData ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        ["Total Advance", fmtAmt(contractLedgerData.summary.TotalAdvance), "text-emerald-600 dark:text-emerald-400"],
                        ["Allocated", fmtAmt(contractLedgerData.summary.TotalAllocated), "text-amber-600 dark:text-amber-400"],
                        ["Unallocated Balance", fmtAmt(contractLedgerData.summary.UnallocatedBalance), "text-violet-600 dark:text-violet-400"],
                        ["Documented (Invoiced/Booked)", fmtAmt(contractLedgerData.summary.TotalDocumented), "text-foreground"],
                      ].map(([label, value, cls]) => (
                        <div key={String(label)} className="rounded-xl border border-border bg-muted/10 px-3 py-2.5">
                          <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</p>
                          <p className={`text-sm font-semibold ${cls}`}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {contractLedgerData.summary.OverBilled && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                        <AlertTriangle size={13} className="shrink-0" />
                        Total documented against this contract exceeds its contract value — legitimate for change orders, but worth a look.
                      </div>
                    )}

                    {contractLedgerData.ledger.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No advances or adjustments recorded yet — pay this contractor/supplier with the contract selected on the Payment page to start one.
                      </p>
                    ) : (
                      <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Date</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Type</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Source</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Remarks</th>
                              <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {contractLedgerData.ledger.map((entry) => (
                              <tr key={entry.LedgerId} className="hover:bg-muted/20 transition-colors">
                                <td className="px-3 py-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
                                  {fmtDate(entry.CreatedAt)}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                    entry.Amount >= 0
                                      ? "bg-emerald-500/10 text-emerald-600"
                                      : "bg-amber-500/10 text-amber-600"
                                  }`}>
                                    {entry.Amount >= 0
                                      ? <ArrowDownCircle size={11} />
                                      : <ArrowUpCircle size={11} />}
                                    {entry.TxnType}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs font-mono text-foreground">
                                  {entry.SourceDocNo || `${entry.SourceType} #${entry.SourceId}`}
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground max-w-[240px] truncate">
                                  {entry.Remarks || "—"}
                                </td>
                                <td className={`px-3 py-2 text-right font-mono font-semibold ${
                                  entry.Amount >= 0 ? "text-emerald-600" : "text-amber-600"
                                }`}>
                                  {entry.Amount >= 0 ? "+" : "−"}{fmtAmt(Math.abs(entry.Amount))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Ledger unavailable.</p>
                )}
              </CardContent>
            </Card>

            {/* Parties */}
            {detailParties.length > 0 && (
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-3 border-b border-border">
                  <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Parties</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap gap-2">
                    {detailParties.map((p, i) => {
                      const colorCfg =
                        p.type === "Supplier"   ? "bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-800" :
                        p.type === "Contractor" ? "bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-800" :
                                                  "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-800";
                      const dotColor = p.type === "Supplier" ? "bg-blue-500" : p.type === "Contractor" ? "bg-amber-500" : "bg-emerald-500";
                      return (
                        <span key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorCfg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                          <span className="text-[10px] opacity-60 uppercase tracking-wider">{p.type}</span>
                          <span>{p.name}</span>
                        </span>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Attachments */}
            {atts.length > 0 && (
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-3 border-b border-border">
                  <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Attachments ({atts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  {atts.map((att, i) => (
                    <AttachmentRow key={i} att={att} readOnly onRemove={() => {}} />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* T&C */}
            {c.TermsAndConditions && (
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-3 border-b border-border">
                  <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Terms &amp; Conditions</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.TermsAndConditions}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Delete confirm */}
          <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Contract?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                <Button variant="destructive" onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </FinanceShell>
      </>
    );
  }

  return null;
}
