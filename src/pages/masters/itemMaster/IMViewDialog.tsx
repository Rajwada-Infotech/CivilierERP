import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item } from "./config";
import type { ItemMasterState } from "./useItemMaster";

// One item opened read-only.
export function IMViewDialog({ m }: { m: ItemMasterState }) {
  const { dbUoms, itemGroups, viewRow, setViewRow, handleItemPrint } = m;
  return (
    <>
      {/* View Detail Modal */}
      <Dialog
        open={!!viewRow}
        onOpenChange={(open) => !open && setViewRow(null)}
      >
        <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              Item Details
            </DialogTitle>
          </DialogHeader>
          {viewRow &&
            (() => {
              const group = itemGroups.find(
                (g) => g.id === viewRow.belongsTo,
              );
              const uomRaw = Array.isArray(dbUoms)
                ? (dbUoms as any[]).find(
                    (u: any) => u.UOMCode === viewRow.uomCode,
                  )
                : null;
              const uomLabel = uomRaw
                ? uomRaw.Symbol
                  ? `${uomRaw.UOMName} (${uomRaw.Symbol})`
                  : uomRaw.UOMName
                : viewRow.uomCode;
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
                  {[
                    { label: "Item Name", value: viewRow.itemName },
                    {
                      label: "Short Code",
                      value: viewRow.shortCode,
                      mono: true,
                    },
                    { label: "Type", value: viewRow.itemType },
                    { label: "Item Group", value: group?.description },
                    { label: "HSN Code", value: viewRow.hsnCode, mono: true },
                    { label: "CGST", value: `${viewRow.cgst}%` },
                    { label: "SGST", value: `${viewRow.sgst}%` },
                    { label: "IGST", value: `${viewRow.igst}%` },
                    { label: "UOM", value: uomLabel },
                    {
                      label: "Days of Supply",
                      value: viewRow.daysOfSupply,
                    },
                    { label: "Description", value: viewRow.description },
                  ].map(({ label, value, mono }) => (
                    <div key={label}>
                      <p className="text-[0.625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p
                        className={`text-sm text-foreground break-words ${mono ? "font-heading" : "font-body"}`}
                      >
                        {value || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              );
            })()}
          <div className="flex justify-end gap-2 pt-2 border-t border-foreground/30 mt-2">
            {viewRow && (
              <button
                onClick={() => handleItemPrint(viewRow)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading border border-foreground/30 text-muted-foreground hover:bg-primary/5 transition-all"
              >
                <Printer size={13} /> Print
              </button>
            )}
            <button
              onClick={() => setViewRow(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading bg-foreground text-card border border-foreground transition-all"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
