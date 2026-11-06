// RN port of QtForm.tsx: the quotation (RFQ) form as a page of the stack, on the drawing sheet, with Cancel / Save as
// draft along its foot. New quotation opens it bare; Edit passes the quotation's id (only a Draft is edited). Sections as
// on the web: scope (company, project, financial year), timeline and source (tag an approved material request, which
// fills in the items; quotation date; response due), the items pulled from that request, the suppliers to quote, and
// remarks with terms and conditions from the T&C master. Saved as Draft; it is sent from the quotation's own view.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileText, Plus, Truck, X } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import type { MainStackParamList } from "@/navigation/MainStack";
import { istToday } from "@/utils/istTime";
import { filterProjectsByCompany } from "@/utils/projectBelongsTo";
import { getQuotationById, createQuotation, updateQuotation, type CreateQuotationPayload, type QuotationLineItem } from "@/api/quotationApi";
import { getCompanies, getProjects, getSuppliers, getApprovedMRList, getMRPOPrefill, fetchDocTypes, fetchNextDocNumber } from "@/api/purchaseOrdersApi";
import { getMRFinYears } from "@/api/materialRequestApi";
import { fetchTCRecords } from "@/api/contractApi";
import { OptionPickerModal, PickerRow, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import { Body, Field, IconKey, Input, Key, Panel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { FormPage, LineList, ShownValue } from "@/components/sheet/Register";

type Header = {
  companyId: string; projectId: string; finYearId: string; sourceMRId: string; sourceMRDocNo: string;
  docDate: string; dueDate: string; remarks: string; docTypeId: number | null; docNoPreview: string;
};
const blank = (): Header => ({ companyId: "", projectId: "", finYearId: "", sourceMRId: "", sourceMRDocNo: "", docDate: istToday(), dueDate: "", remarks: "", docTypeId: null, docNoPreview: "" });

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: S.ink, paddingLeft: 10, paddingRight: 4, paddingVertical: 4 }}>
      <Text style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink, maxWidth: 220 }} numberOfLines={1}>{label}</Text>
      <IconKey onPress={onRemove} size={24}>
        <X size={11} color={S.graphite} />
      </IconKey>
    </View>
  );
}

