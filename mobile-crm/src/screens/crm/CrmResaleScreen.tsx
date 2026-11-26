// One resale / buy-back CASE — the web's guided flow (src/pages/CRM/CrmResaleCase.tsx), part for part: who → who and
// the step it is on; each step with its checklist (✓ done / ○ still needed), the documents it needs (Upload, View,
// Verify, Reject), its one action (Confirm seller is clear, Issue NOC, Open buyer's application, Issue fee invoice,
// Send for approval), the fee payment (Send to Finance), the deed steps with their fields, Open the deed, and at the
// end Transfer to buyer / Send payout to Finance; the property and every document. Worked out on the server
// (GET /api/crm/resales/:id/case); every key the web's route (PUT /api/crm/resales/:id/case/…), its words.
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Check, ChevronDown, Lock, X } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { toast } from "@/components/Toast";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import { openDocument } from "@/utils/documents";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Pill, Section, fmtDate, money } from "./ui";

const API = "/api/crm/resales";
type CheckItem = { label: string; ok: boolean; hint?: string | null; doc?: string; action?: string; link?: string | null; step?: string };
type Stage = { key: string; label: string; ok: boolean; na: boolean; state: "done" | "current" | "waiting" | "stopped"; blockers: string[]; detail: string | null; checks: CheckItem[] };
type CaseDoc = { Id: number; DocumentType: string; FileName: string; Status: string; Remarks: string | null; CreatedAt: string; UploadedByName: string | null };
type CaseState = { case: Row; seller: Row; documents: CaseDoc[]; docTypes: Record<string, string>; stages: Stage[]; currentStage: string | null };

const DEED_ACTION: Record<string, string> = {
  Draft: "Start the deed", LegalApproved: "Give legal approval", Consented: "Record both parties' consent", Executed: "Record the signing date",
  DutyPaid: "Record stamp duty paid", Registered: "Record the registration",
};
const ACTION_LABEL: Record<string, string> = {
  clearance: "Confirm seller is clear", noc: "Issue NOC", "buyer-application": "Open buyer's application", "fee-invoice": "Issue fee invoice", submit: "Send for approval",
};
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** New resale or buy-back — the web's form on Resale Cases (CrmResales.tsx): the kind, a sold property (its owner,
 * price, paid, still due), the plots for a multi-plot booking, the buyer, price and fee (+ GST) or the buy-back price,
 * TDS, GST, stamp duty; date and notes; its checks; POST /api/crm/resales/deal, then straight into the case. */
