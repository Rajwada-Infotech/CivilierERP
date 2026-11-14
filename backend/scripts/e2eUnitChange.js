// End-to-end test of Unit Change: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST booking
// BKG-2026-00126 (fully paid), inside one transaction that is rolled back.
//   node scripts/e2eUnitChange.js
const { openHarness } = require("./e2eHarness");

const BOOKING = 206;   // BKG-2026-00126, ZZTEST, fully paid
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmPropertyChangeRequest) R, (SELECT COUNT(*) FROM dbo.CrmBooking) B,
  (SELECT COUNT(*) FROM dbo.CrmOnAccountPayment) O, (SELECT STRING_AGG(CONCAT(Id, ':', Status), ',') FROM dbo.CrmBooking WHERE Id = ${206}) S`;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

(async () => {
  const h = await openHarness({ mounts: { "/b": "crmBookings", "/c": "crmCancellations" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  const req = async (id) => (await call("GET", `/b/unit-changes/${id}`)).json;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin", email: "e2e@civilier.test", name: "E2E" });
    // Start state, whatever dev data says now: agreement not signed, deed not registered, no open cancellation.
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Draft' WHERE BookingId = ${BOOKING} AND Status IN ('Executed', 'Registered')`);
    await q(`UPDATE dbo.CrmSalesDeed SET Status = 'Draft' WHERE BookingId = ${BOOKING} AND Status = 'Registered'`);
    await q(`UPDATE dbo.CrmCancellation SET Status = 'Withdrawn' WHERE BookingId = ${BOOKING} AND Status NOT IN ('Rejected', 'Withdrawn', 'Cancelled')`);
    // The buyer's details and an extra charge on the booking, to see them reach the new booking.
    await q(`INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, IsActive, CreatedAt) VALUES (${BOOKING}, 'E2E Co Applicant', 'Spouse', 1, SYSDATETIME())`);
    const charge = (await q(`INSERT INTO dbo.CrmExtraCharge (BookingId, Description, Amount, GstRate, GstAmount, TotalAmount, IsActive, CreatedAt) OUTPUT INSERTED.Id
      VALUES (${BOOKING}, 'E2E club membership', 1000, 18, 180, 1180, 1, SYSDATETIME())`))[0].Id;
    const pm = (await q(`SELECT TOP 1 pm.Id, pm.ProjectId, pm.BlockId, pm.ParkingType FROM dbo.ParkingMaster pm
      JOIN dbo.CrmBooking b ON b.ProjectId = pm.ProjectId WHERE b.Id = ${BOOKING} AND pm.IsActive = 1 ORDER BY pm.Id`))[0];
    const slot = (await q(`INSERT INTO dbo.ParkingSlot (ProjectId, BlockId, SlotNo, ParkingType, IsActive, CreatedAt) OUTPUT INSERTED.Id
      VALUES (${pm.ProjectId}, ${pm.BlockId ?? "NULL"}, 'E2E-PK-1', '${pm.ParkingType}', 1, SYSDATETIME())`))[0].Id;
    await require("../routes/crmParking").applyAddParking(require("../db").getPool(), BOOKING, { ParkingMasterId: pm.Id, ParkingSlotId: slot }, null);
    const allot = (await q(`SELECT Id, TotalAmount FROM dbo.CrmParkingAllotment WHERE BookingId = ${BOOKING} AND ParkingSlotId = ${slot} AND IsActive = 1`))[0];
    const src = (await q(`SELECT b.*, (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) Settled FROM dbo.CrmBooking b WHERE b.Id = ${BOOKING}`))[0];
    const freeOnAccount = Number((await q(`SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${BOOKING} AND ISNULL(Status, '') IN ('Unapplied', 'PartiallyApplied')`))[0].a);
    const received = Number(src.Settled) + freeOnAccount;
    const target = (await q(`SELECT TOP 1 u.Id, u.UnitName, u.RatePerSqFt, u.AreaSqFt FROM dbo.UnitMaster u
      WHERE u.IsActive = 1 AND u.ProjectId = ${src.ProjectId} AND u.Id <> ${src.UnitId} AND u.AreaSqFt > 0 AND u.RatePerSqFt > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit bu WHERE bu.UnitId = u.Id AND bu.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationUnit au WHERE au.UnitId = u.Id AND au.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold x WHERE x.EntityType = 'Unit' AND x.EntityId = u.Id AND x.Status = 'Active')
      ORDER BY u.AreaSqFt * u.RatePerSqFt DESC, u.Id`))[0];
    check("A free unit in the same project to move to", !!target, JSON.stringify(target));

    section("Preview");
    const o0 = (await call("GET", `/b/${BOOKING}/unit-change-options`)).json;
    check("Booking alone: nothing stops a change", Array.isArray(o0.blockers) && o0.blockers.length === 0, JSON.stringify(o0.blockers));
    check("Money received = settled + on account", near(o0.money.Received, received), `${o0.money.Received} vs ${received}`);
    const o1 = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${target.Id}`)).json;
    check("The new unit's own rate is offered", near(o1.next.ratePerSqFt, target.RatePerSqFt), `${o1.next.ratePerSqFt} vs ${target.RatePerSqFt}`);
    check("Same project, same company", o1.next.isCrossProject === false && o1.next.isCrossCompany === false);
    const liveInv = await q(`SELECT Id, InvoiceNo, Amount FROM dbo.CrmInvoice WHERE BookingId = ${BOOKING} AND Status <> 'Void' AND InvoiceType IN ('Milestone', 'Booking', 'Final')`);
    check("The preview lists the invoices that will be credited", (o1.invoices || []).length === liveInv.length
      && liveInv.every((i) => o1.invoices.some((x) => x.invoiceNo === i.InvoiceNo)), JSON.stringify(o1.invoices));
    check("The parking slot is offered as stay-or-change (same project)", (o1.addOns || []).some((a) => a.kind === "Parking" && a.id === allot.Id && a.canKeep), JSON.stringify(o1.addOns));
    check("The extra charge is offered as stay-or-change", (o1.addOns || []).some((a) => a.kind === "ExtraCharge" && a.id === charge && a.canKeep));
    const oKeep = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${target.Id}&keep=${encodeURIComponent(`ExtraCharge:${charge},Parking:${allot.Id}`)}`)).json;
    check("Keeping both adds them (with their GST, none on a completed building) to the new price", oKeep.next.grandTotal > o1.next.grandTotal + 1000, `${oKeep.next.grandTotal} vs ${o1.next.grandTotal}`);
    check("New price includes GST, compared with all money received", o1.next.grandTotal >= o1.next.unitPrice
      && near(o1.next.balance, o1.next.grandTotal - o1.money.Received), JSON.stringify({ p: o1.next.unitPrice, g: o1.next.grandTotal, b: o1.next.balance, r: o1.money.Received }));
    const o2 = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${target.Id}&rate=1234`)).json;
    check("A typed rate is used for the price", near(o2.next.ratePerSqFt, 1234));
    const o3 = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${src.UnitId}`)).json;
    check("Its own unit is refused", o3.blockers.some((b) => /own unit/.test(b)), JSON.stringify(o3.blockers));
    const oCheap = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${target.Id}&rate=1`)).json;
    check("A price below the plan's booking amount is caught in the preview", oCheap.blockers.some((b) => /booking amount/.test(b)), JSON.stringify(oCheap.blockers));
    const planId = o1.planId || o1.plans?.[0]?.Id;
    const body = (extra = {}) => ({ TargetUnitId: target.Id, Reason: "E2E: buyer wants a different unit", PaymentPlanId: planId,
      AddOns: (o1.addOns || []).map((a) => ({ kind: a.kind, id: a.id, keep: a.kind === "ExtraCharge" ? a.id === charge : a.id === allot.Id })), ...extra });

    section("Raise, withdraw, reject");
    expectCall("A reason is required", await call("POST", `/b/${BOOKING}/unit-change`, body({ Reason: " " })), 400, "reason");
    if ((o1.addOns || []).length) expectCall("Each parking slot / charge needs a choice", await call("POST", `/b/${BOOKING}/unit-change`, body({ AddOns: [] })), 400, "Choose whether");
    let made = await call("POST", `/b/${BOOKING}/unit-change`, body());
    check("Raised", made.status === 201, `got ${made.status} ${made.json?.error}`);
    let r = await req(made.json.id);
    check("Waiting for approval, with a number", r.Status === "Pending" && /^UCR/.test(r.RequestNo || ""), `${r.Status} ${r.RequestNo}`);
    const hold = (await q(`SELECT COUNT(*) n FROM dbo.CrmInventoryHold WHERE EntityType = 'Unit' AND EntityId = ${target.Id} AND Status = 'Active'`))[0].n;
    check("The new unit is held for it", hold === 1);
    check("The booking itself is untouched while it waits", (await q(`SELECT Status FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0].Status === "Approved");
    expectCall("Only one open request per booking", await call("POST", `/b/${BOOKING}/unit-change`, body()), 409, "already open");
    expectCall("No cancellation while a unit change is open", await call("POST", "/c", { BookingId: BOOKING, Reason: "E2E" }), 409, "Unit change");
    expectCall("Withdraw needs a reason", await call("PUT", `/b/unit-changes/${r.Id}/withdraw`, { reason: "" }), 400, "why");
    expectCall("Withdraw it", await call("PUT", `/b/unit-changes/${r.Id}/withdraw`, { reason: "E2E: changed mind" }), 200);
    r = await req(r.Id);
    check("Withdrawn, the hold released", r.Status === "Withdrawn" && (await q(`SELECT COUNT(*) n FROM dbo.CrmInventoryHold WHERE EntityType = 'Unit' AND EntityId = ${target.Id} AND Status = 'Active'`))[0].n === 0);
    check("Its approval history says Withdrawn", (await q(`SELECT COUNT(*) n FROM dbo.ApprovalAuditLog WHERE TableName = 'CrmPropertyChangeRequest' AND RecordId = ${r.Id} AND ActionStatus = 'Withdrawn'`))[0].n === 1);
    expectCall("A withdrawn one can't be approved", await call("PUT", `/b/unit-changes/${r.Id}/approve`), 409);
    made = await call("POST", `/b/${BOOKING}/unit-change`, body());
    check("Raised again", made.status === 201, `got ${made.status} ${made.json?.error}`);
    expectCall("Reject needs a reason", await call("PUT", `/b/unit-changes/${made.json.id}/reject`, { note: "" }), 400);
    expectCall("Reject it", await call("PUT", `/b/unit-changes/${made.json.id}/reject`, { note: "E2E: price not agreed" }), 200);
    r = await req(made.json.id);
    check("Rejected with its reason", r.Status === "Rejected" && r.Note === "E2E: price not agreed", `${r.Status} ${r.Note}`);

    section("Approve: new booking, old booking closed, money moved");
    // The booking's brokerage, part of it already paid: it moves with the sale and is never raised again.
    const brk = await q(`SELECT Id, Status FROM dbo.CrmBrokerageMaster WHERE BookingId = ${BOOKING}`);
    if (brk.length) await q(`UPDATE dbo.CrmBrokerageMaster SET Status = 'Paid' WHERE Id = ${brk[0].Id}`);
    made = await call("POST", `/b/${BOOKING}/unit-change`, body());
    check("Raised a third time", made.status === 201, `got ${made.status} ${made.json?.error}`);
    // Two levels in Approval Setup: nothing happens until the last level approves.
    await q(`UPDATE dbo.ApprovalWorkflows SET Levels = 2, LevelsData = N'[{"id":1,"label":"Sales Head","mode":"any","userIds":[],"roles":["admin"]},{"id":2,"label":"Director","mode":"any","userIds":[],"roles":["admin"]}]'
      WHERE active = 1 AND modules LIKE N'%"crm-unit-change"%'`);
    require("../services/approvalService").invalidateWorkflowCache?.();
    const ap1 = await call("PUT", `/b/unit-changes/${made.json.id}/approve`, {});
    const r1 = await req(made.json.id);
    check("Two levels: the first approval only moves it to the next level", ap1.status === 200 && r1.Status === "Pending" && !r1.TargetBookingId
      && (await q(`SELECT Status FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0].Status === "Approved", `${ap1.status} ${JSON.stringify(ap1.json)} ${r1.Status}`);
    const ap = await call("PUT", `/b/unit-changes/${made.json.id}/approve`, {});
    check("The last level's approval carries it out", ap.status === 200 && ap.json?.status === "Completed", `got ${ap.status} ${JSON.stringify(ap.json)}`);
    r = await req(made.json.id);
    const nb = (await q(`SELECT b.*, a.Status AppStatus FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = ${r.TargetBookingId || 0}`))[0];
    check("New booking on the new unit, confirmed", nb && nb.UnitId === target.Id && nb.Status === "Approved" && nb.WorkflowStage === "Confirmed", JSON.stringify(nb && { u: nb.UnitId, s: nb.Status, w: nb.WorkflowStage }));
    check("New booking at the new unit's rate", nb && near(nb.RatePerSqFt, target.RatePerSqFt), `${nb?.RatePerSqFt}`);
    const ob = (await q(`SELECT b.Status, b.ClosedByUnitChangeId, a.Status AppStatus FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = ${BOOKING}`))[0];
    check("Old booking closed as UnitChanged, linked to the request", ob.Status === "UnitChanged" && ob.ClosedByUnitChangeId === r.Id, JSON.stringify(ob));
    check("Old unit line released", (await q(`SELECT COUNT(*) n FROM dbo.CrmBookingUnit WHERE BookingId = ${BOOKING} AND Status = 'Active'`))[0].n === 0);
    const moved = Number((await q(`SELECT ISNULL(SUM(Amount), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${nb.Id} AND ISNULL(Status, '') NOT IN ('Bounced', 'Void')`))[0].a);
    check("Every rupee received moved to the new booking", near(moved, received) && near(r.CreditCarriedAmount, received), `moved ${moved}, carried ${r.CreditCarriedAmount}, received ${received}`);
    const heldLeft = (await q(`SELECT Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE HeldSourceType = 'UnitChange' AND HeldSourceRefId = ${r.Id}`))[0];
    check("The held credit is used up", heldLeft && heldLeft.Status === "Applied" && near(heldLeft.Amount, heldLeft.AppliedAmount), JSON.stringify(heldLeft));
    const oldLeft = Number((await q(`SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${BOOKING} AND ISNULL(Status, '') NOT IN ('Bounced', 'Void', 'Applied')`))[0].a);
    check("Nothing left on the old booking", near(oldLeft, 0), `${oldLeft}`);
    const nf = (await q(`SELECT (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = ${nb.Id}) Settled,
      (SELECT ISNULL(SUM(AmountDue), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = ${nb.Id} AND Status <> 'Waived') Due`))[0];
    check("New booking: settled once fully paid, else held on account", Number(nf.Settled) <= received + 0.01, JSON.stringify(nf));
    check("Completed and closed", r.Status === "Completed" && r.CompletedAt != null);
    {
      const notes = await q(`SELECT Id, DocNo, Status, InvoiceId, TotalAmount FROM dbo.CrmGstNote WHERE BookingId = ${BOOKING} AND Source = 'UnitChange'`);
      check("Each live invoice of the old booking credited for all that is left on it", liveInv.length > 0 && liveInv.every((i) => notes.some((n) => n.InvoiceId === i.Id && near(n.TotalAmount, o1.invoices.find((x) => x.invoiceNo === i.InvoiceNo).amount) && n.Status === "Issued" && n.DocNo)),
        JSON.stringify(notes));
      for (const n of notes) {
        const gl = (await q(`SELECT ISNULL(SUM(DebitAmount), 0) Dr, ISNULL(SUM(CreditAmount), 0) Cr FROM dbo.GeneralLedgerEntry WHERE SourceType = 'CrmGstNote' AND SourceId = ${n.Id} AND IsReversed = 0`))[0];
        const inv = (await q(`SELECT ISNULL(SUM(DebitAmount), 0) Dr FROM dbo.GeneralLedgerEntry WHERE SourceType = 'CrmInvoice' AND SourceId = ${n.InvoiceId} AND IsReversed = 0`))[0];
        check(`${n.DocNo}: the invoice's ledger entry mirrored back (in proportion), balanced`, Number(gl.Dr) > 0 && near(gl.Dr, gl.Cr) && Number(gl.Dr) <= Number(inv.Dr) + 0.01, `${JSON.stringify(gl)} vs invoice ${inv.Dr}`);
      }
      if (notes[0]) {
        const cn = await require("../services/crmGstNotes").requestCancel(require("../db").getPool(), notes[0].Id, "E2E", { userId: user, email: "e2e@civilier.test", role: "super_admin" }).then(() => "allowed", (e) => e.message);
        check("A unit change's credit note can't be cancelled", /unit change/.test(cn), cn);
      }
      const page = await req(r.Id);
      check("The request page lists its credit notes", (page.creditNotes || []).length === notes.length);
    }
    check("Co-applicant copied to the new booking", (await q(`SELECT COUNT(*) n FROM dbo.CrmCoApplicant WHERE BookingId = ${nb.Id} AND Name = 'E2E Co Applicant'`))[0].n === 1);
    const ec = (await q(`SELECT Amount, TotalAmount FROM dbo.CrmExtraCharge WHERE BookingId = ${nb.Id} AND IsActive = 1 AND Description = 'E2E club membership'`))[0];
    check("The extra charge kept moved to the new booking, same price", ec && near(ec.Amount, 1000), JSON.stringify(ec));
    check("The request records it as moved", JSON.parse(r.AddOnsJson).some((a) => a.id === charge && a.keep && a.done));
    const pk = (await q(`SELECT BookingId, IsActive FROM dbo.CrmParkingAllotment WHERE ParkingSlotId = ${slot} ORDER BY Id`));
    check("The parking slot kept moved to the new booking (old allotment released)", pk.some((x) => x.BookingId === nb.Id && x.IsActive) && pk.filter((x) => x.BookingId === BOOKING).every((x) => !x.IsActive), JSON.stringify(pk));
    check("The new booking's total includes the parking kept", Number((await q(`SELECT ParkingTotal FROM dbo.CrmBooking WHERE Id = ${nb.Id}`))[0].ParkingTotal) > 0);
    check("The request's new price is the GST-inclusive quote, with the charge kept", near(r.TargetEstimateAtRequest, oKeep.next.grandTotal), `${r.TargetEstimateAtRequest} vs ${oKeep.next.grandTotal}`);
    if (brk.length) {
      const moved = await q(`SELECT Id, Status FROM dbo.CrmBrokerageMaster WHERE BookingId = ${nb.Id}`);
      check("Brokerage moved with the sale: paid part closed, nothing raised twice", moved.length === brk.length && moved.some((x) => x.Id === brk[0].Id && x.Status === "Paid")
        && (await q(`SELECT COUNT(*) n FROM dbo.CrmBrokerageMaster WHERE BookingId = ${BOOKING}`))[0].n === 0, JSON.stringify(moved));
    }
    expectCall("The closed booking can't be cancelled", await call("POST", "/c", { BookingId: BOOKING, Reason: "E2E" }), 400);

    section("A payment Finance verifies after the change follows the buyer");
    const late = (await q(`INSERT INTO dbo.CrmOnAccountPayment (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode, CreatedAt)
      OUTPUT INSERTED.Id VALUES ('E2E-LATE', ${BOOKING}, 5000, 0, 'Unapplied', CAST(SYSDATETIME() AS DATE), 'NEFT', SYSDATETIME())`))[0].Id;
    const fwd = await require("../services/crmEntityCreation").forwardIfUnitChanged(require("../db").getPool(), BOOKING, late, user, "e2e@civilier.test");
    r = await req(r.Id);
    const late2 = (await q(`SELECT Status FROM dbo.CrmOnAccountPayment WHERE Id = ${late}`))[0];
    check("Forwarded to the new booking", fwd === true && late2.Status === "Applied" && near(r.CreditCarriedAmount, received + 5000) && r.Status === "Completed",
      `${fwd} ${late2.Status} ${r.CreditCarriedAmount} ${r.Status}`);

    section("A payment that bounces after the move comes off the new booking");
    {
      const sumNew = async () => Number((await q(`SELECT ISNULL(SUM(Amount), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${nb.Id} AND ISNULL(Status, '') NOT IN ('Bounced', 'Void')`))[0].a);
      const before = await sumNew();
      const pool = require("../db").getPool();
      const tx = pool.transaction(); await tx.begin();
      const out = await require("../services/crmEntityCreation").bounceAfterUnitChange(tx, { bookingId: BOOKING, amount: 5000, note: "E2E bounce" });
      await tx.commit();
      const after = await sumNew();
      const r2 = await req(r.Id);
      check("5,000 taken off the new booking's credit and the request", out?.targetBookingId === nb.Id && near(before - after, 5000) && near(r2.CreditCarriedAmount, received),
        `${before} -> ${after}, carried ${r2.CreditCarriedAmount}`);
    }

    section("Moving to a unit of another company");
    {
      const other = (await q(`SELECT TOP 1 p.id, p.company_id, (SELECT TOP 1 u.BlockId FROM dbo.UnitMaster u WHERE u.ProjectId = p.id AND u.BlockId IS NOT NULL) AS BlockId
        FROM dbo.enterprise p WHERE p.business_type = 'P' AND p.company_id <> ${src.CompanyId}
        AND EXISTS (SELECT 1 FROM dbo.UnitMaster u WHERE u.ProjectId = p.id AND u.BlockId IS NOT NULL) ORDER BY p.id`))[0];
      const cols = (await q(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND is_identity = 0 AND is_computed = 0`)).map((c) => c.name);
      const val = (c) => (c === "ProjectId" ? String(other.id) : c === "BlockId" ? String(other.BlockId) : c === "UnitName" ? "'E2E-XCO-1'" : `[${c}]`);
      const xu = (await q(`INSERT INTO dbo.UnitMaster (${cols.map((c) => `[${c}]`).join(", ")}) OUTPUT INSERTED.Id
        SELECT ${cols.map(val).join(", ")} FROM dbo.UnitMaster WHERE Id = ${target.Id}`))[0].Id;
      const ox = (await call("GET", `/b/${nb.Id}/unit-change-options?unitId=${xu}`)).json;
      check("Another company, and no tagged banks: caught in the preview", ox.next?.isCrossCompany === true && ox.blockers.some((b) => /tag a company bank/.test(b)), JSON.stringify(ox.blockers));
      // Each company's own bank (a Fund Transfer runs between two different banks).
      const banks = (await q("SELECT TOP 2 LHeadId FROM dbo.AccountHeadMaster ORDER BY CASE WHEN LHeadType = 'BK' THEN 0 ELSE 1 END, LHeadId")).map((b) => b.LHeadId);
      await q(`INSERT INTO dbo.CrmProjectBank (ProjectId, BankLHeadId, IsActive, CreatedAt) VALUES (${src.ProjectId}, ${banks[0]}, 1, SYSDATETIME()), (${other.id}, ${banks[1]}, 1, SYSDATETIME())`);
      const ox2 = (await call("GET", `/b/${nb.Id}/unit-change-options?unitId=${xu}`)).json;
      check("With banks tagged nothing stops it", ox2.blockers.length === 0, JSON.stringify(ox2.blockers));
      const xmade = await call("POST", `/b/${nb.Id}/unit-change`, { TargetUnitId: xu, Reason: "E2E: other company", PaymentPlanId: ox2.planId || ox2.plans?.[0]?.Id,
        AddOns: (ox2.addOns || []).map((a) => ({ kind: a.kind, id: a.id, keep: false })) });
      check("Raised", xmade.status === 201, `got ${xmade.status} ${xmade.json?.error}`);
      // Approval Setup still has two levels here (set above): both approve.
      await call("PUT", `/b/unit-changes/${xmade.json?.id}/approve`, {});
      const xap = await call("PUT", `/b/unit-changes/${xmade.json?.id}/approve`, {});
      const xr = await req(xmade.json?.id);
      check("Approved: new booking open, money waiting for the Fund Transfer", xap.status === 200 && xr.Status === "MovingMoney" && xr.TargetBookingId && xr.FundTransferDocNo,
        `${xap.status} ${xr.Status} ${xr.FundTransferDocNo} ${xr.Note || xap.json?.error || ""}`);
      const rt = (await q(`SELECT t.Id, t.Status, t.Amount FROM dbo.CrmRebookingTransfer t JOIN dbo.CrmOnAccountPayment h ON h.Id = t.HeldOnAccountId
        WHERE h.HeldSourceType = 'UnitChange' AND h.HeldSourceRefId = ${xr.Id}`))[0];
      check("The whole credit is reserved for the transfer", rt && near(rt.Amount, xr.MovedAmount), JSON.stringify(rt) + " moved " + xr.MovedAmount);
      if (rt) {
        // Finance approves the Fund Transfer: the existing approval hook applies the credit to the new booking.
        const applied = await require("../routes/crmRefunds").applyRebookingTransferToBooking(require("../db").getPool(), rt.Id, "e2e@civilier.test");
        const xr2 = await req(xr.Id);
        check("Once applied, the change completes", xr2.Status === "Completed" && near(xr2.CreditCarriedAmount, xr2.MovedAmount), `${xr2.Status} ${xr2.CreditCarriedAmount} ${JSON.stringify(applied)}`);
      }
    }

    section("Listed");
    const list = (await call("GET", "/b/unit-changes?status=All&page=1&pageSize=25")).json;
    check("All three requests listed, with counts", list.rows.filter((x) => x.SourceBookingId === BOOKING).length === 3 && list.counts.Completed >= 1, JSON.stringify(list.counts));
    const byBooking = (await call("GET", `/b/${nb.Id}/unit-change`)).json;
    check("The booking page shows its latest unit change (here its own move on to the other company)", byBooking?.SourceBookingId === nb.Id && byBooking?.Id !== r.Id, JSON.stringify(byBooking && { id: byBooking.Id, s: byBooking.SourceBookingId }));
    expectCall("An unknown request is not found", await call("GET", "/b/unit-changes/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