export default function QuotationFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "QuotationForm">>();
  const editingId = route.params?.id ?? null;
  const qc = useQueryClient();
  const [h, setHeader] = useState<Header>(blank);
  const [items, setItems] = useState<QuotationLineItem[]>([]);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [tcIds, setTcIds] = useState<string[]>([]);
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | "mr" | "supplier" | "tc" | null>(null);
  const [saving, setSaving] = useState(false);
  const setH = <K extends keyof Header>(k: K, v: Header[K]) => setHeader((p) => ({ ...p, [k]: v }));

  const { data: companies = [] } = useQuery({ queryKey: ["qt-companies"], queryFn: getCompanies, staleTime: 300_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["qt-projects"], queryFn: getProjects, staleTime: 300_000 });
  const { data: finYears = [] } = useQuery({ queryKey: ["qt-finyears"], queryFn: getMRFinYears, staleTime: 300_000 });
  const { data: suppliers = [] } = useQuery({ queryKey: ["qt-suppliers"], queryFn: getSuppliers, staleTime: 300_000 });
  const { data: tcRecords = [] } = useQuery({ queryKey: ["qt-tc-records"], queryFn: fetchTCRecords, staleTime: 300_000 });
  const { data: approvedMRs = [], isLoading: loadingMRs } = useQuery({
    queryKey: ["qt-approved-mrs", h.companyId, h.projectId],
    queryFn: () => getApprovedMRList({ companyId: h.companyId || undefined, projectId: h.projectId || undefined }),
    enabled: !!h.companyId && !!h.projectId,
  });
  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["qt-detail", editingId],
    queryFn: () => getQuotationById(editingId!),
    enabled: editingId != null,
  });

  const fy = finYears.find((f) => String(f.id) === h.finYearId);
  const finYearStr = fy ? String(fy.name).slice(-5) : undefined;

  // A new quotation's number: the first QT document type, previewed for the chosen year.
  useEffect(() => {
    if (editingId != null) return;
    let live = true;
    fetchDocTypes("QT")
      .then(async (types) => {
        const id = types[0]?.TypeOfDocId;
        if (!id || !live) return;
        const preview = await fetchNextDocNumber(id, finYearStr);
        if (live) setHeader((p) => ({ ...p, docTypeId: id, docNoPreview: preview }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [editingId, finYearStr]);

  // Editing: the saved quotation fills the form once.
  useEffect(() => {
    if (!existing) return;
    setHeader({
      companyId: String(existing.CompanyId ?? ""),
      projectId: String(existing.ProjectId ?? ""),
      finYearId: String(existing.FinYearId ?? ""),
      sourceMRId: String(existing.SourceMRId ?? ""),
      sourceMRDocNo: existing.SourceMRDocNo ?? "",
      docDate: existing.DocDate ? String(existing.DocDate).slice(0, 10) : istToday(),
      dueDate: existing.DueDate ? String(existing.DueDate).slice(0, 10) : "",
      remarks: existing.Remarks ?? "",
      docTypeId: null,
      docNoPreview: existing.DocNo ?? "",
    });
    setItems(existing.items ?? []);
    setSupplierIds((existing.suppliers ?? []).map((s) => String(s.SupplierLHeadId)));
    try {
      setTcIds(existing.TermsConditionIds ? (JSON.parse(existing.TermsConditionIds) as unknown[]).map(String) : []);
    } catch {
      setTcIds([]);
    }
  }, [existing]);

  const tagMR = async (mrId: string) => {
    if (!mrId) {
      setHeader((p) => ({ ...p, sourceMRId: "", sourceMRDocNo: "" }));
      setItems([]);
      return;
    }
    try {
      const prefill = await getMRPOPrefill(mrId);
      setHeader((p) => ({ ...p, sourceMRId: String(prefill.MRId), sourceMRDocNo: prefill.DocNo }));
      setItems(prefill.items.map((it) => ({ MRItemId: it.MRItemId, ItemId: it.ItemId, ItemName: it.ItemName, UOMCode: it.UOMCode, UOMName: it.UOMName, Quantity: it.Quantity })));
    } catch (err: any) {
      Alert.alert("Could not load the items", err.message || "That material request's items could not be loaded.");
    }
  };

  const valid = !!(h.companyId && h.projectId && h.docDate && items.length > 0);

  const save = async () => {
    if (!valid) {
      Alert.alert("Check the form", "Select company, project and date, and tag a material request with items.");
      return;
    }
    const payload: CreateQuotationPayload = {
      CompanyId: Number(h.companyId) || null,
      ProjectId: Number(h.projectId) || null,
      FinYearId: Number(h.finYearId) || null,
      SourceMRId: Number(h.sourceMRId) || null,
      SourceMRDocNo: h.sourceMRDocNo || null,
      DocDate: h.docDate,
      DueDate: h.dueDate || null,
      Remarks: h.remarks || null,
      TermsConditionIds: tcIds,
      items,
      supplierLHeadIds: supplierIds,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateQuotation(editingId, payload);
        Alert.alert("Saved", "Quotation updated.");
      } else {
        const rec = await createQuotation(payload);
        Alert.alert("Saved", `Quotation ${rec?.DocNo || ""} saved as Draft.`);
      }
      qc.invalidateQueries({ queryKey: ["qt-list"] });
      if (editingId != null) qc.invalidateQueries({ queryKey: ["qt-detail", editingId] });
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Could not save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const projectOptions: PickerOption[] = useMemo(
    () => filterProjectsByCompany(projects, h.companyId).map((p) => ({ key: p.id, label: p.name })),
    [projects, h.companyId],
  );
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;
  const chosenTCs = tcRecords.filter((t) => tcIds.includes(String(t.id)));
  const resetSource = { sourceMRId: "", sourceMRDocNo: "" };

  return (
    <FormPage
      asScreen
      onClose={() => navigation.goBack()}
      eyebrow="CivilierERP · Material · Request for quotation"
      title={editingId ? "Edit quotation" : "New quotation"}
      subtitle="Ask suppliers to quote against an approved material request. Saved as a draft; send it from the quotation."
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={save}
      saveLabel="Save as draft"
      saveDisabled={!valid}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companies.map((c) => ({ key: c.id, label: c.name }))} selectedKey={h.companyId}
            onSelect={(k) => { setHeader((p) => ({ ...p, companyId: k, projectId: "", ...resetSource })); setItems([]); setPicker(null); }} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={h.projectId}
            onSelect={(k) => { setHeader((p) => ({ ...p, projectId: k, ...resetSource })); setItems([]); setPicker(null); }} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "finYear"} title="Financial year" options={finYears.map((f) => ({ key: String(f.id), label: f.name }))} selectedKey={h.finYearId}
            onSelect={(k) => { setHeader((p) => ({ ...p, finYearId: k, ...resetSource })); setItems([]); setPicker(null); }} onClose={() => setPicker(null)} clearable />
          <OptionPickerModal visible={picker === "mr"} title="Tag material request" options={approvedMRs.map((m) => ({ key: String(m.MRId), label: m.DocNo, sublabel: m.ProjectName ?? undefined }))}
            selectedKey={h.sourceMRId} onSelect={(k) => { setPicker(null); tagMR(k); }} onClose={() => setPicker(null)} searchable clearable loading={loadingMRs} />
          <OptionPickerModal visible={picker === "supplier"} title="Add supplier" options={suppliers.filter((s) => !supplierIds.includes(s.id)).map((s) => ({ key: s.id, label: s.name }))}
            selectedKey="" onSelect={(k) => { if (k) setSupplierIds((p) => [...p, k]); setPicker(null); }} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "tc"} title="Add terms and conditions" options={tcRecords.filter((t) => !tcIds.includes(String(t.id))).map((t) => ({ key: String(t.id), label: t.name }))}
            selectedKey="" onSelect={(k) => { if (k) setTcIds((p) => [...p, k]); setPicker(null); }} onClose={() => setPicker(null)} searchable />
        </>
      }
    >
      <Panel title="Scope">
        <View>
          <ShownValue label="Doc number" value={h.docNoPreview || (editingId ? "—" : "Made on save")} />
          <PickerRow label="Company *" value={companies.find((c) => c.id === h.companyId)?.name ?? ""} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project *" value={projects.find((p) => p.id === h.projectId)?.name ?? ""} placeholder={h.companyId ? "Select project…" : "Select company first"} onPress={() => setPicker("project")} disabled={!h.companyId} />
          <PickerRow label="Financial year" value={fy?.name ?? ""} placeholder="All years" onPress={() => setPicker("finYear")} />
        </View>
      </Panel>

      <Panel title="Timeline and source">
        <View>
          <PickerRow
            label="Tag material request *"
            value={h.sourceMRDocNo}
            placeholder={!h.companyId || !h.projectId ? "Select company & project first" : loadingMRs ? "Loading…" : "Select approved MR…"}
            onPress={() => setPicker("mr")}
            disabled={!h.companyId || !h.projectId}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field label="Quotation date" required style={{ flex: 1 }}>
            <Input value={h.docDate} onChangeText={(v) => setH("docDate", v)} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="Response due" style={{ flex: 1 }}>
            <Input value={h.dueDate} onChangeText={(v) => setH("dueDate", v)} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
      </Panel>

      <Panel title={`Items (${items.length})`} icon={<ClipboardList size={14} color={S.ink} />}>
        {items.length === 0 ? (
          <Body size={12.5} color={S.graphite}>Tag an approved material request above to fill in the items.</Body>
        ) : (
          <>
            <Body size={11.5} color={S.graphite}>{`From ${h.sourceMRDocNo}`}</Body>
            <LineList rows={items.map((it, i) => ({ key: i, title: `${String(i + 1).padStart(2, "0")}  ${it.ItemName || it.ItemId}`, right: `${it.Quantity} ${it.UOMName || it.UOMCode || ""}` }))} />
          </>
        )}
      </Panel>

      <Panel title={`Suppliers to quote (${supplierIds.length})`} icon={<Truck size={14} color={S.ink} />}>
        {supplierIds.length === 0 ? (
          <Body size={12.5} color={S.graphite}>No suppliers tagged yet.</Body>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {supplierIds.map((id) => <Chip key={id} label={supplierName(id)} onRemove={() => setSupplierIds((p) => p.filter((s) => s !== id))} />)}
          </View>
        )}
        <Key label="Add supplier" icon={<Plus size={13} color={S.ink} />} onPress={() => setPicker("supplier")} style={{ alignSelf: "flex-start" }} />
      </Panel>

      <Panel title="Remarks and terms" icon={<FileText size={14} color={S.ink} />}>
        <View>
          <TextField label="Remarks" value={h.remarks} onChangeText={(v) => setH("remarks", v)} placeholder="Optional notes…" multiline />
        </View>
        {chosenTCs.length === 0 ? (
          <Body size={12.5} color={S.graphite}>No terms chosen. Add them from the T&C master.</Body>
        ) : (
          <View>
            {chosenTCs.map((t, i) => (
              <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                <Text style={{ width: 22, fontFamily: fonts.heading.semibold, fontSize: 11, color: S.graphite }}>{String(i + 1).padStart(2, "0")}</Text>
                <Body size={13} weight="medium" style={{ flex: 1 }}>{t.name}</Body>
                <IconKey onPress={() => setTcIds((p) => p.filter((x) => x !== String(t.id)))} size={28} red>
                  <X size={12} color={S.red} />
                </IconKey>
              </View>
            ))}
          </View>
        )}
        <Key label="Add T&C" icon={<Plus size={13} color={S.ink} />} onPress={() => setPicker("tc")} style={{ alignSelf: "flex-start" }} />
      </Panel>
    </FormPage>
  );
}
