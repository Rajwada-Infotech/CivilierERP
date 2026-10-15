import { RaiseDebitNoteModal } from "@/components/quality/RaiseDebitNoteModal";
import type { GRNState } from "./useGRN";

// Raising a quality debit note against a GRN line.
export function GRNDebitNote({ m }: { m: GRNState }) {
  const { debitNoteLine, setDebitNoteLine, debitNoteQty, setDebitNoteQty, debitNoteReason, setDebitNoteReason, debitNoteMut, onSubmit } = m;
  return (
    <>
      {/* ── Raise Debit Note modal (quality rejection against a GRN line) ── */}
      {debitNoteLine && (
        <RaiseDebitNoteModal
          item={{
            itemName: debitNoteLine.item.itemName || "Item",
            uomName: debitNoteLine.item.uom,
            receivedQty: Number(debitNoteLine.item.receivedQty) || 0,
          }}
          qty={debitNoteQty}
          onQtyChange={setDebitNoteQty}
          reason={debitNoteReason}
          onReasonChange={setDebitNoteReason}
          onClose={() => setDebitNoteLine(null)}
          onSubmit={() => debitNoteMut.mutate()}
          isPending={debitNoteMut.isPending}
        />
      )}
    </>
  );
}
