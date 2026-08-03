// RN port of AmendmentMenu.tsx's AmendFormDialog. NOT a re-entry of the
// whole source document — a fixed delta-record: pick a source PO/GRN
// (locks RefDocType/RefDocNo/RefDocId, prefills OriginalValue from its
// total), then just Amendment Date / Project / Company / Revised Value /
// Description / Reason. Web's dialog only ever opens pre-filled from a
// doc-table row click; this port adds its own lightweight doc picker
// (search over the existing PO/GRN list APIs) since mobile has no
// multi-tab doc browser to click a row from.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, FileEdit } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getAmendment, createAmendment, updateAmendment, AMENDMENT_REASONS, DOC_TYPE_LABEL,
  type AmendmentPayload,
} from "@/api/amendmentsApi";
import { getPurchaseOrders } from "@/api/purchaseOrdersApi";
import { getGRNs } from "@/api/grnApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type DocType = "PurchaseOrder" | "GRN";

function todayISO() { return new Date().toISOString().slice(0, 10); }

type FormState = {
  docType: DocType; refDocId: string; refDocNo: string;
  amendmentDate: string; projectName: string; companyName: string;
  originalValue: string; revisedValue: string; description: string; reason: string;
};

function blankForm(): FormState {
  return {
    docType: "PurchaseOrder", refDocId: "", refDocNo: "", amendmentDate: todayISO(),
    projectName: "", companyName: "", originalValue: "", revisedValue: "", description: "", reason: "",
  };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({ value, onChangeText, placeholder, multiline, keyboardType }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: "default" | "numeric";
}) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder} multiline={multiline} keyboardType={keyboardType}
      placeholderTextColor={`${colors.mutedForeground}99`}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
        textAlignVertical: multiline ? "top" : "center", minHeight: multiline ? 70 : undefined,
      }}
    />
  );
}

