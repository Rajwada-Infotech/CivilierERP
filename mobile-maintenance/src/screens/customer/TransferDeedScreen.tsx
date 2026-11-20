// Transfer Deed — when the customer's property is being resold (they are the seller), when they are buying one
// from another owner (the buyer), or when we are buying it back. Everything the web portal's Transfer Deed page
// does (PortalTransferDeed.tsx), same routes and wording: their papers (upload / re-upload, view), the draft
// (read it, approve or ask for a correction), the signing date (propose, accept), the stamp-duty challan when it is
// theirs to pay, and the registered deed.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, FileSignature, Upload } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { DateField } from "@/components/form/DateField";
import { portal, pdfPath, type DeedView } from "@/api/customerPortalApi";
import { ACCENT_SOFT, Button, Divider, ErrorText, Loading, Muted, Page, Panel, Row, fmtDate, money, useAddPapers } from "@/customer/ui";
import { openDocument } from "@/utils/documents";

const DOC_STATE: Record<string, string> = { Requested: "Please upload", Uploaded: "Received — being checked", Verified: "Accepted", Rejected: "Please upload again" };
const today = () => new Date().toISOString().slice(0, 10);

function DeedCard({ v, onChange }: { v: DeedView; onChange: (next: DeedView) => void }) {
  const brand = useBrand();
  const input = { borderWidth: 1, borderColor: brand.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: brand.textPrimary, fontFamily: fonts.body.regular, fontSize: 13 } as const;
  const d = v.deed;
  const [busy, setBusy] = useState<string | null>(null);
  // A photo taken just before Android closed the app goes to the deed paper it was meant for.
  const papers = useAddPapers({
    owns: (k) => k.startsWith(`deed:${d.Id}:`),
    onRecovered: (k, f) => {
      const parts = k.split("|");
      const [key, path, fields] = [parts[2], parts[3], parts.slice(4).join("|")]; // the fields may hold a "|" themselves
      void run(key, () => portal.deedUpload(d.Id, path, f, JSON.parse(fields || "{}")), "Sent to our team");
    },
  });
  const [recheck, setRecheck] = useState("");
  const [date, setDate] = useState("");
  const [pay, setPay] = useState({ PaidRef: "", AmountPaid: "", PaidOn: today() });
  const other = v.role === "Seller" ? (d.BuyerName ? `buyer ${d.BuyerName}` : "us") : `seller ${d.SellerName}`;
  const run = async (key: string, work: () => Promise<DeedView>, ok: string) => {
    setBusy(key);
    try { onChange(await work()); toast.success(ok); } catch (e) { toast.error(e instanceof Error ? e.message : "The request could not be completed. Please try again."); } finally { setBusy(null); }
  };
  const act = (key: string, path: string, body: unknown, ok: string) => run(key, () => portal.deedAction(d.Id, path, body), ok);
  const upload = async (key: string, path: string, fields: Record<string, string> = {}) => {
    try {
      const f = await papers.pick(`deed:${d.Id}:|${d.Id}|${key}|${path}|${JSON.stringify(fields)}`);
      if (f) await run(key, () => portal.deedUpload(d.Id, path, f, fields), "Sent to our team");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not upload it"); }
  };
  const view = (docId: number, name: string) => openDocument(pdfPath.deedDoc(d.Id, docId), name).catch(() => toast.error("Could not open it"));
  const draft = v.documents.find((x) => x.DocumentType === "DeedDraft");
  const myDocs = v.documents.filter((x) => x.Party === v.role);
  const regCopy = v.documents.find((x) => x.DocumentType === "RegisteredDeed" && x.Status === "Verified");
  const step = v.steps.find((s) => s.state === "current");
  const payer = v.payment ? (v.payment.PayableBy === v.role ? "you" : v.payment.PayableBy === "Shared" ? "both parties" : v.payment.PayableBy === "Developer" ? "us" : `the ${v.payment.PayableBy.toLowerCase()}`) : "";

  return (
    <>
    {papers.sheet}
    <Panel title={`${d.DeedType === "Assignment" ? "Deed of assignment" : "Cancellation deed"} · ${d.Property}`} icon={FileSignature}
      right={<Text style={{ fontSize: 11, fontFamily: fonts.body.semibold, color: ACCENT_SOFT }}>You are the {v.role.toLowerCase()}</Text>}>
      <Muted>
        {d.DeedType === "Assignment"
          ? `${d.SellerName}'s booking (${d.BookingNo}) passes to ${d.BuyerName} by a deed signed by both of you and us, registered at the Sub-Registrar.`
          : `We are buying back ${d.Property} from ${d.SellerName}; the agreement is cancelled by a registered deed.`}
        {" "}Reference {d.DeedNo}{d.VersionNo > 1 ? ` · version ${d.VersionNo}` : ""}.
      </Muted>

      <View style={{ gap: 6 }}>
        {v.steps.map((s, i) => (
          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 20, height: 20, borderRadius: 12, alignItems: "center", justifyContent: "center",
              backgroundColor: s.ok ? "rgba(16,185,129,0.18)" : s.state === "current" ? "rgba(101,163,13,0.2)" : brand.surfaceCard }}>
              {s.ok ? <Check size={11} color="#10b981" /> : <Text style={{ fontSize: 10, fontFamily: fonts.body.bold, color: s.state === "current" ? ACCENT_SOFT : brand.textSecondary }}>{i + 1}</Text>}
            </View>
            <Text style={{ fontSize: 12.5, fontFamily: s.state === "current" ? fonts.body.semibold : fonts.body.regular, color: s.ok ? "#10b981" : s.state === "current" ? brand.textPrimary : brand.textSecondary }}>{s.label}</Text>
          </View>
        ))}
      </View>
      {d.Status === "Registered" ? <Muted>Complete — the deed is registered{v.registry?.RegNo ? ` (${v.registry.RegNo})` : ""}.</Muted>
        : step ? <Muted>Now: {step.label}</Muted> : null}

      {myDocs.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Divider />
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Your papers</Text>
          {myDocs.map((x) => (
            <View key={x.Id} style={{ gap: 6 }}>
              <Row label={x.Label} value={DOC_STATE[x.Status] || x.Status} />
              {x.Remarks && x.Status === "Rejected" ? <Muted>{x.Remarks}</Muted> : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {x.HasFile ? <View style={{ flex: 1 }}><Button label="View" kind="line" icon={Eye} onPress={() => view(x.Id, x.Label)} /></View> : null}
                {["Requested", "Rejected"].includes(x.Status) && ["Draft", "UnderReview"].includes(d.Status) ? (
                  <View style={{ flex: 1 }}><Button label="Upload" kind="line" icon={Upload} busy={busy === `doc${x.Id}`} disabled={!!busy}
                    onPress={() => upload(`doc${x.Id}`, `documents/${x.Id}/upload`)} /></View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {d.Status === "WithParties" ? (
        <View style={{ gap: 8 }}>
          <Divider />
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Please review the draft</Text>
          {draft?.HasFile ? <Button label="Read the draft" kind="line" icon={Eye} onPress={() => view(draft.Id, `${d.DeedNo} draft`)} /> : null}
          {d.MyApproval === "Approved" ? <Muted>You approved it. Waiting for the {other}.</Muted> : (
            <>
              <Button label="I approve the draft" busy={busy === "ok"} disabled={!!busy} onPress={() => act("ok", "respond", { decision: "Approved" }, "Thank you — approved")} />
              <TextInput value={recheck} onChangeText={setRecheck} multiline placeholder="Something to correct? Tell us what…" placeholderTextColor={brand.textSecondary}
                style={[input, { minHeight: 70, textAlignVertical: "top" }]} />
              <Button label="Ask for a correction" kind="line" busy={busy === "re"} disabled={!recheck.trim() || !!busy}
                onPress={() => act("re", "respond", { decision: "Recheck", remarks: recheck }, "Sent — our legal team will revise it")} />
            </>
          )}
        </View>
      ) : null}

      {d.Status === "PartiesApproved" ? (
        <View style={{ gap: 8 }}>
          <Divider />
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Signing date</Text>
          {d.ProposedDate ? (
            <Muted>Proposed: {fmtDate(d.ProposedDate)}{d.ProposedBy === v.role ? " (by you)" : ""}.{d.DateApprovalStatus === "Pending" ? " Everyone has accepted — awaiting final confirmation." : ""}</Muted>
          ) : <Muted>No date proposed yet — propose one that suits you.</Muted>}
          {d.ProposedDate && !d.MyDateAccepted && d.DateApprovalStatus !== "Pending" ? (
            <Button label="This date works for me" busy={busy === "acc"} disabled={!!busy} onPress={() => act("acc", "date/accept", {}, "Date accepted")} />
          ) : null}
          {d.DateApprovalStatus !== "Pending" ? (
            <>
              <DateField label="Date" value={date} onChange={setDate} />
              <Button label={d.ProposedDate ? "Suggest another date" : "Propose this date"} kind="line" busy={busy === "prop"} disabled={!date || !!busy}
                onPress={() => act("prop", "date/propose", { Date: date }, "Date proposed")} />
            </>
          ) : null}
        </View>
      ) : null}
      {d.DeedDate ? <Muted>Signing date: {fmtDate(d.DeedDate)}{d.ExecutedAt ? " — signed" : ""}</Muted> : null}

      {v.payment ? (
        <View style={{ gap: 8 }}>
          <Divider />
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Stamp duty & registration fee</Text>
          <Muted>{money(v.payment.StampDuty)} stamp duty + {money(v.payment.RegistrationFee)} registration fee · paid by {payer}</Muted>
          {v.payment.Status === "Confirmed" ? <Muted>Payment confirmed.</Muted> : null}
          {v.payment.Status === "ProofUploaded" ? <Muted>Challan {v.payment.PaidRef} received — being checked.</Muted> : null}
          {v.payment.IAmPayer && v.payment.Status === "InfoSent" ? (
            <>
              {v.payment.ConfirmRemarks ? <Muted>{v.payment.ConfirmRemarks}</Muted> : null}
              <TextInput value={pay.PaidRef} onChangeText={(x) => setPay({ ...pay, PaidRef: x })} placeholder="GRN / challan no." placeholderTextColor={brand.textSecondary} style={input} />
              <TextInput value={pay.AmountPaid} onChangeText={(x) => setPay({ ...pay, AmountPaid: x })} placeholder="Amount paid" keyboardType="numeric" placeholderTextColor={brand.textSecondary} style={input} />
              <DateField label="Paid on" value={pay.PaidOn} onChange={(x) => setPay({ ...pay, PaidOn: x })} />
              <Button label="Upload the challan" icon={Upload} busy={busy === "duty"} disabled={!pay.PaidRef.trim() || !(Number(pay.AmountPaid) > 0) || !!busy}
                onPress={() => upload("duty", "duty/proof", pay)} />
            </>
          ) : null}
        </View>
      ) : null}

      {v.registry ? <Muted>Sub-Registrar visit: {v.registry.Office}, {fmtDate(v.registry.ScheduledAt)}{v.registry.Attendees ? ` · ${v.registry.Attendees}` : ""}</Muted> : null}
      {regCopy ? <Button label="Registered deed" kind="line" icon={Eye} onPress={() => view(regCopy.Id, `${d.DeedNo} registered`)} /> : null}
    </Panel>
    </>
  );
}

export default function CustomerTransferDeedScreen() {
  const brand = useBrand();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal-transfer-deeds"], queryFn: portal.transferDeeds });
  const replace = (next: DeedView) => qc.setQueryData<DeedView[]>(["portal-transfer-deeds"], (old) => (old || []).map((x) => (x.deed.Id === next.deed.Id ? next : x)));
  return (
    <Page onRefresh={() => q.refetch()}>
      <Muted>When a property passes to a new owner — or back to us — the deed is reviewed, dated, stamped and registered here.</Muted>
      {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} />
        : !q.data?.length ? <Panel><Muted>Nothing here — this is where a resale or buy-back deed appears when you are part of one.</Muted></Panel>
        : q.data.map((v) => <DeedCard key={v.deed.Id} v={v} onChange={replace} />)}
    </Page>
  );
}
