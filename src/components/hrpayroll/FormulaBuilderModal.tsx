import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPERATORS = ["+", "-", "*", "/", "%", "(", ")"];

interface FormulaBuilderModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (formula: string) => void;
  initialFormula: string;
  /** Head codes + labels for the current structure's own lines, so the
   *  builder only offers variables that actually exist in this template. */
  availableHeads: { code: string; label: string }[];
  reservedKeywords: string[];
}

// Popup letting the user build a formula by clicking variable/operator
// chips instead of typing codes from memory (spec §18) -- the resulting
// text stays directly editable too.
export const FormulaBuilderModal: React.FC<FormulaBuilderModalProps> = ({
  open,
  onClose,
  onApply,
  initialFormula,
  availableHeads,
  reservedKeywords,
}) => {
  const [formula, setFormula] = useState(initialFormula || "");

  React.useEffect(() => {
    if (open) setFormula(initialFormula || "");
  }, [open, initialFormula]);

  const insert = (token: string) => {
    setFormula((prev) => (prev ? `${prev.trim()} ${token}` : token));
  };

  const chipClass =
    "px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium border border-border bg-muted hover:bg-muted/70 text-foreground transition-colors";
  const opClass =
    "w-9 h-9 flex items-center justify-center rounded-lg text-sm font-heading font-semibold border border-border bg-muted hover:bg-muted/70 text-foreground transition-colors";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Formula Builder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Formula
            </label>
            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
              placeholder="e.g. BASIC * 40 / 100"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Click variables and operators below, or type/edit directly.
            </p>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Operators
            </label>
            <div className="flex flex-wrap gap-1.5">
              {OPERATORS.map((op) => (
                <button key={op} type="button" onClick={() => insert(op)} className={opClass}>
                  {op}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Salary Heads in this structure
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableHeads.length === 0 && (
                <span className="text-xs text-muted-foreground">Add other lines first to reference them here.</span>
              )}
              {availableHeads.map((h) => (
                <button key={h.code} type="button" onClick={() => insert(h.code)} className={chipClass} title={h.label}>
                  {h.code}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Reserved Variables
            </label>
            <div className="flex flex-wrap gap-1.5">
              {reservedKeywords.map((k) => (
                <button key={k} type="button" onClick={() => insert(k)} className={chipClass}>
                  {k}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(formula.trim());
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white shadow-sm"
          >
            Apply
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
