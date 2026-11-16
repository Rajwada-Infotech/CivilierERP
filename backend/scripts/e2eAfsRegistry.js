// End-to-end test of the Agreement for Sale registration: its registration fees (AFS Query Payment), the Sub-Registrar
// visit (AFS Registry), marking the Agreement registered, and the buyer's portal view of an agreement on a cancelled
// booking. Real routes and real SQL on the DEVELOPMENT database through scripts/e2eHarness.js, inside one transaction
// that is rolled back. Runs on the ZZTEST booking BKG-2026-00133 (its existing AFS rows are cleared inside the test).
//   node scripts/e2eAfsRegistry.js
const { openHarness } = require("./e2eHarness");

const BOOKING = 213;          // BKG-2026-00133, ZZTEST, Agreement Executed
const CANCELLED_BOOKING = 210; // BKG-2026-00130, ZZTEST, booking Cancelled, its Agreement Registered
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmAfsQueryPayment) Q, (SELECT COUNT(*) FROM dbo.CrmAfsRegistry) R,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status), ',') FROM dbo.CrmAgreement WHERE BookingId IN (${213}, ${210})) A`;

(async () => {
  const h = await openHarness({ mounts: { "/aqp": "crmAfsQueryPayment", "/areg": "crmAfsRegistry", "/ag": "crmAgreements", "/p": "crmPortal" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin", email: "e2e@civilier.test", name: "E2E" });
    const ag = (await q(`SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WHERE BookingId = ${BOOKING} ORDER BY CreatedAt DESC`))[0];
    check("The test booking has an Agreement for Sale", !!ag, JSON.stringify(ag));
    // A clean start: no registration fees or registry on the booking yet, the Agreement executed, the booking live.
    await q(`DELETE x FROM dbo.CrmAfsQueryPaymentAttachments x JOIN dbo.CrmAfsQueryPayment p ON p.Id = x.AfsQueryPaymentId WHERE p.BookingId = ${BOOKING}`);
    await q(`DELETE FROM dbo.CrmAfsQueryPayment WHERE BookingId = ${BOOKING}`);
    await q(`DELETE FROM dbo.CrmAfsRegistry WHERE BookingId = ${BOOKING}`);
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Executed', AfsRegistrationNo = NULL, AfsRegistrationDate = NULL WHERE Id = ${ag.Id}`);
    await q(`UPDATE dbo.CrmBooking SET Status = 'Approved', IsActive = 1, IsFrozen = 0, FreezeReason = NULL, FreezeExpiresAt = NULL WHERE Id = ${BOOKING}`);
    const aqpOf = async () => (await q(`SELECT * FROM dbo.CrmAfsQueryPayment WHERE BookingId = ${BOOKING}`))[0];
    const regOf = async () => (await q(`SELECT * FROM dbo.CrmAfsRegistry WHERE BookingId = ${BOOKING}`))[0];
    const proof = { fileName: "challan.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 E2E").toString("base64") };

    section("Registration fees: starting them");
    expectCall("A booking id is required", await call("POST", "/aqp", {}), 400, "BookingId");
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Draft' WHERE Id = ${ag.Id}`);
    expectCall("Not before the Agreement is executed", await call("POST", "/aqp", { BookingId: BOOKING }), 400, "executed");
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Executed' WHERE Id = ${ag.Id}`);
    expectCall("An amount with a comma is refused", await call("POST", "/aqp", { BookingId: BOOKING, StampDuty: "12,000" }), 400, "Stamp Duty");
    expectCall("A negative amount is refused", await call("POST", "/aqp", { BookingId: BOOKING, RegistrationFee: "-5" }), 400, "Registration Fee");
    await q(`UPDATE dbo.CrmBooking SET IsFrozen = 1, FreezeReason = 'E2E freeze', FreezeExpiresAt = DATEADD(DAY, 1, SYSDATETIME()) WHERE Id = ${BOOKING}`);
    expectCall("Not on a frozen booking", await call("POST", "/aqp", { BookingId: BOOKING }), 400, "frozen");
    // A freeze that has run out no longer stops anything, and is cleared (the shared approved-booking rule).
    await q(`UPDATE dbo.CrmBooking SET FreezeExpiresAt = DATEADD(DAY, -1, SYSDATETIME()) WHERE Id = ${BOOKING}`);
    const made = await call("POST", "/aqp", { BookingId: BOOKING, StampDuty: 30000, RegistrationFee: "1000" });
    check("Started, numbered, Pending", made.status === 201 && /^AQP-/.test(made.json?.AfsQPNo || "") && (await aqpOf())?.Status === "Pending", `${made.status} ${JSON.stringify(made.json)}`);
    check("The expired freeze was cleared", (await q(`SELECT IsFrozen FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0].IsFrozen === false);
    expectCall("Only one per booking", await call("POST", "/aqp", { BookingId: BOOKING }), 409, "already started");
    const aqpId = made.json.id;

    section("Registration fees: amounts, details to the customer, payment");
    expectCall("Correct the stamp duty", await call("PUT", `/aqp/${aqpId}`, { StampDuty: 35000 }), 200);
    check("Saved", Number((await aqpOf()).StampDuty) === 35000);
    expectCall("A wrong amount is refused when editing", await call("PUT", `/aqp/${aqpId}`, { StampDuty: "35000.555" }), 400, "2 decimal");
    expectCall("Payment can't be confirmed before the details are sent", await call("POST", `/aqp/${aqpId}/confirm`, { proof, ConfirmedAmount: 36000 }), 400, "InfoSent");
    expectCall("Sending details needs a file", await call("POST", `/aqp/${aqpId}/info`, { files: [] }), 400, "file");
    expectCall("Send the details to the customer", await call("POST", `/aqp/${aqpId}/info`, { files: [proof] }), 200);
    check("Now InfoSent", (await aqpOf()).Status === "InfoSent");
    expectCall("Amounts can't change once sent", await call("PUT", `/aqp/${aqpId}`, { StampDuty: 1 }), 400, "no longer be edited");
    expectCall("Confirming needs the payment proof", await call("POST", `/aqp/${aqpId}/confirm`, { ConfirmedAmount: 36000 }), 400, "proof");
    expectCall("Confirm the payment", await call("POST", `/aqp/${aqpId}/confirm`, { proof, ConfirmedAmount: 36000 }), 200);
    const paid = await aqpOf();
    check("Confirmed with the amount paid", paid.Status === "Confirmed" && Number(paid.ConfirmedAmount) === 36000, JSON.stringify({ s: paid.Status, a: paid.ConfirmedAmount }));
    expectCall("It can't be confirmed twice", await call("POST", `/aqp/${aqpId}/confirm`, { proof, ConfirmedAmount: 36000 }), 400, "Already confirmed");

    section("Agreement Registry: the Sub-Registrar visit");
    const elig = (await call("GET", "/areg/eligible-bookings")).json;
    check("The booking is offered for the registry", Array.isArray(elig) && elig.some((x) => Number(x.Id ?? x.BookingId) === BOOKING), JSON.stringify(elig?.slice?.(0, 3)));
    const reg = await call("POST", "/areg", { BookingId: BOOKING });
    check("Registry started, Pending, linked to the Agreement", reg.status === 201 && (await regOf())?.Status === "Pending" && (await regOf())?.AgreementId === ag.Id, `${reg.status} ${JSON.stringify(reg.json)}`);
    expectCall("Only one registry per booking", await call("POST", "/areg", { BookingId: BOOKING }), 409, "already started");
    const regId = reg.json.id;
    expectCall("It can't be completed before the appointment is set", await call("PUT", `/areg/${regId}/complete`, {}), 400, "Schedule");
    expectCall("The Agreement can't be marked registered before the registry is complete",
      await call("PUT", `/ag/${ag.Id}/mark-registered`, { AfsRegistrationNo: "E2E-REG-1", AfsRegistrationDate: "2026-12-01" }), 400, "Complete the Agreement Registry");
    expectCall("Set the appointment", await call("PUT", `/areg/${regId}/schedule`, { ScheduledDate: "2026-12-01" }), 200);
    expectCall("Move the appointment", await call("PUT", `/areg/${regId}/schedule`, { ScheduledDate: "2026-12-03", Remarks: "E2E moved" }), 200);
    check("Scheduled for the new date", (await regOf()).Status === "Scheduled" && String((await regOf()).ScheduledDate).includes("2026"));
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Cancelled' WHERE Id = ${ag.Id}`);
    expectCall("A cancelled Agreement's registry can't be completed", await call("PUT", `/areg/${regId}/complete`, {}), 409, "cancelled");
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Executed' WHERE Id = ${ag.Id}`);
    expectCall("Complete the registry", await call("PUT", `/areg/${regId}/complete`, { CompletedDate: "2026-12-03" }), 200);
    check("Completed", (await regOf()).Status === "Completed");
    expectCall("A completed registry can't be rescheduled", await call("PUT", `/areg/${regId}/schedule`, { ScheduledDate: "2026-12-10" }), 409, "Completed");
    expectCall("Marking registered needs the registration no.", await call("PUT", `/ag/${ag.Id}/mark-registered`, { AfsRegistrationDate: "2026-12-03" }), 400, "registration no");
    expectCall("Mark the Agreement registered", await call("PUT", `/ag/${ag.Id}/mark-registered`, { AfsRegistrationNo: "E2E-REG-1", AfsRegistrationDate: "2026-12-03" }), 200);
    const agNow = (await q(`SELECT Status, AfsRegistrationNo FROM dbo.CrmAgreement WHERE Id = ${ag.Id}`))[0];
    check("The Agreement is Registered with its no.", agNow.Status === "Registered" && agNow.AfsRegistrationNo === "E2E-REG-1", JSON.stringify(agNow));
    const cancelReg = await call("PUT", `/ag/${ag.Id}/cancel`, { Reason: "E2E" });
    check("A registered Agreement can't be cancelled", cancelReg.status >= 400 && cancelReg.status < 500, `${cancelReg.status} ${cancelReg.json?.error}`);

    section("Starting a registry needs a live Agreement");
    await q(`DELETE FROM dbo.CrmAfsRegistry WHERE BookingId = ${BOOKING}`);
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Cancelled' WHERE BookingId = ${BOOKING}`);
    expectCall("No registry for a cancelled Agreement", await call("POST", "/areg", { BookingId: BOOKING }), 400, "active Agreement");
    check("And the booking is not offered for one", !((await call("GET", "/areg/eligible-bookings")).json || []).some((x) => Number(x.Id ?? x.BookingId) === BOOKING));

    section("Portal: the buyer still sees the agreement of a cancelled booking (as before)");
    {
      const cb = (await q(`SELECT b.ApplicationId, b.Status, a.CustomerId FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = ${CANCELLED_BOOKING}`))[0];
      const cag = (await q(`SELECT TOP 1 Id FROM dbo.CrmAgreement WHERE BookingId = ${CANCELLED_BOOKING} ORDER BY CreatedAt DESC`))[0];
      await q(`UPDATE dbo.CrmAgreement SET SentToCustomerAt = ISNULL(SentToCustomerAt, SYSDATETIME()) WHERE Id = ${cag.Id}`);
      await q(`INSERT INTO dbo.CrmAgreementDocument (AgreementId, DocumentType, Status, FileName, FileBase64, MimeType, CreatedAt)
        VALUES (${cag.Id}, 'SaleAgreement', 'Submitted', 'e2e.pdf', '${proof.base64}', 'application/pdf', SYSDATETIME())`);
      const pu = (await q("SELECT TOP 1 Id FROM dbo.CrmCustomerPortalUser WHERE IsActive = 1 ORDER BY Id"))[0];
      h.setPortal({ portalUserId: pu.Id, customerId: cb.CustomerId });
      const P = `applicationId=${cb.ApplicationId}`;
      check("The test booking is cancelled", cb.Status === "Cancelled", cb.Status);
      const view = await call("GET", `/p/agreement?${P}`);
      check("The buyer sees the agreement", view.status === 200 && view.json && Number(view.json.Id) === cag.Id, `${view.status} ${JSON.stringify(view.json)?.slice(0, 120)}`);
      const docs = await call("GET", `/p/agreement/documents?${P}`);
      check("And its documents", docs.status === 200 && Array.isArray(docs.json) && docs.json.length > 0, `${docs.status} ${docs.json?.length}`);
      const doc = await q(`SELECT TOP 1 Id FROM dbo.CrmAgreementDocument WHERE AgreementId = ${cag.Id} AND FileBase64 IS NOT NULL ORDER BY Id DESC`);
      const file = await call("GET", `/p/agreement/documents/file/${doc[0].Id}?${P}`);
      check("And can open the file", file.status === 200, `${file.status}`);
    }
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
