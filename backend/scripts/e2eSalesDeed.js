// End-to-end test of Sale Deeds: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST bookings
// BKG-2026-00126 (a cancelled deed and a registered one) and BKG-2026-00133 (a deed with every approval), inside one
// transaction that is rolled back.   node scripts/e2eSalesDeed.js
const { openHarness } = require("./e2eHarness");

const CANCELLED = 20;   // BKG-2026-00126: cancelled deed (every approval was given before it was cancelled)
const REGISTERED = 22;  // BKG-2026-00126: the deed that replaced it, registered
const LIVE = 24;        // BKG-2026-00133: draft deed, senior, customer and director approved
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmSalesDeed) D, (SELECT COUNT(*) FROM dbo.CrmSalesDeedApprovalLog) L,
  (SELECT COUNT(*) FROM dbo.CrmSalesDeedRevision) R, (SELECT COUNT(*) FROM dbo.CrmSalesDeedDocument) F,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status, ':', VersionNo, ':', ISNULL(SeniorApprovalStatus, '-'), ':', ISNULL(DirectorApprovalStatus, '-')), ',')
     FROM dbo.CrmSalesDeed WHERE Id IN (${CANCELLED}, ${REGISTERED}, ${LIVE})) S`;

(async () => {
  const h = await openHarness({ mounts: { "/d": "crmSalesDeed" }, count: COUNT });
  const { call, upload, q, check, expectCall, section } = h;
  const log = async (id) => (await call("GET", `/d/${id}`)).json.approvalLog.map((l) => l.Action);
  const deed = async (id) => (await call("GET", `/d/${id}`)).json;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user });

    section("A cancelled deed is closed");
    const proxy = { ProxyMethod: "Phone", ProxyRemarks: "E2E" };
    for (const [name, m, url, body] of [
      ["Submit", "PUT", "submit"], ["Senior approve", "PUT", "approve"], ["Senior reject", "PUT", "reject", { Remarks: "x" }],
      ["Send to customer", "PUT", "send-to-customer"], ["Offline customer approval", "PUT", "proxy-customer-approve", proxy],
      ["Offline recheck", "PUT", "proxy-customer-recheck", proxy], ["Director approve", "PUT", "director/approve"],
      ["Director reject", "PUT", "director/reject", { Remarks: "x" }], ["Assign legal executive", "PUT", "assign-legal", { LegalExecutiveId: user }],
      ["Request a document", "POST", "documents/request", { DocumentType: "Other", Label: "E2E" }],
    ]) expectCall(`${name} on a cancelled deed is refused`, await call(m, `/d/${CANCELLED}/${url}`, body), 400, "cancelled");
    expectCall("Saving the Index II date on a cancelled deed is refused", await call("PUT", `/d/${CANCELLED}`, { Index2ReceivedDate: "2026-11-01" }), 400, "cancelled");
    expectCall("Saving notes on a cancelled deed is refused", await call("PUT", `/d/${CANCELLED}`, { Notes: "E2E" }), 400, "cancelled");
    expectCall("Uploading to a cancelled deed is refused", await upload(`/d/${CANCELLED}/documents/upload`, { DocumentType: "Other" }), 400);
    const cdoc = (await deed(CANCELLED)).documents[0];
    if (cdoc) {
      expectCall("Reviewing a cancelled deed's paper is refused", await call("PUT", `/d/${CANCELLED}/documents/${cdoc.Id}`, { Status: "Rejected", Remarks: "x" }), 400);
    }
    check("It is still Cancelled", (await deed(CANCELLED)).deed.Status === "Cancelled");
    expectCall("Cancelling twice is refused", await call("PUT", `/d/${CANCELLED}/cancel`), 400);
    const reg = await call("PUT", `/d/${REGISTERED}`, { Index2ReceivedDate: "2026-11-02" });
    check("A registered deed still takes its Index II date", reg.status === 200 && reg.json.status === "Registered", `got ${reg.status} ${reg.json?.status || reg.json?.error}`);

    section("Director rejection goes back to legal");
    const before = (await deed(LIVE)).deed;
    // Put the director's review back to Pending, inside the transaction only.
    await q(`UPDATE dbo.CrmSalesDeed SET DirectorApprovalStatus = 'Pending', DirectorApprovedAt = NULL, DirectorApprovedBy = NULL WHERE Id = ${LIVE}`);
    expectCall("The director rejects", await call("PUT", `/d/${LIVE}/director/reject`, { Remarks: "Wrong survey number" }), 200);
    let rec = await deed(LIVE);
    let d = rec.deed;
    check("Director step keeps Rejected and the reason", d.DirectorApprovalStatus === "Rejected" && d.DirectorApprovalRemarks === "Wrong survey number");
    check("Senior review starts again", d.SeniorApprovalStatus == null && d.SeniorApprovedAt == null);
    check("Customer review starts again", d.SentToCustomerAt == null && d.CustomerApprovalStatus === "Pending" && d.CustomerApprovedAt == null);
    check("A new version", d.VersionNo === before.VersionNo + 1, `${before.VersionNo} -> ${d.VersionNo}`);
    check("Every mandatory paper is back to Requested", rec.documents.filter((x) => x.IsMandatory).every((x) => x.Status === "Requested" && !x.HasFile));
    check("The old figures are kept as a revision", (await call("GET", `/d/${LIVE}/revisions`)).json.some((r) => r.VersionNo === before.VersionNo && r.Reason === "Wrong survey number"));
    check("History: Director rejected", (await log(LIVE)).includes("DirectorReject"));
    expectCall("Execution is refused now", await call("PUT", `/d/${LIVE}`, { ExecutedBy: "E2E" }), 400, "pending");
    expectCall("Submitting before the papers are reworked is refused", await call("PUT", `/d/${LIVE}/approve`), 400);

    section("Round again: papers, senior, customer, director");
    for (const doc of rec.documents.filter((x) => x.IsMandatory)) {
      const a = await (async () => { const f = new FormData(); f.append("file", new Blob(["%PDF-1.4\n%E2E"], { type: "application/pdf" }), "e2e.pdf"); const r = await fetch(`${h.base}/d/${LIVE}/documents/${doc.Id}/attach`, { method: "POST", body: f }); return { status: r.status, json: await r.json().catch(() => null) }; })();
      expectCall(`Attach ${doc.Label || doc.DocumentType}`, a, 200);
      expectCall(`Verify ${doc.Label || doc.DocumentType}`, await call("PUT", `/d/${LIVE}/documents/${doc.Id}`, { Status: "Verified" }), 200);
    }
    // Sent back, the figures can be corrected again (they lock once it goes to the customer).
    const fig = await call("PUT", `/d/${LIVE}`, { DeedValue: before.DeedValue || 5000000, StampDuty: 350000, RegistrationFee: 30000 });
    check("The figures can be corrected again", fig.status === 200 && Number((await deed(LIVE)).deed.StampDuty) === 350000, `got ${fig.status} ${fig.json?.error}`);
    expectCall("Submit for senior approval", await call("PUT", `/d/${LIVE}/submit`), 200);
    const sa = await call("PUT", `/d/${LIVE}/approve`, { Remarks: "ok" });
    check("Senior approves (and it goes to the customer)", sa.status === 200 && (await deed(LIVE)).deed.SentToCustomerAt != null, `got ${sa.status} ${sa.json?.error || sa.json?.status}`);
    expectCall("Director approval waits for the customer", await call("PUT", `/d/${LIVE}/director/approve`), 400, "Customer");
    expectCall("Record the customer's recheck (offline)", await call("PUT", `/d/${LIVE}/proxy-customer-recheck`, { ProxyMethod: "Phone", ProxyRemarks: "Spelling of name" }), 200);
    expectCall("Resend to the customer", await call("PUT", `/d/${LIVE}/send-to-customer`), 200);
    expectCall("Record the customer's approval (offline)", await call("PUT", `/d/${LIVE}/proxy-customer-approve`, { ProxyMethod: "Phone", ProxyRemarks: "Approved on call" }), 200);
    d = (await deed(LIVE)).deed;
    check("The director is asked again", d.CustomerApprovalStatus === "Approved" && d.DirectorApprovalStatus === "Pending");
    const da = await call("PUT", `/d/${LIVE}/director/approve`, { Remarks: "ok" });
    check("The director approves", da.status === 200 && (await deed(LIVE)).deed.DirectorApprovalStatus === "Approved", `got ${da.status} ${da.json?.error || da.json?.status}`);
    section("Stamp duty before execution");
    expectCall("Execution waits for the stamp duty payment", await call("PUT", `/d/${LIVE}`, { ExecutedBy: "E2E Signatory" }), 400, "stamp duty");
    // A payment for this deed, inside the transaction only: details sent, then confirmed through the real route.
    const qpId = (await q(`INSERT INTO dbo.CrmQueryPayment (QPNo, BookingId, SalesDeedId, Status, CreatedBy, CreatedAt) OUTPUT INSERTED.Id VALUES ('QP-E2E', 213, ${LIVE}, 'InfoSent', ${user}, SYSDATETIME())`))[0].Id;
    const proof = { fileName: "challan.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 E2E").toString("base64") };
    await q(`UPDATE dbo.CrmSalesDeed SET DirectorApprovalStatus = 'Pending' WHERE Id = ${LIVE}`);
    expectCall("Details can't go to the customer before the director approves", await call("POST", `/d/query-payment/${qpId}/info`, { files: [proof] }), 400, "director");
    expectCall("Payment can't be confirmed before the director approves", await call("POST", `/d/query-payment/${qpId}/confirm`, { proof, ConfirmedAmount: 380000 }), 400, "director");
    await q(`UPDATE dbo.CrmSalesDeed SET DirectorApprovalStatus = 'Approved' WHERE Id = ${LIVE}`);
    const conf = await call("POST", `/d/query-payment/${qpId}/confirm`, { proof, ConfirmedAmount: 380000 });
    check("Confirm the payment", conf.status === 200, `got ${conf.status} ${conf.json?.error}`);
    expectCall("Assign the legal executive again", await call("PUT", `/d/${LIVE}/assign-legal`, { LegalExecutiveId: user }), 200);
    const ex = await call("PUT", `/d/${LIVE}`, { ExecutedBy: "E2E Signatory" });
    check("Record execution", ex.status === 200 && ex.json.status === "Executed", `got ${ex.status} ${ex.json?.error || ex.json?.status}`);
    const actions = await log(LIVE);
    for (const a of ["Submitted", "SeniorApprove", "CustomerRecheck", "SendToCustomer", "CustomerApprove", "DirectorApprove", "LegalAssigned", "Executed"]) {
      check(`History: ${a}`, actions.includes(a));
    }
    const proxyEntry = (await call("GET", `/d/${LIVE}`)).json.approvalLog.find((l) => l.Action === "CustomerRecheck");
    check("The offline entry says how and what", /Phone/.test(proxyEntry?.Remarks || "") && /Spelling/.test(proxyEntry?.Remarks || ""));

    section("Repeat clicks");
    await q(`UPDATE dbo.CrmSalesDeed SET DirectorApprovalStatus = 'Pending' WHERE Id = ${LIVE}`);
    expectCall("Reject", await call("PUT", `/d/${LIVE}/director/reject`, { Remarks: "again" }), 200);
    const v1 = (await deed(LIVE)).deed.VersionNo;
    await call("PUT", `/d/${LIVE}/director/reject`, { Remarks: "again" });
    check("A second reject does not send it back twice", (await deed(LIVE)).deed.VersionNo === v1);
    expectCall("An unknown deed is not found", await call("PUT", "/d/999999/director/reject", { Remarks: "x" }), 404);

    section("The customer's recheck: send back to legal");
    // (Executed earlier in this run: put it back before execution, inside the transaction only.)
    await q(`UPDATE dbo.CrmSalesDeed SET ExecutedBy = NULL, Status = 'Draft', SeniorApprovalStatus = 'Approved', SeniorApprovedAt = SYSDATETIME(), SentToCustomerAt = SYSDATETIME(),
               CustomerApprovalStatus = 'RecheckRequested', CustomerRecheckRemarks = 'Stamp duty is wrong' WHERE Id = ${LIVE};
             UPDATE dbo.CrmQueryPayment SET Status = 'InfoSent' WHERE BookingId = 213`);
    expectCall("Figures are locked while it is with the customer", await call("PUT", `/d/${LIVE}`, { StampDuty: 360000 }), 400, "no longer be edited");
    const v2 = (await deed(LIVE)).deed.VersionNo;
    expectCall("Send it back to legal", await call("PUT", `/d/${LIVE}/rework`), 200);
    rec = await deed(LIVE);
    check("Senior and customer review start again, new version", rec.deed.SeniorApprovalStatus == null && rec.deed.SentToCustomerAt == null && rec.deed.VersionNo === v2 + 1);
    check("The papers are reworked", rec.documents.filter((x) => x.IsMandatory).every((x) => x.Status === "Requested"));
    check("History: Sent back to legal, with the customer's reason", rec.approvalLog.some((l) => l.Action === "SentBackToLegal" && /Stamp duty is wrong/.test(l.Remarks || "")));
    expectCall("Now the figures can be corrected", await call("PUT", `/d/${LIVE}`, { StampDuty: 360000 }), 200);
    expectCall("Sending back again is refused (it is with legal now)", await call("PUT", `/d/${LIVE}/rework`), 400, "still with legal");
    expectCall("Sending back an unknown deed", await call("PUT", "/d/999999/rework"), 404);
    expectCall("Sending back a cancelled deed is refused", await call("PUT", `/d/${CANCELLED}/rework`), 400, "cancelled");

    section("A rejected paper is attached again");
    const paper = rec.documents.find((x) => x.IsMandatory);
    const attach = async () => { const f = new FormData(); f.append("file", new Blob(["%PDF-1.4 E2E"], { type: "application/pdf" }), "e2e.pdf"); const r = await fetch(`${h.base}/d/${LIVE}/documents/${paper.Id}/attach`, { method: "POST", body: f }); return { status: r.status, json: await r.json().catch(() => null) }; };
    expectCall("Attach", await attach(), 200);
    expectCall("Reject it with a reason", await call("PUT", `/d/${LIVE}/documents/${paper.Id}`, { Status: "Rejected", Remarks: "Blurred" }), 200);
    expectCall("Attach a better copy", await attach(), 200);
    expectCall("Verify it", await call("PUT", `/d/${LIVE}/documents/${paper.Id}`, { Status: "Verified" }), 200);

    section("An approved deed with a mistake is sent back (the stuck deed)");
    // As ZZTEST-DEED-UI is on dev: every approval given, no stamp duty or fee, a payment told to the customer.
    await q(`UPDATE dbo.CrmSalesDeed SET SeniorApprovalStatus = 'Approved', CustomerApprovalStatus = 'Approved', DirectorApprovalStatus = 'Approved',
               SentToCustomerAt = SYSDATETIME(), StampDuty = NULL, RegistrationFee = NULL, ExecutedBy = NULL, Status = 'Draft', CustomerRecheckRemarks = NULL WHERE Id = ${LIVE};
             UPDATE dbo.CrmQueryPayment SET Status = 'InfoSent', SalesDeedId = ${LIVE} WHERE BookingId = 213`);
    expectCall("Figures are locked", await call("PUT", `/d/${LIVE}`, { StampDuty: 340000 }), 400, "no longer be edited");
    expectCall("Sending back needs a reason", await call("PUT", `/d/${LIVE}/rework`, {}), 400, "corrected");
    expectCall("Send it back with the reason", await call("PUT", `/d/${LIVE}/rework`, { Remarks: "Stamp duty and fee missing" }), 200);
    rec = await deed(LIVE);
    check("Senior, customer and director start again", rec.deed.SeniorApprovalStatus == null && rec.deed.SentToCustomerAt == null && rec.deed.DirectorApprovalStatus === "NotRequired" && rec.deed.CustomerApprovalStatus === "Pending");
    check("The payment told to the customer starts again", (await q("SELECT Status FROM dbo.CrmQueryPayment WHERE BookingId = 213"))[0].Status === "Pending");
    check("History: sent back, with the reason", rec.approvalLog.some((l) => l.Action === "SentBackToLegal" && /missing/.test(l.Remarks || "")));
    expectCall("Now the stamp duty can be entered", await call("PUT", `/d/${LIVE}`, { StampDuty: 340000, RegistrationFee: 30000 }), 200);
    expectCall("Sending back while it is with legal is refused", await call("PUT", `/d/${LIVE}/rework`, { Remarks: "x" }), 400, "still with legal");
    await q(`UPDATE dbo.CrmSalesDeed SET SeniorApprovalStatus = 'Approved' WHERE Id = ${LIVE}; UPDATE dbo.CrmQueryPayment SET Status = 'Confirmed' WHERE BookingId = 213`);
    expectCall("Not once the payment is confirmed", await call("PUT", `/d/${LIVE}/rework`, { Remarks: "x" }), 400, "confirmed");
    await q(`UPDATE dbo.CrmQueryPayment SET Status = 'InfoSent' WHERE BookingId = 213; UPDATE dbo.CrmSalesDeed SET ExecutedBy = 'E2E' WHERE Id = ${LIVE}`);
    expectCall("Not once it is executed", await call("PUT", `/d/${LIVE}/rework`, { Remarks: "x" }), 400, "executed");
    await q(`UPDATE dbo.CrmSalesDeed SET ExecutedBy = NULL WHERE Id = ${LIVE}`);

    section("A cancelled deed is redone");
    await q(`UPDATE dbo.CrmQueryPayment SET SalesDeedId = ${LIVE}, Status = 'InfoSent' WHERE BookingId = 213;
             UPDATE dbo.CrmAgreement SET Status = 'Registered' WHERE BookingId = 213;
             UPDATE dbo.CrmBooking SET FinancingType = 'SelfFunded' WHERE Id = 213;
             UPDATE dbo.CrmHandover SET Status = 'Completed' WHERE Id = (SELECT TOP 1 Id FROM dbo.CrmHandover WHERE BookingId = 213 ORDER BY CreatedAt DESC)`);
    expectCall("Cancel the deed", await call("PUT", `/d/${LIVE}/cancel`), 200);
    const redo = await call("POST", "/d", { BookingId: 213, DeedValue: 5000000, StampDuty: 340000, RegistrationFee: 30000 });
    check("A new deed for the same booking", redo.status === 201, `got ${redo.status} ${redo.json?.error}`);
    if (redo.status === 201) {
      const qp = (await q("SELECT SalesDeedId, Status FROM dbo.CrmQueryPayment WHERE BookingId = 213"))[0];
      check("The stamp duty payment moves to the new deed and starts again", qp.SalesDeedId === redo.json.id && qp.Status === "Pending", JSON.stringify(qp));
      const qpView = (await call("GET", "/d/query-payment/booking/213")).json;
      check("It shows the new deed's figures", Number(qpView?.StampDuty) === 340000, `${qpView?.StampDuty}`);
      check("The booking's current deed is the new one", (await call("GET", "/d/booking/213/deed")).json?.Id === redo.json.id);
      expectCall("A second live deed is refused", await call("POST", "/d", { BookingId: 213, DeedValue: 1 }), 409);
    }
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
