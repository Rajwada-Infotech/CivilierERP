import { Card } from "@/components/ui/card";
import { Plus, Check, ClipboardList, X } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { inputCls, FieldLabel } from "./config";
import type { POState } from "./usePurchaseOrder";

// Terms and conditions picked from the T&C master.
export function POTerms({ m }: { m: POState }) {
  const { form, selectedTCs, setSelectedTCs, tcDropdownOpen, setTcDropdownOpen, items, tcRecords, setField, isReadOnly } = m;
  return (
    <>
      {/* ── Terms & Conditions Card ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <ClipboardList
              size={11}
              className="text-emerald-600 dark:text-emerald-400"
            />
            Terms &amp; Conditions
          </h3>
          {!isReadOnly && (
            <div className="relative">
              <button
                onClick={() => setTcDropdownOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
              >
                <Plus size={13} />
                Add T&amp;C
              </button>
              {tcDropdownOpen && (
                <>
                  {/* Backdrop */}
                  <BodyPortal><div
                    className="fixed inset-0 z-10"
                    onClick={() => setTcDropdownOpen(false)}
                  /></BodyPortal>
                  {/* Dropdown */}
                  <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">
                        Select Terms &amp; Conditions
                      </p>
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-border">
                      {tcRecords.length === 0 ? (
                        <p className="px-4 py-6 text-xs text-center text-muted-foreground">
                          No T&amp;C records found
                        </p>
                      ) : (
                        tcRecords.map((tc) => {
                          const isSelected = selectedTCs.some(
                            (s) => s.id === tc.id,
                          );
                          return (
                            <button
                              key={tc.id}
                              onClick={() => {
                                setSelectedTCs((prev) =>
                                  isSelected
                                    ? prev.filter((s) => s.id !== tc.id)
                                    : [...prev, tc],
                                );
                              }}
                              className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSelected ? "bg-emerald-500/[0.05]" : ""}`}
                            >
                              <span
                                className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? "bg-emerald-500 border-emerald-500" : "border-border"}`}
                              >
                                {isSelected && (
                                  <Check
                                    size={10}
                                    className="text-primary-foreground"
                                  />
                                )}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-sm font-medium text-foreground truncate">
                                  {tc.name}
                                </span>
                                <span className="block text-[0.6875rem] text-muted-foreground truncate mt-0.5">
                                  {tc.terms}
                                </span>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-border">
                      <button
                        onClick={() => setTcDropdownOpen(false)}
                        className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition py-1"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Selected T&C list */}
        {selectedTCs.length > 0 ? (
          <div className="space-y-2 mb-4">
            {selectedTCs.map((tc, idx) => (
              <div
                key={tc.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3"
              >
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[0.625rem] font-bold flex items-center justify-center mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {tc.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                    {tc.terms}
                  </p>
                </div>
                {!isReadOnly && (
                  <button
                    onClick={() =>
                      setSelectedTCs((prev) =>
                        prev.filter((s) => s.id !== tc.id),
                      )
                    }
                    className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          !isReadOnly && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 mb-4 text-muted-foreground text-xs">
              <ClipboardList size={14} className="opacity-40" />
              <span>
                No terms selected — click <strong>+ Add T&amp;C</strong> to
                add from master
              </span>
            </div>
          )
        )}

        {/* Remarks */}
        <div>
          <FieldLabel>Remarks</FieldLabel>
          <textarea
            value={form.remarks}
            onChange={(e) => setField("remarks", e.target.value)}
            readOnly={isReadOnly}
            rows={3}
            placeholder="Additional notes…"
            className={`${inputCls} resize-none ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
          />
        </div>
      </div>
    </>
  );
}
