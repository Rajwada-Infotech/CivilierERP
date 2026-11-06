// RN port of src/pages/masters/DebitNoteMaster.tsx, on the drawing sheet as the web draws it: the title block with New
// debit note; ink segments switching between the debit-note register (AP discount notes against expense-booking bills:
// one ruled row each with its company and project, total, active mark and keys) and the quality-rejection notes raised
// at the gate (read-only: received / rejected / % bad, rate and amount). Neither list pages on the web, so neither does
// this. A row opens DebitNoteDetailModal; New and Edit open the form as its own page (DebitNoteFormScreen).
import { useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getDebitNotes, deleteDebitNote, type DebitNote } from "@/api/debitNoteApi";
import { getQualityDebitNotes } from "@/api/qualityRejectionDebitNoteApi";
import { Body, Key, Notice, RegisterHead, SearchBox, Seg, SheetMark, SheetShell } from "@/components/sheet/Sheet";
import { Facts, NoAccess, RecordRow, RegisterBox, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { DebitNoteDetailModal } from "./debitNote/DebitNoteDetailModal";

export default function DebitNoteListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("debit-note");
  const [mode, setMode] = useState<"debit" | "quality">("debit");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const notesQ = useQuery({ queryKey: ["debit-notes-mobile"], queryFn: getDebitNotes, enabled: rights.canView && mode === "debit" });
  const qualityQ = useQuery({ queryKey: ["quality-debit-notes-mobile"], queryFn: () => getQualityDebitNotes(), enabled: rights.canView && mode === "quality" });
  const notes = notesQ.data ?? [];
  const qualityNotes = qualityQ.data ?? [];

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => [n.supplier_name, n.company_name, n.project_name, n.Reason].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [notes, search]);
  const filteredQuality = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return qualityNotes;
    return qualityNotes.filter((n) => [n.DocNo, n.SupplierName, n.ItemName, n.GRNDocNo, n.VehicleInOutDocNo].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [qualityNotes, search]);

  const active = mode === "debit" ? notesQ : qualityQ;
  const onRefresh = async () => {
    setRefreshing(true);
    await active.refetch();
    setRefreshing(false);
  };

  const handleDelete = (note: DebitNote) =>
    Alert.alert("Delete debit note?", `${note.supplier_name || "This debit note"} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDebitNote(note.id);
            queryClient.invalidateQueries({ queryKey: ["debit-notes-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Debit notes" what="debit notes" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Debit notes"
          subtitle="Value adjustments against supplier, contractor, customer and broker invoices, plus the quality rejections raised at the gate."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {mode === "debit" && rights.canCreate && <Key tone="ink" label="New debit note" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("DebitNoteForm")} />}
              <Key label={active.isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => active.refetch()} />
            </View>
          }
        >
          <Seg
            options={[
              { value: "debit", label: "Debit notes" },
              { value: "quality", label: "Quality rejections" },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setSearch("");
            }}
          />

          <RegisterBox>
            <RegisterHead
              title={mode === "debit" ? "Debit note register" : "Quality rejection notes"}
              count={mode === "debit" ? filteredNotes.length : filteredQuality.length}
              unit={["note", "notes"]}
            />
            <SearchBox value={search} onChange={setSearch} placeholder={mode === "debit" ? "Search supplier, company, project…" : "Search doc no, supplier, item…"} />

            {active.isLoading ? (
              <RegisterLoading />
            ) : active.isError ? (
              <Notice>Could not load the notes. Pull down to try again.</Notice>
            ) : mode === "debit" ? (
              filteredNotes.length === 0 ? (
                <Body color={S.graphite}>{search ? "No note matches that search." : "No debit notes yet."}</Body>
              ) : (
                <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                  {filteredNotes.map((note, i) => (
                    <RecordRow
                      key={note.id}
                      last={i === filteredNotes.length - 1}
                      title={note.supplier_name || "—"}
                      date={fmtDate(note.DebitDate)}
                      side={formatINR(note.TotalAmount ?? 0)}
                      onPress={() => setViewingId(note.id)}
                      lines={[[note.company_name, note.project_name].filter(Boolean).join(" · ") || null, note.Reason || null]}
                      marks={<SheetMark text={note.is_active ? "Active" : "Inactive"} tone={note.is_active ? "done" : "stopped"} />}
                      actions={
                        <RowKeys
                          onView={() => setViewingId(note.id)}
                          onEdit={rights.canEdit ? () => navigation.navigate("DebitNoteForm", { id: note.id }) : undefined}
                          onDelete={rights.canDelete ? () => handleDelete(note) : undefined}
                        />
                      }
                    />
                  ))}
                </View>
              )
            ) : filteredQuality.length === 0 ? (
              <Body color={S.graphite}>{search ? "No note matches that search." : "No quality rejection notes yet."}</Body>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {filteredQuality.map((note, i) => (
                  <RecordRow
                    key={note.DebitNoteId}
                    last={i === filteredQuality.length - 1}
                    title={note.DocNo}
                    date={fmtDate(note.DebitDate)}
                    side={formatINR(note.Amount)}
                    sideNote={`rate ${note.Rate}`}
                    lines={[
                      `${note.ItemName || "—"} · ${note.SupplierName || "—"}`,
                      <Facts
                        key="f"
                        items={[
                          ["Ref", note.GRNDocNo || note.VehicleInOutDocNo || "—"],
                          ["Received", note.ReceivedQty],
                          ["Rejected", note.RejectedQty],
                          ["Bad", `${note.PercentBad}%`],
                        ]}
                      />,
                    ]}
                    marks={<SheetMark text={note.Status} tone={note.Status === "Issued" ? "done" : "draft"} />}
                  />
                ))}
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <DebitNoteDetailModal
        recordId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={rights.canEdit ? (id) => { setViewingId(null); navigation.navigate("DebitNoteForm", { id }); } : undefined}
      />
    </View>
  );
}
