// The journal voucher form as a page of the stack — under the app's header, like every other screen — on the drawing
// sheet. Same rules as web's JournalVoucher.tsx dialog: company (required), project, date, narration and two or more
// debit / credit lines, each against an account head; a line holds a debit or a credit, not both; it saves only when
// debit equals credit. New opens it bare; Edit passes the voucher's id and the full record (lines with their heads) is
// loaded here, as web's startEdit does. Saving or Back returns to the list.
import { istToday } from "@/utils/istTime";
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react-native";
import {
  getJournalVoucher, getJournalVoucherLedgerOptions, createJournalVoucher, updateJournalVoucher,
  type JournalVoucherLedgerOption, type JournalVoucherLine,
} from "@/api/journalVoucherApi";
import { fetchCompanyOptions, fetchProjectOptions } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Field, IconKey, Input, Key, Label, Notice, Panel, SheetShell, Skel } from "@/components/sheet/Sheet";
import { OptionPickerModal, PickerRow, type PickerOption } from "./payment/OptionPicker";

// A stable reference for "no data yet": an inline `= []` default makes a new array every render.
const EMPTY_LIST: any[] = [];

const LHEAD_TYPE_LABEL: Record<string, string> = { GL: "General Ledger", C: "Customer", S: "Supplier", B: "Bank" };

const fmtINR = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

type LineUI = JournalVoucherLine & { _id: string };
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const emptyLine = (): LineUI => ({ _id: newId(), LHeadId: null, DebitAmount: 0, CreditAmount: 0 });

