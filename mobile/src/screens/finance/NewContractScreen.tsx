// RN port of src/pages/finance/Contract.tsx's "form" view — create AND
// edit (route param `id` switches modes). Document Info (doc type + auto
// doc-number preview, dates, fin year), Contract Details (contact-person
// picker with Supplier/Contractor/Applicant tabs + search, purpose, type,
// amount, period), Attachments (photos via expo-image-picker, or any file
// type — PDFs, docs, etc — via expo-document-picker + expo-file-system's
// base64 read, matching web's arbitrary file input), and Terms &
// Conditions (multi-select from TC master).
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal, Image } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  ArrowLeft, Check, ChevronDown, Plus, RefreshCw, Search, X, Paperclip, Camera, FileText,
} from "lucide-react-native";
import {
  fetchDocTypes, fetchNextDocNumber, fetchContactPersons, fetchTCRecords,
  createContract, updateContract, getContract,
  type ContactPerson, type TCRecord, type ContractPayload, type Attachment,
} from "@/api/contractApi";
import { fetchCompanyOptions, fetchProjectOptions, fetchFinYearOptions } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = "#8b5cf6";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fieldLabel(text: string) {
  return (
    <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
      {text}
    </Text>
  );
}

function TextField({
  label, value, onChangeText, placeholder, keyboardType, multiline,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric"; multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      {fieldLabel(label)}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={`${colors.mutedForeground}80`}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={{
          color: colors.foreground,
          fontSize: 13,
          fontFamily: fonts.body.regular,
          backgroundColor: `${colors.muted}50`,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 11,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

function DateField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={{ width: "48%", marginBottom: 14 }}>
      {fieldLabel(label)}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={`${colors.mutedForeground}80`}
        style={{
          color: colors.foreground,
          fontSize: 12.5,
          fontFamily: fonts.body.regular,
          backgroundColor: `${colors.muted}50`,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 11,
        }}
      />
    </View>
  );
}

