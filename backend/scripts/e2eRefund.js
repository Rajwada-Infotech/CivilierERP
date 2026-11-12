// End-to-end test of CRM Refunds: the real routes and real SQL on the DEVELOPMENT database, on a ZZTEST customer's
// overpayment, inside one transaction that is rolled back.   node scripts/e2eRefund.js
const { openHarness } = require("./e2eHarness");

const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmRefund) R, (SELECT COUNT(*) FROM dbo.NewPayment) P,
  (SELECT COUNT(*) FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmRefund') A,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status, ':', ISNULL(PreferredPaymentMode, '')), ',') FROM dbo.CrmRefund) S`;

(async () => {
  const h = await openHarness({ mounts: { "/r": "crmRefunds" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin" });

    section("Payment modes come from the server");
    const modes = (await call("GET", "/r/payment-modes")).json;
    check("Modes and the transfer modes", Array.isArray(modes?.modes) && modes.modes.includes("Cheque") && modes.transfer.includes("NEFT") && !modes.transfer.includes("Cheque"), JSON.stringify(modes));

    section("Raise");
    const sources = (await call("GET", "/r/eligible-sources")).json;
    const src = sources.find((x) => /zztest/i.test(x.CustomerName || "") && x.SourceType === "OverpaymentOnAccount" && Number(x.Remaining) >= 10) || sources.find((x) => Number(x.Remaining) >= 10);
    check("A ZZTEST overpayment to refund", !!src, `${sources.length} sources`);
    if (!src) throw new Error("no source on dev");
    const made = await call("POST", "/r", { GrossAmount: 10, Reason: "E2E", PreferredPaymentMode: "NEFT", SourceType: src.SourceType, SourceOnAccountId: src.OnAccountId });
    check("Raise a 10 rupee NEFT refund with no customer account", made.status < 300 && !!made.json?.RefundNo, `got ${made.status} ${made.json?.error}`);
    const id = made.json.Id ?? made.json.id;
    let r = (await call("GET", `/r/${id}`)).json;
    check("It starts as sent for approval or a draft", ["Pending", "Draft"].includes(r.Status), r.Status);
    check("Flagged: an NEFT refund without the customer's account", r.NeedsAccount === 1);
    if (r.Status === "Draft") expectCall("Send for approval", await call("PUT", `/r/${id}/submit`), 200);

    section("The dead end that used to exist: NEFT with no account");
    expectCall("Approval refuses it, naming the fix", await call("PUT", `/r/${id}/approve`), 400, "bank account");
    expectCall("While pending, the account can be added", await call("PUT", `/r/${id}`, { Reason: "E2E", CustomerBankName: "E2E Bank", CustomerAccountNo: "123456789", CustomerIfscCode: "SBIN0000001" }), 200);
    r = (await call("GET", `/r/${id}`)).json;
    check("Account saved, flag cleared", r.CustomerAccountNo === "123456789" && r.NeedsAccount === 0);

    section("Rejection, correction, sending again");
    expectCall("Reject", await call("PUT", `/r/${id}/reject`, { note: "Wrong mode" }), 200);
    r = (await call("GET", `/r/${id}`)).json;
    check("Rejected", r.Status === "Rejected", r.Status);
    expectCall("A rejected refund can now be corrected (mode to Cheque)", await call("PUT", `/r/${id}`, { Reason: "E2E corrected", PreferredPaymentMode: "Cheque" }), 200);
    r = (await call("GET", `/r/${id}`)).json;
    check("Corrected: Cheque, reason kept, still rejected until sent", r.PreferredPaymentMode === "Cheque" && r.Reason === "E2E corrected" && r.Status === "Rejected");
    expectCall("An unknown mode is refused", await call("PUT", `/r/${id}`, { Reason: "x", PreferredPaymentMode: "Cash" }), 400, "PaymentMode");
    expectCall("Send it again", await call("PUT", `/r/${id}/submit`), 200);
    check("Pending again", (await call("GET", `/r/${id}`)).json.Status === "Pending");

    section("Finance sends back, CRM approves again");
    await q(`UPDATE dbo.CrmRefund SET Status = 'FinancePending' WHERE Id = ${id}`);
    expectCall("Finance sends it back", await call("PUT", `/r/${id}/finance-reject`, { note: "Wrong bank" }), 200);
    r = (await call("GET", `/r/${id}`)).json;
    check("Back with CRM, with Finance's note", r.Status === "Pending" && /Wrong bank/.test(r.RejectionNote || ""), `${r.Status} ${r.RejectionNote}`);

    section("Approval raises the payout voucher");
    h.setActor({ role: "crm_executive" });
    const stranger = await call("PUT", `/r/${id}/approve`);
    check("Someone not named in Approval Setup cannot approve", stranger.status >= 400 && stranger.status < 500, `got ${stranger.status} ${stranger.json?.error}`);
    h.setActor({ role: "super_admin" });
    const ok = await call("PUT", `/r/${id}/approve`);
    check("Approve", ok.status === 200 || ok.status === 202, `got ${ok.status} ${ok.json?.error || ok.json?.warning}`);
    r = (await call("GET", `/r/${id}`)).json;
    check("With Finance (voucher raised) or kept for Finance with the reason", (r.Status === "FinanceApproved" && r.FinanceNewPaymentId != null) || (r.Status === "FinancePending" && !!r.RejectionNote), `${r.Status} ${r.RejectionNote}`);
    expectCall("No more edits after approval", await call("PUT", `/r/${id}`, { Reason: "x" }), 400, "already");
    if (r.Status === "FinanceApproved") expectCall("A second voucher is refused", await call("PUT", `/r/${id}/finance-approve`, {}), 400);

    section("Withdraw: only before approval, with a reason, and the money is free again");
    expectCall("An approved refund can't be withdrawn", await call("PUT", `/r/${id}/withdraw`, { reason: "x" }), 409, "before approval");
    const remainingNow = async () => Number((await call("GET", "/r/eligible-sources")).json.find((x) => x.OnAccountId === src.OnAccountId)?.Remaining || 0);
    const before = await remainingNow();
    const w = await call("POST", "/r", { GrossAmount: 5, Reason: "E2E withdraw", SourceType: src.SourceType, SourceOnAccountId: src.OnAccountId });
    check("Raise a second refund of 5", w.status < 300, `got ${w.status} ${w.json?.error}`);
    const wid = w.json.Id ?? w.json.id;
    check("It holds 5 of the money", Math.abs((await remainingNow()) - (before - 5)) < 0.01, `${before} -> ${await remainingNow()}`);
    expectCall("A reason is required", await call("PUT", `/r/${wid}/withdraw`, { reason: "  " }), 400, "reason");
    expectCall("Withdraw it", await call("PUT", `/r/${wid}/withdraw`, { reason: "Customer moved the credit to a new booking" }), 200);
    let wr = (await call("GET", `/r/${wid}`)).json;
    check("Withdrawn, with the reason kept", wr.Status === "Withdrawn" && /moved the credit/.test(wr.RejectionNote || ""), `${wr.Status} ${wr.RejectionNote}`);
    check("Its money is free again", Math.abs((await remainingNow()) - before) < 0.01, `${before} vs ${await remainingNow()}`);
    check("Not counted as overdue", wr.IsOverdue === 0 && wr.DaysRemaining == null);
    const audit = await q(`SELECT ActionStatus, Note FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmRefund' AND RecordId = ${wid} AND ActionStatus = 'Withdrawn'`);
    check("In its approval history", audit.length === 1 && /moved the credit/.test(audit[0].Note));
    expectCall("Final: can't be sent again", await call("PUT", `/r/${wid}/submit`), 400);
    expectCall("Final: can't be edited", await call("PUT", `/r/${wid}`, { Reason: "x" }), 400);
    expectCall("Final: can't be withdrawn twice", await call("PUT", `/r/${wid}/withdraw`, { reason: "again" }), 409, "already");
    const approveWithdrawn = await call("PUT", `/r/${wid}/approve`);
    check("Final: can't be approved", approveWithdrawn.status >= 400, `got ${approveWithdrawn.status}`);
    check("Under the Withdrawn tab", (await call("GET", "/r?page=1&pageSize=25&status=Withdrawn")).json.rows.some((x) => x.Id === wid));
    check("Out of the Approval Inbox's Pending list", !(await q(`SELECT 1 x FROM dbo.CrmRefund WHERE Id = ${wid} AND Status = 'Pending'`)).length);
    const third = await call("POST", "/r", { GrossAmount: 5, Reason: "E2E rejected then withdrawn", SourceType: src.SourceType, SourceOnAccountId: src.OnAccountId });
    const tid = third.json.Id ?? third.json.id;
    if ((await call("GET", `/r/${tid}`)).json.Status === "Draft") await call("PUT", `/r/${tid}/submit`);
    expectCall("Reject a third one", await call("PUT", `/r/${tid}/reject`, { note: "No" }), 200);
    expectCall("A rejected refund can be withdrawn too", await call("PUT", `/r/${tid}/withdraw`, { reason: "Not needed" }), 200);

    section("Re-booking credits: made, then visible and followed up");
    // Dev has no held credit: park one on the ZZTEST cancelled booking BKG-2026-00130 (inside the rolled-back transaction).
    if (!sources.some((x) => x.SourceType === "CancellationHeldCredit")) await q("INSERT INTO dbo.CrmOnAccountPayment (BookingId, Amount, Status) VALUES (210, 100, 'Held')");
    const held = (await call("GET", "/r/eligible-sources")).json.find((x) => x.SourceType === "CancellationHeldCredit" && Number(x.Remaining) >= 1);
    const target = held && (await q(`SELECT TOP 1 b.Id FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE a.CustomerId = ${held.CustomerId} AND b.Id <> ${held.BookingId} AND b.IsActive = 1 AND b.Status NOT IN ('Cancelled', 'Rejected', 'Expired', 'Transferred')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmCancellation c WHERE c.BookingId = b.Id AND c.Status NOT IN ('Rejected', 'Cancelled'))
      ORDER BY CASE WHEN b.CompanyId = (SELECT CompanyId FROM dbo.CrmBooking WHERE Id = ${held.BookingId}) THEN 0 ELSE 1 END, b.Id`))[0];
    if (held && target) {
      const mv = await call("POST", "/r/rebooking-transfer", { heldOnAccountId: held.OnAccountId, toBookingId: target.Id, amount: 1 });
      let rtId = mv.json?.id;
      if (mv.status === 400 && /tagged company bank/.test(mv.json?.error || "")) {
        // The only other booking is under another company and dev has no tagged company bank: the server rightly refuses.
        check("Cross-company move refused until both projects have a tagged company bank", true);
        rtId = (await q(`INSERT INTO dbo.CrmRebookingTransfer (HeldOnAccountId, ToBookingId, Amount, IsCrossCompany, Status) OUTPUT INSERTED.Id VALUES (${held.OnAccountId}, ${target.Id}, 1, 1, 'PendingTransfer')`))[0].Id;
      } else check("Move 1 rupee of held credit to the customer's other booking", mv.status < 300, `got ${mv.status} ${mv.json?.error}`);
      const listed = (await call("GET", "/r/rebooking-transfers")).json.find((t) => t.Id === rtId);
      check("Listed under re-booking credits, with its customer and both bookings", !!listed && !!listed.FromBookingNo && !!listed.CustomerName && listed.ToBookingId === target.Id && Number(listed.Amount) === 1, JSON.stringify(listed));
      if (listed?.Status === "Applied") expectCall("Its ledger can be checked again (safe to repeat)", await call("PUT", `/r/rebooking-transfer/${listed.Id}/retry-ledger`), 200);
      else check("Shown as waiting on its fund transfer", listed?.Status === "PendingTransfer");
      check("Searchable by booking", (await call("GET", `/r/rebooking-transfers?search=${encodeURIComponent(listed?.ToBookingNo || "x")}`)).json.some((t) => t.Id === rtId));
    } else check("(dev has no held credit with another booking of the same customer: re-booking not exercised)", true);
    check("The re-booking list answers", (await call("GET", "/r/rebooking-transfers")).status === 200);

    section("List");
    const list = (await call("GET", "/r?page=1&pageSize=25")).json;
    check("Listed, with the account flag on every row", list.rows.some((x) => x.Id === id) && list.rows.every((x) => "NeedsAccount" in x));
    expectCall("An unknown refund is not found", await call("GET", "/r/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
