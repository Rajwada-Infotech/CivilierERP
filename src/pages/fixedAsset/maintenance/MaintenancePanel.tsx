// One maintenance record opened at the side of the list, and the delete confirmation.
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pencil, Printer, Send, X } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { deleteMaintenance, getMaintenance, REPAIR_EXPENSE_LABEL, type MaintenanceItem } from "@/api/fixedAssetMaintenanceApi";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, fmtDate } from "../record/config";
import { MAINT_REFRESH, fmtAmt, maintTone, printMaintenanceVoucher } from "./config";
import { PostingTable } from "./PostingTable";

export function MaintenancePanel({
  id, canEdit, canPrint, onEdit, onPost, onClose,
}: {
  id: number; canEdit: boolean; canPrint: boolean;
  onEdit: (c: MaintenanceItem) => void; onPost: (id: number) => void; onClose: () => void;
}) {
  const { data: d } = useQuery({ queryKey: ["fa-maintenance", id], queryFn: () => getMaintenance(id) });
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Maintenance & repair" className="w-full max-w-md bg-card flex flex-col overflow-y-auto" style={{ borderLeft: RULE }}>
        <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <p className={LBL}>Maintenance &amp; repair</p>
            <p className="font-heading text-base font-bold tabular-nums text-foreground truncate">{d?.DocNo || "…"}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canPrint && d && (
              <button onClick={() => printMaintenanceVoucher(d)} title="Print voucher" className={`${KEY_LINE} h-8 w-8`}><Printer size={14} /></button>
            )}
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close"><X size={16} /></button>
          </div>
        </div>
        {!d ? (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="p-5 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <SheetMark text={d.Status} tone={maintTone(d.Status)} />
              {d.VoucherNo && <span className={`${LBL} tabular-nums`}>Voucher {d.VoucherNo}</span>}
            </div>
            <dl className="text-sm" style={{ borderTop: RULE }}>
              {[
                ["Doc date", fmtDate(d.DocDate)],
                ["Company", d.CompanyName],
                ["Project", d.ProjectName],
                ["Item", d.ItemName],
                ["FA Item Code", d.FAItemCode],
                ["Vendor", d.VendorName],
                ["Repair expense type", REPAIR_EXPENSE_LABEL[d.RepairExpenseType]],
                ["SAC code", d.SacCode],
                ["Taxable", `₹${fmtAmt(d.TaxableAmount ?? d.Amount)}`],
                ["GST", `${d.GstRatePct ?? 0}% · ₹${fmtAmt(d.GstAmount ?? 0)}`],
                ["Total (incl. GST)", `₹${fmtAmt(d.TotalAmount ?? d.Amount)}`],
                ["Remarks", d.Remarks],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.12)" }}>
                  <dt className={`${LBL} pt-0.5 shrink-0`}>{k}</dt>
                  <dd className="font-medium text-right break-words">{v && v !== "—" ? v : "—"}</dd>
                </div>
              ))}
            </dl>
            {d.posting && !d.posting.error && (
              <div>
                <p className={`${LBL} mb-2`}>Accounting entry</p>
                <PostingTable plan={d.posting} compact />
              </div>
            )}
            {canEdit && d.Status !== "Cancelled" && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onEdit(d)} className={`${KEY_LINE} h-10 px-3 ${d.Status === "Draft" ? "" : "col-span-2"}`}>
                  <Pencil size={13} /> Edit
                </button>
                {d.Status === "Draft" && (
                  <button onClick={() => onPost(d.MaintenanceId)} className={`${KEY_INK} h-10 px-3`}><Send size={13} /> Post to GL</button>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

export function DeleteMaintenanceDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteMaintenance(id),
    onSuccess: () => {
      toast.success("Record cancelled / reversed");
      MAINT_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" className="relative bg-card max-w-sm w-full" style={{ border: "1.5px solid hsl(var(--foreground))", boxShadow: "6px 6px 0 hsl(var(--foreground) / 0.14)" }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>Maintenance &amp; repair</p>
          <p className="font-heading text-base font-bold text-foreground">Delete this record?</p>
        </div>
        <p className="px-5 py-4 text-sm text-muted-foreground">
          This permanently removes it and cannot be undone. A posted record has its GL voucher reversed first.
        </p>
        <div className="px-5 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Keep</button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className={`${KEY_RED} h-10 px-3 flex-1`}>
            {del.isPending ? "Working…" : "Delete record"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
