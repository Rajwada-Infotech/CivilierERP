import { RaiseDebitNoteModal } from "@/components/quality/RaiseDebitNoteModal";
import type { VIOState } from "./useVehicleInOut";

// Raising a quality debit note against a received line.
export function VIODebitNote({ m }: { m: VIOState }) {
  const { debitNoteItem, setDebitNoteItem, debitNoteQty, setDebitNoteQty, debitNoteReason, setDebitNoteReason, debitNoteMut, onSubmit } = m;
  return (
    <>
      {/* ── Raise Debit Note modal (quality rejection against a received line) ── */}
      {debitNoteItem && (
        <RaiseDebitNoteModal
          item={{
            itemName: debitNoteItem.ItemName,
            uomName: debitNoteItem.UomName,
            receivedQty: Number(debitNoteItem.ReceivedQty) || 0,
          }}
          qty={debitNoteQty}
          onQtyChange={setDebitNoteQty}
          reason={debitNoteReason}
          onReasonChange={setDebitNoteReason}
          onClose={() => setDebitNoteItem(null)}
          onSubmit={() => debitNoteMut.mutate()}
          isPending={debitNoteMut.isPending}
        />
      )}
    </>
  );
}
