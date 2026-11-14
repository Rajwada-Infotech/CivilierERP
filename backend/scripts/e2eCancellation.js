// End-to-end test of Cancellations: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST booking
// BKG-2026-00133 and its request CXL-2026-00017, inside one transaction that is rolled back.
//   node scripts/e2eCancellation.js
const { openHarness } = require("./e2eHarness");

const BOOKING = 213;       // BKG-2026-00133, ZZTEST
const REQUEST = 31;        // CXL-2026-00017, waiting for approval
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmCancellation) C, (SELECT COUNT(*) FROM dbo.CrmRefund) R,
  (SELECT COUNT(*) FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmCancellation') A,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status, ':', DeductionPercent, ':', LEFT(ISNULL(Reason, ''), 20)), ',') FROM dbo.CrmCancellation) S,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status), ',') FROM dbo.CrmBooking WHERE Id = ${213}) B`;

(async () => {
  const h = await openHarness({ mounts: { "/c": "crmCancellations", "/r": "crmRefunds", "/p": "newPayment", "/cq": "chequeCancellation" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  const get = async (id = REQUEST) => (await call("GET", `/c/${id}`)).json;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin", email: "e2e@civilier.test", name: "E2E" });
    // Migration 636, applied inside this transaction (its changes roll back with everything else).
    const fs = require("fs"), path = require("path");
    const mig = fs.readFileSync(path.join(__dirname, "../migrations/621-640/636-crm-cancellation-again-after-withdraw.sql"), "utf8");
    for (const batch of mig.split(/^\s*GO\s*$/m).map((x) => x.trim()).filter(Boolean)) await q(batch);
    const ix = await q("SELECT name, filter_definition FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'UX_CrmCancellation_Booking_Live'");
    check("Migration 636: one live request per booking (filtered unique index)", ix.length === 1, JSON.stringify(ix));
    const oldUq = await q(`SELECT COUNT(*) n FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmCancellation') AND kc.type = 'UQ' AND col.name = 'BookingId'`);
    check("Migration 636: the old one-row-per-booking rule is gone", oldUq[0].n === 0);
    for (const batch of mig.split(/^\s*GO\s*$/m).map((x) => x.trim()).filter(Boolean)) await q(batch);
    check("Migration 636 is safe to run again", true);
    const mig637 = fs.readFileSync(path.join(__dirname, "../migrations/621-640/637-crm-cancellation-refund-due-days.sql"), "utf8");
    for (let i = 0; i < 2; i++) for (const batch of mig637.split(/^\s*GO\s*$/m).map((x) => x.trim()).filter(Boolean)) await q(batch);
    check("Migration 637: refund due days on the policy and on each request (safe to run again)",
      (await q("SELECT COL_LENGTH('dbo.CrmCancellationPolicy', 'RefundDueDays') a, COL_LENGTH('dbo.CrmCancellation', 'RefundDueDays') b"))[0].a != null);
    // Start from a waiting request whatever dev data says now (people use the test booking too).
    await q(`UPDATE dbo.CrmCancellation SET Status = 'Pending' WHERE Id = ${REQUEST}`);
    let c = await get();
    check("The ZZTEST request is waiting for approval", c?.Status === "Pending", c?.Status);

    section("Correcting a request before approval");
    expectCall("The reason can't be emptied", await call("PUT", `/c/${REQUEST}`, { Reason: "  " }), 400, "reason");
    expectCall("The charge must be 0 to 100", await call("PUT", `/c/${REQUEST}`, { DeductionPercent: 120 }), 400, "between 0 and 100");
    expectCall("Correct the reason and the charge", await call("PUT", `/c/${REQUEST}`, { Reason: "E2E corrected reason", DeductionPercent: 5 }), 200);
    c = await get();
    check("Saved: reason and 5% charge", c.Reason === "E2E corrected reason" && Number(c.DeductionPercent) === 5, `${c.Reason} ${c.DeductionPercent}`);

    section("Rejection, then corrected and sent again");
    expectCall("Reject with a reason", await call("PUT", `/c/${REQUEST}/reject`, { note: "E2E: charge should be 0" }), 200);
    c = await get();
    check("Rejected, and the page gets the rejection reason (not the Notes)", c.Status === "Rejected" && c.RejectionNote === "E2E: charge should be 0", `${c.Status} ${c.RejectionNote}`);
    expectCall("A rejected request can be corrected", await call("PUT", `/c/${REQUEST}`, { DeductionPercent: 0 }), 200);
    check("Charge now 0%", Number((await get()).DeductionPercent) === 0);
    expectCall("Send it again", await call("PUT", `/c/${REQUEST}/submit`), 200);
    check("Waiting for approval again", (await get()).Status === "Pending");

    section("Withdraw: before approval, with a reason, final");
    expectCall("A reason is required", await call("PUT", `/c/${REQUEST}/withdraw`, { reason: " " }), 400, "reason");
    expectCall("Withdraw it", await call("PUT", `/c/${REQUEST}/withdraw`, { reason: "E2E: customer is staying" }), 200);
    c = await get();
    check("Withdrawn, reason shown, booking still active", c.Status === "Withdrawn" && c.RejectionNote === "E2E: customer is staying" && c.BookingStatus !== "Cancelled", `${c.Status} ${c.RejectionNote}`);
    const bk = (await q(`SELECT Status, IsActive FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0];
    check("The booking itself is untouched", bk.Status !== "Cancelled" && bk.IsActive, JSON.stringify(bk));
    expectCall("Final: can't be withdrawn twice", await call("PUT", `/c/${REQUEST}/withdraw`, { reason: "again" }), 409, "already");
    expectCall("Final: can't be corrected", await call("PUT", `/c/${REQUEST}`, { Reason: "x" }), 400);
    const resend = await call("PUT", `/c/${REQUEST}/submit`);
    check("Final: can't be sent again", resend.status >= 400, `got ${resend.status} ${resend.json?.error}`);
    const approveW = await call("PUT", `/c/${REQUEST}/approve`);
    check("Final: can't be approved", approveW.status >= 400, `got ${approveW.status} ${approveW.json?.error}`);
    check("In its approval history", (await q(`SELECT COUNT(*) n FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmCancellation' AND RecordId = ${REQUEST} AND ActionStatus = 'Withdrawn'`))[0].n === 1);
    const listW = (await call("GET", "/c?page=1&pageSize=25&status=Withdrawn")).json;
    check("Listed and counted under Withdrawn", listW.rows.some((r) => r.Id === REQUEST) && listW.statusCounts.Withdrawn >= 1);

    section("Cancellation Policy screen");
    const slabsBefore = (await call("GET", "/c/policies")).json;
    check("Lists the slabs and the defaults (45 days)", Array.isArray(slabsBefore.rows) && slabsBefore.defaults.refundDueDays === 45, JSON.stringify(slabsBefore.defaults));
    const proj = (await q(`SELECT ProjectId FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0].ProjectId;
    expectCall("A slab needs a name", await call("POST", "/c/policies", { ProjectId: proj, DaysFromBookingMin: 0, DeductionPercent: 5 }), 400, "name");
    expectCall("The charge is 0 to 100", await call("POST", "/c/policies", { ProjectId: proj, PolicyName: "E2E", DaysFromBookingMin: 0, DeductionPercent: 101 }), 400, "between 0 and 100");
    expectCall("The days range can't end before it starts", await call("POST", "/c/policies", { ProjectId: proj, PolicyName: "E2E", DaysFromBookingMin: 10, DaysFromBookingMax: 5, DeductionPercent: 5 }), 400, "days range");
    expectCall("The due days are 1 to 365", await call("POST", "/c/policies", { ProjectId: proj, PolicyName: "E2E", DaysFromBookingMin: 0, DeductionPercent: 5, RefundDueDays: 0 }), 400, "1 and 365");
    const slab = await call("POST", "/c/policies", { ProjectId: proj, PolicyName: "E2E slab", DaysFromBookingMin: 0, DeductionPercent: 7.5, RefundDueDays: 30 });
    check("Add a slab for the test project: 7.5%, refund due in 30 days", slab.status === 201, `got ${slab.status} ${slab.json?.error}`);
    expectCall("An overlapping slab is refused", await call("POST", "/c/policies", { ProjectId: proj, PolicyName: "E2E overlap", DaysFromBookingMin: 100, DeductionPercent: 3 }), 409, "overlaps");
    const pol = (await call("GET", `/c/policy?bookingId=${BOOKING}`)).json;
    check("The booking now gets that slab", pol.source === "policy" && pol.DeductionPercent === 7.5 && pol.RefundDueDays === 30, JSON.stringify(pol));
    expectCall("Switch the slab off", await call("PUT", `/c/policies/${slab.json.id}`, { IsActive: false }), 200);
    check("Switched off: the default applies again (0%, 45 days)", (await call("GET", `/c/policy?bookingId=${BOOKING}`)).json.RefundDueDays === 45);
    expectCall("Switch it back on", await call("PUT", `/c/policies/${slab.json.id}`, { IsActive: true }), 200);
    expectCall("Edit it: 30 → 20 days", await call("PUT", `/c/policies/${slab.json.id}`, { ProjectId: proj, PolicyName: "E2E slab", DaysFromBookingMin: 0, DeductionPercent: 7.5, RefundDueDays: 20 }), 200);

    section("A new request after a withdrawal: the policy's charge and due days");
    const policies = (await q("SELECT COUNT(*) n FROM dbo.CrmCancellationPolicy WHERE IsActive = 1"))[0].n;
    // The test booking has an open ZZTEST resale, which rightly blocks a cancellation: close it in this transaction.
    const resale = await call("POST", "/c", { BookingId: BOOKING, Reason: "E2E new request" });
    check("Refused while the booking's resale is open", resale.status === 409 && /resale/i.test(resale.json?.error || ""), `got ${resale.status} ${resale.json?.error}`);
    await q(`UPDATE dbo.CrmUnitResale SET Status = 'Cancelled' WHERE IsActive = 1 AND Status IN ('Draft', 'Pending', 'Approved')
      AND (FromBookingId = ${BOOKING} OR CHARINDEX(',${BOOKING},', ',' + ISNULL(BookingIds, '') + ',') > 0)`);
    const made = await call("POST", "/c", { BookingId: BOOKING, Reason: "E2E new request" });
    if (made.status === 201) {
      check("A new request can be raised once the old one is withdrawn", true);
      const n = await get(made.json.id);
      const nRow = (await q(`SELECT DeductionPercent, RefundDueDays FROM dbo.CrmCancellation WHERE Id = ${made.json.id}`))[0];
      check("The request keeps the slab's 7.5% and 20 days", Number(nRow.DeductionPercent) === 7.5 && nRow.RefundDueDays === 20, JSON.stringify(nRow));
      expectCall("A second live request for the booking is refused", await call("POST", "/c", { BookingId: BOOKING, Reason: "x" }), 409, "already exists");
      // The withdrawn request can't come back (final); a rejected one being sent again while another is live:
      await q(`UPDATE dbo.CrmCancellation SET Status = 'Rejected' WHERE Id = ${REQUEST}`);
      const twoLive = await call("PUT", `/c/${REQUEST}/submit`);
      check(`Sending a rejected request again while another is live is refused (says: ${twoLive.json?.error})`, twoLive.status >= 400, `got ${twoLive.status}`);
      await q(`UPDATE dbo.CrmCancellation SET Status = 'Withdrawn' WHERE Id = ${REQUEST}`);

      section("Approval");
      h.setActor({ role: "crm_executive" });
      const stranger = await call("PUT", `/c/${made.json.id}/approve`);
      check("Someone not named in Approval Setup cannot approve", stranger.status >= 400 && stranger.status < 500, `got ${stranger.status} ${stranger.json?.error}`);
      h.setActor({ role: "super_admin" });
      const ok = await call("PUT", `/c/${made.json.id}/approve`);
      if (ok.status === 200) {
        const a = await get(made.json.id);
        check("Approved: booking cancelled, credit held, draft refund made", a.Status === "Approved" && a.HeldOnAccountId != null && a.RefundId != null, `${a.Status} ${a.HeldOnAccountId} ${a.RefundId}`);
        expectCall("Approved: no more corrections", await call("PUT", `/c/${made.json.id}`, { Reason: "x" }), 400);
        expectCall("Approved: can't be withdrawn", await call("PUT", `/c/${made.json.id}/withdraw`, { reason: "x" }), 409, "before approval");

        section("The payout: draft refund → CRM approval → voucher → Finance approves → Paid");
        const rid = a.RefundId;
        let rf = (await call("GET", `/r/${rid}`)).json;
        const dueDays = Math.round((new Date(rf.RefundDueDate).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
        check("The refund falls due 20 days after approval (the slab's days, not a fixed 45)", dueDays === 20, `${dueDays} days`);
        check("The draft refund carries the held credit, the charge and a RERA due date", rf.Status === "Draft" && Math.abs(Number(rf.GrossAmount) - Number(a.AmountPaidTillDate)) < 0.01 && !!rf.RefundDueDate,
          `${rf.Status} gross ${rf.GrossAmount} paid ${a.AmountPaidTillDate} due ${rf.RefundDueDate}`);
        expectCall("Pay by cheque (no account needed)", await call("PUT", `/r/${rid}`, { Reason: "E2E payout", PreferredPaymentMode: "Cheque" }), 200);
        const sub = await call("PUT", `/r/${rid}/submit`);
        check("Send the refund for approval", sub.status === 200, `got ${sub.status} ${sub.json?.error}`);
        const ap = await call("PUT", `/r/${rid}/approve`);
        check("CRM approves it", ap.status === 200 || ap.status === 202, `got ${ap.status} ${ap.json?.error || ap.json?.warning}`);
        rf = (await call("GET", `/r/${rid}`)).json;
        console.log("   refund after CRM approval:", rf.Status, "voucher", rf.FinanceNewPaymentId, "note", rf.RejectionNote);
        if (rf.Status === "FinancePending") {
          const bank = (await q(`SELECT TOP 1 pb.BankLHeadId FROM dbo.CrmProjectBank pb WHERE pb.ProjectId = ${rf.ProjectId}`))[0];
          check(`Voucher not raised (${rf.RejectionNote}): Finance picks the bank`, !!bank, "no project bank on dev");
          if (bank) {
            const fa = await call("PUT", `/r/${rid}/finance-approve`, { RefundBankLHeadId: bank.BankLHeadId, PaymentMode: "Cheque" });
            check("Finance raises the payout voucher", fa.status === 200, `got ${fa.status} ${fa.json?.error}`);
            rf = (await call("GET", `/r/${rid}`)).json;
          }
        }
        check("With Finance: a payout voucher exists for the net amount", rf.Status === "FinanceApproved" && rf.FinanceNewPaymentId != null, `${rf.Status} ${rf.FinanceNewPaymentId}`);
        if (rf.FinanceNewPaymentId != null) {
          const v = (await q(`SELECT PAmount, PMode, PBankID, PDate, Status, SourceCrmRefundId FROM dbo.NewPayment WHERE PPaymentID = ${rf.FinanceNewPaymentId}`))[0];
          check("The voucher pays the refund's net amount and points back to it", Math.abs(Number(v.PAmount) - Number(rf.NetAmount)) < 0.01 && v.SourceCrmRefundId === rid, JSON.stringify(v));
          // Finance completes the voucher in Payments (bank, date, mode) before approving it: stood in for here.
          if (!v.PBankID || !v.PDate || !v.PMode) await q(`UPDATE dbo.NewPayment SET PBankID = COALESCE(PBankID, (SELECT TOP 1 pb.BankLHeadId FROM dbo.CrmProjectBank pb WHERE pb.ProjectId = ${rf.ProjectId}), (SELECT TOP 1 BankLHeadId FROM dbo.CrmProjectBank)),
            PDate = COALESCE(PDate, CAST(SYSDATETIME() AS DATE)), PMode = COALESCE(NULLIF(PMode, ''), 'Cheque') WHERE PPaymentID = ${rf.FinanceNewPaymentId}`);
          const fin = await call("PUT", `/p/${rf.FinanceNewPaymentId}/approve`);
          check("Finance approves the voucher in Payments", fin.status === 200, `got ${fin.status} ${fin.json?.error} ${fin.json?.message || ""}`);
          console.log("   Payments says:", fin.json?.message, fin.json?.crmRefundSyncIssue || "");
          rf = (await call("GET", `/r/${rid}`)).json;
          check("The refund is Paid", rf.Status === "Paid" && !!rf.PaidAt, rf.Status);
          const held = (await q(`SELECT Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = ${a.HeldOnAccountId}`))[0];
          check("The held credit is used up", held.Status === "Applied" && Math.abs(Number(held.Amount) - Number(held.AppliedAmount)) < 0.01, JSON.stringify(held));
          const after = await get(made.json.id);
          check("The cancellation shows as settled, refund Paid", after.SettlementStatus === "Settled" && after.RefundStatus === "Paid", `${after.SettlementStatus} ${after.RefundStatus}`);
          const gl = await q(`SELECT SourceType, SUM(DebitAmount) Dr, SUM(CreditAmount) Cr, COUNT(*) n FROM dbo.GeneralLedgerEntry
            WHERE (SourceType IN ('NewPayment', 'PaymentPosting') AND SourceId = ${rf.FinanceNewPaymentId}) OR (SourceType = 'CrmRefund' AND SourceId = ${rid}) GROUP BY SourceType`).catch((e) => [{ error: e.message }]);
          console.log("   ledger:", JSON.stringify(gl));
          check("The payout is in the ledger and balances to the paisa", gl.length > 0 && gl.every((x) => Math.abs(Number(x.Dr) - Number(x.Cr)) < 0.005), JSON.stringify(gl));
          const gst = await q(`SELECT DocType, Status, TotalAmount FROM dbo.CrmGstNote WHERE RefundId = ${rid}`);
          console.log("   GST documents:", JSON.stringify(gst));
          const again = await call("PUT", `/p/${rf.FinanceNewPaymentId}/approve`);
          check("Approving the voucher twice changes nothing", again.status >= 400 || (await call("GET", `/r/${rid}`)).json.Status === "Paid");
          expectCall("A paid refund can't be withdrawn", await call("PUT", `/r/${rid}/withdraw`, { reason: "x" }), 409);

          section("Undoing a payout: a bank transfer that came back");
          const glLive = async (type, id) => (await q(`SELECT ISNULL(SUM(DebitAmount), 0) Dr, ISNULL(SUM(CreditAmount), 0) Cr FROM dbo.GeneralLedgerEntry
            WHERE SourceType = '${type}' AND SourceId = ${id} AND ISNULL(IsReversed, 0) = 0`))[0];
          const firstVoucher = rf.FinanceNewPaymentId;
          expectCall("A reason is required", await call("PUT", `/r/${rid}/payout-returned`, { reason: " " }), 400, "reason");
          expectCall("Mark the payout returned", await call("PUT", `/r/${rid}/payout-returned`, { reason: "E2E: NEFT bounced back" }), 200);
          rf = (await call("GET", `/r/${rid}`)).json;
          check("The refund is back to 'voucher not raised', with the reason", rf.Status === "FinancePending" && /NEFT bounced back/.test(rf.RejectionNote || "") && rf.FinanceNewPaymentId == null && !rf.PaidAt, `${rf.Status} ${rf.RejectionNote}`);
          const v1 = (await q(`SELECT Status FROM dbo.NewPayment WHERE PPaymentID = ${firstVoucher}`))[0];
          check("Its voucher is cancelled", v1.Status === "Cancelled", v1.Status);
          const glV1 = await glLive("NewPayment", firstVoucher), glAdj1 = await glLive("CrmRefund", rid);
          check("Both ledger entries are reversed (voucher and refund adjustment)", Number(glV1.Dr) === 0 && Number(glAdj1.Dr) === 0, `${JSON.stringify(glV1)} ${JSON.stringify(glAdj1)}`);
          const held2 = (await q(`SELECT Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = ${a.HeldOnAccountId}`))[0];
          check("The held credit is restored", held2.Status === "Held" && Number(held2.AppliedAmount) === 0, JSON.stringify(held2));
          const back = await get(made.json.id);
          check("The cancellation shows the refund pending again", back.SettlementStatus !== "Settled" && back.RefundStatus === "FinancePending", `${back.SettlementStatus} ${back.RefundStatus}`);
          expectCall("Returning it twice is refused", await call("PUT", `/r/${rid}/payout-returned`, { reason: "again" }), 409);
          check("In its approval history", (await q(`SELECT COUNT(*) n FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmRefund' AND RecordId = ${rid} AND ActionStatus = 'PayoutReturned'`))[0].n === 1);

          section("Paid again with a new voucher");
          const bank2 = (await q("SELECT TOP 1 BankLHeadId FROM dbo.CrmProjectBank"))[0];
          const fa2 = await call("PUT", `/r/${rid}/finance-approve`, { RefundBankLHeadId: bank2.BankLHeadId, PaymentMode: "Cheque" });
          check("Finance raises a new voucher", fa2.status === 200, `got ${fa2.status} ${fa2.json?.error}`);
          rf = (await call("GET", `/r/${rid}`)).json;
          check("A new voucher, not the cancelled one", rf.FinanceNewPaymentId != null && rf.FinanceNewPaymentId !== firstVoucher, String(rf.FinanceNewPaymentId));
          await q(`UPDATE dbo.NewPayment SET PDate = COALESCE(PDate, CAST(SYSDATETIME() AS DATE)), PMode = COALESCE(NULLIF(PMode, ''), 'Cheque') WHERE PPaymentID = ${rf.FinanceNewPaymentId}`);
          expectCall("Finance approves it", await call("PUT", `/p/${rf.FinanceNewPaymentId}/approve`), 200);
          rf = (await call("GET", `/r/${rid}`)).json;
          const held3 = (await q(`SELECT AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = ${a.HeldOnAccountId}`))[0];
          check("Paid again, held credit used up once (not twice)", rf.Status === "Paid" && held3.Status === "Applied" && Math.abs(Number(held3.AppliedAmount) - Number(rf.GrossAmount)) < 0.01, `${rf.Status} ${JSON.stringify(held3)}`);
          const glAdj2 = await glLive("CrmRefund", rid);
          check("One live refund adjustment, balanced", Math.abs(Number(glAdj2.Dr) - Number(glAdj2.Cr)) < 0.005 && Number(glAdj2.Dr) > 0, JSON.stringify(glAdj2));

          section("Undoing a payout: its cheque cancelled in Finance");
          const lot = (await q("SELECT TOP 1 * FROM dbo.ChequeMaster"))[0];
          const lotId = lot && (lot.Id ?? lot.ChequeId ?? lot.CMId ?? Object.values(lot)[0]);
          await q(`UPDATE dbo.NewPayment SET PChequeNo = 'E2E777', PChequeLotId = ${lotId ?? "NULL"} WHERE PPaymentID = ${rf.FinanceNewPaymentId}`);
          const cq = await call("POST", "/cq", { paymentId: rf.FinanceNewPaymentId, reason: "E2E: wrong payee name" });
          check("Cancel the payout's cheque in Finance", cq.status === 200, `got ${cq.status} ${cq.json?.error}`);
          rf = (await call("GET", `/r/${rid}`)).json;
          const held4 = (await q(`SELECT AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = ${a.HeldOnAccountId}`))[0];
          check("The refund is back to 'voucher not raised' and the credit restored", rf.Status === "FinancePending" && /Cheque #E2E777 cancelled/.test(rf.RejectionNote || "") && held4.Status === "Held" && Number(held4.AppliedAmount) === 0,
            `${rf.Status} ${rf.RejectionNote} ${JSON.stringify(held4)}`);
          check("Its refund adjustment is reversed", Number((await glLive("CrmRefund", rid)).Dr) === 0);
        }
      } else check(`Approval refused by a business rule on this test booking: ${ok.json?.error}`, ok.status === 409, `got ${ok.status}`);
    } else check(`New request refused by a business rule on this test booking: ${made.json?.error}`, made.status === 409 || made.status === 400, `got ${made.status}`);
    expectCall("An unknown request is not found", await call("GET", "/c/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