export default function JournalVoucherFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "JournalVoucherForm">>();
  const editingId = route.params?.id ?? null;
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const { data: ledgerOptions = EMPTY_LIST as JournalVoucherLedgerOption[] } = useQuery({ queryKey: ["jv-ledger-options"], queryFn: getJournalVoucherLedgerOptions });
  const { data: companies = EMPTY_LIST } = useQuery({ queryKey: ["jv-companies"], queryFn: fetchCompanyOptions });
  const { data: allProjects = EMPTY_LIST } = useQuery({ queryKey: ["jv-projects"], queryFn: fetchProjectOptions });
  const { data: existing, isLoading: existingLoading, isError: existingError } = useQuery({
    queryKey: ["journal-voucher", editingId],
    queryFn: () => getJournalVoucher(editingId!),
    enabled: editingId != null,
  });

  const [jvDate, setJvDate] = useState(istToday());
  const [narration, setNarration] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyLabel, setCompanyLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectLabel, setProjectLabel] = useState("");
  const [lines, setLines] = useState<LineUI[]>([emptyLine(), emptyLine()]);
  const [picker, setPicker] = useState<"company" | "project" | null>(null);
  const [lhPickerLineId, setLhPickerLineId] = useState<string | null>(null);

  // Edit: fill the form once the full record is in.
  useEffect(() => {
    if (!existing) return;
    setJvDate((existing.JVDate || "").slice(0, 10) || istToday());
    setNarration(existing.Narration || "");
    setCompanyId(existing.CompanyId ? String(existing.CompanyId) : "");
    setCompanyLabel(existing.CompanyName || "");
    setProjectId(existing.ProjectId ? String(existing.ProjectId) : "");
    setProjectLabel(existing.ProjectName || "");
    setLines(
      (existing.lines || []).map((l) => ({ _id: newId(), LineID: l.LineID, LHeadId: l.LHeadId, DebitAmount: l.DebitAmount, CreditAmount: l.CreditAmount, Narration: l.Narration || "" })),
    );
  }, [existing]);

  const projects = useMemo(() => (allProjects as any[]).filter((p) => String(p.company_id) === companyId), [allProjects, companyId]);

  const ledgerOptionsList: PickerOption[] = useMemo(
    () => ledgerOptions.map((o) => ({ key: String(o.id), label: o.label, sublabel: LHEAD_TYPE_LABEL[o.type || "GL"] ?? o.type })),
    [ledgerOptions],
  );
  const headLabel = (id: number | null | undefined) => {
    const o = ledgerOptions.find((x) => x.id === id);
    return o ? o.label : "";
  };

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.DebitAmount) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const updateLine = (id: string, patch: Partial<LineUI>) => setLines((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l._id !== id) : prev));

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("Select the Company this voucher belongs to.");
      if (!totals.balanced) throw new Error("Debit and Credit totals must match before saving.");
      if (lines.some((l) => !l.LHeadId)) throw new Error("Every line requires an account head.");
      const payload = { JVDate: jvDate, Narration: narration, CompanyId: Number(companyId), ProjectId: projectId ? Number(projectId) : null, lines };
      return editingId ? updateJournalVoucher(editingId, payload) : createJournalVoucher(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-vouchers"] });
      if (editingId) qc.invalidateQueries({ queryKey: ["journal-voucher", editingId] });
      Alert.alert(editingId ? "Journal Voucher updated" : "Journal Voucher created", editingId ? undefined : "Submitted for approval.");
      navigation.goBack();
    },
    onError: (e: Error) => Alert.alert("Save failed", e.message),
  });

  const started = totals.debit > 0 || totals.credit > 0;
  const back = <Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />;

  if (editingId != null && (existingLoading || existingError)) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance · Journal voucher" title="Edit journal voucher" action={back}>
          {existingLoading ? (
            <>
              <Skel h={140} />
              <Skel h={180} />
            </>
          ) : (
            <Notice>{`Could not load Journal Voucher #${editingId}.`}</Notice>
          )}
        </SheetShell>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <SheetShell
          eyebrow="CivilierERP · Finance · Journal voucher"
          title={editingId ? `Edit ${existing?.JVNo || "journal voucher"}` : "New journal voucher"}
          subtitle="Debit total must equal credit total."
          action={back}
        >
          <Panel title="Voucher">
            <View>
              <PickerRow label="Company *" value={companyLabel} placeholder="Select company…" onPress={() => setPicker("company")} />
              <PickerRow label="Project" value={projectLabel} placeholder={companyId ? "Optional…" : "Select a company first"} onPress={() => setPicker("project")} disabled={!companyId} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="Date" style={{ width: "40%" }}>
                  <Input value={jvDate} onChangeText={setJvDate} placeholder="YYYY-MM-DD" />
                </Field>
                <Field label="Narration" style={{ flex: 1 }}>
                  <Input value={narration} onChangeText={setNarration} placeholder="Reason…" />
                </Field>
              </View>
            </View>
          </Panel>

          <Panel title={`Lines (${lines.length})`}>
            {lines.map((line, idx) => (
              <View key={line._id} style={{ gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PickerRow label={`Line ${idx + 1} · account head`} value={headLabel(line.LHeadId)} placeholder="Select account…" onPress={() => setLhPickerLineId(line._id)} />
                  </View>
                  <View style={{ marginBottom: 12 }}>
                    <IconKey onPress={() => removeLine(line._id)} disabled={lines.length <= 2} red size={44}>
                      <Trash2 size={14} color={S.red} />
                    </IconKey>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Field label="Debit" style={{ flex: 1 }}>
                    <Input
                      value={line.DebitAmount ? String(line.DebitAmount) : ""}
                      onChangeText={(v) => {
                        const n = parseFloat(v) || 0;
                        updateLine(line._id, n !== 0 ? { DebitAmount: n, CreditAmount: 0 } : { DebitAmount: n });
                      }}
                      keyboardType="numeric"
                      placeholder="0.00"
                      style={{ textAlign: "right" }}
                    />
                  </Field>
                  <Field label="Credit" style={{ flex: 1 }}>
                    <Input
                      value={line.CreditAmount ? String(line.CreditAmount) : ""}
                      onChangeText={(v) => {
                        const n = parseFloat(v) || 0;
                        updateLine(line._id, n !== 0 ? { CreditAmount: n, DebitAmount: 0 } : { CreditAmount: n });
                      }}
                      keyboardType="numeric"
                      placeholder="0.00"
                      style={{ textAlign: "right" }}
                    />
                  </Field>
                </View>
              </View>
            ))}
            <Key label="Add line" icon={<Plus size={13} color={S.ink} />} onPress={addLine} style={{ alignSelf: "flex-start", minHeight: 36 }} />
          </Panel>

          {/* The two totals over an ink rule, then where the voucher stands: balanced, or by how much it is out. */}
          <View style={{ borderTopWidth: 1.5, borderTopColor: S.ink, paddingTop: 10, gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View>
                <Label>Debit</Label>
                <Text style={{ color: S.ink, fontSize: 18, fontFamily: fonts.heading.semibold, marginTop: 4 }}>{fmtINR(totals.debit)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Label>Credit</Label>
                <Text style={{ color: S.ink, fontSize: 18, fontFamily: fonts.heading.semibold, marginTop: 4 }}>{fmtINR(totals.credit)}</Text>
              </View>
            </View>
            {totals.balanced ? (
              <Notice tone="ink">{`Balanced: ${fmtINR(totals.debit)} each side.`}</Notice>
            ) : started ? (
              <Notice>{`Out by ${fmtINR(Math.abs(totals.debit - totals.credit))}.`}</Notice>
            ) : (
              <Body size={12.5} color={S.graphite}>Enter an amount on each line.</Body>
            )}
          </View>
        </SheetShell>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1.5, borderTopColor: S.ink, backgroundColor: colors.background }}>
        <Key label="Cancel" onPress={() => navigation.goBack()} />
        <Key
          tone="ink"
          label={saveMutation.isPending ? "Saving…" : editingId ? "Save changes" : "Save & submit"}
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !totals.balanced}
          style={{ flex: 1 }}
        />
      </View>

      <OptionPickerModal
        visible={picker === "company"}
        title="Select company"
        options={(companies as any[]).map((c) => ({ key: String(c.id), label: c.label }))}
        selectedKey={companyId}
        onClose={() => setPicker(null)}
        searchable
        onSelect={(id) => {
          setCompanyId(id);
          setCompanyLabel((companies as any[]).find((c) => String(c.id) === id)?.label ?? "");
          setProjectId("");
          setProjectLabel("");
          setPicker(null);
        }}
      />
      <OptionPickerModal
        visible={picker === "project"}
        title="Select project"
        options={projects.map((p) => ({ key: String(p.id), label: p.label }))}
        selectedKey={projectId}
        onClose={() => setPicker(null)}
        searchable
        clearable
        onSelect={(id) => {
          setProjectId(id);
          setProjectLabel(projects.find((p) => String(p.id) === id)?.label ?? "");
          setPicker(null);
        }}
      />
      <OptionPickerModal
        visible={!!lhPickerLineId}
        title="Select account head"
        options={ledgerOptionsList}
        selectedKey={lhPickerLineId ? String(lines.find((l) => l._id === lhPickerLineId)?.LHeadId ?? "") : null}
        onClose={() => setLhPickerLineId(null)}
        searchable
        onSelect={(id) => {
          if (lhPickerLineId) updateLine(lhPickerLineId, { LHeadId: Number(id) });
          setLhPickerLineId(null);
        }}
      />
    </View>
  );
}
