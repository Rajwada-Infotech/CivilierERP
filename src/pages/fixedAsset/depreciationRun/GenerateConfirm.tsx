// Generate only runs once confirmed: how many assets, for which project and month, and the total it posts.
import { createPortal } from "react-dom";
import { Play } from "lucide-react";
import { KEY_INK, KEY_LINE, LBL, RULE } from "../record/config";
import { fmtAmt } from "./config";

export function GenerateConfirm({
  month, project, due, posted, amount, onConfirm, onClose, range,
}: {
  month: string; project?: string; due: number; posted: number; amount: number; range?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" className="relative bg-card max-w-md w-full" style={{ border: "1.5px solid hsl(var(--foreground))", boxShadow: "6px 6px 0 hsl(var(--foreground) / 0.14)" }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>Depreciation run</p>
          <p className="font-heading text-base font-bold text-foreground">{range ? `Run depreciation for ${month}?` : `Generate ${month} depreciation?`}</p>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm text-muted-foreground">
          {range ? (
            <p>
              Every month in this range is posted in order, oldest first, for each asset still due
              {project ? <> in <span className="font-semibold text-foreground">{project}</span></> : null}. Months and assets already posted are skipped — nothing is posted twice.
            </p>
          ) : (
          <p>
            <span className="font-semibold text-foreground">{due}</span> asset{due === 1 ? "" : "s"} will be posted
            {project ? <> for <span className="font-semibold text-foreground">{project}</span></> : null} — ₹{fmtAmt(amount)} in total.
          </p>
          )}
          {!range && posted > 0 && <p>{posted} already-posted asset{posted === 1 ? "" : "s"} will be skipped.</p>}
        </div>
        <div className="px-5 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className={`${KEY_INK} h-10 px-3 flex-1`}><Play size={13} /> {range ? "Run" : "Generate"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
