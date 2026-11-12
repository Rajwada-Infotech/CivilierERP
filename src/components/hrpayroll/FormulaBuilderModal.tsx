import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HR_HEAD, HR_LBL } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";

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

  // Tokens on the sheet: square ruled chips, inked on hover (docs/DESIGN.md).
  const chipClass =
    "h-8 px-2.5 border border-foreground/30 bg-card hover:border-foreground hover:bg-primary/10 font-heading text-xs font-semibold text-foreground transition-colors";
  const opClass =
    "w-9 h-9 flex items-center justify-center border border-foreground/30 bg-card hover:border-foreground hover:bg-primary/10 text-sm font-heading font-semibold text-foreground transition-colors";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
        <DialogHeader>
          <DialogTitle className={HR_HEAD}>Formula builder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className={`block ${HR_LBL} mb-1.5`}>
              Formula
            </label>
            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              rows={3}
              className="w-full px-2.5 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm font-mono text-foreground outline-none rounded-none"
              placeholder="e.g. BASIC * 40 / 100"
            />
            <p className="text-[0.6875rem] text-muted-foreground mt-1">
              Click variables and operators below, or type/edit directly.
            </p>
          </div>

          <div>
            <label className={`block ${HR_LBL} mb-1.5`}>
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
            <label className={`block ${HR_LBL} mb-1.5`}>
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
            <label className={`block ${HR_LBL} mb-1.5`}>
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

        <div className="flex items-center justify-end gap-2 pt-4 mt-2" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
          <button
            type="button"
            onClick={onClose}
            className={`${KEY_LINE} h-9 px-4`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(formula.trim());
              onClose();
            }}
            className={`${KEY_INK} h-9 px-5`}
          >
            Apply
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
