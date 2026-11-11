// End-to-end test of NOC: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST bookings
// BKG-2026-00133 (loan-financed: a bank NOC) and BKG-2026-00126 (its NOC already issued), inside one transaction that is
// rolled back.   node scripts/e2eNoc.js
const { openHarness } = require("./e2eHarness");

const BANK_BOOKING = 213;   // BKG-2026-00133, ZZTEST, loan-financed, agreement executed (registered inside the test)
const ISSUED_BOOKING = 206; // BKG-2026-00126, ZZTEST, its developer NOC issued
const CANCELLED_BOOKING = 210; // BKG-2026-00130, ZZTEST, cancelled, agreement registered
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmNoc) N, (SELECT COUNT(*) FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmNoc') A,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status), ',') FROM dbo.CrmNoc) S`;

(async () => {
  const h = await openHarness({ mounts: { "/n": "crmNoc" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user });

    section("Who may request");
    expectCall("Agreement not registered: refused", await call("POST", "/n", { BookingId: BANK_BOOKING }), 400, "registered");
    check("Not offered while the agreement is only executed", !(await call("GET", "/n/eligible-bookings")).json.some((b) => b.Id === BANK_BOOKING));
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Registered' WHERE BookingId = ${BANK_BOOKING}`);
    const offered = (await call("GET", "/n/eligible-bookings")).json.find((b) => b.Id === BANK_BOOKING);
    check("Offered once registered, as a bank NOC (loan-financed)", offered?.NocType === "Bank", JSON.stringify(offered));
    expectCall("A booking whose NOC is issued: a second is refused", await call("POST", "/n", { BookingId: ISSUED_BOOKING }), 409);
    expectCall("A cancelled booking is refused", await call("POST", "/n", { BookingId: CANCELLED_BOOKING }), 400);
    expectCall("A booking is required", await call("POST", "/n", {}), 400);
    expectCall("The type is the booking's, not the request's", await call("POST", "/n", { BookingId: BANK_BOOKING, NocType: "Organisation" }), 400, "Bank");
    const ctx = (await call("GET", `/n/booking/${BANK_BOOKING}/context`)).json;
    check("The request form's context answers", ctx?.booking?.Id === BANK_BOOKING && ctx?.agreement?.Status === "Registered");

    section("Request");
    const made = await call("POST", "/n", { BookingId: BANK_BOOKING, NocType: "Bank", NocDate: "2026-11-11", BankName: "E2E Bank", LoanAccountNo: "E2E-LN-1", LoanAmount: "2500000", Reason: "Loan disbursement" });
    check("Request the bank NOC", made.status === 201 && !!made.json?.NocNo, `got ${made.status} ${made.json?.error}`);
    const id = made.json.id;
    let n = (await call("GET", `/n/${id}`)).json;
    check("Pending, with the request's details", n.Status === "Pending" && n.NocType === "Bank" && n.BankName === "E2E Bank" && Number(n.LoanAmount) === 2500000 && String(n.NocDate).startsWith("2026-11-11"));
    check("The record carries its agreement", n.AgreementStatus === "Registered" && !!n.AgreementNo);
    expectCall("Requesting it twice is refused", await call("POST", "/n", { BookingId: BANK_BOOKING }), 409);
    check("No longer offered", !(await call("GET", "/n/eligible-bookings")).json.some((b) => b.Id === BANK_BOOKING));
    check("Found from its booking", (await call("GET", `/n/by-booking?bookingId=${BANK_BOOKING}`)).json?.Id === id);
    const list = (await call("GET", "/n?page=1&pageSize=25&status=Pending")).json;
    check("Listed under Awaiting approval, counted", list.rows.some((r) => r.Id === id) && list.statusCounts.Pending >= 1 && list.typeCounts.Bank >= 1);
    expectCall("Not issued before approval", await call("PUT", `/n/${id}/mark-issued`), 400, "Approved");
    expectCall("Notes can be saved", await call("PUT", `/n/${id}`, { Notes: "E2E note" }), 200);
    check("Notes kept", (await call("GET", `/n/${id}`)).json.Notes === "E2E note");

    section("Rejection and resubmission");
    h.setActor({ role: "crm_executive" });
    const stranger = await call("PUT", `/n/${id}/approve`);
    check("Someone not named in Approval Setup cannot approve", stranger.status === 403, `got ${stranger.status} ${stranger.json?.error}`);
    h.setActor({ role: "super_admin" });
    expectCall("Reject", await call("PUT", `/n/${id}/reject`, { note: "Wrong loan account", Remarks: "Wrong loan account" }), 200);
    check("Rejected", (await call("GET", `/n/${id}`)).json.Status === "Rejected");
    check("A rejected NOC frees the booking to request again", (await call("GET", "/n/eligible-bookings")).json.some((b) => b.Id === BANK_BOOKING));
    expectCall("Send it again", await call("PUT", `/n/${id}/submit`), 200);
    check("Pending again", (await call("GET", `/n/${id}`)).json.Status === "Pending");

    section("Approval and issue");
    expectCall("Approve", await call("PUT", `/n/${id}/approve`), 200);
    n = (await call("GET", `/n/${id}`)).json;
    check("Approved, approval date set", n.Status === "Approved" && !!n.ApprovalDate);
    expectCall("Mark issued", await call("PUT", `/n/${id}/mark-issued`), 200);
    n = (await call("GET", `/n/${id}`)).json;
    check("Issued, issue date set", n.Status === "Issued" && !!n.IssuedDate);
    expectCall("Issuing twice is refused", await call("PUT", `/n/${id}/mark-issued`), 400);
    const trail = await q(`SELECT COUNT(*) AS c FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmNoc' AND RecordId = ${id}`);
    check("The approval trail records each step", trail[0].c >= 3, `${trail[0].c} entries`);

    section("A rejected NOC, a new one requested, then the old one sent again");
    await q(`UPDATE dbo.CrmNoc SET Status = 'Rejected' WHERE Id = ${id}`);
    const second = await call("POST", "/n", { BookingId: BANK_BOOKING, NocType: "Bank", NocDate: "2026-11-11" });
    check("A new NOC may be requested after a rejection", second.status === 201, `got ${second.status} ${second.json?.error}`);
    const again = await call("PUT", `/n/${id}/submit`);
    check("Sending the old one again is refused (one live NOC per booking)", again.status >= 400, `got ${again.status} ${again.json?.error}`);
    check("  ...with a message a person understands", !/UNIQUE|duplicate key|constraint/i.test(again.json?.error || ""), again.json?.error);

    section("A cancelled booking locks its NOC");
    await q(`UPDATE dbo.CrmBooking SET Status = 'Cancelled' WHERE Id = ${BANK_BOOKING}`);
    expectCall("Approve refused", await call("PUT", `/n/${second.json.id}/approve`), 400);
    expectCall("Notes refused", await call("PUT", `/n/${second.json.id}`, { Notes: "x" }), 400);
    expectCall("An unknown NOC is not found", await call("GET", "/n/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
