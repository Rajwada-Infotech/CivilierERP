// RN port of src/pages/material/ShortClose.tsx, on the drawing sheet as the web draws it: a single search-select-confirm
// page, not a list + detail + form trio. Ink segments choose purchase orders or material requests; financial year,
// company and project narrow the search; the partly fulfilled documents come back as ruled rows with a box to tick
// (total / completed / pending); "Short close n selected" (with the edit right) opens a red-ruled confirmation with
// optional remarks. It is a direct, irreversible bulk status flip: the backend only ever offers documents already in
// Partial status, so nothing needs validating here beyond "at least one ticked".
import { useState } from "react";
import { View, Text, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { searchShortCloseCandidates, processShortClose, getCompanies, getProjects, fetchFinYearOptions, type ShortCloseDocType, type ShortCloseCandidate } from "@/api/shortCloseApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import { Body, Field, Input, Key, Label, Notice, Panel, Press, RegisterHead, Seg, SheetMark, SheetShell } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { Facts, NoAccess, RegisterBox, RegisterLoading, SheetPage, fmtDate } from "@/components/sheet/Register";

const fmtQty = (n: number | null | undefined) => (Number(n) || 0).toFixed(2);

function Tickbox({ on }: { on: boolean }) {
  return (
    <View style={{ width: 18, height: 18, borderWidth: 1.5, borderColor: S.ink, backgroundColor: on ? S.ink : "transparent", alignItems: "center", justifyContent: "center" }}>
      {on && <Check size={11} color={S.paper} />}
    </View>
  );
}

function CandidateRow({ c, on, onToggle, last }: { c: ShortCloseCandidate; on: boolean; onToggle: () => void; last: boolean }) {
  return (
    <Press
      onPress={onToggle}
      style={(pressed) => ({ flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: on || pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ paddingTop: 1 }}>
        <Tickbox on={on} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>
            {c.docNo}
            <Text style={{ color: S.graphite, fontFamily: fonts.body.regular, fontSize: 11.5 }}>{`  ${fmtDate(c.docDate)}`}</Text>
          </Text>
          <SheetMark text={c.status} tone="waiting" />
        </View>
        <Body size={12.5} weight="medium">{c.party || "—"}</Body>
        <Facts items={[["Total", fmtQty(c.totalQty)], ["Completed", fmtQty(c.completedQty)], ["Pending", fmtQty(c.pendingQty)]]} />
      </View>
    </Press>
  );
}

export default function ShortCloseScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("short-close");
  const [docType, setDocType] = useState<ShortCloseDocType>("PO");
  const [finYear, setFinYear] = useState<{ id: string; label: string } | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [picker, setPicker] = useState<"finYear" | "company" | "project" | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [searched, setSearched] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["sc-companies"], queryFn: getCompanies });
  const { data: projects = [] } = useQuery({ queryKey: ["sc-projects"], queryFn: getProjects });
  const { data: finYears = [] } = useQuery({ queryKey: ["sc-finyears"], queryFn: fetchFinYearOptions });

  const { data: candidates = [], isFetching, isError, refetch } = useQuery({
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
      if (failed.length) Alert.alert(`${res.succeeded} short closed, ${failed.length} skipped`, failed.map((f) => `${f.docNo ?? f.docId}: ${f.reason ?? "Unknown reason"}`).join("\n"));
      else Alert.alert("Done", res.message || `${res.succeeded} document(s) short closed.`);
    },
    onError: (err: any) => Alert.alert("Short close failed", err.message ?? "Something went wrong."),
  });

  const handleSearch = () => {
    setSelected(new Set());
    setSearched(true);
    refetch();
  };
  const toggleRow = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.docId)));

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = (companyId ? projects.filter((p) => p.companyId === companyId) : projects).map((p) => ({ key: p.id, label: p.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: String(f.id), label: f.label }));
  const what = docType === "PO" ? "purchase orders" : "material requests";

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Short close" what="short close" />;

  const showBar = rights.canEdit && selected.size > 0;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Short close"
          subtitle="Year-end housekeeping: retire partly fulfilled purchase orders and material requests, cancelling what is still pending on them."
        >
          <Seg
            options={[
              { value: "PO", label: "Purchase orders" },
              { value: "MR", label: "Material requests" },
            ]}
            value={docType}
            onChange={(d) => {
              setDocType(d as ShortCloseDocType);
              setSelected(new Set());
              setSearched(false);
            }}
          />

          <Panel title="Find documents">
            <View>
              <PickerRow label="Financial year" value={finYear?.label ?? ""} placeholder="All" onPress={() => setPicker("finYear")} />
              <PickerRow label="Company" value={companyName} placeholder="All" onPress={() => setPicker("company")} />
              <PickerRow label="Project" value={projectName} placeholder="All" onPress={() => setPicker("project")} />
            </View>
            <Key tone="ink" label={isFetching ? "Searching…" : "Search"} icon={<Search size={13} color={S.paper} />} onPress={handleSearch} disabled={isFetching} />
          </Panel>

          {searched && (
            <RegisterBox>
              <RegisterHead title={`Partly fulfilled ${what}`} count={candidates.length} unit={["document", "documents"]} />
              {isFetching ? (
                <RegisterLoading />
              ) : isError ? (
                <Notice>Could not search. Try again.</Notice>
              ) : candidates.length === 0 ? (
                <Body color={S.graphite}>{`No ${what} in Partial status match these filters.`}</Body>
              ) : (
                <>
                  <Press onPress={toggleAll} style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, opacity: pressed ? 0.7 : 1 })}>
                    <Tickbox on={allSelected} />
                    <Label color={S.ink}>{allSelected ? "Clear all" : `Select all (${candidates.length})`}</Label>
                  </Press>
                  <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                    {candidates.map((c, i) => (
                      <CandidateRow key={c.docId} c={c} on={selected.has(c.docId)} onToggle={() => toggleRow(c.docId)} last={i === candidates.length - 1} />
                    ))}
                  </View>
                </>
              )}
            </RegisterBox>
          )}
          {showBar && <View style={{ height: 40 }} />}
        </SheetShell>
      </SheetPage>

      {showBar && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: S.ink, backgroundColor: S.paper }}>
          <Key tone="red" label={`Short close ${selected.size} selected`} onPress={() => setConfirmOpen(true)} />
        </View>
      )}

      <SheetPicker visible={confirmOpen} title={`Short close ${selected.size} document${selected.size === 1 ? "" : "s"}?`} onClose={() => !processMutation.isPending && setConfirmOpen(false)}>
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>
          <Notice>
            {'This cannot be undone. What is still pending is closed out and the document set to "Short Closed". Quantities already received or ordered stay as they are.'}
          </Notice>
          <Field label="Remarks (optional)">
            <Input value={remarks} onChangeText={setRemarks} placeholder="Reason for short closing…" multiline style={{ minHeight: 70, paddingVertical: 10, textAlignVertical: "top" }} />
          </Field>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Key label="Cancel" onPress={() => setConfirmOpen(false)} disabled={processMutation.isPending} />
            <Key tone="red" label={processMutation.isPending ? "Closing…" : "Confirm short close"} onPress={() => processMutation.mutate()} disabled={processMutation.isPending} style={{ flex: 1 }} />
          </View>
        </View>
      </SheetPicker>

      <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={finYear?.id ?? ""}
        onSelect={(k) => { const f = finYears.find((x) => String(x.id) === k); setFinYear(f ? { id: String(f.id), label: f.label } : null); setPicker(null); }}
        onClose={() => setPicker(null)} clearable />
      <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setCompanyId(k); setCompanyName(c?.name ?? ""); setProjectId(""); setProjectName(""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setProjectId(k); setProjectName(p?.name ?? ""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
    </View>
  );
}
