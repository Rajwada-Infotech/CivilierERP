// RN port of DebitNoteMaster.tsx's view, on the drawing sheet: the note's number (or supplier) as the title with its
// date, company and project; its active mark; the particulars (supplier, total, created by, reason); and the note's
// lines (description, quantity × rate, amount). Edit sits in the title block with the edit right.
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { ClipboardMinus, Pencil } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { getDebitNoteById, type DebitNote } from "@/api/debitNoteApi";
import { InfoGrid, Key, Panel, SheetMark } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

export function DebitNoteDetailModal({ recordId, onClose, onEdit }: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void }) {
  const { data: note, isLoading, isError, error, refetch } = useQuery<DebitNote>({
    queryKey: ["dn-detail", recordId],
    queryFn: () => getDebitNoteById(recordId!),
    enabled: recordId != null,
  });

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Debit note"
      title={note?.DocNo || note?.supplier_name || "Debit note"}
      subtitle={note ? [fmtDate(note.DebitDate), note.company_name, note.project_name].filter(Boolean).join(" · ") : undefined}
      actions={note && onEdit ? <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(note.id)} /> : null}
      loading={isLoading || !note}
      error={isError ? (error as Error)?.message || "Could not load this debit note." : null}
      onRetry={() => refetch()}
    >
      {note && (
        <>
          <View style={{ flexDirection: "row" }}>
            <SheetMark text={note.is_active ? "Active" : "Inactive"} tone={note.is_active ? "done" : "stopped"} />
          </View>
          <InfoGrid
            items={[
              { label: "Supplier", value: note.supplier_name || "—" },
              { label: "Total amount", value: formatINR(note.TotalAmount ?? 0) },
              { label: "Company", value: note.company_name || "—" },
              { label: "Project", value: note.project_name || "—" },
              { label: "Debit date", value: fmtDate(note.DebitDate) },
              { label: "Created by", value: note.created_by_name || "—" },
              ...(note.Reason ? [{ label: "Reason", value: note.Reason, wide: true }] : []),
            ]}
          />
          <Panel title={`Line items (${note.items?.length ?? 0})`} icon={<ClipboardMinus size={14} color={S.ink} />}>
            <LineList
              empty="No lines on this note."
              rows={(note.items ?? []).map((it, i) => ({
                key: i,
                title: it.Description,
                note: it.Quantity != null || it.Rate != null ? `${it.Quantity ?? "—"} ${it.UOMSymbol || ""} × ${it.Rate ?? "—"}` : null,
                right: formatINR(it.Amount ?? 0),
              }))}
            />
          </Panel>
        </>
      )}
    </DetailSheet>
  );
}
