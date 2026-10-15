import { Trash2, ArrowLeft, Users, Send, Package, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "./config";
import type { QtState } from "./useQuotation";

// One quotation opened for reading: details, items, suppliers, print / send / delete.
export function QtView({ m }: { m: QtState }) {
  const { rights, viewingRecord, header, items, suppliers, deleteMutation, sendMutation, goToList, handlePrint } = m;
  if (!viewingRecord) return null;
  const r = viewingRecord;
  return (
    <div className="space-y-4">
      {/* View header */}
      <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 py-3.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={goToList}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-emerald-500/40">|</span>
          <span className="font-mono font-bold text-foreground text-sm">{r.DocNo}</span>
          <StatusBadge status={r.Status} />
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handlePrint(r)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Print"
          >
            <Printer size={13} /> <span className="hidden sm:inline">Print</span>
          </button>
          {rights.canDelete && r.Status === "Draft" && (
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm(`Delete quotation ${r.DocNo}?`)) {
                  deleteMutation.mutate(r.QuotationId, { onSuccess: goToList });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              title="Delete"
            >
              <Trash2 size={13} /> <span className="hidden sm:inline">Delete</span>
            </button>
          )}
          {rights.canEdit && r.Status === "Draft" && (
            <Button type="button" size="sm" onClick={() => sendMutation.mutate(r.QuotationId)} disabled={sendMutation.isPending} className="gap-1.5 btn-module text-white hover:opacity-90 border-0">
              <Send size={13} /> Send to Suppliers
            </Button>
          )}
        </div>
      </div>

      {/* Meta grid */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-5">
          {[
            { label: "Company", value: r.CompanyName },
            { label: "Project", value: r.ProjectName },
            { label: "Date", value: fmtDate(r.DocDate) },
            { label: "Source MR", value: r.SourceMRDocNo },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-1">{label}</p>
              <p className="text-sm font-medium">{value || "—"}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Items */}
      <Card className="border-border shadow-sm">
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Package size={14} className="text-emerald-500" /> Items
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-left text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                <th className="px-5 py-2.5 w-8">#</th>
                <th className="px-5 py-2.5">Item</th>
                <th className="px-5 py-2.5 text-right">UOM</th>
                <th className="px-5 py-2.5 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {(r.items || []).map((it: any, idx: number) => (
                <tr key={idx} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                  <td className="px-5 py-2.5 font-medium">{it.ItemName || it.ItemId}</td>
                  <td className="px-5 py-2.5 text-muted-foreground text-right">{it.UOMName || it.UOMCode}</td>
                  <td className="px-5 py-2.5 font-semibold text-right">{it.Quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Suppliers */}
      <Card className="border-border shadow-sm">
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users size={14} className="text-emerald-500" /> Suppliers
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(!r.suppliers || r.suppliers.length === 0) ? (
            <p className="text-sm text-muted-foreground p-5 text-center">No suppliers tagged.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-left text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  <th className="px-5 py-2.5">Supplier</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Invited</th>
                </tr>
              </thead>
              <tbody>
                {r.suppliers.map((s) => (
                  <tr key={s.Id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5 font-medium">{s.SupplierName}</td>
                    <td className="px-5 py-2.5">
                      <StatusBadge status={s.Status} />
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground">{fmtDate(s.InvitedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
