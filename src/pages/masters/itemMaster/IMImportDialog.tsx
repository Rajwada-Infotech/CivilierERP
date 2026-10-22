import { Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ItemMasterState } from "./useItemMaster";

// What a CSV import did, row by row.
export function IMImportDialog({ m }: { m: ItemMasterState }) {
  const { importResults, setImportResults, error } = m;
  return (
    <>
      {/* Import Results Modal */}
      <Dialog
        open={!!importResults}
        onOpenChange={(open) => !open && setImportResults(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              Import Results
            </DialogTitle>
          </DialogHeader>
          {importResults && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-green-600">
                  <Check size={14} />
                  {
                    importResults.filter((r) => r.status === "success").length
                  }{" "}
                  succeeded
                </span>
                {importResults.some((r) => r.status === "error") && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <X size={14} />
                    {
                      importResults.filter((r) => r.status === "error").length
                    }{" "}
                    failed
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {importResults.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 px-3 py-2 text-sm ${
                      r.status === "error" ? "bg-destructive/5" : ""
                    }`}
                  >
                    {r.status === "success" ? (
                      <Check
                        size={14}
                        className="text-green-600 shrink-0 mt-0.5"
                      />
                    ) : (
                      <X
                        size={14}
                        className="text-destructive shrink-0 mt-0.5"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        Row {r.row} — {r.itemName}
                      </p>
                      {r.message && (
                        <p className="text-xs text-destructive">
                          {r.message}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
            <button
              onClick={() => setImportResults(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading btn-module text-white transition-all"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