export function NewResaleScreen() {
  const b = useBrand();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const empty = { Kind: "Resale" as "Resale" | "BuyBack", FromBookingId: "", ToCustomerId: "", AgreedValue: "", DeveloperFeeAmount: "",
    TdsAmount: "", BuyBackGstAmount: "", StampDutyAmount: "", ResaleDate: localDay(), Notes: "", PlotIds: [] as number[] };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState<null | "property" | "buyer">(null);
  const holdings = useQuery({ queryKey: ["crm-resale-holdings"], queryFn: () => crmGet<Row[]>(`${API}/holdings`) }).data ?? [];
  const customersQ = useQuery({ queryKey: ["crm", "customers", ""], staleTime: 60_000, queryFn: () => crmGet<Row[]>("/api/crm/customers").then((d) => (Array.isArray(d) ? d : [])) });
  const customers = customersQ.data ?? [];
  const holding = holdings.find((h) => String(h.BookingId) === form.FromBookingId);
  const freePlots: Row[] = (holding?.Plots || []).filter((p: Row) => !p.OpenDeal);
  const choosesPlots = form.Kind === "Resale" && (holding?.Plots?.length || 0) > 1;
  const freeKey = `${holding?.BookingId ?? ""}:${freePlots.map((p) => p.PlotId).join(",")}`;
  useEffect(() => { setForm((f) => ({ ...f, PlotIds: freePlots.map((p) => p.PlotId) })); }, [freeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const plotSale = (() => {
    if (!choosesPlots || !holding?.Plots) return null;
    const all = holding.Plots.reduce((t: number, p: Row) => t + Number(p.AllocatedValue || 0), 0);
    const sold = holding.Plots.filter((p: Row) => form.PlotIds.includes(p.PlotId)).reduce((t: number, p: Row) => t + Number(p.AllocatedValue || 0), 0);
    if (!(all > 0) || form.PlotIds.length === holding.Plots.length) return null;
    return { price: sold, paid: Math.round(Number(holding.Paid || 0) * (sold / all) * 100) / 100 };
  })();
  const feeGst = useQuery({ queryKey: ["crm-resale-fee-gst", form.DeveloperFeeAmount, holding?.Kind], enabled: form.Kind === "Resale" && Number(form.DeveloperFeeAmount) > 0,
    queryFn: () => crmGet<{ gstAmount: number; rate: number }>(`${API}/fee-gst?amount=${encodeURIComponent(form.DeveloperFeeAmount)}&plot=${holding?.Kind === "Plot" ? 1 : 0}`) });
  const premium = form.Kind === "BuyBack" && holding && Number(form.AgreedValue) > 0 ? Number(form.AgreedValue) - Number(holding.Paid || 0) : null;
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const field = (label: string, key: keyof typeof empty, hint?: string | null, placeholder?: string, numeric = true) => (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
      <TextInput value={String(form[key])} onChangeText={(v) => set(key, v)} keyboardType={numeric ? "decimal-pad" : "default"} placeholder={placeholder} placeholderTextColor={b.textFaint}
        style={{ borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
      {hint ? <Text style={{ fontSize: 11.5, color: b.textFaint }}>{hint}</Text> : null}
    </View>
  );

  const save = async () => {
    if (!form.FromBookingId) { toast.error("Choose the property that is changing hands"); return; }
    if (choosesPlots && !form.PlotIds.length) { toast.error("Choose the plots being sold"); return; }
    if (form.Kind === "Resale" && !form.ToCustomerId) { toast.error("Choose the new buyer"); return; }
    if (form.Kind === "Resale" && holding && String(form.ToCustomerId) === String(holding.CustomerId)) { toast.error("The seller and the buyer can't be the same customer"); return; }
    if (!(Number(form.AgreedValue) > 0)) { toast.error(form.Kind === "BuyBack" ? "Enter the agreed buy-back price" : "Enter the price the buyers agreed"); return; }
    setSaving(true);
    try {
      const out = await crmSend<Row>(`${API}/deal`, "POST", { ...form, PlotIds: choosesPlots ? form.PlotIds : undefined });
      toast.success(out.message || "Recorded");
      ["crm", "crm-resale-holdings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (out.id) nav.replace("CrmResale", { resaleId: Number(out.id), title: "Resale" }); else nav.goBack();
    } catch (e) { toast.error((e as Error).message || "Could not record it"); }
    finally { setSaving(false); }
  };

  const offered = holdings.filter((h) => (!h.OpenDeal || h.Plots?.some((p: Row) => !p.OpenDeal)) && !h.Conveyed);
  return (
    <View style={{ flex: 1, backgroundColor: b.surface }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{form.Kind === "BuyBack" ? "Buy back a property" : "Resell a property"}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["Resale", "BuyBack"] as const).map((k) => <ActionKey key={k} outline={form.Kind !== k} label={k === "Resale" ? "Resale to another buyer" : "Buy-back by us"} onPress={() => set("Kind", k)} />)}
        </View>

        <PickerRow label="Property" value={holding ? [holding.UnitNo, holding.Kind, holding.CustomerName].filter(Boolean).join(" · ") : ""} placeholder="Choose a sold property" onPress={() => setPick("property")} />
        {holding ? (
          <View style={{ borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 10 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.textPrimary }}>{holding.UnitNo} · {holding.Kind}</Text>
            <Kv label="Owner" value={holding.CustomerName} />
            <Kv label="Price" value={money(holding.TotalValue)} />
            <Kv label="Paid so far" value={money(holding.Paid)} />
            <Kv label="Still due" value={money(Math.max(0, holding.TotalValue - holding.Paid))} />
            {plotSale ? <><Kv label="Plots sold — price" value={money(plotSale.price)} /><Kv label="Their share of what was paid" value={money(plotSale.paid)} /></> : null}
          </View>
        ) : <Text style={{ fontSize: 11.5, color: b.textFaint }}>Not listed? It has an open case, or its sale deed is registered — use Ownership Changes.</Text>}

        {choosesPlots && holding?.Plots ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Plots being sold</Text>
            {holding.Plots.map((p: Row) => {
              const on = form.PlotIds.includes(p.PlotId);
              return (
                <Pressable key={p.PlotId} disabled={!!p.OpenDeal} onPress={() => set("PlotIds", on ? form.PlotIds.filter((x) => x !== p.PlotId) : [...form.PlotIds, p.PlotId])}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderWidth: 1, borderColor: b.border, borderRadius: 10, opacity: p.OpenDeal ? 0.6 : 1 }}>
                  <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: b.textPrimary, backgroundColor: on ? b.textPrimary : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {on ? <Check size={11} color={b.surface} /> : null}
                  </View>
                  <Text style={{ flex: 1, fontSize: 13, color: b.textPrimary }}>{p.PlotName}{p.AreaSqFt ? `  ${Number(p.AreaSqFt).toLocaleString("en-IN")} sq ft` : ""}</Text>
                  <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{money(p.AllocatedValue)}</Text>
                  {p.OpenDeal ? <Text style={{ fontSize: 11, color: b.textFaint }}>On case #{p.OpenDeal.Id}</Text> : null}
                </Pressable>
              );
            })}
            <Text style={{ fontSize: 11.5, color: b.textFaint }}>Each plot goes at its own booked price; what was paid is shared by those prices. Plots sold leave this booking for a new booking in the buyer's name.</Text>
          </View>
        ) : null}

        {form.Kind === "Resale" ? (
          <>
            <PickerRow label="New buyer" value={(() => { const c = customers.find((x) => String(x.Id) === form.ToCustomerId); return c ? [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") : ""; })()}
              placeholder="Choose the new buyer" onPress={() => setPick("buyer")} />
            <Text style={{ fontSize: 11.5, color: b.textFaint, marginTop: -6 }}>Not listed? Add them in Customers first.</Text>
            {field("Price agreed between buyers *", "AgreedValue", null, "Goes on the transfer")}
            {field("Our transfer fee", "DeveloperFeeAmount", feeGst.data ? `+ GST ${money(feeGst.data.gstAmount)} (${feeGst.data.rate}%)` : feeGst.error ? (feeGst.error as Error).message : null, "Paid by the new buyer")}
          </>
        ) : (
          <>
            {field("Agreed buy-back price *", "AgreedValue", premium != null ? (premium >= 0 ? `${money(premium)} above what was paid` : `${money(-premium)} below what was paid`) : null)}
            {field("TDS", "TdsAmount", Number(form.AgreedValue) >= 5000000 ? "₹50 lakh or more: 1% TDS (sec. 194-IA) — confirm with your CA" : null)}
            {field("GST (as advised)", "BuyBackGstAmount")}
            {field("Stamp duty (as advised)", "StampDutyAmount")}
            <Text style={{ fontSize: 11.5, color: b.textFaint }}>Any unpaid milestones are cancelled; we pay only the agreed price. Earlier invoices stay as they are.</Text>
          </>
        )}
        <DateField label="Date" value={form.ResaleDate} onChange={(v: string) => set("ResaleDate", v)} />
        {field("Notes", "Notes", null, undefined, false)}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: b.border }}>
        <ActionKey outline label="Close" onPress={() => nav.goBack()} />
        <ActionKey label={saving ? "Saving…" : "Open case"} onPress={() => { if (!saving) void save(); }} />
      </View>
      <OptionPickerModal visible={!!pick} searchable title={pick === "property" ? "Property" : "New buyer"}
        options={pick === "property" ? offered.map((h) => ({ key: String(h.BookingId), label: [h.UnitNo, h.Kind, h.CustomerName].filter(Boolean).join(" · "), sublabel: [h.BookingNos, h.ProjectName].filter(Boolean).join(" · ") }))
          : customers.filter((c) => !holding || c.Id !== holding.CustomerId).map((c) => ({ key: String(c.Id), label: c.CustomerName, sublabel: [c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") }))}
        selectedKey={pick === "property" ? form.FromBookingId : form.ToCustomerId}
        onSelect={(k) => { set(pick === "property" ? "FromBookingId" : "ToCustomerId", k ?? ""); setPick(null); }}
        onClose={() => setPick(null)} />
    </View>
  );
}

export default function CrmResaleScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmResale">>();
  const id = params.resaleId;
  const b = useBrand();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deed, setDeed] = useState<Row>({ method: "", seller: false, buyer: false, executionDate: "", stampDuty: "", registrationFee: "", paidRef: "", paidBy: "Buyer", regNo: "", regDate: "", regOffice: "" });
  const [fee, setFee] = useState({ PaymentMode: "", TransactionRef: "", ReceivedDate: localDay() });
  const [pick, setPick] = useState<null | "feeMode" | "paidBy">(null);
  const [rejectDoc, setRejectDoc] = useState<CaseDoc | null>(null);
  const [rejectText, setRejectText] = useState("");

  const q = useQuery<CaseState>({ queryKey: ["crm-resale-case", id], queryFn: () => crmGet(`${API}/${id}/case`) });
  const st = q.data;
  const c = st?.case;
  useEffect(() => { if (st) setOpen(st.currentStage || st.stages[st.stages.length - 1]?.key || null); }, [st?.currentStage]); // eslint-disable-line react-hooks/exhaustive-deps

  const isResale = c?.Kind !== "BuyBack";
  const finished = !!c && ["Completed", "Cancelled"].includes(c.Status);
  const canEdit = canDoAction("crm-resales", "edit") && !finished;

  const apply = (out: Row) => {
    const next = out?.stages ? out : out?.state?.stages ? out.state : null;
    if (next) qc.setQueryData(["crm-resale-case", id], next); else qc.invalidateQueries({ queryKey: ["crm-resale-case", id] });
    qc.invalidateQueries({ queryKey: ["crm"] });
  };
  const call = async (key: string, path: string, body?: object, ok?: string) => {
    setBusy(key);
    try {
      const out = await crmSend<Row>(`${API}/${id}/${path}`, "PUT", body || {});
      toast.success(out.message || ok || "Done");
      if (out.ledger?.posted === false && out.ledger.reason) toast.error(out.ledger.reason);
      if (out.ledgerWarning) toast.error(out.ledgerWarning);
      apply(out);
    } catch (e) { toast.error((e as Error).message || "Could not do that"); }
    finally { setBusy(null); }
  };
  const upload = async (type: string) => {
    const pickRes = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
    if (pickRes.canceled || !pickRes.assets?.length) return;
    const a = pickRes.assets[0];
    setBusy(`up-${type}`);
    try {
      const fd = new FormData();
      if (a.file) fd.append("file", a.file); else fd.append("file", { uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream" } as any);
      fd.append("DocumentType", type);
      const res = await fetchWithAuth(`${API}/${id}/documents`, { method: "POST", body: fd });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Upload failed");
      toast.success("Uploaded — now someone else verifies it");
      apply(out);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  const viewDoc = (d: CaseDoc) => openDocument(`${API}/${id}/documents/${d.Id}/file`, d.FileName || "Document").catch(() => toast.error("Could not open the file"));
  const openDeed = async () => {
    setBusy("deed");
    try {
      const out = await crmSend<Row>(`/api/crm/transfer-deeds/for-case/${c!.Id}`, "POST", {});
      nav.navigate("CrmTransferDeed", { deedId: Number(out.deed.Id), title: out.deed.DeedNo || "Transfer Deed" });
    } catch (e) { toast.error((e as Error).message || "Could not open the deed"); }
    finally { setBusy(null); }
  };

  if (q.isLoading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}><ActivityIndicator color={b.accent} /></View>;
  if (q.error || !st || !c) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
      <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>{(q.error as Error)?.message || "Case not found"}</Text>
    </View>;
  }

  const steps = st.stages;
  const curIdx = steps.findIndex((s) => s.key === st.currentStage);
  const doneCount = steps.filter((s) => s.ok || s.na).length;
  const latestDoc = (t: string) => st.documents.filter((d) => d.DocumentType === t).pop();
  const last = steps[steps.length - 1];
  const readyToFinish = steps.filter((s) => s !== last).every((s) => s.ok || s.na);
  const docMark = (s: string) => (s === "Uploaded" ? "Waiting to be verified" : s);
  const small = (label: string, onPress: () => void, outline = true, danger = false, disabled = false) => (
    <Pressable key={label} onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: danger ? b.danger : b.accent,
        backgroundColor: outline ? "transparent" : b.accent, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: outline ? (danger ? b.danger : b.accent) : "#fff" }}>{label}</Text>
    </Pressable>
  );
  const field = (label: string, value: string, onChange: (v: string) => void, opts: { numeric?: boolean; placeholder?: string } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={opts.numeric ? "decimal-pad" : "default"} placeholder={opts.placeholder} placeholderTextColor={b.textFaint}
        style={{ borderWidth: 1, borderColor: b.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
    </View>
  );

  const DocSlot = ({ type, active }: { type: string; active: boolean }) => {
    const d = latestDoc(type);
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {d ? <Pill label={docMark(d.Status)} tone={d.Status === "Verified" ? b.success : d.Status === "Rejected" ? b.danger : b.warning} /> : null}
        {d ? small("View", () => viewDoc(d)) : null}
        {canEdit && active && d?.Status === "Uploaded" ? <>
          {small("Verify", () => call(`doc-${d.Id}`, `documents/${d.Id}/review`, { decision: "Verified", remarks: "" }, "Verified"), false, false, busy === `doc-${d.Id}`)}
          {small("Reject", () => { setRejectText(""); setRejectDoc(d); }, true, true, busy === `doc-${d.Id}`)}
        </> : null}
        {canEdit && active && (!d || d.Status === "Rejected") ? small(busy === `up-${type}` ? "Uploading…" : d ? "Upload again" : "Upload", () => upload(type), true, false, busy === `up-${type}`) : null}
        {d?.Status === "Rejected" && d.Remarks ? <Text style={{ width: "100%", fontSize: 11.5, color: b.danger }}>{d.Remarks}</Text> : null}
      </View>
    );
  };

  const deedFields = (step: string) => {
    if (step === "Consented") return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13.5, color: b.textPrimary }}>Seller consents</Text>
          <Switch value={!!deed.seller} onValueChange={(v) => setDeed({ ...deed, seller: v })} trackColor={{ true: b.accent }} />
        </View>
        {isResale ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 13.5, color: b.textPrimary }}>Buyer consents</Text>
            <Switch value={!!deed.buyer} onValueChange={(v) => setDeed({ ...deed, buyer: v })} trackColor={{ true: b.accent }} />
          </View>
        ) : null}
        {field("How", deed.method, (v) => setDeed({ ...deed, method: v }), { placeholder: "Signed draft, in person, email…" })}
      </View>
    );
    if (step === "Executed") return <DateField label="Signed on" value={deed.executionDate} onChange={(v: string) => setDeed({ ...deed, executionDate: v })} />;
    if (step === "DutyPaid") return (
      <View style={{ gap: 8 }}>
        {field("Stamp duty (as assessed)", deed.stampDuty, (v) => setDeed({ ...deed, stampDuty: v }), { numeric: true })}
        {field("Registration fee", deed.registrationFee, (v) => setDeed({ ...deed, registrationFee: v }), { numeric: true })}
        {field("GRN / challan no.", deed.paidRef, (v) => setDeed({ ...deed, paidRef: v }))}
        <PickerRow label="Paid by" value={deed.paidBy} onPress={() => setPick("paidBy")} />
      </View>
    );
    if (step === "Registered") return (
      <View style={{ gap: 8 }}>
        {field("Registration no.", deed.regNo, (v) => setDeed({ ...deed, regNo: v }))}
        <DateField label="Registered on" value={deed.regDate} onChange={(v: string) => setDeed({ ...deed, regDate: v })} />
        {field("Sub-Registrar office", deed.regOffice, (v) => setDeed({ ...deed, regOffice: v }))}
      </View>
    );
    return null;
  };

  const renderCheck = (s: Stage, ch: CheckItem, i: number, active: boolean) => {
    const firstOpen = s.checks.findIndex((x) => !x.ok) === i;
    const sequential = ch.action === "clearance" || ch.action === "fee-payment";
    const canAct = sequential ? firstOpen : true;
    const isNextDeed = !!ch.step && ch.step === c.DeedNext;
    const docReady = ch.doc ? latestDoc(ch.doc)?.Status === "Verified" : true;
    return (
      <View key={i} style={{ paddingVertical: 10, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: b.border }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ width: 20, height: 20, marginTop: 1, borderRadius: 4, alignItems: "center", justifyContent: "center",
            backgroundColor: ch.ok ? b.textPrimary : "transparent", borderWidth: ch.ok ? 0 : 2, borderColor: b.textFaint }}>
            {ch.ok ? <Check size={12} color={b.surface} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13.5, fontFamily: ch.ok ? fonts.body.regular : fonts.body.medium, color: ch.ok ? b.textSecondary : b.textPrimary }}>{ch.label}</Text>
            {ch.hint ? <Text style={{ fontSize: 11.5, color: b.textFaint }}>{ch.hint}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginLeft: 30 }}>
          {ch.link === "kyc" && c.ToCustomerId && !ch.ok ? small("Edit buyer", () => nav.navigate("CrmCustomer", { customerId: Number(c.ToCustomerId), title: c.ToName })) : null}
          {ch.link === "application" && c.BuyerApplicationId ? small("Open application", () => nav.navigate("CrmApplicationForm", { applicationId: Number(c.BuyerApplicationId) })) : null}
          {ch.link === "inbox" && !ch.ok ? small("Approval Inbox", () => nav.navigate("Approvals" as never)) : null}
          {ch.link === "deed" && c.TransferDeedId ? small(`Work on ${c.TransferDeedNo}`, () => nav.navigate("CrmTransferDeed", { deedId: Number(c.TransferDeedId), title: c.TransferDeedNo || "Transfer Deed" }), false) : null}
          {ch.action === "open-deed" && canEdit && active ? small("Open the deed", openDeed, false, false, !!busy) : null}
          {ch.doc ? <DocSlot type={ch.doc} active={active} /> : null}
          {canEdit && active && canAct && !ch.ok && ch.action && ACTION_LABEL[ch.action]
            ? small(ACTION_LABEL[ch.action], () => call(ch.action!, `case/${ch.action}`, {}, ch.action === "submit" ? "Sent — waiting in the Approval Inbox" : "Done"), false, false,
              !!busy || (ch.action === "clearance" && s.checks.slice(0, i).some((x) => !x.ok)))
            : null}
        </View>
        {canEdit && active && firstOpen && ch.action === "fee-payment" ? (
          <View style={{ marginLeft: 30, gap: 8, padding: 10, borderWidth: 1, borderColor: b.border, borderRadius: 10 }}>
            <PickerRow label="Mode" value={fee.PaymentMode} placeholder="Choose" onPress={() => setPick("feeMode")} />
            {field("Reference", fee.TransactionRef, (v) => setFee({ ...fee, TransactionRef: v }), { placeholder: "UTR / cheque no." })}
            <DateField label="Received on" value={fee.ReceivedDate} onChange={(v: string) => setFee({ ...fee, ReceivedDate: v })} />
            <View style={{ flexDirection: "row" }}>{small(busy === "fee" ? "Sending…" : "Send to Finance", () => call("fee", "case/fee-payment", fee, "Sent to Finance for approval"), false, false, busy === "fee")}</View>
          </View>
        ) : null}
        {canEdit && active && isNextDeed ? (
          <View style={{ marginLeft: 30, gap: 8, padding: 10, borderWidth: 1, borderColor: b.border, borderRadius: 10 }}>
            {deedFields(ch.step!)}
            {ch.doc && !docReady ? <Text style={{ fontSize: 11.5, color: b.textFaint }}>{ch.step === "Draft" ? "Upload the draft above first." : "Upload the document above and have it verified first."}</Text> : null}
            <View style={{ flexDirection: "row" }}>
              {small(DEED_ACTION[ch.step!], () => call("deed", `case/deed/${ch.step}`, deed, "Saved"), false, false,
                busy === "deed" || (ch.step === "Draft" ? !latestDoc("DeedDraft") : !docReady))}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const finishResale = () => Alert.alert("Transfer", `Pass ${c.Property} to ${c.ToName}?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Transfer", onPress: () => { void call("finish", "transfer", {}, "Transferred to the buyer"); } },
  ]);

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 56 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 12, color: b.textSecondary }}>Case #{c.Id} · Booking {c.BookingNo}</Text>
          <Text style={{ fontSize: 20, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{isResale ? "Resale" : "Buy-back"} · {c.Property}</Text>
        </View>

        {/* Who → who, and where it stands */}
        <Section title={isResale ? "Resale" : "Buy-back"}>
          <Text style={{ fontSize: 14, fontFamily: fonts.body.medium, color: b.textPrimary }}>{c.FromName} → {isResale ? c.ToName || "new buyer" : "back to us"}</Text>
          <Text style={{ fontSize: 12.5, color: b.textSecondary, marginTop: 4 }}>
            {finished ? (c.Status === "Completed" ? `Completed ${fmtDate(c.CompletedAt)}` : c.Status) : `Step ${curIdx + 1} of ${steps.length}: ${steps[curIdx]?.label ?? ""}`}
          </Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: b.surfaceGlass, overflow: "hidden", marginTop: 8 }}>
            <View style={{ height: "100%", width: `${Math.round((doneCount / steps.length) * 100)}%`, backgroundColor: ["Rejected", "Cancelled"].includes(c.Status) ? b.textFaint : b.textPrimary }} />
          </View>
          {["Rejected", "Cancelled"].includes(c.Status) && c.RejectionNote ? <Text style={{ fontSize: 13, color: b.danger, marginTop: 8 }}>{c.Status === "Rejected" ? "Sent back: " : ""}{c.RejectionNote}</Text> : null}
        </Section>

        {/* The guided steps */}
        {steps.map((s, i) => {
          const isOpen = open === s.key;
          const active = s.state === "current";
          const locked = s.state === "waiting";
          const todo = s.checks.filter((x) => !x.ok).length;
          return (
            <View key={s.key} style={{ borderRadius: 16, borderWidth: 1, borderColor: active ? b.textPrimary : b.border, borderLeftWidth: active ? 3 : 1, backgroundColor: b.surfaceCard, opacity: s.na ? 0.6 : 1 }}>
              <Pressable onPress={() => setOpen(isOpen ? null : s.key)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center",
                  backgroundColor: s.ok || s.na ? b.textPrimary : s.state === "stopped" ? b.danger : "transparent",
                  borderWidth: s.ok || s.na || s.state === "stopped" ? 0 : active ? 2 : 1, borderColor: active ? b.textPrimary : b.textFaint, borderStyle: locked ? "dashed" : "solid" }}>
                  {s.ok || s.na ? <Check size={14} color={b.surface} /> : s.state === "stopped" ? <X size={13} color="#fff" /> : locked ? <Lock size={12} color={b.textFaint} />
                    : <Text style={{ fontSize: 12, fontFamily: fonts.heading.bold, color: b.textPrimary }}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.bold, color: b.textPrimary, textTransform: "uppercase", letterSpacing: 0.6 }}>{s.label}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, color: b.textSecondary }}>
                    {s.na ? "Not needed" : s.ok ? s.detail || "Done" : active ? `${todo} thing${todo === 1 ? "" : "s"} left` : locked ? "Opens after the steps above" : s.detail || ""}
                  </Text>
                </View>
                {active ? <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: b.textPrimary, borderRadius: 4 }}>
                  <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.semibold, color: b.surface, letterSpacing: 0.8 }}>YOU ARE HERE</Text></View> : null}
                <ChevronDown size={16} color={b.textFaint} style={{ transform: [{ rotate: isOpen ? "180deg" : "0deg" }] }} />
              </Pressable>
              {isOpen ? (
                <View style={{ paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: b.border }}>
                  {locked ? <Text style={{ paddingTop: 10, fontSize: 12, color: b.textSecondary }}>Opens once "{steps[curIdx]?.label}" is done. It will need:</Text> : null}
                  {s.checks.map((ch, ci) => renderCheck(s, ch, ci, active))}
                  {s.key === "clearance" && active && canEdit && !c.SellerClearedAt ? (
                    <Pressable onPress={() => call("loan", "case/seller-loan", { hasLoan: !c.SellerHasLoan }, "Saved")}>
                      <Text style={{ fontSize: 12.5, color: b.textPrimary, textDecorationLine: "underline", marginTop: 4 }}>{c.SellerHasLoan ? "The seller has no home loan" : "The seller has a home loan"}</Text>
                    </Pressable>
                  ) : null}
                  {s === last && active && canEdit ? (
                    <View style={{ marginTop: 10, gap: 8, padding: 10, borderWidth: 1, borderColor: b.border, borderRadius: 10 }}>
                      <Text style={{ fontSize: 12, color: b.textSecondary }}>
                        {isResale ? "The booking, its schedule and everything paid pass to the buyer. The seller's agreement stays as history and the buyer gets portal access."
                          : "Finance pays the agreed price; when they approve it the property returns to stock."}
                      </Text>
                      {isResale && c.FromCustomerId && c.FromCustomerId === c.ToCustomerId ? <Text style={{ fontSize: 11.5, color: b.danger }}>The seller and the buyer are the same customer</Text> : null}
                      <View style={{ flexDirection: "row" }}>
                        {isResale
                          ? small("Transfer to buyer", finishResale, false, false, !readyToFinish || busy === "finish" || (!!c.FromCustomerId && c.FromCustomerId === c.ToCustomerId))
                          : small("Send payout to Finance", () => call("finish", "send-to-finance", {}, "Sent to Finance"), false, false, !readyToFinish || busy === "finish" || !!c.PayoutNewPaymentId)}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}

        <Section title="The property">
          <Kv label="Property" value={c.Property} />
          <Kv label="Booking" value={`${c.BookingNo}${c.BookingIds?.length > 1 ? ` + ${c.BookingIds.length - 1} more, moving as one property` : ""}`} />
          <Kv label="Paid so far" value={money(c.OriginalValue)} />
          <Kv label={isResale ? "Price between buyers" : "Buy-back price"} value={money(c.AgreedValue)} />
          {isResale ? <Kv label="Our transfer fee" value={Number(c.DeveloperFeeAmount) > 0 ? (Number(c.DeveloperFeeGstAmount) > 0 ? `${money(c.DeveloperFeeAmount)} + GST = ${money(c.FeeTotal)}` : `${money(c.DeveloperFeeAmount)} (no GST)`) : "None"} /> : null}
          {c.NocNo ? <Kv label="NOC" value={c.NocNo} /> : null}
          {c.DeedRegNo ? <Kv label="Registered deed" value={`${c.DeedRegNo} · ${fmtDate(c.DeedRegDate)} · ${c.DeedRegOffice}`} /> : null}
          {Array.isArray(c.BookingIds) && c.BookingIds.length > 0 ? (
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              <ActionKey outline label="Open seller booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(c.BookingIds[0]), title: c.BookingNo || "Booking" })} />
            </View>
          ) : null}
        </Section>

        <Section title="All documents">
          {st.documents.length === 0 ? <Text style={{ fontSize: 12.5, color: b.textSecondary }}>Each step asks for its own documents.</Text> : st.documents.map((d) => (
            <Pressable key={d.Id} onPress={() => viewDoc(d)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: b.border }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: b.textPrimary }}>{st.docTypes[d.DocumentType] || d.DocumentType}</Text>
              <Pill label={d.Status === "Uploaded" ? "To verify" : d.Status} tone={d.Status === "Verified" ? b.success : d.Status === "Rejected" ? b.danger : b.warning} />
            </Pressable>
          ))}
        </Section>
      </ScrollView>

      <OptionPickerModal visible={!!pick} title={pick === "feeMode" ? "Mode" : "Paid by"}
        options={(pick === "feeMode" ? ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash"] : ["Buyer", "Seller", "Developer", "Shared"]).map((m) => ({ key: m, label: m }))}
        selectedKey={pick === "feeMode" ? fee.PaymentMode : deed.paidBy}
        onSelect={(k) => { if (pick === "feeMode") setFee({ ...fee, PaymentMode: k ?? "" }); else setDeed({ ...deed, paidBy: k ?? "Buyer" }); setPick(null); }}
        onClose={() => setPick(null)} />

      {rejectDoc ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: b.surface, borderRadius: 18, padding: 18, gap: 10 }}>
            <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Reject document</Text>
            <Text style={{ fontSize: 13, color: b.textSecondary }}>Why is it rejected? The uploader sees this.</Text>
            <TextInput value={rejectText} onChangeText={setRejectText} multiline
              style={{ minHeight: 70, textAlignVertical: "top", borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 10, color: b.textPrimary }} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey outline label="Cancel" onPress={() => setRejectDoc(null)} />
              <ActionKey label="Reject" tone={b.danger} onPress={() => {
                if (!rejectText.trim()) return;
                const d = rejectDoc; setRejectDoc(null);
                void call(`doc-${d.Id}`, `documents/${d.Id}/review`, { decision: "Rejected", remarks: rejectText }, "Rejected");
              }} />
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}