export function AmendmentFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"docType" | "doc" | "reason" | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) setForm(blankForm());
  }, [visible, editingId]);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["amd-editing-record", editingId],
    queryFn: () => getAmendment(editingId!),
    enabled: visible && editingId != null,
  });

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      docType: (existing.RefDocType as DocType) || "PurchaseOrder",
      refDocId: existing.RefDocId != null ? String(existing.RefDocId) : "", refDocNo: existing.RefDocNo || "",
      amendmentDate: existing.AmendmentDate?.slice(0, 10) || todayISO(),
      projectName: existing.ProjectName || "", companyName: existing.CompanyName || "",
      originalValue: existing.OriginalValue != null ? String(existing.OriginalValue) : "",
      revisedValue: existing.RevisedValue != null ? String(existing.RevisedValue) : "",
      description: existing.Description || "", reason: existing.Reason || "",
    });
  }, [visible, editingId, existing]);

  const { data: poData, isFetching: loadingPOs } = useQuery({
    queryKey: ["amd-form-pos"],
    queryFn: () => getPurchaseOrders({ page: 1, limit: 200 }),
    enabled: visible && picker === "doc" && form.docType === "PurchaseOrder",
  });
  const { data: grnData, isFetching: loadingGRNs } = useQuery({
    queryKey: ["amd-form-grns"],
    queryFn: () => getGRNs({ page: 1, limit: 200 }),
    enabled: visible && picker === "doc" && form.docType === "GRN",
  });

  const docOptions: PickerOption[] = useMemo(() => {
    if (form.docType === "PurchaseOrder") {
      return (poData?.data ?? []).map((po) => ({
        key: String(po.PurchaseOrderID), label: po.PurchaseOrderNo,
        sublabel: [po.SupplierName, po.CompanyName, po.ProjectName].filter(Boolean).join(" · "),
      }));
    }
    return (grnData?.data ?? []).map((g) => ({
      key: String(g.GRNID), label: g.DocNo || g.GRNNo || `GRN-${g.GRNID}`,
      sublabel: [g.SupplierName, g.CompanyName, g.ProjectName].filter(Boolean).join(" · "),
    }));
  }, [form.docType, poData, grnData]);

  const pickDoc = (key: string) => {
    if (form.docType === "PurchaseOrder") {
      const po = (poData?.data ?? []).find((p) => String(p.PurchaseOrderID) === key);
      if (!po) return;
      setForm((f) => ({
        ...f, refDocId: key, refDocNo: po.PurchaseOrderNo, companyName: po.CompanyName || "", projectName: po.ProjectName || "",
        originalValue: po.TotalAmount != null ? String(po.TotalAmount) : f.originalValue,
      }));
    } else {
      const g = (grnData?.data ?? []).find((x) => String(x.GRNID) === key);
      if (!g) return;
      setForm((f) => ({
        ...f, refDocId: key, refDocNo: g.DocNo || g.GRNNo || `GRN-${g.GRNID}`, companyName: g.CompanyName || "", projectName: g.ProjectName || "",
        originalValue: g.TotalAmount != null ? String(g.TotalAmount) : f.originalValue,
      }));
    }
    setPicker(null);
  };

  const diff = useMemo(() => {
    const orig = Number(form.originalValue);
    const rev = Number(form.revisedValue);
    if (!Number.isFinite(orig) || !Number.isFinite(rev) || form.originalValue === "" || form.revisedValue === "") return null;
    return rev - orig;
  }, [form.originalValue, form.revisedValue]);

  const validate = (): string | null => {
    if (!form.refDocId) return "Select a source document to amend.";
    if (!form.projectName.trim()) return "Project name is required.";
    if (!form.description.trim()) return "Description of change is required.";
    if (!form.reason) return "Business reason is required.";
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const payload: AmendmentPayload = {
      RefDocType: form.docType, RefDocId: Number(form.refDocId), RefDocNo: form.refDocNo,
      ProjectName: form.projectName.trim(), CompanyName: form.companyName.trim() || undefined,
      Description: form.description.trim(), Reason: form.reason,
      AmendmentDate: form.amendmentDate || undefined,
      OriginalValue: form.originalValue !== "" ? Number(form.originalValue) : undefined,
      RevisedValue: form.revisedValue !== "" ? Number(form.revisedValue) : undefined,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateAmendment(editingId, payload);
        Alert.alert("Saved", "Amendment updated.");
      } else {
        await createAmendment(payload);
        Alert.alert("Saved", "Amendment saved as Draft.");
      }
      queryClient.invalidateQueries({ queryKey: ["amendments-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const docTypeOptions: PickerOption[] = [
    { key: "PurchaseOrder", label: "Purchase Order" },
    { key: "GRN", label: "GRN" },
  ];
  const reasonOptions: PickerOption[] = AMENDMENT_REASONS.map((r) => ({ key: r, label: r }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#7c3aed26" }}>
              <FileEdit size={14} color="#7c3aed" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit Amendment" : "New Amendment"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <PickerRow
              label="Document Type" value={DOC_TYPE_LABEL[form.docType]}
              onPress={() => setPicker("docType")} disabled={editingId != null || !!form.refDocId}
            />
            <PickerRow
              label="Source Document" value={form.refDocNo} placeholder="Select a document to amend"
              onPress={() => setPicker("doc")} disabled={editingId != null}
            />

            <FieldLabel>Amendment Date</FieldLabel>
            <TextField value={form.amendmentDate} onChangeText={(v) => set("amendmentDate", v)} placeholder="YYYY-MM-DD" />
            <FieldLabel required>Project</FieldLabel>
            <TextField value={form.projectName} onChangeText={(v) => set("projectName", v)} placeholder="Project name" />
            <FieldLabel>Company / Vendor</FieldLabel>
            <TextField value={form.companyName} onChangeText={(v) => set("companyName", v)} placeholder="Optional" />

            <View className="flex-row gap-2">
              <View style={{ flex: 1 }}>
                <FieldLabel>Original Value ₹</FieldLabel>
                <TextField value={form.originalValue} onChangeText={(v) => set("originalValue", v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" />
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel required>Revised Value ₹</FieldLabel>
                <TextField value={form.revisedValue} onChangeText={(v) => set("revisedValue", v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" />
              </View>
            </View>

            {diff != null && (
              <View
                className="flex-row items-center justify-between rounded-xl px-3.5 py-3 mb-4"
                style={{ borderWidth: 1, borderColor: diff >= 0 ? "#05966940" : "#e11d4840", backgroundColor: diff >= 0 ? "#0596690d" : "#e11d480d" }}
              >
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Net Change</Text>
                <Text style={{ color: diff >= 0 ? "#059669" : "#e11d48", fontSize: 14, fontFamily: fonts.heading.bold }}>
                  {diff >= 0 ? "+" : ""}{formatINR(diff)}
                </Text>
              </View>
            )}

            <FieldLabel required>Description of Change</FieldLabel>
            <TextField value={form.description} onChangeText={(v) => set("description", v)} placeholder="What changed — item quantities, rates, delivery date, etc." multiline />

            <PickerRow label="Business Reason" value={form.reason} placeholder="Select a reason" onPress={() => setPicker("reason")} />
          </ScrollView>
        )}

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave} disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: "#7c3aed", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Save as Draft"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "docType"} title="Document Type" options={docTypeOptions} selectedKey={form.docType}
        onSelect={(k) => { set("docType", k as DocType); set("refDocId", ""); set("refDocNo", ""); setPicker(null); }} onClose={() => setPicker(null)} />
      <OptionPickerModal
        visible={picker === "doc"} title={`Select ${DOC_TYPE_LABEL[form.docType]}`} options={docOptions} selectedKey={form.refDocId}
        onSelect={pickDoc} onClose={() => setPicker(null)} searchable loading={form.docType === "PurchaseOrder" ? loadingPOs : loadingGRNs}
      />
      <OptionPickerModal visible={picker === "reason"} title="Business Reason" options={reasonOptions} selectedKey={form.reason}
        onSelect={(k) => { set("reason", k); setPicker(null); }} onClose={() => setPicker(null)} />
    </Modal>
  );
}
