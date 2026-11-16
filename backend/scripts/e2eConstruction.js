// End-to-end test of construction progress read live from the DPR module: the roll-up (checked against an independent
// computation from the raw DPR rows), works in site order, now/next, towers, units, what moved, notes for buyers, the
// buyer's portal, and payment milestones ready to demand. Real routes and real SQL on the DEVELOPMENT database through
// scripts/e2eHarness.js, inside one transaction that is rolled back. Runs on TEST RESIDENCE (project 16).
//   node scripts/e2eConstruction.js
const { openHarness } = require("./e2eHarness");

const PROJECT = 16;   // TEST RESIDENCE
const BOOKING = 206;  // BKG-2026-00126, ZZTEST, in TEST RESIDENCE
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmConstructionUpdate) U, (SELECT CHECKSUM_AGG(CHECKSUM(Id, DprGroupId)) FROM dbo.CrmMilestoneMaster) M,
  (SELECT CHECKSUM_AGG(CHECKSUM(Status, ProgressPercent)) FROM dbo.DependencyActivityAssignment WHERE IsCurrent = 1) A`;
const near = (a, b, tol = 0.05) => Math.abs(Number(a) - Number(b)) <= tol;
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

(async () => {
  const h = await openHarness({ mounts: { "/cu": "crmConstructionUpdates", "/p": "crmPortal" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user, role: "super_admin", email: "e2e@civilier.test", name: "E2E" });
    const rawSql = `
      SELECT dm.TowerId, dm.FlatId, am.group_id AS GroupId, dma.SequenceNo, daa.Id AS AsgId, dma.Id AS RungId, daa.Status, daa.ProgressPercent, daa.Days, daa.EndDate, am.days_of_completion
      FROM dbo.DependencyMaster dm JOIN dbo.DependencyMasterActivity dma ON dma.DependencyMasterId = dm.Id
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.DependencyActivityAssignment daa ON daa.DependencyMasterActivityId = dma.Id AND daa.IsCurrent = 1
      WHERE dm.IsActive = 1 AND dm.ProjectId = ${PROJECT} AND ISNULL(daa.Status, '') <> 'CANCELLED'`;
    let raw = await q(rawSql);
    check("The project has DPR steps", raw.length > 0, `${raw.length}`);
    const pctOf = (r) => (["COMPLETED", "APPROVED"].includes(r.Status) ? 100
      : ["IN_PROGRESS", "HOLD", "REWORK"].includes(r.Status) ? Math.min(100, Math.max(0, Number(r.ProgressPercent) || 0)) : 0);
    const wOf = (r) => Number(r.Days) || Number(r.days_of_completion) || 1;
    const expected = (rows) => { const w = rows.reduce((n, r) => n + wOf(r), 0); return w ? round1(rows.reduce((n, r) => n + wOf(r) * pctOf(r), 0) / w) : null; };
    const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0); yesterday.setDate(yesterday.getDate() - 1);
    const lateCount = (rows) => rows.filter((r) => pctOf(r) < 100 && r.EndDate && new Date(r.EndDate) >= new Date("2000-01-01") && new Date(r.EndDate) <= yesterday).length;
    const list = async () => (await call("GET", "/cu/progress")).json?.projects?.find((x) => x.projectId === PROJECT);

    section("The roll-up matches the DPR rows");
    let p = await list();
    check("Project %: every step weighted by its planned days", p && near(p.pct, expected(raw)), `${p?.pct} vs ${expected(raw)}`);
    check("Project behind schedule", p.late === lateCount(raw), `${p.late} vs ${lateCount(raw)}`);
    check("Steps, done and under way", p.steps === raw.length && p.done === raw.filter((r) => pctOf(r) >= 100).length
      && p.moving === raw.filter((r) => ["IN_PROGRESS", "HOLD", "REWORK"].includes(r.Status)).length, `${p.steps}/${p.done}/${p.moving}`);
    for (const t of p.towers) {
      const rows = raw.filter((r) => Number(r.TowerId) === Number(t.blockId));
      check(`Tower ${t.blockName}: %`, near(t.pct, expected(rows)) && t.steps === rows.length, `${t.pct} vs ${expected(rows)}`);
      check(`Tower ${t.blockName}: behind schedule`, t.late === lateCount(rows), `${t.late} vs ${lateCount(rows)}`);
    }
    for (const w of p.works) {
      const rows = raw.filter((r) => r.GroupId === w.groupId);
      check(`Work ${w.name}: %`, near(w.pct, expected(rows)) && w.steps === rows.length, `${w.pct} vs ${expected(rows)}`);
    }
    const avgSeq = (g) => { const rows = raw.filter((r) => r.GroupId === g); return rows.reduce((n, r) => n + Number(r.SequenceNo), 0) / rows.length; };
    check("Works are in site order", p.works.every((w, i) => i === 0 || avgSeq(p.works[i - 1].groupId) <= avgSeq(w.groupId)), p.works.map((w) => w.name).join(" > "));
    check("Names read naturally (numbering dropped)", p.works.every((w) => !/^\d/.test(w.name)), p.works.map((w) => w.name).join(", "));
    check("Now = the works under way", p.now.every((n) => { const w = p.works.find((x) => x.name === n.name); return w && ((w.pct > 0 && w.pct < 100) || w.moving > 0); }), JSON.stringify(p.now));

    section("It moves with the site");
    const first = p.works[0];
    await q(`UPDATE daa SET Status = 'COMPLETED', ProgressPercent = 100, UpdatedAt = SYSDATETIME()
      FROM dbo.DependencyActivityAssignment daa JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      WHERE daa.IsCurrent = 1 AND daa.Status <> 'CANCELLED' AND dm.IsActive = 1 AND dm.ProjectId = ${PROJECT} AND am.group_id = ${first.groupId}`);
    for (const r of raw.filter((x) => x.GroupId === first.groupId && !x.AsgId)) {
      await q(`INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, Status, ProgressPercent, IsCurrent, AttemptNo, CreatedAt, UpdatedAt)
        VALUES (${r.RungId}, 'COMPLETED', 100, 1, 1, SYSDATETIME(), SYSDATETIME())`);
    }
    // One step of the second work moves 0 -> 40%, logged the way the DPR screens log it.
    const second = p.works[1];
    const mover = (await q(`SELECT TOP 1 daa.Id FROM dbo.DependencyActivityAssignment daa JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      WHERE daa.IsCurrent = 1 AND daa.Status NOT IN ('CANCELLED', 'COMPLETED', 'APPROVED') AND dm.IsActive = 1 AND dm.ProjectId = ${PROJECT} AND am.group_id = ${second?.groupId ?? 0}`))[0];
    if (mover) {
      await q(`UPDATE dbo.DependencyActivityAssignment SET Status = 'IN_PROGRESS', ProgressPercent = 40, UpdatedAt = SYSDATETIME() WHERE Id = ${mover.Id}`);
      await q(`INSERT INTO dbo.DependencyActivityProgressLog (AssignmentId, FromProgressPercent, ToProgressPercent, Remarks, StatusAfter, LoggedBy, LoggedAt)
        VALUES (${mover.Id}, 0, 40, 'E2E', 'IN_PROGRESS', ${user}, SYSDATETIME())`);
      // A save of remarks only is logged without a % (dependencyActivityAssignment.js): not a move.
      await q(`INSERT INTO dbo.DependencyActivityProgressLog (AssignmentId, FromProgressPercent, ToProgressPercent, Remarks, StatusAfter, LoggedBy, LoggedAt)
        VALUES (${mover.Id}, NULL, NULL, 'E2E remark only', 'IN_PROGRESS', ${user}, SYSDATETIME())`);
    }
    raw = await q(rawSql);
    p = await list();
    check(`${first.name} is now complete`, p.works.find((w) => w.groupId === first.groupId).pct === 100);
    check("The project % follows", near(p.pct, expected(raw)), `${p.pct} vs ${expected(raw)}`);
    if (mover) check(`${second.name} shows under way`, p.now.some((n) => n.name === second.name), JSON.stringify(p.now));
    check("Next is the first work not started after the last one started", p.next == null || p.works.find((w) => w.name === p.next)?.pct === 0, `${p.next}`);

    section("Project detail: units and what moved");
    const d = (await call("GET", `/cu/progress/${PROJECT}`)).json;
    const flats = [...new Set(raw.map((r) => r.FlatId))];
    check("Every unit with DPR work is listed with its %", d.units.length === flats.length
      && d.units.every((u) => near(u.pct, expected(raw.filter((r) => r.FlatId === u.unitId)))), JSON.stringify(d.units.map((u) => [u.unitName, u.pct])));
    check("What moved shows the completion and the logged %", d.feed.some((f) => f.completed && f.work === first.name)
      && (!mover || d.feed.some((f) => f.from === 0 && f.to === 40)), JSON.stringify(d.feed.slice(0, 3)));
    check("A save of remarks only is not shown as a move", d.feed.every((f) => f.to != null), JSON.stringify(d.feed.filter((f) => f.to == null)));
    const tower = p.towers[0];
    const dt = (await call("GET", `/cu/progress/${PROJECT}?blockId=${tower.blockId}`)).json;
    check("A tower's detail has the tower's % and only its units", near(dt.pct, tower.pct) && dt.units.every((u) => Number(u.blockId) === Number(tower.blockId)), `${dt.pct} vs ${tower.pct}`);
    const selectedUnit = dt.units[0];
    if (selectedUnit) {
      const du = (await call("GET", `/cu/progress/${PROJECT}?blockId=${tower.blockId}&unitId=${selectedUnit.unitId}`)).json;
      check("A selected unit returns its own progress and construction stages", du.selectedUnit?.unitId === selectedUnit.unitId
        && near(du.pct, selectedUnit.pct) && du.works.length > 0, JSON.stringify({ pct: du.pct, expected: selectedUnit.pct, stages: du.works?.length }));
      check("A selected unit's behind-schedule count is its own", du.late === lateCount(raw.filter((r) => r.FlatId === selectedUnit.unitId)), `${du.late}`);
      check("A selected unit's recent activity is limited to that unit", du.feed.every((event) => !event.unit || event.unit === selectedUnit.unitName), JSON.stringify(du.feed.slice(0, 3)));
      expectCall("A unit outside the selected block is refused", await call("GET", `/cu/progress/${PROJECT}?blockId=${tower.blockId}&unitId=999999`), 404);
    } else check("A unit with DPR work exists in the selected block", false);
    expectCall("A block with no project progress is refused", await call("GET", `/cu/progress/${PROJECT}?blockId=999999`), 404);
    expectCall("A project out of reach is refused", await call("GET", "/cu/progress/0"), 400);

    section("Notes for buyers");
    expectCall("A note needs text", await call("POST", "/cu", { ProjectId: PROJECT, Summary: " " }), 400, "note");
    expectCall("Add a note", await call("POST", "/cu", { ProjectId: PROJECT, Summary: "E2E: slab work on schedule." }), 201);
    const n = (await q(`SELECT TOP 1 PercentComplete, Stage FROM dbo.CrmConstructionUpdate WHERE ProjectId = ${PROJECT} ORDER BY Id DESC`))[0];
    check("It carries the live % and the work under way (not typed)", near(n.PercentComplete, p.pct) && (n.Stage === (p.now[0]?.name || p.next)), JSON.stringify(n));

    section("Portal: the buyer sees the live progress");
    {
      const bk = (await q(`
        SELECT TOP 1 b.ApplicationId, a.CustomerId
        FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        JOIN dbo.UnitMaster u ON u.Id = b.UnitId
        WHERE b.IsActive = 1
          AND EXISTS (SELECT 1 FROM dbo.DependencyMaster dm WHERE dm.ProjectId = u.ProjectId AND dm.FlatId = u.Id AND dm.IsActive = 1)
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = b.Id AND bp.Status = N'Active')
        ORDER BY b.Id DESC`))[0];
      const pu = (await q("SELECT TOP 1 Id FROM dbo.CrmCustomerPortalUser WHERE IsActive = 1 ORDER BY Id"))[0];
      h.setPortal({ portalUserId: pu.Id, customerId: bk.CustomerId });
      const tl = (await call("GET", `/p/timeline?applicationId=${bk.ApplicationId}`)).json;
      const cp = tl.constructionProgress;
      check("Only the buyer's booked unit is returned", cp?.scope === "unit" && cp.unit?.works?.length > 0, JSON.stringify(cp)?.slice(0, 200));
    }
    const plotBuyer = (await q(`
      SELECT TOP 1 b.ApplicationId, a.CustomerId, pm.ProjectId
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmBookingPlot bp ON bp.BookingId = b.Id AND bp.Status = N'Active'
      JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId
      JOIN dbo.UnitMaster um ON um.Id = pm.ConvertedUnitId
      WHERE b.IsActive = 1 AND EXISTS (SELECT 1 FROM dbo.DependencyMaster dm WHERE dm.ProjectId = pm.ProjectId AND dm.IsActive = 1)
      ORDER BY bp.IsPrimary DESC, b.Id DESC`))[0];
    if (plotBuyer) {
      const pu = (await q("SELECT TOP 1 Id FROM dbo.CrmCustomerPortalUser WHERE IsActive = 1 ORDER BY Id"))[0];
      h.setPortal({ portalUserId: pu.Id, customerId: plotBuyer.CustomerId });
      const plotTimeline = (await call("GET", `/p/timeline?applicationId=${plotBuyer.ApplicationId}`)).json;
      check("Converted plot buyer receives only the linked unit's progress", plotTimeline.constructionProgress?.scope === "unit"
        && plotTimeline.constructionProgress.unit?.works?.length > 0, JSON.stringify(plotTimeline.constructionProgress)?.slice(0, 200));
    } else check("Converted plot buyer with unit DPR available", true, "Skipped: no active converted plot on a project with DPR in development data");

    section("Milestones ready to demand");
    const links = (await call("GET", "/cu/milestone-links")).json;
    check("DPR works and milestones are offered", links.groups.length > 0 && links.milestones.length > 0);
    const ms = (await q(`SELECT TOP 1 ti.MilestoneMasterId, m.MilestoneNo FROM dbo.CrmBooking b
      JOIN dbo.CrmPaymentMilestone m ON m.BookingId = b.Id AND m.ExtraChargeId IS NULL AND m.ParkingAllotmentId IS NULL
      JOIN dbo.CrmPaymentPlanTemplateItem ti ON ti.PlanTemplateId = b.PaymentPlanId AND ti.MilestoneNo = m.MilestoneNo
      WHERE b.Id = ${BOOKING} AND ti.MilestoneMasterId IS NOT NULL ORDER BY m.MilestoneNo DESC`))[0];
    if (!ms) check("A booking milestone to test with", false, "none");
    else {
      await q(`UPDATE dbo.CrmPaymentMilestone SET Status = 'Pending', AmountPaid = 0, DemandStatus = 'Pending' WHERE BookingId = ${BOOKING} AND MilestoneNo = ${ms.MilestoneNo}`);
      await q(`UPDATE dbo.CrmBooking SET Status = 'Approved', IsActive = 1 WHERE Id = ${BOOKING}`);
      expectCall("Link the milestone to the completed work", await call("PUT", "/cu/milestone-links", { links: [{ id: ms.MilestoneMasterId, groupId: first.groupId }] }), 200);
      const hit = ((await call("GET", `/cu/ready-demands?bookingId=${BOOKING}`)).json || []).find((r) => r.MilestoneNo === ms.MilestoneNo);
      check("Its work is complete: ready to demand", !!hit && hit.work === first.name && ["Unit", "Tower", "Project"].includes(hit.judgedOn), JSON.stringify(hit));

      // The plan's own level decides where the work is judged: open one step of this work in another tower.
      const bk = (await q(`SELECT b.UnitId, u.BlockId, b.PaymentPlanId FROM dbo.CrmBooking b JOIN dbo.UnitMaster u ON u.Id = b.UnitId WHERE b.Id = ${BOOKING}`))[0];
      // The test booking sits in a tower the site tracks this work in (rolled back with the rest).
      const workTowers = [...new Set(raw.filter((r) => r.GroupId === first.groupId && r.TowerId).map((r) => Number(r.TowerId)))];
      if (workTowers.length > 1 && !workTowers.includes(Number(bk.BlockId))) {
        bk.BlockId = workTowers[0];
        await q(`UPDATE dbo.UnitMaster SET BlockId = ${bk.BlockId} WHERE Id = ${bk.UnitId}`);
      }
      const elsewhere = (await q(`SELECT TOP 1 daa.Id FROM dbo.DependencyActivityAssignment daa JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        WHERE daa.IsCurrent = 1 AND dm.IsActive = 1 AND dm.ProjectId = ${PROJECT} AND am.group_id = ${first.groupId} AND ISNULL(dm.TowerId, 0) <> ${bk.BlockId}`))[0];
      const towerHasWork = raw.some((r) => Number(r.TowerId) === Number(bk.BlockId) && r.GroupId === first.groupId);
      if (elsewhere && towerHasWork) {
        await q(`UPDATE dbo.DependencyActivityAssignment SET Status = 'IN_PROGRESS', ProgressPercent = 50 WHERE Id = ${elsewhere.Id}`);
        await q(`UPDATE dbo.CrmUnitPaymentPlan SET IsActive = 0 WHERE PlanId = ${bk.PaymentPlanId}`);
        await q(`UPDATE dbo.CrmBlockPaymentPlan SET IsActive = 0 WHERE PlanId = ${bk.PaymentPlanId}`);
        const readyNow = async () => ((await call("GET", `/cu/ready-demands?bookingId=${BOOKING}`)).json || []).find((r) => r.MilestoneNo === ms.MilestoneNo);
        check("Plan set for the project: waits for the work across the project", !(await readyNow()));
        await q(`INSERT INTO dbo.CrmBlockPaymentPlan (BlockId, PlanId, IsActive) VALUES (${bk.BlockId}, ${bk.PaymentPlanId}, 1)`);
        const tw = await readyNow();
        check("Plan set for the tower: ready once the tower's work is complete", tw?.judgedOn === "Tower", JSON.stringify(tw));
        await q(`INSERT INTO dbo.CrmUnitPaymentPlan (UnitId, PlanId, IsActive) VALUES (${bk.UnitId}, ${bk.PaymentPlanId}, 1)`);
        const un = await readyNow();
        const unitHasWork = raw.some((r) => Number(r.FlatId) === Number(bk.UnitId) && r.GroupId === first.groupId);
        check("Plan set for the unit: judged on the unit (its tower when the unit has no DPR steps)", un?.judgedOn === (unitHasWork ? "Unit" : "Tower"), JSON.stringify(un));
        await q(`UPDATE dbo.DependencyActivityAssignment SET Status = 'COMPLETED', ProgressPercent = 100 WHERE Id = ${elsewhere.Id}`);
      } else check("Plan level checks", true, "Skipped: the project has this work in one tower only");
      if (second) {
        await call("PUT", "/cu/milestone-links", { links: [{ id: ms.MilestoneMasterId, groupId: second.groupId }] });
        check("Linked to a work not complete: not listed", !((await call("GET", `/cu/ready-demands?bookingId=${BOOKING}`)).json || []).some((r) => r.MilestoneNo === ms.MilestoneNo));
      }
      await call("PUT", "/cu/milestone-links", { links: [{ id: ms.MilestoneMasterId, groupId: first.groupId }] });
      await q(`UPDATE dbo.CrmPaymentMilestone SET DemandStatus = 'Demanded' WHERE BookingId = ${BOOKING} AND MilestoneNo = ${ms.MilestoneNo}`);
      check("Once demanded it is no longer listed", !((await call("GET", `/cu/ready-demands?bookingId=${BOOKING}`)).json || []).some((r) => r.MilestoneNo === ms.MilestoneNo));
      expectCall("Set to no DPR work on purpose", await call("PUT", "/cu/milestone-links", { links: [{ id: ms.MilestoneMasterId, groupId: null }] }), 200);
      const after = (await call("GET", "/cu/milestone-links")).json.milestones.find((m) => m.id === ms.MilestoneMasterId);
      check("It stays unlinked (no name match brings it back)", after.groupId == null && after.matched === false, JSON.stringify(after));
      expectCall("A DPR work that doesn't exist is refused", await call("PUT", "/cu/milestone-links", { links: [{ id: ms.MilestoneMasterId, groupId: 999999 }] }), 400, "does not exist");
    }
    const byName = (await call("GET", "/cu/milestone-links")).json.milestones.filter((m) => m.matched);
    check("Milestones with the same name as a DPR work are matched by name", byName.every((m) => m.groupId), JSON.stringify(byName));
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