function PickerField({
  label, value, placeholder, onPress, disabled,
}: {
  label: string; value: string; placeholder: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <View style={{ width: "48%", marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      {fieldLabel(label)}
      <Pressable
        onPress={disabled ? undefined : onPress}
        className="flex-row items-center justify-between"
        style={{
          backgroundColor: `${colors.muted}50`,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 11,
        }}
      >
        <Text numberOfLines={1} style={{ color: value ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
          {value || placeholder}
        </Text>
        <ChevronDown size={13} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function OptionSheet({
  visible, title, options, onSelect, onClose,
}: {
  visible: boolean; title: string; options: Array<{ id: string | number; label: string }>; onSelect: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70%", borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <View className="px-4 py-2.5 flex-row items-center rounded-xl mx-4 mt-2.5" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
            <Search size={13} color={colors.mutedForeground} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search…"
              placeholderTextColor={`${colors.mutedForeground}80`}
              style={{ flex: 1, color: colors.foreground, fontSize: 12.5, paddingVertical: 8, paddingHorizontal: 8 }}
            />
          </View>
          <ScrollView style={{ marginTop: 8 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {filtered.length === 0 ? (
              <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No matches found</Text>
            ) : (
              filtered.map((o, i) => (
                <Pressable key={`${o.id}-${i}`} onPress={() => onSelect(String(o.id))} className="px-5 py-3">
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{o.label}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const PARTY_TABS: Array<{ code: "S" | "C" | "A"; label: string }> = [
  { code: "S", label: "Supplier" },
  { code: "C", label: "Contractor" },
  { code: "A", label: "Applicant" },
];

export default function NewContractScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "NewContract">>();
  const editingId = route.params?.id ?? null;
  const isEditing = !!editingId;
  const qc = useQueryClient();

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [docNo, setDocNo] = useState("");
  const [docTypeId, setDocTypeId] = useState<number | null>(null);
  const [docDate, setDocDate] = useState(todayISO());
  const [contractDate, setContractDate] = useState(todayISO());
  const [finYear, setFinYear] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyLabel, setCompanyLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectLabel, setProjectLabel] = useState("");
  const [remarks, setRemarks] = useState("");

  const [contactPerson, setContactPerson] = useState("");
  const [contactPartyId, setContactPartyId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [natureOfContract, setNatureOfContract] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");
  const [contractEndDate, setContractEndDate] = useState("");

  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);

  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [finYearPickerOpen, setFinYearPickerOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [tcSheetOpen, setTcSheetOpen] = useState(false);
  const [partyTab, setPartyTab] = useState<"S" | "C" | "A">("S");
  const [partySearch, setPartySearch] = useState("");

  const { data: companies = [] } = useQuery({ queryKey: ["contract-companies"], queryFn: fetchCompanyOptions });
  const { data: allProjects = [] } = useQuery({ queryKey: ["contract-projects"], queryFn: fetchProjectOptions });
  const { data: finYears = [] } = useQuery({ queryKey: ["contract-finyears"], queryFn: fetchFinYearOptions });
  const { data: contactPersons = [] } = useQuery({ queryKey: ["contract-contact-persons"], queryFn: fetchContactPersons });
  const { data: tcRecords = [] } = useQuery({ queryKey: ["tc-master"], queryFn: fetchTCRecords });

  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ["contract-edit", editingId],
    queryFn: () => getContract(editingId!),
    enabled: isEditing,
  });

  const projects = useMemo(() => {
    if (!companyId) return [];
    return (allProjects as any[]).filter((p) => String(p.company_id) === String(companyId));
  }, [allProjects, companyId]);

  // Doc type/number is only auto-generated for a brand-new contract — an
  // existing one keeps its already-assigned DocNo (matches web: the field
  // is readOnly and hidden entirely in edit mode there).
  useEffect(() => {
    if (isEditing) return;
    (async () => {
      const types = await fetchDocTypes("CON");
      if (types.length > 0) {
        const first = types[0];
        setDocTypeId(first.TypeOfDocId);
        const preview = await fetchNextDocNumber(first.TypeOfDocId, finYear || undefined);
        setDocNo(preview);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  useEffect(() => {
    if (!existing) return;
    setDocNo(existing.DocNo ?? "");
    setDocDate(existing.DocDate?.slice(0, 10) || todayISO());
    setContractDate(existing.ContractDate?.slice(0, 10) || todayISO());
    setFinYear(existing.FinYear ?? "");
    setRemarks(existing.Remarks ?? "");
    setContactPerson(existing.ContactPerson ?? "");
    setReason(existing.Reason ?? "");
    setNatureOfContract(existing.NatureOfContract ?? "");
    setContractAmount(existing.ContractAmount != null ? String(existing.ContractAmount) : "");
    setContractStartDate(existing.ContractStartDate?.slice(0, 10) || "");
    setContractEndDate(existing.ContractEndDate?.slice(0, 10) || "");
    try {
      setAttachments(existing.Attachments ? JSON.parse(existing.Attachments) : []);
    } catch {
      setAttachments([]);
    }
    try {
      if (existing.TermsAndConditions) {
        // Match the saved "Name: terms" blob back to TC master records once loaded
        setSelectedTCs(tcRecords.filter((t) => existing.TermsAndConditions!.includes(t.name)));
      }
    } catch {
      /* ignore */
    }
  }, [existing, tcRecords]);

  useEffect(() => {
    if (!existing?.CompanyId) return;
    setCompanyId(String(existing.CompanyId));
  }, [existing]);
  useEffect(() => {
    if (!companyId || !companies.length) return;
    setCompanyLabel((companies as any[]).find((c) => String(c.id) === companyId)?.label ?? "");
  }, [companyId, companies]);
  useEffect(() => {
    if (!existing?.ProjectId) return;
    setProjectId(String(existing.ProjectId));
  }, [existing]);
  useEffect(() => {
    if (!projectId || !projects.length) return;
    setProjectLabel(projects.find((p) => String(p.id) === projectId)?.label ?? "");
  }, [projectId, projects]);

  const refreshDocNo = async () => {
    if (!docTypeId) return;
    const preview = await fetchNextDocNumber(docTypeId, finYear || undefined);
    setDocNo(preview);
  };

  const selectedContact = contactPersons.find((p) => p.name === contactPerson) ?? null;

  const pickAttachment = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Photo library access is needed to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.6,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const mime = asset.mimeType || "image/jpeg";
      const name = asset.fileName || `photo-${Date.now()}.jpg`;
      setAttachments((prev) => [...prev, { name, url: `data:${mime};base64,${asset.base64}`, type: mime, size: asset.fileSize }]);
    } finally {
      setUploading(false);
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
      const mime = asset.mimeType || "application/octet-stream";
      setAttachments((prev) => [...prev, { name: asset.name, url: `data:${mime};base64,${base64}`, type: mime, size: asset.size ?? undefined }]);
    } catch {
      Alert.alert("Attach failed", "Couldn't read the selected file.");
    } finally {
      setUploading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!docTypeId && !isEditing) throw new Error("Document type not loaded yet.");
      const tc = selectedTCs.length > 0 ? selectedTCs.map((t) => `${t.name}: ${t.terms}`).join("\n\n") : undefined;
      const payload: ContractPayload = {
        docTypeId: docTypeId as number,
        docDate: docDate || undefined,
        contractDate: contractDate || undefined,
        companyId: companyId ? Number(companyId) : undefined,
        projectId: projectId ? Number(projectId) : undefined,
        finYear: finYear || undefined,
        contactPerson: contactPerson || undefined,
        contactPartyId: contactPartyId ?? undefined,
        reason: reason || undefined,
        natureOfContract: natureOfContract || undefined,
        contractAmount: contractAmount !== "" ? Number(contractAmount) : undefined,
        contractStartDate: contractStartDate || undefined,
        contractEndDate: contractEndDate || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        termsAndConditions: tc,
        remarks: remarks || undefined,
      };
      return isEditing ? updateContract(editingId!, payload) : createContract(payload);
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
      if (isEditing) qc.invalidateQueries({ queryKey: ["contract", editingId] });
      Alert.alert(
        isEditing ? "Contract updated" : "Contract created",
        isEditing ? undefined : `Reference: ${result.docNo}`,
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    },
    onError: (e: Error) => Alert.alert("Save failed", e.message),
  });

  if (isEditing && existingLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* Header */}
      <View className="flex-row items-center justify-between mb-1">
        <Pressable onPress={() => navigation.goBack()} className="flex-row items-center gap-1.5">
          <ArrowLeft size={15} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.medium }}>Back</Text>
        </Pressable>
        {!!docNo && (
          <View className="px-2.5 py-1 rounded-md" style={{ backgroundColor: `${ACCENT}1a`, borderWidth: 1, borderColor: `${ACCENT}33` }}>
            <Text style={{ color: ACCENT, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{docNo}</Text>
          </View>
        )}
      </View>
      <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 19, marginTop: 6 }}>{isEditing ? "Edit Contract" : "New Contract"}</Text>

      {/* Document Info */}
      <View className="rounded-2xl mt-5 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          Document Info
        </Text>
        <View style={{ marginBottom: 14 }}>
          {fieldLabel("Document No.")}
          <View className="flex-row items-center gap-2">
            <View className="flex-1 flex-row items-center rounded-xl px-3 py-2.5" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: docNo ? "#a78bfa" : `${colors.mutedForeground}80`, fontSize: 13, fontFamily: fonts.heading.semibold }}>
                {docNo || "Auto-generated"}
              </Text>
            </View>
            <Pressable onPress={refreshDocNo} className="p-2.5 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
              <RefreshCw size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        <View className="flex-row flex-wrap justify-between">
          <DateField label="Doc Date" value={docDate} onChangeText={setDocDate} />
          <DateField label="Contract Date" value={contractDate} onChangeText={setContractDate} />
          <PickerField label="Financial Year" value={finYear} placeholder="Select FY…" onPress={() => setFinYearPickerOpen(true)} />
          <PickerField label="Company" value={companyLabel} placeholder="Select company…" onPress={() => setCompanyPickerOpen(true)} />
          <PickerField label="Project" value={projectLabel} placeholder="Select project…" onPress={() => setProjectPickerOpen(true)} disabled={!companyId} />
        </View>

        <TextField label="Remarks" value={remarks} onChangeText={setRemarks} placeholder="Internal remarks…" multiline />
      </View>

      {/* Contract Details */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          Contract Details
        </Text>

        <View style={{ marginBottom: 14 }}>
          {fieldLabel("Contact Person")}
          <Pressable
            onPress={() => setContactSheetOpen(true)}
            className="flex-row items-center justify-between"
            style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 }}
          >
            <Text numberOfLines={1} style={{ color: contactPerson ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
              {contactPerson || "Select contact person…"}
            </Text>
            <ChevronDown size={13} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {selectedContact && (
          <View className="rounded-xl px-3.5 py-3 mb-3.5" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-start justify-between gap-2">
              <View className="flex-1 min-w-0">
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{selectedContact.name}</Text>
                <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>
                  {selectedContact.partyName}{selectedContact.partyCode ? ` (${selectedContact.partyCode})` : ""}
                </Text>
              </View>
              <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${ACCENT}22` }}>
                <Text style={{ color: ACCENT, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>
                  {selectedContact.type === "S" ? "Supplier" : selectedContact.type === "C" ? "Contractor" : "Applicant"}
                </Text>
              </View>
            </View>
            {(selectedContact.phone || selectedContact.email) && (
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 6 }}>
                {[selectedContact.phone, selectedContact.email].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
        )}

        <TextField label="Purpose / Description" value={reason} onChangeText={setReason} placeholder="Describe the reason / purpose of this contract…" multiline />

        <View className="flex-row flex-wrap justify-between">
          <View style={{ width: "48%" }}>
            <TextField label="Contract Type" value={natureOfContract} onChangeText={setNatureOfContract} placeholder="e.g. Advance, Service Agreement" />
          </View>
          <View style={{ width: "48%" }}>
            <TextField label="Contract Amount (₹)" value={contractAmount} onChangeText={setContractAmount} placeholder="0.00" keyboardType="numeric" />
          </View>
          <DateField label="Contract Start Date" value={contractStartDate} onChangeText={setContractStartDate} />
          <DateField label="Contract End Date" value={contractEndDate} onChangeText={setContractEndDate} />
        </View>
      </View>

      {/* Attachments — images only (see file header for why) */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          Attachments
        </Text>
        {attachments.map((att, i) => (
          <View key={i} className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-xl mb-2" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
            {att.url.startsWith("data:image") ? (
              <Image source={{ uri: att.url }} style={{ width: 32, height: 32, borderRadius: 6 }} />
            ) : (
              <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${ACCENT}22` }}>
                <Paperclip size={14} color={ACCENT} />
              </View>
            )}
            <View className="flex-1 min-w-0">
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{att.name}</Text>
              {!!att.size && <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular }}>{(att.size / 1024).toFixed(1)} KB</Text>}
            </View>
            <Pressable onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
              <X size={13} color={colors.destructive} />
            </Pressable>
          </View>
        ))}
        <View className="flex-row gap-2.5">
          <Pressable
            onPress={pickAttachment}
            disabled={uploading}
            className="flex-1 items-center py-5 rounded-xl"
            style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? <ActivityIndicator color={colors.mutedForeground} /> : <Camera size={18} color={`${colors.mutedForeground}80`} />}
            <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 6 }}>Photo</Text>
          </Pressable>
          <Pressable
            onPress={pickDocument}
            disabled={uploading}
            className="flex-1 items-center py-5 rounded-xl"
            style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? <ActivityIndicator color={colors.mutedForeground} /> : <FileText size={18} color={`${colors.mutedForeground}80`} />}
            <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 6 }}>File</Text>
          </Pressable>
        </View>
      </View>

      {/* Terms & Conditions */}
      <View className="rounded-2xl mt-4 mb-2 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <View className="flex-row items-center justify-between mb-3">
          <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1 }}>
            Terms & Conditions
          </Text>
          <Pressable onPress={() => setTcSheetOpen(true)} className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Plus size={12} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>Add T&C</Text>
          </Pressable>
        </View>

        {selectedTCs.length === 0 ? (
          <View className="items-center py-6 rounded-xl" style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border }}>
            <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 11.5, fontFamily: fonts.body.regular }}>No T&C selected — tap "Add T&C" above</Text>
          </View>
        ) : (
          selectedTCs.map((tc, idx) => (
            <View key={`${tc.id}-${idx}`} className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3 mb-2" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
              <View className="w-5 h-5 rounded-full items-center justify-center mt-0.5" style={{ backgroundColor: `${ACCENT}22` }}>
                <Text style={{ color: ACCENT, fontSize: 9.5, fontFamily: fonts.heading.bold }}>{idx + 1}</Text>
              </View>
              <View className="flex-1 min-w-0">
                <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{tc.name}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>{tc.terms}</Text>
              </View>
              <Pressable onPress={() => setSelectedTCs((prev) => prev.filter((s) => s.id !== tc.id))} hitSlop={8}>
                <X size={13} color={colors.destructive} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      {/* Save */}
      <Pressable
        onPress={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="rounded-xl items-center mt-2"
        style={{ backgroundColor: ACCENT, paddingVertical: 13, opacity: saveMutation.isPending ? 0.6 : 1 }}
      >
        {saveMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{isEditing ? "Update Contract" : "Create Contract"}</Text>
        )}
      </Pressable>

      {/* ── Pickers ── */}
      <OptionSheet
        visible={companyPickerOpen}
        title="Select Company"
        options={(companies as any[]).map((c) => ({ id: c.id, label: c.label }))}
        onClose={() => setCompanyPickerOpen(false)}
        onSelect={(id) => {
          setCompanyId(id);
          setCompanyLabel((companies as any[]).find((c) => String(c.id) === id)?.label ?? "");
          setProjectId("");
          setProjectLabel("");
          setCompanyPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={projectPickerOpen}
        title="Select Project"
        options={projects.map((p) => ({ id: p.id, label: p.label }))}
        onClose={() => setProjectPickerOpen(false)}
        onSelect={(id) => {
          setProjectId(id);
          setProjectLabel(projects.find((p) => String(p.id) === id)?.label ?? "");
          setProjectPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={finYearPickerOpen}
        title="Select Financial Year"
        options={(finYears as any[]).map((f) => ({ id: f.label, label: f.label }))}
        onClose={() => setFinYearPickerOpen(false)}
        onSelect={(id) => {
          setFinYear(id);
          setFinYearPickerOpen(false);
        }}
      />

      {/* Contact person sheet */}
      <Modal visible={contactSheetOpen} transparent animationType="fade" onRequestClose={() => setContactSheetOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setContactSheetOpen(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "75%", borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Contact Person</Text>
              <Pressable onPress={() => setContactSheetOpen(false)} hitSlop={8}>
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View className="flex-row" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {PARTY_TABS.map((t) => {
                const count = contactPersons.filter((p) => p.type === t.code).length;
                const active = partyTab === t.code;
                return (
                  <Pressable
                    key={t.code}
                    onPress={() => setPartyTab(t.code)}
                    className="flex-1 items-center py-2.5"
                    style={{ borderBottomWidth: 2, borderBottomColor: active ? ACCENT : "transparent" }}
                  >
                    <Text style={{ color: active ? ACCENT : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>
                      {t.label} ({count})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="px-4 py-2.5 flex-row items-center rounded-xl mx-4 mt-2.5" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
              <Search size={13} color={colors.mutedForeground} />
              <TextInput
                value={partySearch}
                onChangeText={setPartySearch}
                placeholder="Search…"
                placeholderTextColor={`${colors.mutedForeground}80`}
                style={{ flex: 1, color: colors.foreground, fontSize: 12.5, paddingVertical: 8, paddingHorizontal: 8 }}
              />
            </View>
            <ScrollView style={{ marginTop: 8 }} contentContainerStyle={{ paddingBottom: 24 }}>
              {contactPersons.filter((p) => p.type === partyTab && p.name.toLowerCase().includes(partySearch.toLowerCase())).length === 0 ? (
                <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No matches found</Text>
              ) : (
                contactPersons
                  .filter((p) => p.type === partyTab && p.name.toLowerCase().includes(partySearch.toLowerCase()))
                  .map((p, i) => {
                    const active = contactPerson === p.name;
                    return (
                      <Pressable
                        key={`${p.type}-${p.partyId}-${i}`}
                        onPress={() => {
                          setContactPerson(p.name);
                          setContactPartyId(p.partyId);
                          setContactSheetOpen(false);
                          setPartySearch("");
                        }}
                        className="flex-row items-center gap-2.5 px-5 py-3"
                      >
                        <Check size={13} color={active ? ACCENT : "transparent"} />
                        <Text style={{ color: active ? ACCENT : colors.foreground, fontSize: 13, fontFamily: active ? fonts.heading.semibold : fonts.body.regular }}>{p.name}</Text>
                      </Pressable>
                    );
                  })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* T&C multi-select sheet */}
      <Modal visible={tcSheetOpen} transparent animationType="fade" onRequestClose={() => setTcSheetOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setTcSheetOpen(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70%", borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Select Terms & Conditions</Text>
              <Pressable onPress={() => setTcSheetOpen(false)} hitSlop={8}>
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              {tcRecords.length === 0 ? (
                <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No T&C records found</Text>
              ) : (
                tcRecords.map((tc, i) => {
                  const isSel = selectedTCs.some((s) => s.id === tc.id);
                  return (
                    <Pressable
                      key={`${tc.id}-${i}`}
                      onPress={() => setSelectedTCs((prev) => (isSel ? prev.filter((s) => s.id !== tc.id) : [...prev, tc]))}
                      className="flex-row items-start gap-2.5 px-5 py-3"
                      style={isSel ? { backgroundColor: `${ACCENT}0d` } : undefined}
                    >
                      <View
                        className="w-4 h-4 rounded items-center justify-center mt-0.5"
                        style={{ backgroundColor: isSel ? ACCENT : "transparent", borderWidth: 1, borderColor: isSel ? ACCENT : colors.border }}
                      >
                        {isSel && <Check size={10} color="#fff" />}
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>{tc.name}</Text>
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>{tc.terms}</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={() => setTcSheetOpen(false)} className="py-3 items-center" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.medium }}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
