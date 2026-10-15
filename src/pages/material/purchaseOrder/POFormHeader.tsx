import { ArrowLeft, Printer, FilePenLine } from "lucide-react";
import { StatusChip, KEY_INK, KEY_LINE, LBL, RULE } from "./config";
import type { POState } from "./usePurchaseOrder";

// The form's title bar: back, create / edit / view, the PO number.
export function POFormHeader({ m }: { m: POState }) {
  const { rights, viewMode, editingId, form, handlePrint, listData, goToList, goToEdit, isReadOnly } = m;
  return (
    <div className="bg-card flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ border: RULE }}>
      <div className="flex items-center gap-3 min-w-0">
        <button type="button" onClick={goToList} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
          <ArrowLeft size={12} /> Back
        </button>
        <div className="min-w-0">
          <p className={LBL}>{viewMode === "create" ? "New" : viewMode === "edit" ? "Editing" : "Purchase order"}</p>
          <h2 className="font-heading text-base font-bold tracking-tight text-foreground truncate flex items-center gap-2 mt-0.5">
            {viewMode === "create"
              ? "New purchase order"
              : viewMode === "edit"
                ? `Edit ${form.poNumber || "purchase order"}`
                : form.poNumber || "—"}
            {viewMode === "view" && form.status && <StatusChip status={form.status} />}
          </h2>
        </div>
      </div>
      {isReadOnly && (
        <div className="flex items-center gap-2 shrink-0">
          {!form.status && <StatusChip status={listData.find((r) => r._id === editingId)?.status ?? "Draft"} />}
          {rights.canPrint && (
            <button onClick={handlePrint} className={`${KEY_LINE} h-8 px-3`}>
              <Printer size={12} /> Print
            </button>
          )}
          {rights.canEdit && form.status !== "Short Closed" && (
            <button
              onClick={() => {
                const item = listData.find((r) => r._id === editingId);
                if (item) goToEdit(item);
              }}
              className={`${KEY_INK} h-8 px-3`}
            >
              <FilePenLine size={12} /> Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
