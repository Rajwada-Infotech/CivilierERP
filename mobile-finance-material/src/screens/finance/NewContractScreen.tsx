// RN port of src/pages/finance/Contract.tsx's "form" view — create AND
// edit (route param `id` switches modes). Document Info (doc type + auto
// doc-number preview, dates, fin year), Contract Details (contact-person
// picker with Supplier/Contractor/Applicant tabs + search, purpose, type,
// amount, period), Attachments (photos via expo-image-picker, or any file
// type — PDFs, docs, etc — via expo-document-picker + expo-file-system's
// base64 read, matching web's arbitrary file input), and Terms &
// Conditions (multi-select from TC master).
import { istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Alert, Image } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  ArrowLeft, Plus, RefreshCw, X, Paperclip, Camera, FileText,
} from "lucide-react-native";
import {
  fetchDocTypes, fetchNextDocNumber, fetchContactPersons, fetchTCRecords,
  createContract, updateContract, getContract, type TCRecord, type ContractPayload, type Attachment } from "@/api/contractApi";
import { fetchCompanyOptions, fetchProjectOptions, fetchFinYearOptions } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Field, IconKey, Key, Label, Panel, Press, SearchBox, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { DateField, OptionRow, OptionSheet, PickerField, SheetPicker, TextField } from "@/components/sheet/FormParts";
import { fonts } from "@/theme/fonts";


// A stable reference for "no data yet" — `data: x = []` in a destructure
// evaluates a brand-new array literal every render while `data` is still
// undefined (query pending, or perpetually failing on a flaky connection),
// which breaks referential equality for any effect/memo depending on that
// value and can loop it forever. Reusing one module-level empty array
// keeps the reference stable regardless of how long the query takes.
const EMPTY_LIST: any[] = [];

