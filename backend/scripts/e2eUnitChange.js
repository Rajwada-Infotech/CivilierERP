// End-to-end test of Unit Change: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST booking
// BKG-2026-00126 (fully paid), inside one transaction that is rolled back.
//   node scripts/e2eUnitChange.js
// The flow: the Change Unit card starts a Draft (new unit + reason) → the buyer's application for the new unit is
// finished in the application wizard (rate, plan, parking, extra charges) → submitting it sends the unit change for
// its one approval → on approval the new booking opens confirmed, the money moves and the old booking closes.
const { openHarness } = require("./e2eHarness");

const BOOKING = 206;   // BKG-2026-00126, ZZTEST, fully paid
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmPropertyChangeRequest) R, (SELECT COUNT(*) FROM dbo.CrmBooking) B,
  (SELECT COUNT(*) FROM dbo.CrmOnAccountPayment) O, (SELECT STRING_AGG(CONCAT(Id, ':', Status), ',') FROM dbo.CrmBooking WHERE Id = ${206}) S`;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

(async () => {
  const h = await openHarness({ mounts: { "/b": "crmBookings", "/c": "crmCancellations", "/a": "crmApplications", "/ai": "approvalInbox", "/p": "crmParking" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  const req = async (id) => (await call("GET", `/b/unit-changes/${id}`)).json;
  const pool = require("../db").getPool();
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin", email: "e2e@civilier.test", name: "E2E" });
    // Start state, whatever dev data says now: agreement not signed, deed not registered, no open cancellation.
    await q(`UPDATE dbo.CrmAgreement SET Status = 'Draft' WHERE BookingId = ${BOOKING} AND Status IN ('Executed', 'Registered')`);
    await q(`UPDATE dbo.CrmSalesDeed SET Status = 'Draft' WHERE BookingId = ${BOOKING} AND Status = 'Registered'`);
    await q(`UPDATE dbo.CrmCancellation SET Status = 'Withdrawn' WHERE BookingId = ${BOOKING} AND Status NOT IN ('Rejected', 'Withdrawn', 'Cancelled')`);
    // The buyer's details, an extra charge and a parking slot on the booking, to see them reach the new booking.
    await q(`INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, IsActive, CreatedAt) VALUES (${BOOKING}, 'E2E Co Applicant', 'Spouse', 1, SYSDATETIME())`);
    await q(`INSERT INTO dbo.CrmExtraCharge (BookingId, Description, Amount, GstRate, GstAmount, TotalAmount, IsActive, CreatedAt)
      VALUES (${BOOKING}, 'E2E club membership', 1000, 18, 180, 1180, 1, SYSDATETIME())`);
    const pm = (await q(`SELECT TOP 1 pm.Id, pm.ProjectId, pm.BlockId, pm.ParkingType FROM dbo.ParkingMaster pm
      JOIN dbo.CrmBooking b ON b.ProjectId = pm.ProjectId WHERE b.Id = ${BOOKING} AND pm.IsActive = 1 ORDER BY pm.Id`))[0];
    const newSlot = async (no) => (await q(`INSERT INTO dbo.ParkingSlot (ProjectId, BlockId, SlotNo, ParkingType, IsActive, CreatedAt) OUTPUT INSERTED.Id
      VALUES (${pm.ProjectId}, ${pm.BlockId ?? "NULL"}, '${no}', '${pm.ParkingType}', 1, SYSDATETIME())`))[0].Id;
    const slot = await newSlot("E2E-PK-1");
    const slot2 = await newSlot("E2E-PK-2");
    await require("../routes/crmParking").applyAddParking(pool, BOOKING, { ParkingMasterId: pm.Id, ParkingSlotId: slot }, null);
    const allot = (await q(`SELECT Id, RateSnapshot FROM dbo.CrmParkingAllotment WHERE BookingId = ${BOOKING} AND ParkingSlotId = ${slot} AND IsActive = 1`))[0];
    const src = (await q(`SELECT b.*, a.CustomerId, (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) Settled
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = ${BOOKING}`))[0];
    const freeOnAccount = Number((await q(`SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${BOOKING} AND ISNULL(Status, '') IN ('Unapplied', 'PartiallyApplied')`))[0].a);
    const received = Number(src.Settled) + freeOnAccount;
    const target = (await q(`SELECT TOP 1 u.Id, u.UnitName, u.RatePerSqFt, u.AreaSqFt FROM dbo.UnitMaster u
      WHERE u.IsActive = 1 AND u.ProjectId = ${src.ProjectId} AND u.Id <> ${src.UnitId} AND u.AreaSqFt > 0 AND u.RatePerSqFt > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit bu WHERE bu.UnitId = u.Id AND bu.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationUnit au WHERE au.UnitId = u.Id AND au.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold x WHERE x.EntityType = 'Unit' AND x.EntityId = u.Id AND x.Status = 'Active')
      ORDER BY u.AreaSqFt * u.RatePerSqFt DESC, u.Id`))[0];
    check("A free unit in the same project to move to", !!target, JSON.stringify(target));
    const liveInv = await q(`SELECT Id, InvoiceNo, Amount FROM dbo.CrmInvoice WHERE BookingId = ${BOOKING} AND Status <> 'Void' AND InvoiceType IN ('Milestone', 'Booking', 'Final')`);

    section("Preview on the Change Unit card");
    const o0 = (await call("GET", `/b/${BOOKING}/unit-change-options`)).json;
    check("Booking alone: nothing stops a change", Array.isArray(o0.blockers) && o0.blockers.length === 0 && !o0.open, JSON.stringify(o0.blockers));
    check("Money received = settled + on account", near(o0.money.Received, received), `${o0.money.Received} vs ${received}`);
    const o1 = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${target.Id}`)).json;
    check("The new unit's own rate is offered", near(o1.next.ratePerSqFt, target.RatePerSqFt), `${o1.next.ratePerSqFt} vs ${target.RatePerSqFt}`);
    check("Same project, same company", o1.next.isCrossProject === false && o1.next.isCrossCompany === false);
    check("The preview lists the invoices that will be credited", (o1.invoices || []).length === liveInv.length
      && liveInv.every((i) => o1.invoices.some((x) => x.invoiceNo === i.InvoiceNo)), JSON.stringify(o1.invoices));
    check("The parking slot (same project) and the extra charge come across to the application", (o1.items || []).filter((x) => x.change === "kept").length === 2, JSON.stringify(o1.items));
    check("The new price includes them, with GST, compared with all money received", o1.next.grandTotal > o1.next.unitPrice
      && near(o1.next.balance, o1.next.grandTotal - o1.money.Received), JSON.stringify({ p: o1.next.unitPrice, g: o1.next.grandTotal, b: o1.next.balance }));
    const o3 = (await call("GET", `/b/${BOOKING}/unit-change-options?unitId=${src.UnitId}`)).json;
    check("Its own unit is refused", o3.blockers.some((b) => /own unit/.test(b)), JSON.stringify(o3.blockers));

    // Starts a draft; returns the request and its application.
    const start = async () => {
      const made = await call("POST", `/b/${BOOKING}/unit-change`, { TargetUnitId: target.Id, Reason: "E2E: buyer wants a different unit" });
      return { made, r: made.json?.id ? await req(made.json.id) : null };
    };
    const held = async (type, id) => (await q(`SELECT COUNT(*) n FROM dbo.CrmInventoryHold WHERE EntityType = '${type}' AND EntityId = ${id} AND Status = 'Active'`))[0].n;
    const submit = (appId) => call("PUT", `/a/${appId}/submit`);

    section("Start: a draft, and the buyer's application for the new unit");
    expectCall("A reason is required", await call("POST", `/b/${BOOKING}/unit-change`, { TargetUnitId: target.Id, Reason: " " }), 400, "reason");
    let { made, r } = await start();
    check("Started as a Draft, with a number and its application", made.status === 201 && r?.Status === "Draft" && /^UCR/.test(r?.RequestNo || "") && made.json.applicationId === r.TargetApplicationId,
      `${made.status} ${made.json?.error} ${r?.Status}`);
    const app1 = (await q(`SELECT Status, CustomerId, PreferredUnitId, RatePerSqFt, PaymentPlanId, BrokerId FROM dbo.CrmApplication WHERE Id = ${r.TargetApplicationId}`))[0];
    check("The application is a draft for the same buyer, on the new unit at its rate", app1.Status === "Draft" && app1.CustomerId === src.CustomerId
      && app1.PreferredUnitId === target.Id && near(app1.RatePerSqFt, target.RatePerSqFt), JSON.stringify(app1));
    check("The new unit is held for it", (await held("Unit", target.Id)) === 1);
    const ph = (await q(`SELECT ApplicationId, RateOverride FROM dbo.CrmInventoryHold WHERE EntityType = 'Parking' AND EntityId = ${slot} AND Status = 'Active'`))[0];
    check("The booking's parking slot is held for the application at the price it was sold at", ph && ph.ApplicationId === r.TargetApplicationId && near(ph.RateOverride, allot.RateSnapshot), JSON.stringify(ph));
    const ac = (await q(`SELECT Description, Amount FROM dbo.CrmExtraCharge WHERE ApplicationId = ${r.TargetApplicationId} AND BookingId IS NULL AND IsActive = 1`));
    check("The booking's extra charge is on the application, same amount", ac.length === 1 && ac[0].Description === "E2E club membership" && near(ac[0].Amount, 1000), JSON.stringify(ac));
    check("The buyer's co-applicant is on the application, to check in the wizard", (await q(`SELECT COUNT(*) n FROM dbo.CrmCoApplicant WHERE ApplicationId = ${r.TargetApplicationId} AND BookingId IS NULL AND Name = 'E2E Co Applicant'`))[0].n === 1);
    {
      // Removed in the wizard's Parking step, the buyer's own slot can be picked again (offered to this application only).
      const hid = (await q(`SELECT Id FROM dbo.CrmInventoryHold WHERE EntityType = 'Parking' AND EntityId = ${slot} AND Status = 'Active'`))[0].Id;
      await require("../services/crmHoldService").releaseHold(pool, hid, user);
      const offered = async (withApp) => ((await call("GET", `/p/available?projectId=${pm.ProjectId}${withApp ? `&applicationId=${r.TargetApplicationId}` : ""}`)).json?.rates || [])
        .some((x) => (x.AvailableSlots || []).some((z) => z.Id === slot));
      check("The buyer's own slot is offered back to the application, and to no one else", (await offered(true)) && !(await offered(false)));
      await require("../services/crmHoldService").placeHold(pool, { entityType: "Parking", entityId: slot, applicationId: r.TargetApplicationId, reason: "E2E re-pick", userId: user });
      check("And can be held for it again", (await held("Parking", slot)) === 1);
    }
    check("The old booking is untouched: still approved, its slot still allotted", (await q(`SELECT Status FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0].Status === "Approved"
      && (await q(`SELECT IsActive FROM dbo.CrmParkingAllotment WHERE Id = ${allot.Id}`))[0].IsActive === true);
    const oDraft = (await call("GET", `/b/${BOOKING}/unit-change-options`)).json;
    check("The card finds the draft to continue in its application", oDraft.open?.id === r.Id && oDraft.open?.status === "Draft" && oDraft.open?.applicationId === r.TargetApplicationId, JSON.stringify(oDraft.open));
    expectCall("Only one open request per booking", await call("POST", `/b/${BOOKING}/unit-change`, { TargetUnitId: target.Id, Reason: "again" }), 409, "already open");
    expectCall("No cancellation while a unit change is open", await call("POST", "/c", { BookingId: BOOKING, Reason: "E2E" }), 409, "Unit change");
    expectCall("Its application can't be turned into a booking on its own", await call("POST", `/a/${r.TargetApplicationId}/create-booking`), 409, "unit change");
    const appDetail = (await call("GET", `/a/${r.TargetApplicationId}`)).json;
    check("The application says which unit change it is for", appDetail.unitChange?.RequestNo === r.RequestNo && appDetail.unitChange?.SourceBookingNo === src.BookingNo, JSON.stringify(appDetail.unitChange));
    expectCall("Withdraw the draft", await call("PUT", `/b/unit-changes/${r.Id}/withdraw`, { reason: "E2E: changed mind" }), 200);
    r = await req(r.Id);
    check("Withdrawn: unit and parking holds released, the application cancelled", r.Status === "Withdrawn" && (await held("Unit", target.Id)) === 0 && (await held("Parking", slot)) === 0
      && (await q(`SELECT Status FROM dbo.CrmApplication WHERE Id = ${r.TargetApplicationId}`))[0].Status === "Cancelled");

    section("Submit the application: the unit change goes for approval; reject");
    ({ made, r } = await start());
    check("Started again", made.status === 201, `${made.status} ${made.json?.error}`);
    const appId2 = r.TargetApplicationId;
    await q(`UPDATE dbo.CrmApplication SET CustomerId = NULL WHERE Id = ${appId2}`);
    expectCall("A unit change keeps the same buyer", await submit(appId2), 409, "same buyer");
    await q(`UPDATE dbo.CrmApplication SET CustomerId = ${src.CustomerId} WHERE Id = ${appId2}`);
    const sub2 = await submit(appId2);
    check("Submitting the application sends the unit change for approval (no booking made)", sub2.status === 200 && sub2.json?.unitChange?.id === r.Id
      && (await q(`SELECT COUNT(*) n FROM dbo.CrmBooking WHERE ApplicationId = ${appId2}`))[0].n === 0, `${sub2.status} ${JSON.stringify(sub2.json)}`);
    r = await req(r.Id);
    check("Waiting for approval", r.Status === "Pending");
    // Sent: what the approver sees can't change under them. The application is locked until it is withdrawn or rejected.
    expectCall("Its application can't be edited while it waits", await call("PUT", `/a/${appId2}`, { RatePerSqFt: 1 }), 409, "locked");
    check("Nor its extra charges", await require("../routes/crmExtraCharges").applyAddExtraChargeToApplication(pool, appId2, { Description: "E2E late add", Amount: 500 }, user)
      .then(() => false, (e) => e.status === 409));
    check("The application's rate is as submitted", near((await q(`SELECT RatePerSqFt FROM dbo.CrmApplication WHERE Id = ${appId2}`))[0].RatePerSqFt, r.RatePerSqFt));
    expectCall("Submitting it again is refused (it is the approvers' now)", await submit(appId2), 409, "already sent");
    check("And no booking was made from it", (await q(`SELECT COUNT(*) n FROM dbo.CrmBooking WHERE ApplicationId = ${appId2}`))[0].n === 0);
    check("Still one request, still Pending", (await req(r.Id)).Status === "Pending");
    expectCall("Reject needs a reason", await call("PUT", `/b/unit-changes/${r.Id}/reject`, { note: "" }), 400);
    expectCall("Reject it", await call("PUT", `/b/unit-changes/${r.Id}/reject`, { note: "E2E: price not agreed" }), 200);
    r = await req(r.Id);
    check("Rejected with its reason; holds released", r.Status === "Rejected" && r.Note === "E2E: price not agreed" && (await held("Unit", target.Id)) === 0 && (await held("Parking", slot)) === 0);

    section("The application as the buyer settles it: rate, parking and charges changed in the wizard");
    ({ made, r } = await start());
    const appId = r.TargetApplicationId;
    const newRate = Number(target.RatePerSqFt) + 250;
    // A slot of another project held on the application (its unit was moved to another project in the wizard).
    {
      const otherPid = (await q(`SELECT TOP 1 id FROM dbo.enterprise WHERE business_type = 'P' AND id <> ${src.ProjectId} ORDER BY id`))[0].id;
      const xs = (await q(`INSERT INTO dbo.ParkingSlot (ProjectId, SlotNo, ParkingType, IsActive, CreatedAt) OUTPUT INSERTED.Id VALUES (${otherPid}, 'E2E-XP-1', '${pm.ParkingType}', 1, SYSDATETIME())`))[0].Id;
      const xh = (await q(`INSERT INTO dbo.CrmInventoryHold (EntityType, EntityId, ApplicationId, HoldDays, HoldUntil, Reason, Status, CreatedAt) OUTPUT INSERTED.Id
        VALUES ('Parking', ${xs}, ${appId}, 3650, DATEADD(YEAR, 10, SYSDATETIME()), 'E2E', 'Active', SYSDATETIME())`))[0].Id;
      expectCall("A parking slot of another project on the application is caught at submit", await submit(appId), 409, "another project");
      await q(`UPDATE dbo.CrmInventoryHold SET Status = 'Released' WHERE Id = ${xh}`);
    }
    // The buyer's co-applicant corrected in the wizard: the correction is what reaches the new booking.
    await q(`UPDATE dbo.CrmCoApplicant SET Name = 'E2E Co Applicant Corrected' WHERE ApplicationId = ${appId} AND BookingId IS NULL`);
    await q(`UPDATE dbo.CrmApplication SET RatePerSqFt = ${newRate} WHERE Id = ${appId}`);
    // Another slot picked in the wizard's Parking step, and a new extra charge in its Extra Charges step.
    await require("../services/crmHoldService").placeHold(pool, { entityType: "Parking", entityId: slot2, applicationId: appId, reason: "E2E wizard pick", userId: user });
    await require("../routes/crmExtraCharges").applyAddExtraChargeToApplication(pool, appId, { Description: "E2E power backup", Amount: 3000 }, user);
    const sub = await submit(appId);
    check("Submitted", sub.status === 200 && sub.json?.unitChange?.id === r.Id, `${sub.status} ${JSON.stringify(sub.json)}`);
    r = await req(r.Id);
    const items = JSON.parse(r.AddOnsJson || "[]");
    check("The request takes the rate typed on the application", near(r.RatePerSqFt, newRate), `${r.RatePerSqFt} vs ${newRate}`);
    check("Kept: the old slot and charge; added: the new slot and charge", items.filter((x) => x.change === "kept").length === 2 && items.filter((x) => x.change === "added").length === 2, JSON.stringify(items));
    const quote = await require("../services/crmPriceQuote").quoteSale(pool, { unitIds: [target.Id], ratePerSqFt: newRate, paymentPlanId: r.PaymentPlanId, customerId: src.CustomerId,
      parkingBases: items.filter((x) => x.kind === "Parking").map((x) => x.amount), extraAmounts: items.filter((x) => x.kind === "ExtraCharge").map((x) => x.amount) });
    check("The request's new price is the GST-inclusive quote of the application", near(r.TargetEstimateAtRequest, quote.grandTotal), `${r.TargetEstimateAtRequest} vs ${quote.grandTotal}`);
    {
      const inbox = (await call("GET", "/ai?module=crm-unit-change")).json;
      const row = (Array.isArray(inbox) ? inbox : []).find((x) => Number(x.RecordId) === r.Id);
      const sum = row?.JournalVoucherSummary || "";
      check("The Approval Inbox row shows the whole decision: move, rate, kept / added items, money",
        /→/.test(sum) && /keeps .*E2E club membership/.test(sum) && /adds .*E2E power backup/.test(sum) && /received moves/.test(sum) && row?.CompanyName && row?.ProjectName, `${sum} | ${row?.CompanyName} | ${row?.ProjectName}`);
    }

    section("Approve: new booking, old booking closed, money moved");
    // The booking's brokerage, part of it already paid: it moves with the sale and is never raised again.
    const brk = await q(`SELECT Id, Status FROM dbo.CrmBrokerageMaster WHERE BookingId = ${BOOKING}`);
    if (brk.length) await q(`UPDATE dbo.CrmBrokerageMaster SET Status = 'Paid' WHERE Id = ${brk[0].Id}`);
    // Two levels in Approval Setup: nothing happens until the last level approves.
    await q(`UPDATE dbo.ApprovalWorkflows SET Levels = 2, LevelsData = N'[{"id":1,"label":"Sales Head","mode":"any","userIds":[],"roles":["admin"]},{"id":2,"label":"Director","mode":"any","userIds":[],"roles":["admin"]}]'
      WHERE active = 1 AND modules LIKE N'%"crm-unit-change"%'`);
    require("../services/approvalService").invalidateWorkflowCache?.();
    const ap1 = await call("PUT", `/b/unit-changes/${r.Id}/approve`, {});
    const r1 = await req(r.Id);
    check("Two levels: the first approval only moves it to the next level", ap1.status === 200 && r1.Status === "Pending" && !r1.TargetBookingId
      && (await q(`SELECT Status FROM dbo.CrmBooking WHERE Id = ${BOOKING}`))[0].Status === "Approved", `${ap1.status} ${JSON.stringify(ap1.json)} ${r1.Status}`);
    const ap = await call("PUT", `/b/unit-changes/${r.Id}/approve`, {});
    check("The last level's approval carries it out", ap.status === 200 && ap.json?.status === "Completed", `got ${ap.status} ${JSON.stringify(ap.json)}`);
    r = await req(r.Id);
    const nb = (await q(`SELECT b.*, a.Status AppStatus FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = ${r.TargetBookingId || 0}`))[0];
    check("New booking on the new unit, from the application, waiting for its own booking review (not approved by the unit change)",
      nb && nb.UnitId === target.Id && nb.ApplicationId === appId && nb.Status === "Pending" && nb.WorkflowStage === "Review" && !nb.ConfirmedAt && !nb.DirectorApprovedAt,
      JSON.stringify(nb && { u: nb.UnitId, s: nb.Status, w: nb.WorkflowStage }));
    check("No booking-amount receipt is drawn for it (the money came across)",
      (await require("../services/crmMoneyReceiptWorkflow").createMoneyReceiptAfterDataReview(pool, nb.Id, user)) === null
      && (await q(`SELECT COUNT(*) n FROM dbo.CrmMoneyReceipt WHERE BookingId = ${nb.Id} AND Status <> 'Bounced' AND ReceivedPaymentId IS NULL`))[0].n === 0);
    check("New booking at the application's rate: area x rate", nb && near(nb.RatePerSqFt, newRate) && near(nb.TotalValue, Math.round(Number(target.AreaSqFt) * newRate * 100) / 100), `${nb?.RatePerSqFt} ${nb?.TotalValue}`);
    const ob = (await q(`SELECT b.Status, b.ClosedByUnitChangeId FROM dbo.CrmBooking b WHERE b.Id = ${BOOKING}`))[0];
    check("Old booking closed as UnitChanged, linked to the request", ob.Status === "UnitChanged" && ob.ClosedByUnitChangeId === r.Id, JSON.stringify(ob));
    check("Old unit line released", (await q(`SELECT COUNT(*) n FROM dbo.CrmBookingUnit WHERE BookingId = ${BOOKING} AND Status = 'Active'`))[0].n === 0);
    const pk = await q(`SELECT ParkingSlotId, BookingId, IsActive FROM dbo.CrmParkingAllotment WHERE ParkingSlotId IN (${slot}, ${slot2}) ORDER BY Id`);
    check("The kept slot moved to the new booking (old allotment released)", pk.some((x) => x.ParkingSlotId === slot && x.BookingId === nb.Id && x.IsActive)
      && pk.filter((x) => x.BookingId === BOOKING).every((x) => !x.IsActive), JSON.stringify(pk));
    check("The slot picked in the wizard is allotted on the new booking", pk.some((x) => x.ParkingSlotId === slot2 && x.BookingId === nb.Id && x.IsActive), JSON.stringify(pk));
    check("No parking hold left behind", (await held("Parking", slot)) === 0 && (await held("Parking", slot2)) === 0);
    const ecs = await q(`SELECT Description, Amount FROM dbo.CrmExtraCharge WHERE BookingId = ${nb.Id} AND IsActive = 1 ORDER BY Id`);
    check("Both extra charges on the new booking", ecs.some((x) => x.Description === "E2E club membership" && near(x.Amount, 1000)) && ecs.some((x) => x.Description === "E2E power backup" && near(x.Amount, 3000)), JSON.stringify(ecs));
    check("The new booking's total is the price the approver saw", near(nb.GrandTotal, r.TargetEstimateAtRequest), `${nb.GrandTotal} vs ${r.TargetEstimateAtRequest}`);
    const moved = Number((await q(`SELECT ISNULL(SUM(Amount), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${nb.Id} AND ISNULL(Status, '') NOT IN ('Bounced', 'Void')`))[0].a);
    check("Every rupee received moved to the new booking", near(moved, received) && near(r.CreditCarriedAmount, received), `moved ${moved}, carried ${r.CreditCarriedAmount}, received ${received}`);
    const heldLeft = (await q(`SELECT Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE HeldSourceType = 'UnitChange' AND HeldSourceRefId = ${r.Id}`))[0];
    check("The held credit is used up", heldLeft && heldLeft.Status === "Applied" && near(heldLeft.Amount, heldLeft.AppliedAmount), JSON.stringify(heldLeft));
    const oldLeft = Number((await q(`SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${BOOKING} AND ISNULL(Status, '') NOT IN ('Bounced', 'Void', 'Applied')`))[0].a);
    check("Nothing left on the old booking", near(oldLeft, 0), `${oldLeft}`);
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
        const cn = await require("../services/crmGstNotes").requestCancel(pool, notes[0].Id, "E2E", { userId: user, email: "e2e@civilier.test", role: "super_admin" }).then(() => "allowed", (e) => e.message);
        check("A unit change's credit note can't be cancelled", /unit change/.test(cn), cn);
      }
      check("The request page lists its credit notes", ((await req(r.Id)).creditNotes || []).length === notes.length);
    }
    {
      const co = await q(`SELECT Name FROM dbo.CrmCoApplicant WHERE BookingId = ${nb.Id} AND ISNULL(IsActive, 1) = 1`);
      check("The co-applicant as corrected in the application is on the new booking, once", co.length === 1 && co[0].Name === "E2E Co Applicant Corrected", JSON.stringify(co));
    }
    if (brk.length) {
      const mv = await q(`SELECT Id, Status FROM dbo.CrmBrokerageMaster WHERE BookingId = ${nb.Id}`);
      check("Brokerage moved with the sale: paid part closed, nothing raised twice", mv.length === brk.length && mv.some((x) => x.Id === brk[0].Id && x.Status === "Paid")
        && (await q(`SELECT COUNT(*) n FROM dbo.CrmBrokerageMaster WHERE BookingId = ${BOOKING}`))[0].n === 0, JSON.stringify(mv));
    }
    expectCall("The closed booking can't be cancelled", await call("POST", "/c", { BookingId: BOOKING, Reason: "E2E" }), 400);

    section("A payment Finance verifies after the change follows the buyer");
    const late = (await q(`INSERT INTO dbo.CrmOnAccountPayment (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode, CreatedAt)
      OUTPUT INSERTED.Id VALUES ('E2E-LATE', ${BOOKING}, 5000, 0, 'Unapplied', CAST(SYSDATETIME() AS DATE), 'NEFT', SYSDATETIME())`))[0].Id;
    const fwd = await require("../services/crmEntityCreation").forwardIfUnitChanged(pool, BOOKING, late, user, "e2e@civilier.test");
    r = await req(r.Id);
    const late2 = (await q(`SELECT Status FROM dbo.CrmOnAccountPayment WHERE Id = ${late}`))[0];
    check("Forwarded to the new booking", fwd === true && late2.Status === "Applied" && near(r.CreditCarriedAmount, received + 5000) && r.Status === "Completed",
      `${fwd} ${late2.Status} ${r.CreditCarriedAmount} ${r.Status}`);

    section("A payment that bounces after the move comes off the new booking");
    {
      const sumNew = async () => Number((await q(`SELECT ISNULL(SUM(Amount), 0) a FROM dbo.CrmOnAccountPayment WHERE BookingId = ${nb.Id} AND ISNULL(Status, '') NOT IN ('Bounced', 'Void')`))[0].a);
      const before = await sumNew();
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
      check("Parking can't follow into another project", (ox.items || []).filter((x) => x.kind === "Parking").every((x) => x.change === "dropped"), JSON.stringify(ox.items));
      const banks = (await q("SELECT TOP 2 LHeadId FROM dbo.AccountHeadMaster ORDER BY CASE WHEN LHeadType = 'BK' THEN 0 ELSE 1 END, LHeadId")).map((b) => b.LHeadId);
      await q(`INSERT INTO dbo.CrmProjectBank (ProjectId, BankLHeadId, IsActive, CreatedAt) VALUES (${src.ProjectId}, ${banks[0]}, 1, SYSDATETIME()), (${other.id}, ${banks[1]}, 1, SYSDATETIME())`);
      const ox2 = (await call("GET", `/b/${nb.Id}/unit-change-options?unitId=${xu}`)).json;
      check("With banks tagged nothing stops it", ox2.blockers.length === 0, JSON.stringify(ox2.blockers));
      const xmade = await call("POST", `/b/${nb.Id}/unit-change`, { TargetUnitId: xu, Reason: "E2E: other company" });
      check("Started", xmade.status === 201, `got ${xmade.status} ${xmade.json?.error}`);
      const xsub = await submit(xmade.json?.applicationId);
      check("Its application submitted", xsub.status === 200 && xsub.json?.unitChange, `${xsub.status} ${JSON.stringify(xsub.json)}`);
      await call("PUT", `/b/unit-changes/${xmade.json?.id}/approve`, {});
      const xap = await call("PUT", `/b/unit-changes/${xmade.json?.id}/approve`, {});
      const xr = await req(xmade.json?.id);
      check("Approved: new booking open, money waiting for the Fund Transfer", xap.status === 200 && xr.Status === "MovingMoney" && xr.TargetBookingId && xr.FundTransferDocNo,
        `${xap.status} ${xr.Status} ${xr.FundTransferDocNo} ${xr.Note || xap.json?.error || ""}`);
      const rt = (await q(`SELECT t.Id, t.Status, t.Amount FROM dbo.CrmRebookingTransfer t JOIN dbo.CrmOnAccountPayment h ON h.Id = t.HeldOnAccountId
        WHERE h.HeldSourceType = 'UnitChange' AND h.HeldSourceRefId = ${xr.Id}`))[0];
      check("The whole credit is reserved for the transfer", rt && near(rt.Amount, xr.MovedAmount), JSON.stringify(rt) + " moved " + xr.MovedAmount);
      if (rt) {
        const applied = await require("../routes/crmRefunds").applyRebookingTransferToBooking(pool, rt.Id, "e2e@civilier.test");
        const xr2 = await req(xr.Id);
        check("Once applied, the change completes", xr2.Status === "Completed" && near(xr2.CreditCarriedAmount, xr2.MovedAmount), `${xr2.Status} ${xr2.CreditCarriedAmount} ${JSON.stringify(applied)}`);
      }
    }

    section("Listed");
    const list = (await call("GET", "/b/unit-changes?status=All&page=1&pageSize=25")).json;
    check("Its three requests listed, with counts", list.rows.filter((x) => x.SourceBookingId === BOOKING).length === 3 && list.counts.Completed >= 1 && list.counts.Withdrawn >= 1, JSON.stringify(list.counts));
    const byBooking = (await call("GET", `/b/${nb.Id}/unit-change`)).json;
    check("The booking page shows its latest unit change (here its own move on to the other company)", byBooking?.SourceBookingId === nb.Id && byBooking?.Id !== r.Id, JSON.stringify(byBooking && { id: byBooking.Id, s: byBooking.SourceBookingId }));
    expectCall("An unknown request is not found", await call("GET", "/b/unit-changes/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
