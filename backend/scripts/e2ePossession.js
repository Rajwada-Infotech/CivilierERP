// End-to-end test of Possession & Handover on the ZZTEST booking BKG-2026-00133, through scripts/e2eHarness.js (real
// routes, real SQL, the DEVELOPMENT database, one transaction rolled back at the end).
//   node scripts/e2ePossession.js
const { openHarness } = require("./e2eHarness");

const BOOKING = 213; // BKG-2026-00133, ZZTEST
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmPrePossession) P, (SELECT COUNT(*) FROM dbo.CrmPossessionNotice) N, (SELECT COUNT(*) FROM dbo.CrmHandover) H,
  (SELECT COUNT(*) FROM dbo.CrmOccupancyCertificate) C, (SELECT COUNT(*) FROM dbo.CrmSnagItem) S, (SELECT COUNT(*) FROM dbo.CrmBookingDocument) D,
  (SELECT Status FROM dbo.CrmAgreement WHERE BookingId = ${BOOKING} AND Status <> 'Cancelled') A`;

(async () => {
  const h = await openHarness({
    mounts: { "/c": "crmPrePossession", "/n": "crmPossessionNotice", "/h": "crmHandover", "/oc": "crmOcCc", "/ag": "crmAgreements", "/d": "crmBookingDocuments", "/p": "crmPortal" },
    count: COUNT,
  });
  const { base, call, q, request, check, expectCall, section } = h;
  const row = async (id = BOOKING) => (await call("GET", `/c/board?page=1&pageSize=1&bookingId=${id}`)).json.rows[0];

  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user });
    const b = (await q(`SELECT b.ApplicationId, b.ProjectId, a.CustomerId FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = ${BOOKING}`))[0];
    const pu = (await q("SELECT TOP 1 Id FROM dbo.CrmCustomerPortalUser WHERE IsActive = 1 AND ISNULL(MustChangePassword, 0) = 0 ORDER BY Id"))[0];
    const stranger = (await q(`SELECT TOP 1 Id FROM dbo.CrmCustomer WHERE Id <> ${b.CustomerId} ORDER BY Id`))[0];
    h.setPortal({ portalUserId: pu.Id, customerId: b.CustomerId });
    const P = `applicationId=${b.ApplicationId}`;
    const asStranger = async (fn) => { h.setPortal({ portalUserId: pu.Id, customerId: stranger.Id }); try { return await fn(); } finally { h.setPortal({ portalUserId: pu.Id, customerId: b.CustomerId }); } };

    section("Board: what each kind of booking shows");
    const pending = await row(217);
    check("Pending booking is Not Ready", pending.Stage === "NotReady", pending.Stage);
    check("Pending booking reports its status and approval stage", pending.BookingStatus === "Pending" && !!pending.WorkflowStage, JSON.stringify(pending.WorkflowStage));
    check("Pending booking has no agreement to open", pending.AgreementId == null);
    const noAg = await row(211);
    check("Approved booking with no agreement reports what blocks it", Array.isArray(noAg.AgreementBlocks), JSON.stringify(noAg.AgreementBlocks));
    let r0 = await row();
    check("Executed agreement is found, so Create is never offered", !!r0.AgreementId && r0.Gate0_AgreementExecuted === 1);
    expectCall("Unknown sort is ignored safely", await call("GET", "/c/board?page=1&pageSize=5&sortKey=constructor"), 200);
    expectCall("Filter by a stage", await call("GET", "/c/board?page=1&pageSize=5&status=NotReady"), 200);
    expectCall("Search", await call("GET", "/c/board?page=1&pageSize=5&search=BKG-2026-00133"), 200);

    section("Agreement: duplicates and eligibility");
    expectCall("Second agreement on a booking that has one is refused", await call("POST", "/ag", { BookingId: BOOKING }), 400);
    const dup = await call("POST", "/ag", { BookingId: 217 });
    check("Agreement on an unapproved booking is refused", dup.status >= 400 && dup.status < 500, `got ${dup.status} ${dup.json?.error}`);

    section("Order: nothing can jump ahead");
    expectCall("Checklist before the agreement is registered", await call("POST", "/c", { BookingId: BOOKING }), 400, "regist");
    expectCall("Notice before any checklist", await call("POST", "/n", { BookingId: BOOKING, OfferedDate: "2026-11-10", ResponseDeadline: "2026-11-25", DeliveryMode: "Portal" }), 400);
    expectCall("Handover before any notice", await call("POST", "/h", { BookingId: BOOKING }), 400);
    expectCall("Cancelled booking cannot start a checklist", await call("POST", "/c", { BookingId: 212 }), 400);

    await request().query(`UPDATE dbo.CrmAgreement SET Status = 'Registered' WHERE BookingId = ${BOOKING} AND Status <> 'Cancelled'`);
    expectCall("Checklist without a certificate", await call("POST", "/c", { BookingId: BOOKING }), 400, "certificate");
    r0 = await row();
    check("Registered but uncertified stays Not Ready", r0.Stage === "NotReady" && r0.Gate2_OcCcReceived === 0, r0.Stage);

    section("Certificate");
    const applied = (await q(`SELECT TOP 1 Id, CertType FROM dbo.CrmOccupancyCertificate WHERE ProjectId = ${b.ProjectId} AND Status = 'Applied' AND BlockId IS NULL`))[0];
    check("The project has an application filed", !!applied);
    expectCall("Filing the same certificate type again is a duplicate", await call("POST", "/oc", { ProjectId: b.ProjectId, CertType: applied.CertType, Status: "Applied" }), 409);
    expectCall("Mark as Issued", await call("PUT", `/oc/${applied.Id}`, { Status: "Received", ReceivedDate: "2026-11-01", CertificateNo: "E2E-1", IssuedBy: "E2E Authority" }), 200);
    r0 = await row();
    check("Certified and registered moves to Checklist", r0.Stage === "Checklist" && r0.Gate2_OcCcReceived === 1, `${r0.Stage} ${r0.Gate2_OcCcReceived}`);

    section("Checklist");
    expectCall("Start the checklist", await call("POST", "/c", { BookingId: BOOKING, ScheduledInspectionDate: "2026-11-05" }), 201);
    expectCall("Second checklist is a duplicate", await call("POST", "/c", { BookingId: BOOKING }), 409);
    r0 = await row();
    const chk = r0.CheckId;
    expectCall("Notice while checklist is not Ready", await call("POST", "/n", { BookingId: BOOKING, OfferedDate: "2026-11-10", ResponseDeadline: "2026-11-25", DeliveryMode: "Portal" }), 400);
    for (const k of ["DocumentationCheck", "QualityInspectionCheck"]) expectCall(`Tick ${k}`, await call("PUT", `/c/${chk}`, { [k]: true }), 200);
    check("Two of three ticks: still In Progress", (await row()).CheckStatus === "InProgress");
    const last = await call("PUT", `/c/${chk}`, { UtilityReadinessCheck: true });
    check("Last tick with dues cleared: Ready", last.json?.status === "Ready", JSON.stringify(last.json));
    expectCall("Inspection date saves", await call("PUT", `/c/${chk}`, { ScheduledInspectionDate: "2026-11-06" }), 200);
    check("The date is stored", String((await call("GET", `/c/${chk}`)).json.ScheduledInspectionDate).startsWith("2026-11-06"));
    expectCall("Notes save", await call("PUT", `/c/${chk}`, { Notes: "E2E note" }), 200);
    expectCall("A dues tick cannot be forged", await call("PUT", `/c/${chk}`, { DuesClearedCheck: true }), 200);
    check("Still driven by real money", (await row()).FullyFunded === 1);

    section("Dues reopening after Ready");
    const m = (await q(`SELECT TOP 1 Id, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = ${BOOKING} AND AmountPaid > 1000 ORDER BY MilestoneNo DESC`))[0];
    const collected = Number((await row()).Collected), required = Number((await row()).RequiredAmount);
    const cut = Math.round(collected - required + 1000);
    await request().query(`UPDATE dbo.CrmPaymentMilestone SET AmountPaid = AmountPaid - ${cut}, Status = 'Pending' WHERE Id = ${m.Id}`);
    r0 = await row();
    check("Short by Rs 1,000 shows the balance", Math.abs(Number(r0.Balance) - 1000) < 1 && r0.FullyFunded === 0, `${r0.Balance} ${r0.FullyFunded}`);
    expectCall("Notice refused while dues are open", await call("POST", "/n", { BookingId: BOOKING, OfferedDate: "2026-11-10", ResponseDeadline: "2026-11-25", DeliveryMode: "Portal" }), 400);
    check("Checklist fell back from Ready", (await row()).CheckStatus !== "Ready", (await row()).CheckStatus);
    await request().query(`UPDATE dbo.CrmPaymentMilestone SET AmountPaid = AmountPaid + ${cut}, Status = '${m.Status}' WHERE Id = ${m.Id}`);
    await call("PUT", `/c/${chk}`, { Notes: "E2E note 2" });
    check("Paid again: Ready again", (await row()).CheckStatus === "Ready", (await row()).CheckStatus);

    section("Notice");
    const created = await call("POST", "/n", { BookingId: BOOKING, OfferedDate: "2026-11-10", ResponseDeadline: "2026-11-25", DeliveryMode: "Courier", Notes: "E2E" });
    check("Create the notice", created.status === 201, `got ${created.status} ${created.json?.error}`);
    expectCall("Second active notice is a duplicate", await call("POST", "/n", { BookingId: BOOKING, OfferedDate: "2026-11-10", ResponseDeadline: "2026-11-25", DeliveryMode: "Courier" }), 409);
    r0 = await row();
    const nid = r0.NoticeId;
    check("Stage moves to Notice", r0.Stage === "Notice" && r0.NoticeStatus === "Draft", r0.Stage);
    expectCall("Edit a draft", await call("PUT", `/n/${nid}`, { Notes: "Edited" }), 200);
    const pdf = await call("GET", `/n/${nid}/pdf`);
    check("Staff can open the draft letter", pdf.status === 200 && pdf.type.includes("pdf"), `${pdf.status}`);
    const hidden = await call("GET", `/p/possession-notice/${nid}/pdf?${P}`);
    check("Customer cannot see a draft letter", hidden.status === 404, `${hidden.status}`);
    expectCall("Cannot acknowledge a draft", await call("PUT", `/n/${nid}/mark-acknowledged`), 400);
    expectCall("Customer cannot respond to a draft", await call("POST", `/p/possession-notice/respond?${P}`, { decision: "Acknowledge" }), 404);
    expectCall("Mark as sent through the portal", await call("PUT", `/n/${nid}/mark-sent`, { DeliveryMode: "Portal" }), 200);
    check("Delivery mode is stored", (await call("GET", `/n/${nid}`)).json.DeliveryMode === "Portal");
    expectCall("Cannot send twice", await call("PUT", `/n/${nid}/mark-sent`, { DeliveryMode: "Portal" }), 400);
    const delSent = await call("DELETE", `/n/${nid}`);
    check("A sent notice cannot be deleted", delSent.status === 400 || delSent.status === 409, `got ${delSent.status}`);
    const owner = await call("GET", `/p/possession-notice/${nid}/pdf?${P}`);
    check("Customer can open the sent letter", owner.status === 200 && owner.type.includes("pdf"), `${owner.status}`);
    const other = await asStranger(() => call("GET", `/p/possession-notice/${nid}/pdf?${P}`));
    check("Another customer is refused the letter", other.status === 403, `${other.status}`);
    const tl = await call("GET", `/p/timeline?${P}`);
    check("Sent notice is on the customer's timeline", tl.json?.possessionNotice?.Status === "Sent", `${tl.status} ${tl.json?.error || ""}`);

    section("Customer response");
    expectCall("Dispute needs a reason", await call("POST", `/p/possession-notice/respond?${P}`, { decision: "Dispute" }), 400);
    expectCall("Unknown decision refused", await call("POST", `/p/possession-notice/respond?${P}`, { decision: "Maybe" }), 400);
    const strangerDisp = await asStranger(() => call("POST", `/p/possession-notice/respond?${P}`, { decision: "Acknowledge" }));
    check("Another customer cannot respond", strangerDisp.status === 403, `${strangerDisp.status}`);
    expectCall("Customer disputes", await call("POST", `/p/possession-notice/respond?${P}`, { decision: "Dispute", reason: "E2E snag" }), 200);
    r0 = await row();
    check("Disputed is counted on the board", r0.NoticeStatus === "Disputed");
    expectCall("Cannot acknowledge a disputed notice", await call("PUT", `/n/${nid}/mark-acknowledged`), 400);
    expectCall("Withdrawing needs a reason", await call("PUT", `/n/${nid}/retract-dispute`, {}), 400);
    expectCall("Withdraw the dispute", await call("PUT", `/n/${nid}/retract-dispute`, { RetractReason: "Settled" }), 200);
    check("Back to Draft", (await row()).NoticeStatus === "Draft");
    expectCall("Resend", await call("PUT", `/n/${nid}/mark-sent`, { DeliveryMode: "Portal" }), 200);
    expectCall("Staff records a dispute needs remarks", await call("PUT", `/n/${nid}/proxy-dispute`, { ProxyMethod: "Phone" }), 400);
    expectCall("Staff records an off-portal acknowledgement needs remarks", await call("PUT", `/n/${nid}/proxy-acknowledge`, { ProxyMethod: "Phone" }), 400);
    expectCall("Customer acknowledges", await call("POST", `/p/possession-notice/respond?${P}`, { decision: "Acknowledge" }), 200);
    expectCall("Cannot respond twice", await call("POST", `/p/possession-notice/respond?${P}`, { decision: "Dispute", reason: "x" }), 400);
    r0 = await row();
    check("Stage moves to Handover", r0.Stage === "Handover" && r0.NoticeStatus === "Acknowledged", r0.Stage);
    const delAck = await call("DELETE", `/n/${nid}`);
    check("An acknowledged notice cannot be deleted", delAck.status === 400 || delAck.status === 409, `got ${delAck.status}`);

    section("Signed copies");
    const up = async (type) => { const f = new FormData(); f.append("files", new Blob(["%PDF-1.4\n%E2E"], { type: "application/pdf" }), "e2e.pdf"); f.append("DocumentType", type); const res = await fetch(`${base}/d/booking/${BOOKING}/possession-upload`, { method: "POST", body: f }); return { status: res.status, json: await res.json() }; };
    expectCall("An identity document cannot be uploaded here", await up("IdentityProof"), 400);
    const good = await up("Signed Possession Notice");
    expectCall("Upload the signed notice", good, 201);
    const docs = await call("GET", `/d/booking/${BOOKING}/possession`);
    check("It is listed on the booking", docs.json.documents.some((d) => d.Id === good.json.ids[0]));
    check("It opens", (await fetch(`${base}/d/possession-file/${good.json.ids[0]}`)).status === 200);
    const kyc = (await request().query(`INSERT INTO dbo.CrmBookingDocument (BookingId, DocumentType, FileName, FileBase64, MimeType) OUTPUT INSERTED.Id VALUES (${BOOKING}, 'IdentityProof', 'e2e.pdf', 'JVBERg==', 'application/pdf')`)).recordset[0].Id;
    check("An identity document cannot be read through this route", (await fetch(`${base}/d/possession-file/${kyc}`)).status === 404);

    section("Handover: what blocks it");
    await call("PUT", `/c/${chk}`, { QualityInspectionCheck: false });
    expectCall("Unticked checklist blocks scheduling", await call("POST", "/h", { BookingId: BOOKING }), 400, "Pre-Possession");
    await call("PUT", `/c/${chk}`, { QualityInspectionCheck: true });
    await request().query(`UPDATE dbo.CrmPaymentMilestone SET AmountPaid = AmountPaid - ${cut}, Status = 'Pending' WHERE Id = ${m.Id}`);
    expectCall("Open balance blocks scheduling", await call("POST", "/h", { BookingId: BOOKING }), 400);
    await request().query(`UPDATE dbo.CrmPaymentMilestone SET AmountPaid = AmountPaid + ${cut}, Status = '${m.Status}' WHERE Id = ${m.Id}`);
    await call("PUT", `/c/${chk}`, { Notes: "E2E note 3" });
    let nocInserted = false;
    try { await request().query(`INSERT INTO dbo.CrmNoc (BookingId, NocType, Status) VALUES (${BOOKING}, 'Org', 'Pending')`); nocInserted = true; } catch (e) { console.log(`SKIP  Open NOC case: ${e.message.slice(0, 90)}`); }
    if (nocInserted) {
      r0 = await row();
      check("Open NOC shows on the board", r0.NocPending === 1);
      expectCall("Open NOC blocks scheduling", await call("POST", "/h", { BookingId: BOOKING }), 400, "NOC");
      await request().query(`DELETE FROM dbo.CrmNoc WHERE BookingId = ${BOOKING} AND Status = 'Pending'`);
    }

    section("Handover: the run");
    const sch = await call("POST", "/h", { BookingId: BOOKING, ScheduledDate: "2026-11-20" });
    check("Schedule (an earlier cancelled one does not stop it)", sch.status === 201, `got ${sch.status} ${sch.json?.error}`);
    expectCall("Second live handover is a duplicate", await call("POST", "/h", { BookingId: BOOKING }), 409);
    let hid = sch.json.id;
    expectCall("Cannot jump from Scheduled to Completed", await call("PUT", `/h/${hid}`, { Status: "Completed" }), 400);
    expectCall("Cancel", await call("PUT", `/h/${hid}`, { Status: "Cancelled" }), 200);
    check("Cancelled is not live on the board", (await row()).Stage === "Handover");
    expectCall("Cancelled cannot be resumed", await call("PUT", `/h/${hid}`, { Status: "SnagInspection" }), 400);
    const again = await call("POST", "/h", { BookingId: BOOKING, ScheduledDate: "2026-11-21" });
    check("A new one can be scheduled after cancelling", again.status === 201, `got ${again.status} ${again.json?.error}`);
    hid = again.json.id;
    expectCall("Start inspection", await call("PUT", `/h/${hid}`, { Status: "SnagInspection" }), 200);
    expectCall("A snag needs a description", await call("POST", `/h/${hid}/snags`, { Category: "Paint" }), 400);
    const snag = await call("POST", `/h/${hid}/snags`, { Category: "Paint", Description: "E2E" });
    check("Raise a snag", snag.status === 201, `got ${snag.status} ${snag.json?.error}`);
    check("Open snag shows on the board", (await row()).OpenSnags === 1);
    const complete = { Status: "Completed", ActualHandoverDate: "2026-11-09", KeyHandoverBy: user, FinalDuesCleared: true, CustomerAcknowledged: true };
    expectCall("Inspection done", await call("PUT", `/h/${hid}`, { Status: "SnagPending" }), 200);
    expectCall("Cannot complete with an open snag", await call("PUT", `/h/${hid}`, complete), 400);
    const sid = (await q(`SELECT TOP 1 Id FROM dbo.CrmSnagItem WHERE HandoverId = ${hid}`))[0].Id;
    expectCall("Resolve the snag", await call("PUT", `/h/${hid}/snags/${sid}`, { Status: "Resolved" }), 200);
    check("No open snags left", (await row()).OpenSnags === 0);
    for (const [k, v] of [["ActualHandoverDate", null], ["KeyHandoverBy", null], ["FinalDuesCleared", false], ["CustomerAcknowledged", false]]) {
      const res = await call("PUT", `/h/${hid}`, { ...complete, [k]: v });
      check(`Complete refused without ${k}`, res.status === 400, `got ${res.status} ${res.json?.error}`);
    }
    expectCall("Complete the handover", await call("PUT", `/h/${hid}`, complete), 200);
    r0 = await row();
    check("Board shows Completed", r0.Stage === "Completed" && r0.HandoverStatus === "Completed", r0.Stage);
    expectCall("Completed cannot be cancelled", await call("PUT", `/h/${hid}`, { Status: "Cancelled" }), 400);
    expectCall("No second handover after completion", await call("POST", "/h", { BookingId: BOOKING }), 409);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