function todayISO() {
  return istToday();
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

  const { data: companies = EMPTY_LIST } = useQuery({ queryKey: ["contract-companies"], queryFn: fetchCompanyOptions });
  const { data: allProjects = EMPTY_LIST } = useQuery({ queryKey: ["contract-projects"], queryFn: fetchProjectOptions });
  const { data: finYears = [] } = useQuery({ queryKey: ["contract-finyears"], queryFn: fetchFinYearOptions });
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(!isEditing);
  const finYearLocked = (!isEditing) && !!lockedFY;
  useEffect(() => {
    if (!(!isEditing) || !lockedFY) return;
    setFinYear(lockedFY.label);
  }, [isEditing, lockedFY?.id]);
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
  // is readOnly and hidden entirely in edit mode there). This IIFE used to
  // have no try/catch at all — a rejection from either await (network
  // blip, or a 403 on a doc-type-scoped right) crashed the whole app the
  // moment this New Contract screen opened. docTypeId/docNo just stay
  // unset on failure — the backend still accepts the contract without one.
  useEffect(() => {
    if (isEditing) return;
    (async () => {
      try {
        const types = await fetchDocTypes("CON");
        if (types.length > 0) {
          const first = types[0];
          setDocTypeId(first.TypeOfDocId);
          const preview = await fetchNextDocNumber(first.TypeOfDocId, finYear || undefined);
          setDocNo(preview);
        }
      } catch {
        /* doc-number preview is best-effort — submit still works without it */
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
    // Called directly from a Pressable's onPress (never awaited by the
    // caller) — an unhandled rejection here crashed the whole app on tap.
    try {
      const preview = await fetchNextDocNumber(docTypeId, finYear || undefined);
      setDocNo(preview);
    } catch {
      /* best-effort refresh — leave the previous preview showing */
    }
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
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance" title="Edit contract" action={<Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />}>
          <Skel h={160} />
          <Skel h={200} />
        </SheetShell>
      </ScrollView>
    );
  }

  const contactsOfTab = contactPersons.filter((p) => p.type === partyTab && p.name.toLowerCase().includes(partySearch.toLowerCase()));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title={isEditing ? "Edit contract" : "New contract"}
        subtitle={docNo || "Auto-numbered on save"}
        action={<Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />}
      >
        <Panel title="Document info">
          <Field label="Document No.">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: S.line40, backgroundColor: S.paper }}>
                <Text style={{ color: docNo ? S.ink : S.faint, fontSize: 14, fontFamily: fonts.heading.semibold }}>{docNo || "Auto-generated"}</Text>
              </View>
              <IconKey onPress={refreshDocNo} size={44}>
                <RefreshCw size={14} color={S.ink} />
              </IconKey>
            </View>
          </Field>

          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            <DateField label="Doc Date" value={docDate} onChangeText={setDocDate} />
            <DateField label="Contract Date" value={contractDate} onChangeText={setContractDate} />
            <PickerField label={finYearLocked ? "Financial Year · locked" : "Financial Year"} value={finYear} placeholder="Select FY…" onPress={() => setFinYearPickerOpen(true)} disabled={finYearLocked} />
            <PickerField label="Company" value={companyLabel} placeholder="Select company…" onPress={() => setCompanyPickerOpen(true)} />
            <PickerField label="Project" value={projectLabel} placeholder="Select project…" onPress={() => setProjectPickerOpen(true)} disabled={!companyId} wide />
          </View>

          <TextField label="Remarks" value={remarks} onChangeText={setRemarks} placeholder="Internal remarks…" multiline />
        </Panel>

        <Panel title="Contract details">
          <PickerField label="Contact Person" value={contactPerson} placeholder="Select contact person…" onPress={() => setContactSheetOpen(true)} wide />

          {selectedContact && (
            <View style={{ borderWidth: 1, borderColor: S.line40, padding: 12, gap: 6, marginBottom: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{selectedContact.name}</Text>
                  <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
                    {selectedContact.partyName}
                    {selectedContact.partyCode ? ` (${selectedContact.partyCode})` : ""}
                  </Text>
                </View>
                <Label color={S.ink}>{selectedContact.type === "S" ? "Supplier" : selectedContact.type === "C" ? "Contractor" : "Applicant"}</Label>
              </View>
              {!!(selectedContact.phone || selectedContact.email) && (
                <Body size={11.5} color={S.graphite}>{[selectedContact.phone, selectedContact.email].filter(Boolean).join(" · ")}</Body>
              )}
            </View>
          )}

          <TextField label="Purpose / Description" value={reason} onChangeText={setReason} placeholder="Describe the reason / purpose of this contract…" multiline />

          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            <View style={{ width: "48%" }}>
              <TextField label="Contract Type" value={natureOfContract} onChangeText={setNatureOfContract} placeholder="e.g. Advance" />
            </View>
            <View style={{ width: "48%" }}>
              <TextField label="Contract Amount (₹)" value={contractAmount} onChangeText={setContractAmount} placeholder="0.00" keyboardType="numeric" />
            </View>
            <DateField label="Contract Start Date" value={contractStartDate} onChangeText={setContractStartDate} />
            <DateField label="Contract End Date" value={contractEndDate} onChangeText={setContractEndDate} />
          </View>
        </Panel>

        <Panel title={attachments.length ? `Attachments (${attachments.length})` : "Attachments"}>
          {attachments.map((att, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
              {att.url.startsWith("data:image") ? (
                <Image source={{ uri: att.url }} style={{ width: 32, height: 32, borderWidth: 1, borderColor: S.ink }} />
              ) : (
                <View style={{ width: 32, height: 32, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                  <Paperclip size={14} color={S.ink} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12.5, fontFamily: fonts.body.medium }}>{att.name}</Text>
                {!!att.size && <Body size={11} color={S.graphite}>{`${(att.size / 1024).toFixed(1)} KB`}</Body>}
              </View>
              <IconKey onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} size={32} red>
                <X size={13} color={S.red} />
              </IconKey>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[
              { label: "Photo", icon: <Camera size={17} color={S.ink} />, onPress: pickAttachment },
              { label: "File", icon: <FileText size={17} color={S.ink} />, onPress: pickDocument },
            ].map((b) => (
              <Press
                key={b.label}
                onPress={b.onPress}
                disabled={uploading}
                style={(pressed) => ({ flex: 1, alignItems: "center", gap: 6, paddingVertical: 18, borderWidth: 1, borderStyle: "dashed", borderColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent", opacity: uploading ? 0.5 : 1 })}
              >
                {uploading ? <ActivityIndicator color={S.ink} /> : b.icon}
                <Label color={S.ink}>{b.label}</Label>
              </Press>
            ))}
          </View>
        </Panel>

        <Panel title="Terms & conditions">
          <Key label="Add T&C" icon={<Plus size={13} color={S.ink} />} onPress={() => setTcSheetOpen(true)} style={{ alignSelf: "flex-start", minHeight: 36 }} />
          {selectedTCs.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 20, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
              <Body size={12} color={S.graphite}>No T&C selected. Tap Add T&C above.</Body>
            </View>
          ) : (
            selectedTCs.map((tc, idx) => (
              <View key={`${tc.id}-${idx}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: S.ink, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: S.ink, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{tc.name}</Text>
                  <Body size={11.5} color={S.graphite} style={{ marginTop: 2 }}>{tc.terms}</Body>
                </View>
                <IconKey onPress={() => setSelectedTCs((prev) => prev.filter((x) => x.id !== tc.id))} size={30} red>
                  <X size={12} color={S.red} />
                </IconKey>
              </View>
            ))
          )}
        </Panel>

        <Key
          tone="ink"
          label={saveMutation.isPending ? "Saving…" : isEditing ? "Update contract" : "Create contract"}
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        />
      </SheetShell>

      {/* ── Pickers ── */}
      <OptionSheet
        visible={companyPickerOpen}
        title="Select company"
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
        title="Select project"
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
        title="Select financial year"
        options={(finYears as any[]).map((f) => ({ id: f.label, label: f.label }))}
        onClose={() => setFinYearPickerOpen(false)}
        onSelect={(id) => {
          setFinYear(id);
          setFinYearPickerOpen(false);
        }}
      />

      {/* Contact person: a tab per party type, a search, then the people */}
      <SheetPicker visible={contactSheetOpen} title="Contact person" onClose={() => setContactSheetOpen(false)}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
          <Seg
            options={PARTY_TABS.map((t) => ({ value: t.code, label: `${t.label} (${contactPersons.filter((p) => p.type === t.code).length})` }))}
            value={partyTab}
            onChange={(v) => setPartyTab(v)}
          />
          <SearchBox value={partySearch} onChange={setPartySearch} placeholder="Search…" />
        </View>
        <ScrollView style={{ marginTop: 6 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {contactsOfTab.length === 0 ? (
            <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 28 }}>No matches found</Body>
          ) : (
            contactsOfTab.map((p, i) => (
              <OptionRow
                key={`${p.type}-${p.partyId}-${i}`}
                label={p.name}
                sub={p.partyName}
                selected={contactPerson === p.name}
                onPress={() => {
                  setContactPerson(p.name);
                  setContactPartyId(p.partyId);
                  setContactSheetOpen(false);
                  setPartySearch("");
                }}
              />
            ))
          )}
        </ScrollView>
      </SheetPicker>

      {/* T&C: several may be chosen */}
      <SheetPicker
        visible={tcSheetOpen}
        title="Select terms & conditions"
        onClose={() => setTcSheetOpen(false)}
        footer={
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: S.ink }}>
            <Key tone="ink" label={`Done${selectedTCs.length ? ` · ${selectedTCs.length} chosen` : ""}`} onPress={() => setTcSheetOpen(false)} />
          </View>
        }
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
          {tcRecords.length === 0 ? (
            <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 28 }}>No T&C records found</Body>
          ) : (
            tcRecords.map((tc, i) => {
              const isSel = selectedTCs.some((x) => x.id === tc.id);
              return (
                <OptionRow
                  key={`${tc.id}-${i}`}
                  check
                  label={tc.name}
                  sub={tc.terms}
                  selected={isSel}
                  onPress={() => setSelectedTCs((prev) => (isSel ? prev.filter((x) => x.id !== tc.id) : [...prev, tc]))}
                />
              );
            })
          )}
        </ScrollView>
      </SheetPicker>
    </ScrollView>
  );
}
