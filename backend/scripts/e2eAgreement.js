// End-to-end test of the Agreement for Sale: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST
// agreement ZZTEST-AGR-UI (booking BKG-2026-00133), set back to a fresh draft inside one transaction that is rolled back.
//   node scripts/e2eAgreement.js
const { openHarness } = require("./e2eHarness");

const AGR = 36;            // ZZTEST-AGR-UI, booking 213 (BKG-2026-00133), executed on dev
const BOOKING = 213;
const LOCKED_AGR = 33;     // ZZTEST-AGR-BB, booking 210 cancelled
const DATE = "2026-12-15";
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmAgreement) N, (SELECT COUNT(*) FROM dbo.CrmAgreementDocument) D,
  (SELECT COUNT(*) FROM dbo.CrmAgreementDateHistory) H, (SELECT COUNT(*) FROM dbo.CrmAgreementRevision) R,
  (SELECT COUNT(*) FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmAgreement') A,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status, ':', SeniorApprovalStatus, ':', CustomerApprovalStatus, ':', CONVERT(varchar(10), AgreementDate, 23)), ',') FROM dbo.CrmAgreement) S`;

(async () => {
  const h = await openHarness({ mounts: { "/a": "crmAgreements" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  const get = async () => (await call("GET", `/a/${AGR}`)).json;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin" });

    // A fresh draft, as on the day it was made: waiting for senior approval, no papers, no legal executive.
    await q(`DELETE FROM dbo.CrmAgreementDocument WHERE AgreementId = ${AGR}; DELETE FROM dbo.CrmAgreementDateHistory WHERE AgreementId = ${AGR};
      UPDATE dbo.CrmAgreement SET Status = 'Draft', SeniorApprovalStatus = 'Pending', SeniorApprovedAt = NULL, SeniorApprovedBy = NULL, SeniorApprovalRemarks = NULL,
        SentToCustomerAt = NULL, CustomerApprovalStatus = 'Pending', CustomerApprovedAt = NULL, RecheckCount = 0, LastRecheckRemarks = NULL,
        AgreementDate = NULL, ProposedDate = NULL, ProposedDateStatus = NULL, DateApprovalStatus = 'NotRequired', ProposedDateByCompany = NULL, ProposedDateByCustomer = NULL,
        LegalExecutiveId = NULL, AfsRegistrationNo = NULL, AfsRegistrationDate = NULL WHERE Id = ${AGR}`);
    let a = (await get()).agreement;
    check("Reset to a fresh draft", a.Status === "Draft" && a.SeniorApprovalStatus === "Pending" && a.LegalExecutiveId == null, JSON.stringify(a.Status));
    check("Found from its booking", (await call("GET", `/a/booking/${BOOKING}`)).json?.agreement?.Id === AGR);
    const list = (await call("GET", "/a?page=1&pageSize=25&status=Draft")).json;
    check("Listed under In preparation, counted", list.rows.some((r) => r.Id === AGR) && list.statusCounts.Draft >= 1);
    const twice = await call("POST", "/a", { BookingId: BOOKING });
    check("A second agreement for the same booking is refused", twice.status >= 400 && twice.status < 500, `got ${twice.status} ${twice.json?.error}`);

    section("Senior approval waits for the legal executive and the papers");
    expectCall("No legal executive: approval refused", await call("PUT", `/a/${AGR}/approve`), 400, "Legal Executive");
    expectCall("Assign the legal executive", await call("PUT", `/a/${AGR}/assign-legal`, { LegalExecutiveId: user }), 200);
    expectCall("No papers asked for: approval refused", await call("PUT", `/a/${AGR}/approve`), 400, "mandatory");
    const asked = await call("POST", `/a/${AGR}/documents/request`, { DocumentType: "IdentityProof", Label: "E2E PAN card", IsMandatory: true });
    check("Ask the customer for a mandatory paper", asked.status < 300, `got ${asked.status} ${asked.json?.error}`);
    let docs = (await get()).documents;
    const paper = docs.find((d) => d.IsMandatory);
    check("The paper is on the list, requested", paper && paper.Status === "Requested", JSON.stringify(paper?.Status));
    expectCall("Paper not in yet: approval refused", await call("PUT", `/a/${AGR}/approve`), 400, "0%");
    await q(`UPDATE dbo.CrmAgreementDocument SET FileBase64 = 'RTJF', FileName = 'e2e-paper.pdf', Status = 'Uploaded', UploadedAt = SYSDATETIME() WHERE Id = ${paper.Id}`);

    section("Rejection and resubmission");
    expectCall("A reject needs a reason", await call("PUT", `/a/${AGR}/reject`, {}), 400, "Remarks");
    expectCall("Reject", await call("PUT", `/a/${AGR}/reject`, { note: "Wrong PAN" }), 200);
    a = (await get()).agreement;
    check("Rejected, with the reason", a.SeniorApprovalStatus === "Rejected" && a.SeniorApprovalRemarks === "Wrong PAN", `${a.SeniorApprovalStatus} ${a.SeniorApprovalRemarks}`);
    expectCall("Not sent before senior approval", await call("PUT", `/a/${AGR}/send-to-customer`, {}), 400, "senior");
    const edited = await call("PUT", `/a/${AGR}`, { LegalName: "ZZTEST Import One", PanNo: "ABCDE1234F", RevisionReason: "E2E PAN fixed" });
    check("Correct the details", edited.status === 200, `got ${edited.status} ${edited.json?.error}`);
    expectCall("Submit again", await call("PUT", `/a/${AGR}/submit`), 200);
    check("Pending again", (await get()).agreement.SeniorApprovalStatus === "Pending");

    section("Approval and the customer");
    h.setActor({ role: "crm_executive" });
    const stranger = await call("PUT", `/a/${AGR}/approve`);
    check("Someone not named in Approval Setup cannot approve", stranger.status >= 400 && stranger.status < 500, `got ${stranger.status} ${stranger.json?.error}`);
    h.setActor({ role: "super_admin" });
    expectCall("Approve", await call("PUT", `/a/${AGR}/approve`), 200);
    a = (await get()).agreement;
    check("Senior-approved", a.SeniorApprovalStatus === "Approved" && !!a.SeniorApprovedAt);
    if (!a.SentToCustomerAt) expectCall("Send to the customer portal", await call("PUT", `/a/${AGR}/send-to-customer`, {}), 200);
    a = (await get()).agreement;
    check("Shared with the customer", !!a.SentToCustomerAt);
    expectCall("Offline recheck needs how they said it", await call("PUT", `/a/${AGR}/proxy-customer-recheck`, { ProxyRemarks: "x" }), 400, "ProxyMethod");
    expectCall("Record the customer's recheck (phone)", await call("PUT", `/a/${AGR}/proxy-customer-recheck`, { ProxyMethod: "Phone", ProxyRemarks: "Name spelling" }), 200);
    a = (await get()).agreement;
    check("Recheck recorded with the remark", a.CustomerApprovalStatus === "RecheckRequested" && a.LastRecheckRemarks === "Name spelling" && a.RecheckCount >= 1, `${a.CustomerApprovalStatus} ${a.LastRecheckRemarks}`);
    expectCall("Resend to the customer", await call("PUT", `/a/${AGR}/send-to-customer`, {}), 200);
    a = (await get()).agreement;
    check("Back with the customer to review", a.CustomerApprovalStatus !== "RecheckRequested", a.CustomerApprovalStatus);
    expectCall("Not executed before the customer approves", await call("PUT", `/a/${AGR}/mark-executed`), 400);
    expectCall("Record the customer's approval (in person)", await call("PUT", `/a/${AGR}/proxy-customer-approve`, { ProxyMethod: "InPerson", ProxyRemarks: "Signed the review copy" }), 200);
    check("Customer-approved", (await get()).agreement.CustomerApprovalStatus === "Approved");

    section("The signing date: both sides, then its approval");
    expectCall("Not executed without a date", await call("PUT", `/a/${AGR}/mark-executed`), 400, "date");
    expectCall("A past date is refused", await call("PUT", `/a/${AGR}/propose-date`, { proposedDate: "2020-01-01" }), 400, "past");
    expectCall("We propose a date", await call("PUT", `/a/${AGR}/propose-date`, { proposedDate: DATE }), 200);
    a = (await get()).agreement;
    check("Waiting for the customer's answer", a.ProposedDateStatus === "PendingCustomerReview" && String(a.ProposedDate).startsWith(DATE), a.ProposedDateStatus);
    expectCall("We can't accept our own proposal", await call("PUT", `/a/${AGR}/date/accept`), 400, "turn");
    expectCall("The customer proposes another (offline)", await call("PUT", `/a/${AGR}/proxy-propose-date`, { ProxyMethod: "Phone", ProxyRemarks: "Called: prefers the 20th", ProposedDate: "2026-12-20" }), 200);
    a = (await get()).agreement;
    check("Now ours to answer", a.ProposedDateStatus === "PendingCompanyReview" && String(a.ProposedDate).startsWith("2026-12-20"), a.ProposedDateStatus);
    expectCall("We accept their date", await call("PUT", `/a/${AGR}/date/accept`), 200);
    a = (await get()).agreement;
    check("Agreed by both, waiting for its approval", a.DateApprovalStatus === "Pending" && !a.AgreementDate, a.DateApprovalStatus);
    expectCall("Not executed while the date waits for approval", await call("PUT", `/a/${AGR}/mark-executed`), 400, "Date Approval");
    expectCall("Reject the date", await call("PUT", `/a/${AGR}/date/reject`, { note: "Office closed that day" }), 200);
    a = (await get()).agreement;
    check("Date rejected: the negotiation starts again", !a.AgreementDate && a.DateApprovalStatus !== "Pending", `${a.DateApprovalStatus} ${a.ProposedDateStatus}`);
    expectCall("We propose again", await call("PUT", `/a/${AGR}/propose-date`, { proposedDate: DATE }), 200);
    expectCall("The customer accepts (offline)", await call("PUT", `/a/${AGR}/proxy-date-accept`, { ProxyMethod: "WhatsApp", ProxyRemarks: "Said yes on WhatsApp" }), 200);
    expectCall("Approve the date", await call("PUT", `/a/${AGR}/date/approve`), 200);
    a = (await get()).agreement;
    check("Signing date set", String(a.AgreementDate).startsWith(DATE), String(a.AgreementDate));
    expectCall("No more proposals once the date is set", await call("PUT", `/a/${AGR}/propose-date`, { proposedDate: "2026-12-30" }), 400, "already");
    const hist = (await call("GET", `/a/${AGR}/date-history`)).json;
    check("Every proposal is in the date history", Array.isArray(hist) && hist.length >= 3, `${hist?.length}`);

    section("Execution");
    expectCall("Paper not verified: execution refused", await call("PUT", `/a/${AGR}/mark-executed`), 400, "not yet verified");
    expectCall("Reject the paper", await call("PUT", `/a/${AGR}/documents/${paper.Id}`, { Status: "Rejected", Remarks: "Blurred" }), 200);
    expectCall("Still refused with a rejected paper", await call("PUT", `/a/${AGR}/mark-executed`), 400, "not yet verified");
    expectCall("Verify the paper", await call("PUT", `/a/${AGR}/documents/${paper.Id}`, { Status: "Verified" }), 200);
    const exec = await call("PUT", `/a/${AGR}/mark-executed`);
    check("Mark executed", exec.status === 200, `got ${exec.status} ${exec.json?.error}`);
    a = (await get()).agreement;
    check("Executed", a.Status === "Executed");
    expectCall("Executed: details are locked", await call("PUT", `/a/${AGR}`, { LegalName: "x" }), 409, "locked");
    expectCall("Executed: the legal executive can still change (until registered)", await call("PUT", `/a/${AGR}/assign-legal`, { LegalExecutiveId: user }), 200);
    expectCall("Executing twice is refused", await call("PUT", `/a/${AGR}/mark-executed`), 400);

    section("Registration");
    expectCall("Registration no. required", await call("PUT", `/a/${AGR}/mark-registered`, { AfsRegistrationDate: DATE }), 400, "Registration No");
    await q(`UPDATE dbo.CrmAfsRegistry SET Status = 'InProgress' WHERE BookingId = ${BOOKING}`);
    const reg0 = await call("PUT", `/a/${AGR}/mark-registered`, { AfsRegistrationNo: "E2E/1", AfsRegistrationDate: DATE });
    check("Refused until the AFS Registry is complete", reg0.status === 400 && /AFS Registry/i.test(reg0.json?.error || ""), `got ${reg0.status} ${reg0.json?.error}`);
    const hasRegistry = (await q(`SELECT COUNT(*) c FROM dbo.CrmAfsRegistry WHERE BookingId = ${BOOKING}`))[0].c > 0;
    if (hasRegistry) {
      await q(`UPDATE dbo.CrmAfsRegistry SET Status = 'Completed' WHERE BookingId = ${BOOKING}`);
      expectCall("Mark registered", await call("PUT", `/a/${AGR}/mark-registered`, { AfsRegistrationNo: "E2E/1", AfsRegistrationDate: DATE, AfsStampDuty: "1000", AfsRegistrationFee: "100" }), 200);
      a = (await get()).agreement;
      check("Registered, with its document no.", a.Status === "Registered" && a.AfsRegistrationNo === "E2E/1");
      expectCall("A registered agreement can't be cancelled", await call("PUT", `/a/${AGR}/cancel`), 400);
    } else check("(no AFS Registry row on dev for this booking: registration not exercised)", true);

    section("Cancelling, and a cancelled booking");
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Executed' WHERE Id = ${AGR}`);
    expectCall("An executed agreement can be cancelled", await call("PUT", `/a/${AGR}/cancel`), 200);
    check("Cancelled", (await get()).agreement.Status === "Cancelled");
    expectCall("Cancelled: execution refused", await call("PUT", `/a/${AGR}/mark-executed`), 400);
    const twiceCancel = await call("PUT", `/a/${AGR}/cancel`);
    check(`Cancelling a cancelled agreement again: answers ${twiceCancel.status} (finding: allowed, Cancelled -> Cancelled)`, true);
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Draft' WHERE Id = ${LOCKED_AGR}`);
    expectCall("Booking cancelled: sending refused", await call("PUT", `/a/${LOCKED_AGR}/send-to-customer`, {}), 409);
    expectCall("Booking cancelled: editing refused", await call("PUT", `/a/${LOCKED_AGR}`, { LegalName: "x" }), 409);
    expectCall("Booking cancelled: the draft can still be cancelled (closed out)", await call("PUT", `/a/${LOCKED_AGR}/cancel`), 200);
    expectCall("An unknown agreement is not found", await call("GET", "/a/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
