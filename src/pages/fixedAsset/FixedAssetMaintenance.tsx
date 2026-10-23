// FA Maintenance & Repair: repair and maintenance spent on a fixed asset, and the accounting entry it posts. Parts under
// ./maintenance: MaintenanceForm · MaintenancePanel (open one, delete) · PostingTable · pickers. Sheet styles from ./record/config.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, PenSquare, Plus, Printer, RefreshCw, Send, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaintenance, getMaintenanceList, postMaintenance, REPAIR_EXPENSE_LABEL, type MaintenanceItem } from "@/api/fixedAssetMaintenanceApi";
import { KEY_INK, KEY_LINE, Mark, RULE, ensureArray, fmt, fmtDate } from "./record/config";
import { MAINT_REFRESH, fmtAmt, maintTone, printMaintenanceVoucher } from "./maintenance/config";
import { MaintenanceForm } from "./maintenance/MaintenanceForm";
import { DeleteMaintenanceDialog, MaintenancePanel } from "./maintenance/MaintenancePanel";

type Show = "all" | "Draft" | "Posted";

export default function FixedAssetMaintenance() {
  const rights = usePageRights("fixed-asset-maintenance");
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [show, setShow] = useState<Show>("all");

  const { data: records = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["fa-maintenance"], queryFn: () => getMaintenanceList() });
  const all = ensureArray<MaintenanceItem>(records);
  const rows = useMemo(() => (show === "all" ? all : all.filter((c) => c.Status === show)), [all, show]);

  const drafts = all.filter((c) => c.Status === "Draft");
  const posted = all.filter((c) => c.Status === "Posted");
  const stats = [
    { label: "Records", value: fmt(all.length), note: "maintenance and repair entries" },
    { label: "Draft", value: fmt(drafts.length), note: drafts.length ? `₹${fmtAmt(drafts.reduce((s, c) => s + Number(c.Amount ?? 0), 0))} not yet posted` : "nothing waiting to post" },
    { label: "Posted", value: fmt(posted.length), note: "entries in the general ledger" },
    { label: "Posted value", value: `₹${fmtAmt(posted.reduce((s, c) => s + Number(c.TotalAmount ?? c.Amount ?? 0), 0))}`, note: "including GST" },
  ];

  const postMut = useMutation({
    mutationFn: (id: number) => postMaintenance(id),
    onSuccess: (r) => {
      toast.success(`Posted to GL — voucher ${r.voucherNo}`);
      MAINT_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => { setOpenId(null); setEditingId(null); setView("form"); };
  const openEdit = (c: MaintenanceItem) => {
    if (c.Status === "Cancelled") { toast.error("Cancelled records cannot be edited"); return; }
    setOpenId(null); setEditingId(c.MaintenanceId); setView("form");
  };
  const print = async (id: number) => {
    try { printMaintenanceVoucher(await getMaintenance(id)); }
    catch (e) { toast.error((e as Error).message); }
  };

  const COLUMNS: ColumnDef<MaintenanceItem>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      size: 150,
      header: "Doc no",
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight">
          <p className="font-heading tabular-nums text-xs">{c.DocNo || "—"}</p>
          <p className="text-[0.625rem] text-muted-foreground tabular-nums">{fmtDate(c.DocDate)}</p>
        </div>
      ),
    },
    {
      id: "Asset",
      accessorFn: (c) => `${c.ItemName ?? ""} ${c.FAItemCode ?? ""}`,
      size: 230,
      header: "Asset",
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight max-w-[240px]">
          <p className="text-sm text-foreground truncate">{c.ItemName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{c.FAItemCode || "—"}</p>
        </div>
      ),
    },
    {
      id: "Vendor",
      accessorKey: "VendorName",
      size: 190,
      header: "Vendor",
      cell: ({ row: { original: c } }) => <p className="text-xs text-foreground truncate max-w-[200px]">{c.VendorName || "—"}</p>,
    },
    {
      id: "Type",
      accessorFn: (c) => REPAIR_EXPENSE_LABEL[c.RepairExpenseType] ?? c.RepairExpenseType,
      size: 150,
      header: "Type",
      cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span>,
    },
    {
      id: "Amount",
      accessorFn: (c) => Number(c.Amount ?? 0),
      size: 130,
      header: "Amount",
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight text-right">
          <p className="text-sm tabular-nums">₹{fmtAmt(c.Amount)}</p>
          {c.TotalAmount != null && c.TotalAmount !== c.Amount && (
            <p className="text-[0.625rem] text-muted-foreground tabular-nums">₹{fmtAmt(c.TotalAmount)} with GST</p>
          )}
        </div>
      ),
    },
    { id: "Status", accessorKey: "Status", size: 110, header: "Status", cell: ({ getValue }) => <Mark text={getValue() as string} tone={maintTone(getValue() as MaintenanceItem["Status"])} /> },
    {
      id: "actions",
      size: 170,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setOpenId(c.MaintenanceId)} title="Open" className="p-1.5 text-muted-foreground hover:text-foreground"><Eye size={13} /></button>
          {rights.canPrint && <button onClick={() => print(c.MaintenanceId)} title="Print voucher" className="p-1.5 text-muted-foreground hover:text-foreground"><Printer size={13} /></button>}
          {rights.canEdit && c.Status === "Draft" && (
            <button onClick={() => postMut.mutate(c.MaintenanceId)} disabled={postMut.isPending} title="Post to GL" className="p-1.5 text-muted-foreground hover:text-foreground"><Send size={13} /></button>
          )}
          {rights.canEdit && c.Status !== "Cancelled" && (
            <button onClick={() => openEdit(c)} title={c.Status === "Posted" ? "Edit (reverses the posting)" : "Edit"} className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>
          )}
          {rights.canDelete && (
            <button onClick={() => setDeleteId(c.MaintenanceId)} title={c.Status === "Posted" ? "Reverse & delete" : "Delete"} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>
          )}
        </div>
      ),
    },
  ];

  const SHOW: { k: Show; label: string }[] = [
    { k: "all", label: "All" },
    { k: "Draft", label: "Draft" },
    { k: "Posted", label: "Posted" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Maintenance & Repair"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? (editingId != null ? "Edit maintenance & repair" : "New maintenance & repair") : "Maintenance & repair"}
        subtitle={
          view === "form"
            ? "Pick the fixed asset, the vendor and what the repair cost; the entry it posts is worked out as you go."
            : "Repair and maintenance spent on each fixed asset, and the accounting entry it posts to the ledger."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {rights.canCreate && <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New record</button>}
            </div>
          ) : (
            <button onClick={() => setView("list")} className={`${KEY_LINE} h-9 px-3`}>Back to records</button>
          )
        }
      >
        {view === "form" ? (
          <MaintenanceForm key={editingId ?? "new"} editingId={editingId} onClose={() => setView("list")} />
        ) : (
          <div className="space-y-5">
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {stats.map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
                <span className="inline-flex h-9 border border-foreground overflow-x-auto max-w-full" role="group" aria-label="Show">
                  {SHOW.map((s) => (
                    <button key={s.k} onClick={() => setShow(s.k)} aria-pressed={show === s.k}
                      className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 shrink-0 transition-colors ${show === s.k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                      {s.label}
                    </button>
                  ))}
                </span>
              </div>
              <DataTable
                data={rows}
                columns={COLUMNS}
                loading={isLoading}
                searchable
                searchPlaceholder="Search doc no, FA Item Code, item, vendor…"
                paginated
                onRowClick={(row) => setOpenId(row.original.MaintenanceId)}
                getRowId={(c) => String(c.MaintenanceId)}
                emptyMessage={show !== "all" ? "No records match this filter." : "No maintenance records yet. Use New record to book a repair against a fixed asset."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {openId != null && (
        <MaintenancePanel
          id={openId}
          canEdit={rights.canEdit}
          canPrint={rights.canPrint}
          onEdit={openEdit}
          onPost={(id) => { postMut.mutate(id); setOpenId(null); }}
          onClose={() => setOpenId(null)}
        />
      )}
      {deleteId != null && <DeleteMaintenanceDialog id={deleteId} onClose={() => setDeleteId(null)} />}
    </>
  );
}
