// Agreement & legal — everything the web portal's Agreement page does (PortalAgreement.tsx), same routes and
// wording: the agreement (its details, the documents we need from you — upload or re-upload — and those on file,
// approve or ask for a recheck, then agree the agreement date), the sale deed draft, the government payment
// (stamp duty & registration: our paperwork and your proof of payment), the registry, and NOCs & legal status.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, CalendarCheck2, FileText, Landmark, Paperclip, ReceiptIndianRupee, ShieldCheck, UploadCloud } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { DateField } from "@/components/form/DateField";
import { portal, pdfPath, type AgreementDoc } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { Button, Divider, ErrorText, ListRow, Loading, Muted, Page, Panel, Row, fmtDate, money, Pill, useAddPapers } from "@/customer/ui";
import { openDocument, type PickedFile } from "@/utils/documents";

const docLabel = (d: { Label?: string | null; DocumentType: string }) => d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim();
const fmtBytes = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong");

/** Approve, or ask for a recheck with what needs correcting (agreement and sale deed). */
function Respond({ which, onDone }: { which: "agreement" | "salesDeed"; onDone: () => void }) {
  const brand = useBrand();
  const { appId } = useCustomer();
  const [mode, setMode] = useState<"choose" | "recheck">("choose");
  const [remarks, setRemarks] = useState("");
  const send = useMutation({
    mutationFn: (decision: "Approve" | "Recheck") =>
      (which === "agreement" ? portal.respondAgreement : portal.respondSalesDeed)(appId as number, decision, decision === "Recheck" ? remarks.trim() : ""),
    onSuccess: (_r, decision) => { toast.success(decision === "Approve" ? "Approved. Thank you." : "Recheck requested"); onDone(); },
    onError: fail,
  });
  if (mode === "recheck") {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Request a Recheck</Text>
        <Muted>Tell us exactly what needs to be corrected — this goes straight to your assigned team.</Muted>
        <TextInput value={remarks} onChangeText={setRemarks} multiline numberOfLines={3}
          placeholder="e.g. My name is spelled incorrectly, the unit area is wrong…" placeholderTextColor={brand.textSecondary}
          style={{ borderWidth: 1, borderColor: brand.border, borderRadius: 12, padding: 10, minHeight: 80, textAlignVertical: "top", color: brand.textPrimary, fontFamily: fonts.body.regular, fontSize: 13 }} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Button label="Back" kind="line" onPress={() => setMode("choose")} /></View>
          <View style={{ flex: 1 }}><Button label="Submit Recheck Request" busy={send.isPending}
            onPress={() => (remarks.trim() ? send.mutate("Recheck") : toast.error("Remarks are required"))} /></View>
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Muted>Review the details below carefully — approving is a binding confirmation on your end.</Muted>
      <Button label="Everything looks correct" busy={send.isPending} onPress={() => send.mutate("Approve")} />
      <Button label="Something needs to be corrected" kind="line" onPress={() => setMode("recheck")} />
    </View>
  );
}

/** Propose an agreement date (first time, or a different one from ours). */
function ProposeDate({ ourDate, onDone, onCancel }: { ourDate: string | null; onDone: () => void; onCancel?: () => void }) {
  const brand = useBrand();
  const { appId } = useCustomer();
  const [date, setDate] = useState("");
  const send = useMutation({
    mutationFn: () => portal.proposeAgreementDate(appId as number, date),
    onSuccess: () => { toast.success("Your proposed date was sent to our team"); onDone(); },
    onError: fail,
  });
  return (
    <View style={{ gap: 8 }}>
      <Muted>{ourDate ? `We proposed ${fmtDate(ourDate)}. This sends a different date back to our team for their review.`
        : "Suggest a date that works for you — we'll review it and either accept it or propose another."}</Muted>
      <DateField label="Date" value={date} onChange={setDate} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {onCancel ? <View style={{ flex: 1 }}><Button label="Cancel" kind="line" onPress={onCancel} /></View> : null}
        <View style={{ flex: 1 }}><Button label="Submit" busy={send.isPending} onPress={() => (date ? send.mutate() : toast.error("Pick a date"))} /></View>
      </View>
    </View>
  );
}

