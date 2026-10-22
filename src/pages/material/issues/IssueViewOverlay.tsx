import { createPortal } from "react-dom";
import { FileText, X, Edit3, ShoppingCart, Printer } from "lucide-react";
import { printMasterPreview } from "@/utils/masterPreviewPrint";
import { StatusBadge } from "@/components/StatusBadge";
import type { IssuesState } from "./useIssues";

// One issue opened: details, items, print, edit / delete.
export function IssueViewOverlay({ m }: { m: IssuesState }) {
  const { rights, viewingRecord, setViewingRecord, isEditableStatus, handleEdit } = m;
  if (!viewingRecord) return null;
  const items: any[] = viewingRecord.items || [];
  const close = () => setViewingRecord(null);
  const fields = [
    { label: "Doc No", value: viewingRecord.DocNo || viewingRecord.IssueNo, mono: true },
    { label: "Date", value: viewingRecord.Date ? new Date(viewingRecord.Date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
    { label: "Company", value: viewingRecord.CompanyName },
    { label: "Project", value: viewingRecord.ProjectName },
    { label: "Financial Year", value: viewingRecord.FinYearName },
    { label: "Created By", value: viewingRecord.CreatedByName || "—" },
    { label: "Source Godown", value: viewingRecord.GodownName ? `${viewingRecord.GodownName}${viewingRecord.GodownCode ? ` (${viewingRecord.GodownCode})` : ""}` : "—" },
    ...(viewingRecord.BlockName ? [{ label: "Block", value: viewingRecord.BlockName }] : []),
    ...(viewingRecord.FloorNo != null
      ? [{ label: "Floor", value: viewingRecord.FloorNo === 0 ? "Ground Floor" : `Floor ${viewingRecord.FloorNo}` }]
      : []),
    ...(viewingRecord.IssuedTo ? [{ label: "Issued To", value: viewingRecord.IssuedTo }] : []),
    ...(viewingRecord.CostCenter ? [{ label: "Cost Center", value: viewingRecord.CostCenter }] : []),
    ...(viewingRecord.SourceWODocNo ? [{ label: "Work Order", value: viewingRecord.SourceWODocNo }] : []),
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-card z-10 border-b border-border">
          <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                  <FileText size={13} className="text-emerald-500" />
                </div>
                <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[160px] sm:max-w-none">
                  {viewingRecord.DocNo || viewingRecord.IssueNo || `#${viewingRecord.IssueId}`}
                </h2>
                <StatusBadge status={viewingRecord.Status || "Draft"} />
              </div>
              <p className="text-[0.625rem] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">Material Issue</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  const rec = viewingRecord;
                  const itms: any[] = rec.items || [];
                  printMasterPreview({
                    title: rec.DocNo || rec.IssueNo || `#${rec.IssueId}`,
                    subtitle: "Material Issue",
                    code: rec.DocNo,
                    status: rec.Status,
                    sections: [
                      {
                        title: "Issue Details",
                        fields: [
                          { label: "Doc No", value: rec.DocNo || rec.IssueNo },
                          { label: "Date", value: rec.Date ? new Date(rec.Date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
                          { label: "Company", value: rec.CompanyName },
                          { label: "Project", value: rec.ProjectName },
                          { label: "Financial Year", value: rec.FinYearName },
                          { label: "Created By", value: rec.CreatedByName },
                          { label: "Source Godown", value: rec.GodownName },
                          { label: "Block", value: rec.BlockName },
                          { label: "Floor", value: rec.FloorNo === 0 ? "Ground Floor" : rec.FloorNo != null ? `Floor ${rec.FloorNo}` : null },
                          { label: "Issued To", value: rec.IssuedTo },
                          { label: "Cost Center", value: rec.CostCenter },
                          { label: "Reason", value: rec.Reason },
                          { label: "Remarks", value: rec.Remarks },
                        ],
                      },
                      {
                        title: `Issued Items (${itms.length})`,
                        fields: itms.map((it, i) => ({
                          label: `${i + 1}. ${it.ItemName || it.ItemId}`,
                          value: `${Number(it.Quantity).toFixed(2)} ${it.UOMName || it.UOMCode || ""}${it.Remarks ? ` — ${it.Remarks}` : ""}`,
                        })),
                      },
                    ],
                  });
                }}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                <Printer size={13} /><span className="hidden sm:inline">Print</span>
              </button>
              {rights.canEdit && isEditableStatus(viewingRecord.Status) && (
                <button
                  onClick={() => { close(); handleEdit(viewingRecord); }}
                  className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold btn-module shadow-sm transition"
                >
                  <Edit3 size={13} /><span className="hidden sm:inline">Edit</span>
                </button>
              )}
              <button onClick={close} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">

          {/* Detail fields */}
          <div>
            <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
              <FileText size={10} className="text-emerald-500" /> Issue Details
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {fields.map(({ label, value, mono }: any) => (
                <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                  <p className={`text-xs font-semibold truncate ${mono ? "font-mono text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{value || "—"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Reason & Remarks */}
          {(viewingRecord.Reason || viewingRecord.Remarks) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {viewingRecord.Reason && (
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-1">Reason for Issue</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Reason}</p>
                </div>
              )}
              {viewingRecord.Remarks && (
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-1">Remarks</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Remarks}</p>
                </div>
              )}
            </div>
          )}

          {/* Items */}
          <div>
            <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
              <ShoppingCart size={10} className="text-emerald-500" /> Issued Items
              <span className="ml-1 font-mono text-[0.625rem] bg-muted px-1.5 py-0.5 rounded-full border border-border">{items.length}</span>
            </p>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Item</th>
                    <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">UOM</th>
                    <th className="px-4 py-2.5 text-right text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Qty</th>
                    <th className="px-4 py-2.5 text-right text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Balance After</th>
                    <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No items found</td></tr>
                  ) : items.map((it, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        {it.ItemName || it.ItemId}
                        {it.ItemGroup && <span className="text-muted-foreground ml-1">· {it.ItemGroup}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.UOMName || it.UOMCode || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">{Number(it.Quantity).toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold hidden sm:table-cell ${Number(it.CurrentBalance) < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {Number(it.CurrentBalance).toFixed(2)} {it.UOMSymbol}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.Remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {items.length > 0 && (
                  <tfoot className="bg-muted/20 border-t border-border">
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-muted-foreground">Total</td>
                      <td className="hidden sm:table-cell" />
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {items.reduce((s, it) => s + Number(it.Quantity), 0).toFixed(2)}
                      </td>
                      <td className="hidden sm:table-cell" />
                      <td className="hidden sm:table-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
}
