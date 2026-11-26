// One TRANSFER DEED — the web's page (src/pages/CRM/CrmTransferDeed.tsx TransferDeedDetail), part for part: the stage
// strip and the next-step banner; Cancel; the tabs Overview (parties, legal executive), Documents (verify / reject,
// upload ours, upload for a party with how they told us, request another), Legal & Approval (Legal Head, the parties'
// review, the signing date, execution), Stamp Duty (assessment, challan, confirm), Registry (the visit, the registered
// copy, Mark registered) and History. Every rule is the server's (services/crmTransferDeed.js); its routes and words.
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Check } from "lucide-react-native";
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
import { Pill, Section, money } from "./ui";

const API = "/api/crm/transfer-deeds";
type Tab = "Overview" | "Documents" | "Legal & Approval" | "Stamp Duty" | "Registry" | "History";
const TABS: Tab[] = ["Overview", "Documents", "Legal & Approval", "Stamp Duty", "Registry", "History"];
const STEP_TAB: Record<string, Tab> = { papers: "Documents", legal: "Legal & Approval", parties: "Legal & Approval", date: "Legal & Approval", duty: "Stamp Duty", executed: "Legal & Approval", registry: "Registry" };
const docWord: Record<string, string> = { Requested: "Not uploaded", Uploaded: "To verify", Verified: "Verified", Rejected: "Rejected" };
const when = (d: any) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const canAct = (module: string, id: number) => crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=${module}&recordId=${id}`).then((x) => !!x.canAct).catch(() => false);
type Proxy = { ProxyMethod: string; ProxyRemarks: string };

export default function CrmTransferDeedScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmTransferDeed">>();
  const id = params.deedId;
  const b = useBrand();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [proxy, setProxy] = useState<Record<string, Proxy>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [f, setF] = useState<Row>({ date: "", dateBy: "Company", StampDuty: "", RegistrationFee: "", PayableBy: "", DutyRemarks: "", PaidRef: "", AmountPaid: "", PaidOn: localDay(), Office: "", ScheduledDay: "", ScheduledTime: "", Attendees: "", RegNo: "", RegDate: "", newDoc: "", newDocParty: "Company", exec: "" });
  const [pick, setPick] = useState<null | { kind: "exec" | "newDocParty" | "dateBy" | "payableBy" | "method"; key?: string }>(null);
  const [prompt, setPrompt] = useState<null | { title: string; label: string; ok: string; cancel?: string; danger?: boolean; go: (text: string) => void }>(null);
  const [promptText, setPromptText] = useState("");
  const P = (k: string): Proxy => proxy[k] || { ProxyMethod: "", ProxyRemarks: "" };

  const q = useQuery<Row>({ queryKey: ["crm-transfer-deed", id], queryFn: () => crmGet(`${API}/${id}`) });
  const execs = useQuery<Row[]>({ queryKey: ["crm-transfer-deed-execs"], staleTime: 300_000, queryFn: () => crmGet<Row[]>(`${API}/legal-executives`).then((x) => (Array.isArray(x) ? x : [])).catch(() => []) });
  const st = q.data;
  const d = st?.deed;
  useEffect(() => { if (st?.currentStep) setTab(STEP_TAB[st.currentStep] || "Overview"); }, [id, st?.currentStep]);
  const finished = !!d && ["Registered", "Cancelled"].includes(d.Status);
  const canEdit = canDoAction("crm-transfer-deeds", "edit") && !finished;
  const canApproveLegal = useQuery({ queryKey: ["can-act", "crm-transfer-deeds", id], enabled: d?.Status === "UnderReview", queryFn: () => canAct("crm-transfer-deeds", id) }).data;
  const canApproveDate = useQuery({ queryKey: ["can-act", "crm-transfer-deed-date", id], enabled: d?.DateApprovalStatus === "Pending", queryFn: () => canAct("crm-transfer-deed-date", id) }).data;

  const apply = (out: Row) => {
    if (out?.steps) qc.setQueryData(["crm-transfer-deed", id], out); else qc.invalidateQueries({ queryKey: ["crm-transfer-deed", id] });
    ["crm", "crm-resale-case"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const call = async (key: string, path: string, body?: object, ok?: string, method: "PUT" | "POST" = "PUT") => {
    setBusy(key);
    try { const out = await crmSend<Row>(`${API}/${id}/${path}`, method, body || {}); toast.success(ok || "Done"); apply(out); return true; }
    catch (e) { toast.error((e as Error).message || "Could not do that"); return false; }
    finally { setBusy(null); }
  };
  const sendFile = async (url: string, fields: Record<string, string> = {}) => {
    const res0 = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
    if (res0.canceled || !res0.assets?.length) return;
    const a = res0.assets[0];
    setBusy("file");
    try {
      const fd = new FormData();
      if (a.file) fd.append("file", a.file); else fd.append("file", { uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream" } as any);
      for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
      const r = await fetchWithAuth(`${API}/${id}/${url}`, { method: "POST", body: fd });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Upload failed");
      toast.success("Uploaded"); apply(out);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  const view = (url: string, name: string) => openDocument(`${API}/${id}/${url}`, name).catch(() => toast.error("Could not open the file"));
  const ask = (p: NonNullable<typeof prompt>) => { setPromptText(""); setPrompt(p); };
  const sendBack = (key: string, path: string, what: string) => ask({ title: "Send back", label: `${what} — say why (they see this).`, ok: "Send back", danger: true,
    go: (r) => { void call(key, path, { remarks: r, decision: "Rejected" }, "Sent back"); } });

  if (q.isLoading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}><ActivityIndicator color={b.accent} /></View>;
  if (q.error || !st || !d) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}><Text style={{ color: b.danger }}>{(q.error as Error)?.message || "Not found"}</Text></View>;

  const methods: string[] = st.proxyMethods || [];
  const docs: Row[] = st.documents || [];
  const payment = st.payment;
  const registry = st.registry;
  const steps: Row[] = st.steps || [];
  const parties: string[] = st.parties || [];
  const partyName = (p: string) => (p === "Seller" ? d.SellerName : p === "Buyer" ? d.BuyerName : "Us");
  const regCopy = docs.find((x) => x.DocumentType === "RegisteredDeed");
  const papers = docs.filter((x) => x.DocumentType !== "RegisteredDeed");
  const papersEditable = canEdit && ["Draft", "UnderReview"].includes(d.Status);
  const stepper = [
    { label: "Legal Assigned", done: !!d.LegalExecutiveId, tab: "Overview" as Tab },
    { label: `Papers (${papers.filter((x) => x.IsMandatory && x.Status === "Verified").length}/${papers.filter((x) => x.IsMandatory).length})`, done: !!steps[0]?.ok, tab: "Documents" as Tab },
    ...steps.slice(1).map((s) => ({ label: s.key === "legal" ? "Legal Head" : s.key === "parties" ? (parties.length > 1 ? "Parties Approve" : "Seller Approves") : s.key === "date" ? "Signing Date" : s.key === "duty" ? "Stamp Duty" : s.key === "executed" ? "Executed" : "Registered", done: !!s.ok, tab: STEP_TAB[s.key] })),
  ];
  let blocked = false;
  const chips = stepper.map((s) => { const state = !blocked && s.done ? "done" : !blocked ? ((blocked = true), "current") : "upcoming"; return { ...s, state }; });
  const cur = steps.find((s) => s.state === "current");
  const nextCheck = cur?.checks?.find((c: Row) => !c.ok);
  const banner = d.Status === "Cancelled" ? { v: "error", t: "This deed is cancelled." }
    : d.Status === "Registered" ? { v: "success", t: "Deed complete — registered at the Sub-Registrar." }
    : cur ? { v: "action", t: `${cur.label}: ${nextCheck?.label || "ready"}`, tab: STEP_TAB[cur.key] } : null;

  const key = (label: string, onPress: () => void, o: { kind?: "primary" | "ghost" | "danger"; disabled?: boolean } = {}) => {
    const kind = o.kind ?? "primary";
    const c = kind === "danger" ? b.danger : b.accent;
    return (
      <Pressable key={label} onPress={o.disabled ? undefined : onPress} style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c,
        backgroundColor: kind === "primary" ? c : "transparent", opacity: o.disabled ? 0.4 : pressed ? 0.75 : 1 })}>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: kind === "primary" ? "#fff" : c }}>{label}</Text>
      </Pressable>
    );
  };
  const input = (label: string, value: string, onChange: (v: string) => void, o: { numeric?: boolean; placeholder?: string } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={o.numeric ? "decimal-pad" : "default"} placeholder={o.placeholder} placeholderTextColor={b.textFaint}
        style={{ borderWidth: 1, borderColor: b.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
    </View>
  );
  const proxyFields = (pk: string, who: string) => (
    <View style={{ gap: 8 }}>
      <PickerRow label={`How the ${who} told you`} value={P(pk).ProxyMethod === "InPerson" ? "In person" : P(pk).ProxyMethod} placeholder="Choose" onPress={() => setPick({ kind: "method", key: pk })} />
      {input("Note", P(pk).ProxyRemarks, (v) => setProxy({ ...proxy, [pk]: { ...P(pk), ProxyRemarks: v } }), { placeholder: "e.g. called on 98300…, confirmed" })}
    </View>
  );
  const proxyOk = (pk: string) => !!P(pk).ProxyMethod && !!P(pk).ProxyRemarks.trim();
  const mark = (s: string, text: string) => <Pill label={text} tone={s === "Verified" || s === "Approved" ? b.success : s === "Rejected" ? b.danger : s === "Uploaded" || s === "Pending" ? b.warning : b.textFaint} />;
  const tick = (ok: boolean) => (
    <View style={{ width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: ok ? b.textPrimary : "transparent", borderWidth: ok ? 0 : 2, borderColor: b.textFaint }}>
      {ok ? <Check size={12} color={b.surface} /> : null}
    </View>
  );
  const box = (children: React.ReactNode, k?: string) => <View key={k} style={{ borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 10, gap: 8, marginTop: 8 }}>{children}</View>;
  const row = (children: React.ReactNode) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
  const small = (t: string, c = b.textSecondary) => <Text style={{ fontSize: 12, color: c }}>{t}</Text>;

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 56 }} keyboardShouldPersistTaps="handled">
        {/* Stage strip and the next step */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {chips.map((s) => (
            <Pressable key={s.label} onPress={() => setTab(s.tab)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
              backgroundColor: s.state === "done" ? `${b.success}22` : s.state === "current" ? b.accentSoft : b.surfaceCard, borderWidth: s.state === "current" ? 1 : 0, borderColor: b.accent }}>
              {s.state === "done" ? <Check size={12} color={b.success} /> : null}
              <Text style={{ fontSize: 12, fontFamily: s.state === "current" ? fonts.heading.semibold : fonts.body.medium, color: s.state === "done" ? b.success : s.state === "current" ? b.accent : b.textSecondary }}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {banner ? (
          <View style={{ borderWidth: 1, borderColor: b.border, borderLeftWidth: 3, borderLeftColor: banner.v === "error" ? b.danger : banner.v === "success" ? b.success : b.textPrimary, borderRadius: 12, padding: 12, gap: 8 }}>
            <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: banner.v === "error" ? b.danger : b.textPrimary }}>{banner.t}</Text>
            {"tab" in banner && banner.tab && banner.tab !== tab ? row(key(`Go to ${banner.tab}`, () => setTab(banner.tab as Tab))) : null}
          </View>
        ) : null}

        {/* Header */}
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.6 }}>{d.DeedType === "Assignment" ? "DEED OF ASSIGNMENT" : "CANCELLATION DEED"}</Text>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: b.textPrimary }}>{d.SellerName} <Text style={{ fontFamily: fonts.body.regular, color: b.textSecondary }}>→ {d.DeedType === "Assignment" ? d.BuyerName : "us (buy-back)"}</Text></Text>
          <Text style={{ fontSize: 12, color: b.textSecondary }}>{d.DeedNo}{d.VersionNo > 1 ? ` · version ${d.VersionNo}` : ""} · {d.BookingNo} · {d.Property}</Text>
          {row(<>
            {mark(d.Status === "Registered" ? "Verified" : d.Status === "Cancelled" ? "Rejected" : "Pending", d.StatusLabel || d.Status)}
            {key(`Case #${d.ResaleId}`, () => nav.navigate("CrmResale", { resaleId: Number(d.ResaleId), title: "Resale" }), { kind: "ghost" })}
            {canEdit && d.Status !== "Executed" ? key("Cancel", () => ask({ title: "Cancel deed", label: "Why is this deed cancelled?", ok: "Cancel deed", cancel: "Keep it", danger: true,
              go: (r) => { void call("cancel", "cancel", { remarks: r }, "Cancelled"); } }), { kind: "danger" }) : null}
          </>)}
        </View>

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {TABS.map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: tab === t ? b.textPrimary : b.surfaceCard, borderWidth: 1, borderColor: b.border }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: tab === t ? b.surface : b.textSecondary }}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {tab === "Overview" ? (
          <>
            <Section title="Parties">
              {["Seller", ...(d.DeedType === "Assignment" ? ["Buyer"] : [])].map((p) => <View key={p} style={{ paddingVertical: 4 }}>{small(p)}<Text style={{ fontSize: 14, color: b.textPrimary }}>{partyName(p)}</Text></View>)}
              <View style={{ paddingVertical: 4 }}>{small("Developer")}<Text style={{ fontSize: 14, color: b.textPrimary }}>Us — {d.DeedType === "Assignment" ? "consenting party (our NOC)" : "taking the property back"}</Text></View>
            </Section>
            <Section title="Legal executive">
              <PickerRow label="Legal executive" value={(execs.data || []).find((u) => String(u.id) === String(f.exec || d.LegalExecutiveId || ""))?.name ?? ""} placeholder="— Unassigned —"
                disabled={!canEdit || !["Draft", "UnderReview", "LegalApproved", "WithParties", "PartiesApproved", "DateApproved"].includes(d.Status)} onPress={() => setPick({ kind: "exec" })} />
              {canEdit && f.exec && String(f.exec) !== String(d.LegalExecutiveId || "") ? row(key("Assign", () => call("exec", "legal-executive", { LegalExecutiveId: Number(f.exec) }, "Legal executive assigned"), { disabled: busy === "exec" })) : null}
              {small(`Prepares the papers and attends the Sub-Registrar visit.${d.RecheckCount ? ` · ${d.RecheckCount} recheck(s) so far` : ""}`)}
            </Section>
          </>
        ) : null}

        {tab === "Documents" ? (
          <>
            {papers.map((x) => {
              const pk = `doc-${x.Id}`;
              return (
                <View key={x.Id} style={{ borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 12, gap: 8, backgroundColor: b.surfaceCard }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    {tick(x.Status === "Verified")}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{x.Label}{!x.IsMandatory ? " · optional" : ""}</Text>
                      {small(`${x.Party === "Company" ? "Ours" : `${x.Party} — ${partyName(x.Party)}`}${x.UploadedByType ? ` · uploaded ${x.UploadedByType === "Portal" ? "by them in the portal" : x.UploadedByType === "Proxy" ? "by staff for them" : "by staff"}` : ""}${x.Remarks ? ` · ${x.Remarks}` : ""}`)}
                    </View>
                    {mark(x.Status, docWord[x.Status] || x.Status)}
                  </View>
                  {row(<>
                    {x.FileName ? key("View", () => view(`documents/${x.Id}/file`, x.FileName), { kind: "ghost" }) : null}
                    {papersEditable && x.Status === "Uploaded" ? <>
                      {key("Verify", () => call(pk, `documents/${x.Id}/review`, { decision: "Verified" }, "Verified"), { disabled: !!busy })}
                      {key("Reject", () => sendBack(pk, `documents/${x.Id}/review`, "Reject this document"), { kind: "ghost", disabled: !!busy })}
                    </> : null}
                    {papersEditable && x.Party === "Company" && !["Verified", "Uploaded"].includes(x.Status) ? key("Upload", () => sendFile(`documents/${x.Id}/upload`), { kind: "ghost", disabled: !!busy }) : null}
                  </>)}
                  {papersEditable && x.Party !== "Company" && !["Verified", "Uploaded"].includes(x.Status) ? box(<>
                    {small(`${partyName(x.Party)} uploads it in their portal — or upload what they sent you:`)}
                    {proxyFields(pk, String(x.Party).toLowerCase())}
                    {row(key("Upload for them", () => sendFile(`documents/${x.Id}/upload`, P(pk) as unknown as Record<string, string>), { kind: "ghost", disabled: !proxyOk(pk) || !!busy }))}
                  </>) : null}
                </View>
              );
            })}
            {papersEditable ? box(<>
              {input("Need another paper?", f.newDoc, (v) => setF({ ...f, newDoc: v }), { placeholder: "e.g. Seller's possession letter" })}
              <PickerRow label="Whose" value={f.newDocParty === "Company" ? "Ours" : f.newDocParty} onPress={() => setPick({ kind: "newDocParty" })} />
              {row(key("Request it", async () => { if (await call("req", "documents/request", { Label: f.newDoc, Party: f.newDocParty, DocumentType: "Other" }, "Requested", "POST")) setF({ ...f, newDoc: "" }); },
                { kind: "ghost", disabled: !f.newDoc.trim() || !!busy }))}
            </>) : null}
          </>
        ) : null}

        {tab === "Legal & Approval" ? (
          <>
            <Section title="Legal Head approval" right={small(steps[1]?.ok ? "Approved" : d.SeniorApprovalStatus === "Pending" ? "Waiting" : "Not sent yet")}>
              {d.SeniorRemarks ? small(d.SeniorRemarks) : null}
              {canEdit && d.Status === "Draft" ? row(key("Send to the Legal Head", () => call("submit", "submit", {}, "Sent to the Legal Head"), { disabled: busy === "submit" })) : null}
              {canEdit && canApproveLegal && d.Status === "UnderReview" ? box(<>
                {input("Remarks", remarks.legal || "", (v) => setRemarks({ ...remarks, legal: v }))}
                {row(<>
                  {key("Approve", () => call("legal", "legal/approve", { remarks: remarks.legal }, "Approved"), { disabled: !!busy })}
                  {key("Send back", () => call("legal", "legal/reject", { remarks: remarks.legal }, "Sent back for changes"), { kind: "danger", disabled: !!busy || !(remarks.legal || "").trim() })}
                </>)}
              </>) : null}
            </Section>

            <Section title={parties.length > 1 ? "Seller & buyer review the draft" : "Seller reviews the draft"}>
              {canEdit && d.Status === "LegalApproved" ? row(key("Send to the portal", () => call("send", "send-to-parties", {}, "Sent — they can answer in the portal"), { disabled: busy === "send" })) : null}
              {parties.map((p) => {
                const s = d[`${p}Approval`];
                const pk = `party-${p}`;
                return box(<>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{p} — {partyName(p)}</Text>
                    {mark(s || "", s === "Approved" ? "Approved" : s === "Pending" ? "Reviewing in the portal" : "Not sent yet")}
                  </View>
                  {d[`${p}Remarks`] ? small(d[`${p}Remarks`]) : null}
                  {canEdit && d.Status === "WithParties" && s === "Pending" ? <>
                    {small(`If ${partyName(p)} answered you directly, record it for them:`)}
                    {proxyFields(pk, p.toLowerCase())}
                    {row(<>
                      {key("They approve", () => call(pk, `parties/${p}/respond`, { decision: "Approved", ...P(pk) }, `${p}'s approval recorded`), { disabled: !proxyOk(pk) || !!busy })}
                      {key("They ask for a recheck", () => ask({ title: "Recheck asked for", label: "What do they want checked?", ok: "Send back",
                        go: (r) => { void call(pk, `parties/${p}/respond`, { decision: "Recheck", ...P(pk), Remarks: r }, "Sent back for a recheck"); } }), { kind: "danger", disabled: !proxyOk(pk) || !!busy })}
                    </>)}
                  </> : null}
                </>, pk);
              })}
            </Section>

            <Section title="Signing date" right={small(d.DeedDate ? `Approved: ${d.DeedDate}` : d.ProposedDate ? `Proposed ${d.ProposedDate} by ${d.ProposedBy === "Company" ? "us" : d.ProposedBy}` : "Not proposed")}>
              {canEdit && d.Status === "PartiesApproved" && d.DateApprovalStatus !== "Pending" ? box(<>
                <PickerRow label="Proposed by" value={f.dateBy === "Company" ? "Us" : `${f.dateBy} (for them)`} onPress={() => setPick({ kind: "dateBy" })} />
                <DateField label="Date" value={f.date} onChange={(v: string) => setF({ ...f, date: v })} />
                {f.dateBy !== "Company" ? proxyFields("dateprop", String(f.dateBy).toLowerCase()) : null}
                {row(key(d.ProposedDate ? "Propose another date" : "Propose the date",
                  () => call("date", "date/propose", { Date: f.date, ProposedBy: f.dateBy, ...(f.dateBy !== "Company" ? P("dateprop") : {}) }, "Proposed — the parties accept it in the portal"),
                  { disabled: !f.date || !!busy || (f.dateBy !== "Company" && !proxyOk("dateprop")) }))}
              </>) : null}
              {d.ProposedDate && d.Status === "PartiesApproved" ? parties.map((p) => {
                const ok = d[`${p}DateAccepted`];
                const pk = `date-${p}`;
                return box(<>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{tick(!!ok)}<Text style={{ flex: 1, fontSize: 13.5, color: b.textPrimary }}>{p} — {partyName(p)} {ok ? "accepted the date" : "hasn't accepted it yet"}</Text></View>
                  {canEdit && !ok && d.DateApprovalStatus !== "Pending" ? <>
                    {proxyFields(pk, p.toLowerCase())}
                    {row(key("They accept this date", () => call(pk, `date/accept/${p}`, P(pk), "Recorded"), { kind: "ghost", disabled: !proxyOk(pk) || !!busy }))}
                  </> : null}
                </>, pk);
              }) : null}
              {canEdit && canApproveDate && d.DateApprovalStatus === "Pending" ? box(<>
                {input("Remarks", remarks.date || "", (v) => setRemarks({ ...remarks, date: v }))}
                {row(<>
                  {key("Approve the date", () => call("dateok", "date/approve", { remarks: remarks.date }, "Date approved"), { disabled: !!busy })}
                  {key("Turn it down", () => call("dateok", "date/reject", { remarks: remarks.date }, "Turned down"), { kind: "danger", disabled: !!busy || !(remarks.date || "").trim() })}
                </>)}
              </>) : null}
            </Section>

            <Section title="Execution (signing)" right={small(d.ExecutedAt ? `Executed ${when(d.ExecutedAt)}` : "After the stamp duty is confirmed")}>
              {canEdit && d.Status === "DateApproved" ? <>
                {payment?.Status !== "Confirmed" ? small("Confirm the stamp duty first") : null}
                {row(key("Mark executed", () => Alert.alert("Mark executed", `Every party signed ${d.DeedNo} on ${d.DeedDate}?`, [
                  { text: "Cancel", style: "cancel" }, { text: "Mark executed", onPress: () => { void call("x", "execute", {}, "Marked executed"); } },
                ]), { disabled: busy === "x" || payment?.Status !== "Confirmed" }))}
              </> : null}
            </Section>
          </>
        ) : null}

        {tab === "Stamp Duty" ? (
          <>
            <Section title="Stamp duty & registration fee">
              {!payment && d.Status !== "DateApproved" ? small("Assessed once the signing date is approved — the deed is stamped before it is signed.") : null}
              {payment ? <Text style={{ fontSize: 13.5, color: b.textPrimary }}>Assessed {money(payment.StampDuty)} stamp duty + {money(payment.RegistrationFee)} registration fee · paid by {payment.PayableBy}{payment.InfoRemarks ? ` · ${payment.InfoRemarks}` : ""}</Text> : null}
              {payment?.PaidRef ? <>
                <Text style={{ fontSize: 13.5, color: b.textPrimary }}>Paid {money(payment.AmountPaid)} · {payment.PaidRef} · {payment.ProofUploadedByType === "Portal" ? "uploaded by them" : payment.ProofUploadedByType === "Proxy" ? "uploaded by staff for them" : "uploaded by staff"}</Text>
                {row(key("Proof", () => view("duty/proof", "Challan"), { kind: "ghost" }))}
              </> : null}
              {payment?.ConfirmRemarks ? small(payment.ConfirmRemarks) : null}
              {payment?.Status === "Confirmed" ? mark("Verified", "Confirmed") : null}
            </Section>
            {canEdit && d.Status === "DateApproved" && (!payment || (payment.Status === "InfoSent" && !payment.PaidRef)) ? (
              <Section title={payment ? "Change the assessment" : "Assessment from the Sub-Registrar"}>
                <View style={{ gap: 8 }}>
                  {input("Stamp duty", f.StampDuty, (v) => setF({ ...f, StampDuty: v }), { numeric: true })}
                  {input("Registration fee", f.RegistrationFee, (v) => setF({ ...f, RegistrationFee: v }), { numeric: true })}
                  <PickerRow label="Paid by" value={f.PayableBy} placeholder="Choose" onPress={() => setPick({ kind: "payableBy" })} />
                  {input("Note", f.DutyRemarks, (v) => setF({ ...f, DutyRemarks: v }))}
                  {row(key("Send to the payer", () => call("duty", "duty/info", { StampDuty: f.StampDuty, RegistrationFee: f.RegistrationFee, PayableBy: f.PayableBy, Remarks: f.DutyRemarks }, "Sent to the payer"), { disabled: !f.PayableBy || !!busy }))}
                </View>
              </Section>
            ) : null}
            {canEdit && payment?.Status === "InfoSent" ? (
              <Section title="Paid? The payer uploads the challan in their portal — or upload what they sent you">
                <View style={{ gap: 8 }}>
                  {input("GRN / challan no.", f.PaidRef, (v) => setF({ ...f, PaidRef: v }))}
                  {input("Amount paid", f.AmountPaid, (v) => setF({ ...f, AmountPaid: v }), { numeric: true })}
                  <DateField label="Paid on" value={f.PaidOn} onChange={(v: string) => setF({ ...f, PaidOn: v })} />
                  {payment.PayableBy !== "Developer" ? proxyFields("duty", "payer") : null}
                  {row(key("Upload the challan", () => sendFile("duty/proof", { PaidRef: f.PaidRef, AmountPaid: f.AmountPaid, PaidOn: f.PaidOn, ...(payment.PayableBy !== "Developer" ? P("duty") : {}) }),
                    { kind: "ghost", disabled: !f.PaidRef || !(Number(f.AmountPaid) > 0) || !!busy || (payment.PayableBy !== "Developer" && !proxyOk("duty")) }))}
                </View>
              </Section>
            ) : null}
            {canEdit && payment?.Status === "ProofUploaded" ? (
              <Section title="Confirm the payment">
                {input("Remarks", remarks.duty || "", (v) => setRemarks({ ...remarks, duty: v }), { placeholder: "Needed if the amount differs from the assessment" })}
                <View style={{ marginTop: 8 }}>{row(<>
                  {key("Confirm the payment", () => call("dutyok", "duty/confirm", { remarks: remarks.duty }, "Confirmed"), { disabled: !!busy })}
                  {key("Send back", () => call("dutyok", "duty/return", { remarks: remarks.duty }, "Sent back"), { kind: "danger", disabled: !!busy || !(remarks.duty || "").trim() })}
                </>)}</View>
              </Section>
            ) : null}
          </>
        ) : null}

        {tab === "Registry" ? (
          <>
            <Section title="Sub-Registrar visit">
              {registry ? <Text style={{ fontSize: 13.5, color: b.textPrimary }}>{registry.Office} · {when(registry.ScheduledAt)}{registry.Attendees ? ` · ${registry.Attendees}` : ""}{registry.RegNo ? ` · registered ${registry.RegNo}` : ""}</Text>
                : small("Scheduled once the deed is executed.")}
              {canEdit && d.Status === "Executed" ? box(<>
                {input("Office", f.Office, (v) => setF({ ...f, Office: v }), { placeholder: "e.g. ADSR Bidhannagar" })}
                <DateField label="Date" value={f.ScheduledDay} onChange={(v: string) => setF({ ...f, ScheduledDay: v })} />
                {input("Time (HH:MM)", f.ScheduledTime, (v) => setF({ ...f, ScheduledTime: v }), { placeholder: "11:00" })}
                {input("Who attends", f.Attendees, (v) => setF({ ...f, Attendees: v }), { placeholder: "Seller, buyer, legal executive" })}
                {row(key(registry ? "Reschedule" : "Schedule the visit", () => call("reg", "registry/schedule", {
                  Office: f.Office, ScheduledAt: new Date(`${f.ScheduledDay}T${f.ScheduledTime || "00:00"}`).toISOString(), Attendees: f.Attendees,
                }, registry ? "Rescheduled" : "Visit scheduled"), { disabled: !f.Office.trim() || !f.ScheduledDay || !!busy }))}
              </>) : null}
            </Section>
            {registry ? (
              <Section title="Registered deed (copy)">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{tick(regCopy?.Status === "Verified")}{regCopy ? mark(regCopy.Status, docWord[regCopy.Status] || regCopy.Status) : null}</View>
                <View style={{ marginTop: 8 }}>{row(<>
                  {regCopy?.FileName ? key("View", () => view(`documents/${regCopy.Id}/file`, regCopy.FileName), { kind: "ghost" }) : null}
                  {canEdit && d.Status === "Executed" && regCopy && !["Verified", "Uploaded"].includes(regCopy.Status) ? key("Upload", () => sendFile("registry/copy"), { kind: "ghost", disabled: !!busy }) : null}
                  {canEdit && regCopy?.Status === "Uploaded" ? <>
                    {key("Verify", () => call("copy", "registry/copy/verify", {}, "Verified"), { disabled: !!busy })}
                    {key("Reject", () => sendBack("copy", "registry/copy/reject", "Reject the copy"), { kind: "ghost", disabled: !!busy })}
                  </> : null}
                </>)}</View>
                {canEdit && d.Status === "Executed" ? box(<>
                  {input("Registration no.", f.RegNo, (v) => setF({ ...f, RegNo: v }))}
                  <DateField label="Registered on" value={f.RegDate} onChange={(v: string) => setF({ ...f, RegDate: v })} />
                  {row(key("Mark registered", () => call("done", "registry/complete", { RegNo: f.RegNo, RegDate: f.RegDate }, "Registered"),
                    { disabled: !f.RegNo.trim() || !f.RegDate || regCopy?.Status !== "Verified" || !!busy }))}
                </>) : null}
              </Section>
            ) : null}
          </>
        ) : null}

        {tab === "History" ? (
          <Section title="History">
            {(st.history || []).map((h: Row, i: number) => (
              <View key={i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: b.border, gap: 2 }}>
                {small(when(h.At))}
                <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{h.Action}</Text>
                {small(`${h.ActorType === "Portal" ? `${h.PortalName || h.Party} in the portal` : h.ActorType === "Proxy" ? `${h.ActorName || "Staff"} for the ${String(h.Party || "party").toLowerCase()} (${h.Method === "InPerson" ? "in person" : h.Method})` : h.ActorName || "Staff"}${h.Remarks ? ` · ${h.Remarks}` : ""}`)}
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <OptionPickerModal visible={!!pick}
        title={pick?.kind === "exec" ? "Legal executive" : pick?.kind === "newDocParty" ? "Whose" : pick?.kind === "dateBy" ? "Proposed by" : pick?.kind === "payableBy" ? "Paid by" : "How they told you"}
        options={pick?.kind === "exec" ? [{ key: "", label: "— Unassigned —" }, ...(execs.data || []).map((u) => ({ key: String(u.id), label: u.name }))]
          : pick?.kind === "newDocParty" ? ["Company", ...parties].map((p) => ({ key: p, label: p === "Company" ? "Ours" : p }))
          : pick?.kind === "dateBy" ? ["Company", ...parties].map((p) => ({ key: p, label: p === "Company" ? "Us" : `${p} (for them)` }))
          : pick?.kind === "payableBy" ? [...parties, "Developer", "Shared"].map((x) => ({ key: x, label: x }))
          : methods.map((m) => ({ key: m, label: m === "InPerson" ? "In person" : m }))}
        selectedKey={pick?.kind === "exec" ? String(f.exec || d.LegalExecutiveId || "") : pick?.kind === "newDocParty" ? f.newDocParty : pick?.kind === "dateBy" ? f.dateBy : pick?.kind === "payableBy" ? f.PayableBy : pick?.key ? P(pick.key).ProxyMethod : null}
        onSelect={(k) => {
          const v = k ?? "";
          if (pick?.kind === "exec") setF({ ...f, exec: v });
          else if (pick?.kind === "newDocParty") setF({ ...f, newDocParty: v || "Company" });
          else if (pick?.kind === "dateBy") setF({ ...f, dateBy: v || "Company" });
          else if (pick?.kind === "payableBy") setF({ ...f, PayableBy: v });
          else if (pick?.key) setProxy({ ...proxy, [pick.key]: { ...P(pick.key), ProxyMethod: v } });
          setPick(null);
        }}
        onClose={() => setPick(null)} />

      {prompt ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: b.surface, borderRadius: 18, padding: 18, gap: 10 }}>
            <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{prompt.title}</Text>
            <Text style={{ fontSize: 13, color: b.textSecondary }}>{prompt.label}</Text>
            <TextInput value={promptText} onChangeText={setPromptText} multiline
              style={{ minHeight: 70, textAlignVertical: "top", borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 10, color: b.textPrimary }} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {key(prompt.cancel || "Cancel", () => setPrompt(null), { kind: "ghost" })}
              {key(prompt.ok, () => { if (!promptText.trim()) return; const p = prompt; setPrompt(null); p.go(promptText); }, { kind: prompt.danger ? "danger" : "primary", disabled: !promptText.trim() })}
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}