export default function CustomerDocumentsScreen() {
  const brand = useBrand();
  const qc = useQueryClient();
  const { appId, timeline, readOnly } = useCustomer();
  const enabled = appId != null;
  const agreementQ = useQuery({ queryKey: ["portal-agreement", appId], queryFn: () => portal.agreement(appId as number), enabled });
  const docsQ = useQuery({ queryKey: ["portal-agreement-documents", appId], queryFn: () => portal.agreementDocuments(appId as number), enabled });
  const t = timeline.data;
  const qpQ = useQuery({ queryKey: ["portal-qp-attachments", appId], queryFn: () => portal.queryPaymentAttachments(appId as number), enabled: enabled && !!t?.queryPayment });
  const deedQ = useQuery({ queryKey: ["portal-sales-deed", appId], queryFn: () => portal.salesDeed(appId as number), enabled: enabled && !!t?.salesDeed?.SentToCustomerAt });
  const [proposing, setProposing] = useState(false);
  const [busyDoc, setBusyDoc] = useState<number | null>(null);
  const [qpBusy, setQpBusy] = useState(false);
  // Every upload asks the same way: from the phone, a photo, or several pages scanned into one PDF.
  const papers = useAddPapers({
    // A photo taken just before Android closed the app goes where it was meant to.
    owns: (k) => k === "qpProof" || k.startsWith("agreementDoc:"),
    onRecovered: (k, f) => { void (k === "qpProof" ? sendProof(f) : sendDoc(Number(k.split(":")[1]), f)); },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["portal-timeline"] });
    qc.invalidateQueries({ queryKey: ["portal-agreement", appId] });
    qc.invalidateQueries({ queryKey: ["portal-agreement-documents", appId] });
    qc.invalidateQueries({ queryKey: ["portal-qp-attachments", appId] });
    qc.invalidateQueries({ queryKey: ["portal-sales-deed", appId] });
    qc.invalidateQueries({ queryKey: ["portal-needs-you"] });
  };
  const acceptDate = useMutation({
    mutationFn: () => portal.acceptAgreementDate(appId as number),
    onSuccess: () => { toast.success("Date accepted — sent to our team for final sign-off"); refresh(); },
    onError: fail,
  });
  const sendDoc = async (docId: number, f: PickedFile) => {
    try {
      setBusyDoc(docId);
      await portal.uploadAgreementDoc(appId as number, docId, f);
      toast.success("Document submitted for review");
      refresh();
    } catch (e) { fail(e); } finally { setBusyDoc(null); }
  };
  const sendProof = async (f: PickedFile) => {
    try {
      setQpBusy(true);
      await portal.uploadQueryPaymentProof(appId as number, f);
      toast.success("Proof uploaded — our team will confirm shortly");
      refresh();
    } catch (e) { fail(e); } finally { setQpBusy(false); }
  };
  const upload = async (d: AgreementDoc) => {
    try {
      const f = await papers.pick(`agreementDoc:${d.Id}`);
      if (f) await sendDoc(d.Id, f);
    } catch (e) { fail(e); }
  };
  const uploadProof = async () => {
    try {
      const f = await papers.pick("qpProof");
      if (f) await sendProof(f);
    } catch (e) { fail(e); }
  };
  const open = (path: string, name: string) => openDocument(path, name).catch(fail);

  if (timeline.isLoading || agreementQ.isLoading || docsQ.isLoading) return <Page><Loading /></Page>;
  if (timeline.error || agreementQ.error) return <Page><ErrorText error={timeline.error || agreementQ.error} /></Page>;
  const ag = agreementQ.data;
  const documents = docsQ.data || [];
  const needsAction = documents.filter((d) => d.Status === "Requested" || d.Status === "Rejected");
  const onFile = documents.filter((d) => d.FileName && d.Status !== "Rejected");
  const mandatoryOutstanding = needsAction.filter((d) => d.IsMandatory);
  const sd = t?.salesDeed;
  const deed = deedQ.data?.deed;
  const deedPapers = deedQ.data?.documents || [];
  const qp = t?.queryPayment;
  const qpInfo = (qpQ.data || []).filter((a) => a.DocType === "Info");
  const qpProof = (qpQ.data || []).filter((a) => a.DocType === "Proof");

  if (!ag && !sd?.SentToCustomerAt && !documents.length) {
    return (
      <Page onRefresh={() => Promise.all([timeline.refetch(), agreementQ.refetch(), docsQ.refetch()])}>
        <Panel title="Your agreement isn't ready yet" icon={FileText}>
          <Muted>We'll notify you the instant it clears in-house approval and is shared here for your review.</Muted>
        </Panel>
      </Page>
    );
  }

  return (
    <Page onRefresh={() => Promise.all([timeline.refetch(), agreementQ.refetch(), docsQ.refetch(), qpQ.refetch(), deedQ.refetch()])}>
      {papers.sheet}
      <Muted>Track your full legal journey — agreement, sale deed, government payment, and registration — in one place.</Muted>

      {ag ? (
        <Panel title={`Agreement For Sale · ${ag.AgreementNo || ""}`} icon={FileText}
          // Where the agreement really is: registered and signed come after the customer's approval.
          right={<Pill label={ag.Status === "Registered" ? "Registered" : ag.Status === "Executed" ? "Signed" : ag.CustomerApprovalStatus || ag.Status} />}>
          <Row label="Legal Name" value={ag.LegalName || "—"} />
          <Row label="Project" value={ag.ProjectName || "—"} />
          <Row label="Unit" value={ag.UnitNo || "—"} />
          <Row label="Total Value" value={money(ag.TotalValue)} />
          <Row label="PAN (Permanent Account Number)" value={ag.PanNo || "—"} />
          <Row label="Aadhaar" value={ag.AadhaarNo || "—"} />
          <Row label={ag.Status === "Executed" || ag.Status === "Registered" ? "Signed on" : "Agreement Date"} value={ag.AgreementDate ? fmtDate(ag.AgreementDate) : "Not yet finalized"} />
          {ag.Status === "Registered" ? (
            <>
              <Divider />
              <Text style={{ fontSize: 11, fontFamily: fonts.body.semibold, color: brand.textSecondary }}>REGISTRATION</Text>
              <Row label="Registered on" value={fmtDate(ag.AfsRegistrationDate)} tone={brand.success} />
              {ag.AfsRegistrationNo ? <Row label="Registration no." value={ag.AfsRegistrationNo} /> : null}
              {ag.AfsStampDuty != null ? <Row label="Stamp duty" value={money(ag.AfsStampDuty)} /> : null}
              {ag.AfsRegistrationFee != null ? <Row label="Registration fee" value={money(ag.AfsRegistrationFee)} /> : null}
            </>
          ) : null}
          {ag.LegalAddress ? <Row label="Registered Address" value={ag.LegalAddress} /> : null}
          <Row label="Documents" value={needsAction.length > 0 ? `${onFile.length} on file, ${needsAction.length} needed` : String(onFile.length)} />
          {ag.LastRecheckRemarks ? <Muted>Your last recheck note: {ag.LastRecheckRemarks}{ag.RecheckCount ? ` (requested ${ag.RecheckCount}×)` : ""}</Muted> : null}
          <Divider />
          {ag.CustomerApprovalStatus === "Pending" && ag.SentToCustomerAt ? (
            mandatoryOutstanding.length ? <Muted>Upload the required document{mandatoryOutstanding.length > 1 ? "s" : ""} below before responding</Muted>
              : readOnly ? null : <Respond which="agreement" onDone={refresh} />
          ) : ag.CustomerApprovalStatus === "Approved" ? (
            <View style={{ gap: 8 }}>
              <Muted>
                You approved this agreement on {fmtDate(ag.CustomerApprovedAt)}.
                {ag.Status === "Registered" ? " It is signed and registered — nothing more is needed from you on it."
                  : ag.Status === "Executed" ? " It is signed; registration with the government comes next — we'll tell you once it's done." : ""}
              </Muted>
              {!ag.AgreementDate && (
                ag.DateApprovalStatus === "Pending" ? <Muted>Date agreed — awaiting our team's final sign-off</Muted>
                : ag.ProposedDateStatus === "PendingCustomerReview" ? (
                  proposing ? <ProposeDate ourDate={ag.ProposedDate} onDone={() => { setProposing(false); refresh(); }} onCancel={() => setProposing(false)} /> : readOnly ? null : (
                    <View style={{ gap: 8 }}>
                      <Muted>We proposed {fmtDate(ag.ProposedDate)} — accept it, or suggest a different date.</Muted>
                      <Button label="Accept This Date" busy={acceptDate.isPending} onPress={() => acceptDate.mutate()} />
                      <Button label="Propose a Different Date" kind="line" icon={CalendarCheck2} onPress={() => setProposing(true)} />
                    </View>
                  )
                ) : ag.ProposedDateStatus === "PendingCompanyReview" ? <Muted>You proposed {fmtDate(ag.ProposedDate)} — awaiting our team's response</Muted>
                : readOnly ? null : proposing ? <ProposeDate ourDate={null} onDone={() => { setProposing(false); refresh(); }} onCancel={() => setProposing(false)} />
                : <Button label="Propose Agreement Date" icon={CalendarCheck2} onPress={() => setProposing(true)} />
              )}
            </View>
          ) : ag.CustomerApprovalStatus === "Recheck" ? <Muted>Awaiting our team's revision — we'll re-share once updated</Muted> : null}
        </Panel>
      ) : null}

      {needsAction.length > 0 ? (
        <Panel title={`Documents Needed From You (${needsAction.length})`} icon={UploadCloud}>
          {needsAction.map((d, i) => (
            <View key={d.Id} style={{ gap: 6 }}>
              {i ? <Divider /> : null}
              <ListRow title={`${docLabel(d)}${d.IsMandatory ? " *" : ""}`}
                sub={d.Status === "Rejected" ? `Returned — please re-upload${d.Remarks ? ` · Why it was returned: ${d.Remarks}` : ""}` : "Requested — upload when ready"} />
              {readOnly ? null : <Button label={d.Status === "Rejected" ? "Re-submit Document" : "Upload Document"} kind="line" icon={UploadCloud}
                busy={busyDoc === d.Id} disabled={busyDoc != null} onPress={() => upload(d)} />}
            </View>
          ))}
        </Panel>
      ) : null}

      {onFile.length > 0 ? (
        <Panel title={`Attached Documents (${onFile.length})`} icon={FileText}>
          {onFile.map((d, i) => (
            <View key={d.Id}>
              {i ? <Divider /> : null}
              <ListRow title={`${docLabel(d)}${d.VersionNo && d.VersionNo > 1 ? ` (v${d.VersionNo})` : ""}`}
                pill={d.UploadedByType === "Customer" ? <Pill label={d.Status} /> : undefined}
                sub={[d.FileName, fmtBytes(d.FileSize)].filter(Boolean).join(" · ")}
                onPress={() => open(pdfPath.agreementDoc(appId as number, d.Id), d.FileName || docLabel(d))} />
            </View>
          ))}
        </Panel>
      ) : null}

      {sd?.SentToCustomerAt ? (
        <Panel title="Sales Deed" icon={Landmark} right={<Pill label={sd.CustomerApprovalStatus || sd.Status} />}>
          <Row label="Deed No." value={sd.DeedNo || "—"} />
          <Row label="Status" value={sd.Status} />
          <Row label="Deed Value" value={sd.DeedValue != null ? money(sd.DeedValue) : "—"} />
          <Row label="Deed Date" value={fmtDate(sd.DeedDate)} />
          <Row label="Sub-Registrar Office" value={sd.SubRegistrarOffice || "—"} />
          <Row label="Registration No." value={sd.RegistrationNo || "—"} />
          {deed?.StampDuty != null ? <Row label="Stamp duty" value={money(deed.StampDuty)} /> : null}
          {deed?.RegistrationFee != null ? <Row label="Registration fee" value={money(deed.RegistrationFee)} /> : null}
          {Number(deed?.StampDutyCredit) > 0 ? <Row label="Stamp duty already paid (credit)" value={money(deed?.StampDutyCredit)} /> : null}
          {deedPapers.length ? (
            <>
              <Text style={{ fontSize: 11, fontFamily: fonts.body.semibold, color: brand.textSecondary }}>THE DEED AND ITS PAPERS — TAP TO READ</Text>
              {deedPapers.map((d) => (
                <ListRow key={d.Id} title={`${docLabel(d)}${d.VersionNo && d.VersionNo > 1 ? ` (v${d.VersionNo})` : ""}`}
                  sub={[d.FileName, fmtBytes(d.FileSize), d.UploadedAt ? fmtDate(d.UploadedAt) : null].filter(Boolean).join(" · ")}
                  onPress={() => open(pdfPath.salesDeedDoc(appId as number, d.Id), d.FileName || docLabel(d))} />
              ))}
            </>
          ) : deedQ.isLoading ? <Loading /> : <Muted>The deed papers will appear here as soon as our legal team attaches them.</Muted>}
          {sd.CustomerApprovalStatus === "Recheck" ? (
            <Muted>You asked for a recheck{deed?.CustomerRecheckRemarks ? `: "${deed.CustomerRecheckRemarks}"` : ""}. Our legal team is revising the deed and will share it again.</Muted>
          ) : null}
          {sd.CustomerApprovalStatus === "Pending" && !readOnly ? <Respond which="salesDeed" onDone={refresh} />
            : sd.CustomerApprovalStatus === "Approved" ? <Muted>You approved this sale deed{deed?.CustomerApprovedAt ? ` on ${fmtDate(deed.CustomerApprovedAt)}` : ""}.</Muted> : null}
        </Panel>
      ) : null}

      {qp ? (
        <Panel title="Government Payment (Stamp Duty & Registration)" icon={ReceiptIndianRupee} right={<Pill label={qp.Status} />}>
          <Muted>This amount is paid by you directly to the government at registration — it is never paid to us.</Muted>
          <Row label="Stamp Duty" value={money(qp.StampDuty)} />
          <Row label="Registration Fee" value={money(qp.RegistrationFee)} />
          <Row label="Total Required" value={money(qp.RequiredAmount)} strong />
          {qpInfo.length ? <Text style={{ fontSize: 11, fontFamily: fonts.body.semibold, color: brand.textSecondary }}>PAPERWORK FROM US</Text> : null}
          {qpInfo.map((a) => <ListRow key={a.AttachmentId} title={a.FileName} sub={fmtBytes(a.FileSize)} onPress={() => open(pdfPath.qpAttachment(appId as number, a.AttachmentId), a.FileName)} />)}
          {qpProof.length ? <Text style={{ fontSize: 11, fontFamily: fonts.body.semibold, color: brand.textSecondary }}>YOUR PROOF OF PAYMENT</Text> : null}
          {qpProof.map((a) => <ListRow key={a.AttachmentId} title={a.FileName} sub={fmtBytes(a.FileSize)} onPress={() => open(pdfPath.qpAttachment(appId as number, a.AttachmentId), a.FileName)} />)}
          {qp.Status === "Confirmed" ? <Muted>Payment confirmed{qp.ConfirmedAt ? ` on ${fmtDate(qp.ConfirmedAt)}` : ""}</Muted>
            : readOnly ? null : <Button label={qpBusy ? "Uploading…" : "Upload Proof of Payment"} icon={Paperclip} busy={qpBusy} onPress={uploadProof} />}
        </Panel>
      ) : null}

      {t?.registry ? (
        <Panel title="Registry" icon={BookMarked} right={<Pill label={t.registry.Status} />}>
          <Row label="Registry No." value={t.registry.RegNo || "—"} />
          <Row label="Scheduled Date" value={fmtDate(t.registry.ScheduledDate)} />
          <Row label="Completed Date" value={fmtDate(t.registry.CompletedDate)} />
        </Panel>
      ) : null}

      {(t?.nocStatus?.total || t?.legalDocumentation) ? (
        <Panel title="NOCs & Legal Status" icon={ShieldCheck}>
          {t?.legalDocumentation ? <Row label="Legal Documentation" value={t.legalDocumentation.status} /> : null}
          {(t?.nocStatus?.items || []).map((n, i) => <Row key={`${n.type}-${i}`} label={`${n.type} NOC${n.nocNo ? ` · ${n.nocNo}` : ""}`} value={n.status} />)}
        </Panel>
      ) : null}
    </Page>
  );
}
