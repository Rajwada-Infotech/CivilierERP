// RN port of src/pages/material/ShortClose.tsx. Unlike every other Material
// port so far, this is a single search-select-confirm screen, not a
// list+detail+form trio — the web page has no detail view, no create/edit
// form, no print, no CSV, no approval-chain: it's a direct, irreversible,
// permission-gated bulk status flip on already partially-fulfilled POs/MRs.
// The candidate list only ever contains documents the backend has already
// determined are "Partial" (approved PO with some-but-not-all qty received,
// or MR with Status='Partially Fulfilled') — there's nothing to validate
// client-side beyond "at least one selected".
import { useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput, Alert, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Search, CheckSquare, Square, AlertTriangle, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import {
  searchShortCloseCandidates, processShortClose, getCompanies, getProjects, fetchFinYearOptions,
  type ShortCloseDocType, type ShortCloseCandidate,
} from "@/api/shortCloseApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtQty(n: number | null | undefined) {
  return (Number(n) || 0).toFixed(2);
}

function CandidateRow({ candidate, selected, onToggle }: { candidate: ShortCloseCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} className="rounded-2xl p-3.5 mb-2.5 flex-row" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: selected ? colors.primary : `${colors.border}99` }}>
      <View className="mr-3 justify-center">
        {selected ? <CheckSquare size={20} color={colors.primary} /> : <Square size={20} color={colors.mutedForeground} />}
      </View>
      <View style={{ flex: 1 }}>
        <View className="flex-row items-center justify-between mb-1">
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold, flex: 1, marginRight: 8 }}>{candidate.docNo}</Text>
          <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${colors.mutedForeground}1a`, borderWidth: 1, borderColor: `${colors.mutedForeground}40` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{candidate.status}</Text>
          </View>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 6 }}>{fmtDate(candidate.docDate)} · {candidate.party || "—"}</Text>
        <View className="flex-row" style={{ gap: 14 }}>
          <View>
            <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Total</Text>
            <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.medium, marginTop: 1 }}>{fmtQty(candidate.totalQty)}</Text>
          </View>
          <View>
            <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Completed</Text>
            <Text style={{ color: "#059669", fontSize: 11.5, fontFamily: fonts.heading.medium, marginTop: 1 }}>{fmtQty(candidate.completedQty)}</Text>
          </View>
          <View>
            <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Pending</Text>
            <Text style={{ color: "#d97706", fontSize: 11.5, fontFamily: fonts.heading.medium, marginTop: 1 }}>{fmtQty(candidate.pendingQty)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function ShortCloseScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("short-close");
  const [docType, setDocType] = useState<ShortCloseDocType>("PO");
  const [finYear, setFinYear] = useState<{ id: string; label: string } | null>(null);
  const [companyId, setCompanyId] = useState(""); const [companyName, setCompanyName] = useState("");
  const [projectId, setProjectId] = useState(""); const [projectName, setProjectName] = useState("");
  const [picker, setPicker] = useState<"finYear" | "company" | "project" | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [searched, setSearched] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["sc-companies"], queryFn: getCompanies });
  const { data: projects = [] } = useQuery({ queryKey: ["sc-projects"], queryFn: getProjects });
  const { data: finYears = [] } = useQuery({ queryKey: ["sc-finyears"], queryFn: fetchFinYearOptions });

  const { data: candidates = [], isFetching, refetch } = useQuery({
    queryKey: ["sc-candidates", docType, finYear?.id, companyId, projectId],
    queryFn: () => searchShortCloseCandidates({ docType, finYearId: finYear?.id, companyId: companyId || undefined, projectId: projectId || undefined }),
    enabled: false,
  });

  const processMutation = useMutation({
    mutationFn: () => processShortClose({ docType, ids: Array.from(selected), remarks: remarks.trim() || undefined }),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setSelected(new Set());
      setRemarks("");
      queryClient.invalidateQueries({ queryKey: ["material-requests-mobile"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-mobile"], exact: false });
      refetch();
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) {
        Alert.alert(
          `${res.succeeded} short closed, ${failed.length} skipped`,
          failed.map((f) => `${f.docNo ?? f.docId}: ${f.reason ?? "Unknown reason"}`).join("\n"),
        );
      } else {
        Alert.alert("Done", res.message || `${res.succeeded} document(s) short closed.`);
      }
    },
    onError: (err: any) => Alert.alert("Short close failed", err.message ?? "Something went wrong."),
  });

  const handleSearch = () => {
    setSelected(new Set());
    setSearched(true);
    refetch();
  };

  const toggleRow = (docId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  };

  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.docId)));

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = (companyId ? projects.filter((p) => p.companyId === companyId) : projects).map((p) => ({ key: p.id, label: p.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: String(f.id), label: f.label }));

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <Archive size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to use Short Close.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#64748b26", borderWidth: 1, borderColor: "#64748b4d" }}>
          <Archive size={16} color="#64748b" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Short Close</Text>
      </View>

      <View className="flex-row rounded-xl mb-3 p-1" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        {(["PO", "MR"] as ShortCloseDocType[]).map((dt) => {
          const active = docType === dt;
          return (
            <Pressable
              key={dt}
              onPress={() => { setDocType(dt); setSelected(new Set()); setSearched(false); }}
              className="flex-1 items-center py-2 rounded-lg"
              style={{ backgroundColor: active ? colors.primary : "transparent" }}
            >
              <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
                {dt === "PO" ? "Purchase Orders" : "Material Requests"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <PickerRow label="Financial Year" value={finYear?.label ?? ""} placeholder="All" onPress={() => setPicker("finYear")} />
      <PickerRow label="Company" value={companyName} placeholder="All" onPress={() => setPicker("company")} />
      <PickerRow label="Project" value={projectName} placeholder="All" onPress={() => setPicker("project")} />

      <Pressable onPress={handleSearch} disabled={isFetching} className="flex-row items-center justify-center gap-1.5 py-3 rounded-xl mb-3" style={{ backgroundColor: colors.primary, opacity: isFetching ? 0.7 : 1 }}>
        {isFetching ? <ActivityIndicator size="small" color="#fff" /> : <Search size={14} color="#fff" />}
        <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Search</Text>
      </Pressable>

      {searched && candidates.length > 0 && (
        <Pressable onPress={toggleAll} className="flex-row items-center gap-2 mb-2.5 px-1">
          {allSelected ? <CheckSquare size={16} color={colors.primary} /> : <Square size={16} color={colors.mutedForeground} />}
          <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.medium }}>
            {allSelected ? "Deselect all" : `Select all (${candidates.length})`}
          </Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={candidates}
        keyExtractor={(c) => String(c.docId)}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (rights.canEdit && selected.size > 0 ? 90 : 24) }}
        ListHeaderComponent={ListHeader}
        renderItem={({ item }) => <CandidateRow candidate={item} selected={selected.has(item.docId)} onToggle={() => toggleRow(item.docId)} />}
        ListEmptyComponent={
          searched && !isFetching ? (
            <View className="items-center py-16">
              <AlertTriangle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8, textAlign: "center" }}>
                No {docType === "PO" ? "Purchase Orders" : "Material Requests"} in Partial status match these filters.
              </Text>
            </View>
          ) : null
        }
      />

      {rights.canEdit && selected.size > 0 && (
        <View className="absolute left-0 right-0 bottom-0 px-4" style={{ paddingBottom: insets.bottom + 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
          <Pressable onPress={() => setConfirmOpen(true)} className="items-center justify-center py-3 rounded-xl" style={{ backgroundColor: "#dc2626" }}>
            <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>Short Close {selected.size} Selected</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={confirmOpen} transparent animationType="slide" onRequestClose={() => setConfirmOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => !processMutation.isPending && setConfirmOpen(false)}>
          <Pressable onPress={() => {}} style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View className="flex-row items-center justify-between mb-3">
              <Text style={{ color: colors.foreground, fontSize: 14.5, fontFamily: fonts.heading.bold }}>Short Close {selected.size} Document{selected.size === 1 ? "" : "s"}?</Text>
              <Pressable onPress={() => setConfirmOpen(false)} className="w-7 h-7 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
                <X size={13} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View className="flex-row gap-2 rounded-xl px-3 py-2.5 mb-3" style={{ backgroundColor: "#dc262614", borderWidth: 1, borderColor: "#dc262640" }}>
              <AlertTriangle size={15} color="#dc2626" />
              <Text style={{ color: colors.foreground, fontSize: 11.5, flex: 1, lineHeight: 16 }}>
                This is irreversible. The remaining pending quantity will be closed out and the document status set to "Short Closed". Quantities already received/ordered are kept as-is.
              </Text>
            </View>

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>Remarks (optional)</Text>
            <TextInput
              value={remarks} onChangeText={setRemarks} placeholder="Reason for short closing…" multiline
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, minHeight: 70, textAlignVertical: "top", marginBottom: 16 }}
            />

            <View className="flex-row gap-2.5">
              <Pressable onPress={() => setConfirmOpen(false)} disabled={processMutation.isPending} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => processMutation.mutate()} disabled={processMutation.isPending} className="flex-1 items-center justify-center py-3 rounded-xl" style={{ backgroundColor: "#dc2626", opacity: processMutation.isPending ? 0.7 : 1 }}>
                {processMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Confirm Short Close</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={finYear?.id ?? ""}
        onSelect={(k) => { const f = finYears.find((x) => String(x.id) === k); setFinYear(f ? { id: String(f.id), label: f.label } : null); setPicker(null); }}
        onClose={() => setPicker(null)} clearable />
      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setCompanyId(k); setCompanyName(c?.name ?? ""); setProjectId(""); setProjectName(""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setProjectId(k); setProjectName(p?.name ?? ""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
    </View>
  );
}
