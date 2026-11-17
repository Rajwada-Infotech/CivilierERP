// LEGAL MODULE PRESENTATION DATA — for showing every Legal page and stage (live or any database).
// WIPES every Legal record (lands, enquiries, deed searches, deed process / registration, payments, documents, audit) and
// loads a demo set: 10 enquiries in 2 projects at every status, Deed Registry Search at every stage, and 4 lands at
// Draft → Deed Process → Deed Registration (part paid) → Registered (post-registration under way).
// Setup masters and reference lists are kept. One transaction: if any step fails nothing is changed.
// Demo records are marked: enquiries DEMO-ENQ-xxxx, lands DEMO/xxxxx, documents DEMO-DOC-xxxxx.
// Not a migration — it runs only when you run it, and asks for the database name so it can't run by mistake:
//   cd backend && node scripts/legal-demo-seed.js --confirm=<DB_NAME>            (projects: the first two)
//   cd backend && node scripts/legal-demo-seed.js --confirm=<DB_NAME> --projects=117,86
// Remove afterwards: node scripts/legal-demo-remove.js --confirm=<DB_NAME>
require("dotenv").config();
const { connectDB, sql } = require("../db");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || "";
// Setup masters / reference lists that stay.
const KEEP = [
  "LegalAreaUnit", "LegalChecklistItem", "LegalChecklistTemplate", "LegalDeedType", "LegalDistrict", "LegalDocumentType", "LegalLawReference",
  "LegalLookupValue", "LegalRegistrationOfficeType", "LegalRegistryOfficeSla", "LegalRuleConfig", "LegalStatusReason", "LegalSuccessionRule",
  "LegalWorkflowStep", "LegalApprovalAuthority", "LegalPortalLink", "LegalPortalApi", "LegalRegistrationOffice", "LegalMouza", "LegalBlock",
  "LegalMunicipality", "LegalPoliceStation", "LegalSubDivision", "LegalVillage", "LegalMasterFile", "LegalTaskType", "LegalReminderSla",
  "LegalApprovalWorkflow", "LegalAdvocate", "LegalPerson", "LegalParty", "LegalRsKhatian", "LegalRsPlot", "LegalLrRor",
];

(async () => {
  const pool = await connectDB();
  const one = async (s) => (await pool.request().query(s)).recordset[0];
  const db = (await one("SELECT DB_NAME() AS d, @@SERVERNAME AS s")) ;
  if (!arg("confirm") || arg("confirm") !== db.d) throw new Error(`Run with --confirm=${db.d} (server ${db.s}). This wipes every Legal record in that database.`);

  // What this database has: two projects, a district with two mouzas, the Katha unit, users for each role, a file.
  const pids = arg("projects") ? arg("projects").split(",").map(Number) : (await pool.request().query("SELECT TOP 2 id FROM dbo.enterprise WHERE business_type = 'P' ORDER BY id")).recordset.map((r) => r.id);
  if (pids.length < 2) throw new Error("Need two projects (enterprise business_type 'P'); pass --projects=<id>,<id>");
  const [GREENS, GRAND] = pids;
  const dist = await one("SELECT TOP 1 d.DistrictId FROM dbo.LegalDistrict d WHERE EXISTS (SELECT 1 FROM dbo.LegalMouza m WHERE m.DistrictId = d.DistrictId) ORDER BY CASE WHEN d.DistrictName LIKE N'%North 24%' THEN 0 ELSE 1 END, d.DistrictId");
  if (!dist) throw new Error("No district with mouzas in Setup (Legal → Setup → Mouza)");
  const DIST = dist.DistrictId;
  const mz = (await pool.request().input("D", sql.Int, DIST).query("SELECT TOP 2 MouzaId FROM dbo.LegalMouza WHERE DistrictId = @D ORDER BY MouzaId")).recordset.map((r) => r.MouzaId);
  const [RAJARHAT, KADAMPUKUR = mz[0]] = mz;
  const KATHA = (await one("SELECT TOP 1 AreaUnitId FROM dbo.LegalAreaUnit ORDER BY CASE WHEN UnitName LIKE N'Katha%' THEN 0 ELSE 1 END, AreaUnitId"))?.AreaUnitId;
  if (!KATHA) throw new Error("No area unit in Setup");
  const users = (await pool.request().query(`SELECT TOP 4 u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE ISNULL(u.discontinue, 0) = 0 AND LOWER(r.RName) IN (N'super admin', N'super_admin', N'admin') ORDER BY u.id`)).recordset.map((r) => r.id);
  if (!users.length) throw new Error("No active admin user found");
  const U = { entry: users[0], verifier: users[1] ?? users[0], l1: users[2] ?? users[0], l2: users[3] ?? users[1] ?? users[0] };
  const files = (await pool.request().query("SELECT TOP 2 FileId FROM dbo.LegalMasterFile ORDER BY FileId DESC")).recordset.map((r) => r.FileId);
  const FILE = files[0] ?? null, FILE2 = files[1] ?? files[0] ?? null;
  console.log(`Database ${db.d} on ${db.s} · projects ${GREENS}, ${GRAND} · district ${DIST} · users ${Object.values(U).join(", ")} · ${FILE ? "documents attached" : "no file to attach (documents without a file)"}`);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  const q = async (s) => (await new sql.Request(tx).query(s)).recordset;
  try {
    // ── 1. Clear ──
    await q("UPDATE dbo.LegalLand SET EnquiryId = NULL; UPDATE dbo.LegalLandEnquiry SET LandId = NULL;");
    await q("IF COL_LENGTH('dbo.LegalRsPlot','LandId') IS NOT NULL EXEC('UPDATE dbo.LegalRsPlot SET LandId = NULL')");
    let left = (await q(`SELECT t.name FROM sys.tables t WHERE t.name LIKE N'Legal%' AND t.name NOT IN (${KEEP.map((k) => `N'${k}'`).join(",")})`)).map((r) => r.name);
    for (let pass = 0; pass < 15 && left.length; pass++) {
      const next = [];
      for (const t of left) {
        await q("SAVE TRAN s1");
        try { await q(`DELETE FROM dbo.${t}`); } catch { await q("ROLLBACK TRAN s1"); next.push(t); }
      }
      left = next;
    }
    if (left.length) throw new Error(`Could not clear: ${left.join(", ")}`);
    console.log("✓ Legal records cleared (Setup masters kept)");

    const look = (cat, name) => `(SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'${cat}' AND Name = N'${name}')`;
    const doc = (name) => `(SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'${name}')`;
    const day = (n) => `CAST(DATEADD(day, ${n}, GETDATE()) AS DATE)`;

    // ── 2. Enquiries ──  [no, project, location, mouza, jl, rsDag, lrDag, rsKh, lrKh, area, price, status, days ago, source]
    const ENQ = [
      ["DEMO-ENQ-001", GREENS, "Greens phase 2 — east corner, Rajarhat", RAJARHAT, "105", "441", "1410", "221", "2290", 6, 3600000, "New", 0, "Broker"],
      ["DEMO-ENQ-002", GREENS, "Behind Rajarhat bus depot", RAJARHAT, "105", "452", "1433", "226", "2302", 4, 2600000, "Under Review", 12, "Direct Owner"],
      ["DEMO-ENQ-003", GREENS, "Canal-side plot, Rajarhat", RAJARHAT, "105", "433", "1402", "219", "2264", 8, 4800000, "Interested", 5, "Reference"],
      ["DEMO-ENQ-004", GRAND, "Kadampukur school road", KADAMPUKUR, "27", "162", "611", "91", "958", 10, 5500000, "Interested", 15, "Broker"],
      ["DEMO-ENQ-005", GRAND, "Kadampukur bus stand, east side", KADAMPUKUR, "27", "157", "602", "88", "941", 5, 3100000, "On Hold", 3, "Website"],
      ["DEMO-ENQ-006", GRAND, "Low land near Kadampukur bheri", KADAMPUKUR, "27", "171", "630", "95", "977", 12, 2400000, "Rejected", 20, "Walk-in"],
      // Converted — each becomes a land at a later stage.
      ["DEMO-ENQ-007", GREENS, "Rajarhat main road, north plot", RAJARHAT, "105", "418", "1376", "94", "2215", 5, 3000000, "Converted to Land Record", 40, "Direct Owner"],
      ["DEMO-ENQ-008", GREENS, "Chowmatha junction plot, Rajarhat", RAJARHAT, "105", "425", "1389", "97", "2241", 7, 4200000, "Converted to Land Record", 55, "Broker"],
      ["DEMO-ENQ-009", GRAND, "Kadampukur canal road", KADAMPUKUR, "27", "149", "588", "84", "915", 8, 4800000, "Converted to Land Record", 70, "Reference"],
      ["DEMO-ENQ-010", GRAND, "Kadampukur market back plot", KADAMPUKUR, "27", "140", "571", "80", "902", 6, 3600000, "Converted to Land Record", 90, "Broker"],
    ];
    for (const [no, p, loc, m, jl, rd, ld, rk, lk, area, price, st, ago, src] of ENQ) {
      await q(`INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
          ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
        VALUES (N'${no}', ${day(-ago)}, N'2026-27', ${look("enquiry-source", src)}, N'${loc}', ${DIST}, ${m}, N'${jl}', ${area}, ${KATHA},
          N'Seller contact', N'9830012345', ${price}, ${U.entry}, N'${st}', ${p}, N'${rd}', N'${ld}', N'${rk}', N'${lk}',
          N'Demo enquiry — ${st}.', 1, ${U.entry})`);
    }
    // RS / LR records of each enquiry (one each; ENQ-3 covers two Dags), deed area a little under the total.
    await q(`UPDATE dbo.LegalLandEnquiry SET DeedArea = ApproxArea - 0.25;
      INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy)
        SELECT EnquiryId, MouzaId, RsKhatianNo, RsDagNo, N'Nitai Sarkar', ApproxArea, AreaUnitId, CreatedBy FROM dbo.LegalLandEnquiry;
      INSERT INTO dbo.LegalEnquiryLrRecord (EnquiryId, MouzaId, LrKhatianNo, LrDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy)
        SELECT EnquiryId, MouzaId, LrKhatianNo, LrDagNo, N'Bimal Sarkar & Kamal Sarkar', ApproxArea, AreaUnitId, CreatedBy FROM dbo.LegalLandEnquiry;
      INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy)
        SELECT EnquiryId, MouzaId, N'219', N'434', N'Nitai Sarkar', 2, AreaUnitId, CreatedBy FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003';
      UPDATE dbo.LegalLandEnquiry SET RsDagNo = N'433, 434' WHERE EnquiryNo = N'DEMO-ENQ-003';`);
    // Office timelines for every enquiry (as saving an enquiry does).
    await q(`INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate)
      SELECT e.EnquiryId, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear, DATEADD(day, t.SlaDays, e.EnquiryDate)
      FROM dbo.LegalLandEnquiry e JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
      JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1 AND (t.StateName IS NULL OR t.StateName = d.State)`);
    const adsr = (await q("SELECT TOP 1 OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeType = N'ADSR'"))[0]?.OfficeId ?? null;
    if (adsr) await q(`UPDATE dbo.LegalEnquiryOfficeSearch SET OfficeId = ${adsr} WHERE OfficeType = N'ADSR'`);

    // Year results: found years + the rest of 1956 → this year as not found; then the office is completed.
    const year = new Date().getFullYear();
    const office = async (no, type, found, { complete = true, upTo = year, remarks = null } = {}) => {
      const e = `(SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'${no}')`;
      for (const [y, deed, parties] of found) {
        await q(`INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
          SELECT o.EnquiryId, o.OfficeType, o.OfficeId, ${y}, N'Found', o.SlaDays, o.DueDate, N'${deed}', '${y}-03-15', N'${parties}', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', ${U.verifier}, ${U.verifier}, SYSUTCDATETIME()
          FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = ${e} AND o.OfficeType = N'${type}'`);
      }
      await q(`WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < ${upTo})
        INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
        SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', ${U.verifier}, ${U.verifier}, SYSUTCDATETIME()
        FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
        WHERE o.EnquiryId = ${e} AND o.OfficeType = N'${type}'
          AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
        OPTION (MAXRECURSION 400)`);
      if (complete) await q(`UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = ${U.verifier}, CompletedAt = SYSUTCDATETIME(),
          Remarks = N'${remarks ?? `1956–${year} searched; ${found.length ? `${found.length} deed(s) found` : "nothing found"}.`}'
        WHERE EnquiryId = ${e} AND OfficeType = N'${type}'`);
    };
    // ENQ-3: partly searched (ADSR + BLRO done, DSR half way, RA Calcutta not started).
    await office("DEMO-ENQ-003", "ADSR", [[2009, "I-0874/2009", "Haripada Ghosh → Sukanta Ghosh"]]);
    await office("DEMO-ENQ-003", "BLRO", []);
    await office("DEMO-ENQ-003", "DSR", [], { complete: false, upTo: 1990 });
    // ENQ-4: every office done → ready to convert. Converted ones: every office done.
    for (const no of ["DEMO-ENQ-004", "DEMO-ENQ-007", "DEMO-ENQ-008", "DEMO-ENQ-009", "DEMO-ENQ-010"]) {
      await office(no, "ADSR", [[2011, `I-${no.slice(-2)}12/2011`, "Previous owner → present seller"]]);
      for (const t of ["DSR", "RA Calcutta", "BLRO"]) await office(no, t, []);
    }
    console.log("✓ 10 enquiries in 2 projects, office timelines and year results");

    // ── 3. Lands from the converted enquiries ──
    // [enquiry, code, name, mouza, rsDag, lrDag, rsKh, lrKh, area, workflow]
    const LANDS = [
      ["DEMO-ENQ-007", "DEMO/00001/2026-27", "Rajarhat main road, north plot", RAJARHAT, "418", "1376", "94", "2215", 5, "Draft (Verification Pending)"],
      ["DEMO-ENQ-008", "DEMO/00002/2026-27", "Chowmatha junction plot, Rajarhat", RAJARHAT, "425", "1389", "97", "2241", 7, "Deed Process"],
      ["DEMO-ENQ-009", "DEMO/00003/2026-27", "Kadampukur canal road", KADAMPUKUR, "149", "588", "84", "915", 8, "Deed Registration"],
      ["DEMO-ENQ-010", "DEMO/00004/2026-27", "Kadampukur market back plot", KADAMPUKUR, "140", "571", "80", "902", 6, "Registered"],
    ];
    const ids = {};
    for (const [enq, code, name, m, rd, ld, rk, lk, area, wf] of LANDS) {
      const later = wf !== "Draft (Verification Pending)";
      const r = await q(`INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, EnquiryId, ProjectId, LocationAddress,
          RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, CreatedBy, CreatedAt,
          OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent)
        OUTPUT INSERTED.LandId
        SELECT N'${code}', N'${name}', ${DIST}, ${m}, ${area}, ${KATHA}, N'${wf === "Registered" ? "Owned" : "Identified"}', N'New Acquisition', e.EnquiryId, e.ProjectId, N'${name}, North 24 Parganas',
          N'${rd}', N'${ld}', N'${rk}', N'${lk}', N'${wf}', N'${later ? "Verified" : "Draft"}', N'Pending', N'Pending', 0, 1, ${U.entry}, DATEADD(day, -30, SYSUTCDATETIME()),
          N'Individual', N'Purchase', N'${later ? "Verified" : "Pending"}', N'${later ? "Has authority" : "Pending"}', N'${later ? "All owners consented" : "Pending"}'
        FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo = N'${enq}'`);
      const id = r[0].LandId;
      ids[wf] = id;
      await q(`UPDATE dbo.LegalLandEnquiry SET LandId = ${id} WHERE EnquiryNo = N'${enq}'`);
      // Owners, RS / LR records, two documents.
      await q(`INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy) VALUES
          (${id}, N'Bimal Sarkar', N'Late Nitai Sarkar', ${look("ownership-type", "Joint")}, 50, '2004-05-10', 1, ${U.entry}),
          (${id}, N'Kamal Sarkar', N'Late Nitai Sarkar', ${look("ownership-type", "Joint")}, 50, '2004-05-10', 1, ${U.entry});
        INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy)
          VALUES (${id}, ${m}, N'${rk}', N'${rd}', N'Nitai Sarkar', ${area}, ${KATHA}, 1, ${U.entry});
        INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, IsActive, CreatedBy)
          VALUES (${id}, ${m}, N'${lk}', N'${ld}', 1, ${U.entry});`);
      for (const [i, [type, section, title, no]] of [["Sale Deed", "Purchase / Sale", "Parent sale deed", `I-${rd}/2004`], ["LR Khatian", "Ownership", "LR Khatian (RoR)", lk]].entries()) {
        const d = await q(`INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
          OUTPUT INSERTED.DocumentId
          VALUES (N'DEMO-DOC-${String(Object.keys(ids).length * 2 + i - 1).padStart(5, "0")}', ${id}, ${doc(type)}, N'${section}', N'${title}', N'${no}', N'ADSR Rajarhat', 1, N'Demo document', 1, ${U.entry})`);
        if (FILE) await q(`INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (${d[0].DocumentId}, 1, ${FILE}, ${U.entry}, N'Verified')`);
      }
      if (later) {
        // Due diligence done, low risk, legally cleared, final verified.
        await q(`INSERT INTO dbo.LegalDiligenceArea (LandId, Area, Status, Remarks, CheckedBy, CheckedAt) VALUES
            (${id}, N'ownership', N'Verified', N'Both co-owners verified.', ${U.verifier}, SYSUTCDATETIME()),
            (${id}, N'inheritance', N'Not Applicable', N'Bought in 2004; no inheritance since.', ${U.verifier}, SYSUTCDATETIME()),
            (${id}, N'title', N'Verified', N'Title chain continuous; RS / LR match.', ${U.verifier}, SYSUTCDATETIME()),
            (${id}, N'documents', N'Verified', N'Deed and RoR on file.', ${U.verifier}, SYSUTCDATETIME());
          INSERT INTO dbo.LegalRiskAssessment (LandId, RiskLevel, Remarks, AssessedBy) VALUES (${id}, N'Low', N'Clean title, no encumbrance or case.', ${U.verifier});
          INSERT INTO dbo.LegalReview (LandId, Status, ReviewerUserId, AssignedOn, CompletedOn, Opinion, Recommendation, CreatedBy)
            VALUES (${id}, N'Legally Cleared', ${U.verifier}, ${day(-12)}, ${day(-10)}, N'Title clear and marketable.', N'Cleared for registration.', ${U.verifier});
          UPDATE dbo.LegalLand SET FinalVerifiedBy = ${U.verifier}, FinalVerifiedAt = DATEADD(day, -9, SYSUTCDATETIME()), DeedFileId = ${FILE ?? "NULL"} WHERE LandId = ${id};`);
      }
    }
    // Deed Process: L1 approved, waiting for L2, timeline in 5 days.
    await q(`UPDATE dbo.LegalLand SET DeedTargetDate = ${day(5)}, L1Status = N'Approved', L1ReviewerId = ${U.l1}, L1ReviewedAt = DATEADD(day, -1, SYSUTCDATETIME()),
      L1Remarks = N'Documents in order.' WHERE LandId = ${ids["Deed Process"]}`);
    // Deed Registration: approved, consideration + stamp duty + applied; final registration still to do.
    const reg = ids["Deed Registration"];
    await q(`UPDATE dbo.LegalLand SET DeedTargetDate = ${day(-4)}, L1Status = N'Approved', L1ReviewerId = ${U.l1}, L1ReviewedAt = DATEADD(day, -7, SYSUTCDATETIME()),
        L2Status = N'Approved', L2ApproverId = ${U.l2}, L2ApprovedAt = DATEADD(day, -6, SYSUTCDATETIME()),
        ConsTotalAmount = 4800000, ConsRate = 600000, ConsRateUnitId = ${KATHA}, ConsAdvanceAmount = 500000, ConsPaymentModeId = ${look("payment-mode", "RTGS")},
        ConsRemarks = N'8 katha @ ₹6 lakh per katha; advance on agreement, balance at registration.',
        RegAppliedBy = ${U.l1}, RegAppliedAt = DATEADD(day, -3, SYSUTCDATETIME())
      WHERE LandId = ${reg};
      INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy) VALUES
        (${reg}, ${day(-4)}, ${look("fee-type", "Stamp Duty")}, 288000, N'6% on market value ₹48 lakh', ${U.entry}),
        (${reg}, ${day(-4)}, ${look("fee-type", "Registration Fee")}, 52800, N'1.1% registration fee', ${U.entry});`);
    // Registered: every step, deed tracked to the company locker, post-registration under way.
    const done = ids.Registered;
    await q(`UPDATE dbo.LegalLand SET DeedTargetDate = ${day(-30)}, L1Status = N'Approved', L1ReviewerId = ${U.l1}, L1ReviewedAt = DATEADD(day, -35, SYSUTCDATETIME()),
        L2Status = N'Approved', L2ApproverId = ${U.l2}, L2ApprovedAt = DATEADD(day, -34, SYSUTCDATETIME()),
        ConsTotalAmount = 3600000, ConsRate = 600000, ConsRateUnitId = ${KATHA}, ConsAdvanceAmount = 1000000, ConsPaymentModeId = ${look("payment-mode", "Cheque")},
        RegAppliedBy = ${U.l1}, RegAppliedAt = DATEADD(day, -30, SYSUTCDATETIME()),
        RegFinalDate = ${day(-20)}, RegOfficeId = ${adsr ?? "NULL"}, RegModeId = ${look("registration-mode", "Physical (at office)")}, RegDeedNo = N'I-1504-08812/2026',
        RegDeedFileId = ${FILE2 ?? "NULL"}, RegCompletedBy = ${U.l2}, RegCompletedAt = DATEADD(day, -19, SYSUTCDATETIME()),
        IgrTrackingUrl = N'https://wbregistration.gov.in/', IgrStatusId = ${look("igr-status", "Delivered")}, DeedLocationId = ${look("deed-location", "In company locker / vault")}
      WHERE LandId = ${done};
      INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, CreatedBy) VALUES
        (${done}, ${day(-26)}, ${look("fee-type", "Stamp Duty")}, 216000, ${U.entry}), (${done}, ${day(-26)}, ${look("fee-type", "Registration Fee")}, 39600, ${U.entry}),
        (${done}, ${day(-20)}, ${look("fee-type", "Scanning Fee")}, 500, ${U.entry});
      INSERT INTO dbo.LegalDeedTracking (LandId, StatusDate, IgrStatusId, DeedLocationId, TrackingUrl, Remarks, CreatedBy) VALUES
        (${done}, ${day(-20)}, ${look("igr-status", "Registered — deed pending")}, ${look("deed-location", "In registration office")}, N'https://wbregistration.gov.in/', N'Registered; original with the office for scanning.', ${U.entry}),
        (${done}, ${day(-12)}, ${look("igr-status", "Ready for delivery")}, ${look("deed-location", "In registration office")}, NULL, N'IGR shows ready for collection.', ${U.entry}),
        (${done}, ${day(-10)}, ${look("igr-status", "Delivered")}, ${look("deed-location", "With advocate")}, NULL, N'Collected by the advocate.', ${U.entry}),
        (${done}, ${day(-8)}, ${look("igr-status", "Delivered")}, ${look("deed-location", "In company locker / vault")}, NULL, N'Original kept in the head-office locker.', ${U.entry});`);
    const TASKS = [["Registered deed verification", "Completed"], ["Mutation application", "Application Submitted"], ["Updated Khatian / RoR", "Not Started"],
      ["Updated land records", "Not Started"], ["Land tax / revenue update", "Under Processing"], ["Ownership record update", "Not Started"], ["Project mapping eligibility", "Completed"]];
    for (const [i, [t, s]] of TASKS.entries()) await q(`INSERT INTO dbo.LegalPostRegTask (LandId, TaskNo, Task, Status) VALUES (${done}, ${i + 1}, N'${t}', N'${s}')`);
    console.log("✓ 4 lands: Draft, Deed Process, Deed Registration, Registered (+ post-registration tasks)");

    // Payments (migration 662): first consideration revision + advance as a payment, then schedule, instalments,
    // a later valuation, and the registered land's final payment.
    await q(`UPDATE dbo.LegalLand SET ConsDate = CAST(GETDATE() AS DATE) WHERE ConsTotalAmount IS NOT NULL;
      INSERT INTO dbo.LegalConsiderationRevision (LandId, RevisionDate, NewTotal, NewRate, Reason, CreatedBy)
        SELECT LandId, ConsDate, ConsTotalAmount, ConsRate, N'Consideration agreed', ${U.entry} FROM dbo.LegalLand WHERE ConsTotalAmount IS NOT NULL;
      INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Remarks, CreatedBy)
        SELECT LandId, ConsDate, ${look("txn-type", "Advance")}, ConsAdvanceAmount, ConsPaymentModeId, N'Advance on agreement', ${U.entry} FROM dbo.LegalLand WHERE ConsAdvanceAmount > 0;`);
    await q(`DECLARE @reg INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00003/2026-27');
DECLARE @done INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00004/2026-27');
DECLARE @adv INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Advance');
DECLARE @pp INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Purchase Payment');
DECLARE @fin INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Final Payment');
DECLARE @rtgs INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'payment-mode' AND Name = N'RTGS');
-- In registration: agreed 7 months ago at ₹48 lakh; advance + one instalment paid; a valuation after the agreement.
UPDATE dbo.LegalLand SET ConsDate = CAST(DATEADD(month, -7, GETDATE()) AS DATE) WHERE LandId = @reg;
UPDATE dbo.LegalConsiderationRevision SET RevisionDate = CAST(DATEADD(month, -7, GETDATE()) AS DATE) WHERE LandId = @reg;
UPDATE dbo.LegalPayment SET PaymentDate = CAST(DATEADD(month, -7, GETDATE()) AS DATE), Payee = N'Bimal Sarkar & Kamal Sarkar', TransactionRef = N'RTGS-UTIB-88120' WHERE LandId = @reg;
IF NOT EXISTS (SELECT 1 FROM dbo.LegalPayment WHERE LandId = @reg AND TxnTypeId = @pp)
  INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payee, TransactionRef, Remarks, CreatedBy)
  VALUES (@reg, CAST(DATEADD(month, -3, GETDATE()) AS DATE), @pp, 1500000, @rtgs, N'Bimal Sarkar & Kamal Sarkar', N'RTGS-UTIB-90433', N'Second instalment', ${U.entry});
IF NOT EXISTS (SELECT 1 FROM dbo.LegalPaymentSchedule WHERE LandId = @reg)
  INSERT INTO dbo.LegalPaymentSchedule (LandId, DueDate, Amount, TxnTypeId, Remarks, CreatedBy) VALUES
    (@reg, CAST(DATEADD(month, -7, GETDATE()) AS DATE), 500000, @adv, N'On agreement', ${U.entry}),
    (@reg, CAST(DATEADD(month, -3, GETDATE()) AS DATE), 1500000, @pp, N'Second instalment', ${U.entry}),
    (@reg, CAST(DATEADD(day, -10, GETDATE()) AS DATE), 1500000, @pp, N'Third instalment', ${U.entry}),
    (@reg, CAST(DATEADD(day, 20, GETDATE()) AS DATE), 1300000, @fin, N'Balance at registration', ${U.entry});
IF NOT EXISTS (SELECT 1 FROM dbo.LegalValuation WHERE LandId = @reg)
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, IsActive, CreatedBy)
  VALUES (@reg, CAST(DATEADD(day, -15, GETDATE()) AS DATE), 8, ${KATHA}, 650000, 5200000, 4950000, N'WB Registration market value search', 1, ${U.entry});
-- Registered: agreed earlier, advance + final payment, all before the registration date.
UPDATE dbo.LegalLand SET ConsDate = CAST(DATEADD(day, -60, GETDATE()) AS DATE) WHERE LandId = @done;
UPDATE dbo.LegalConsiderationRevision SET RevisionDate = CAST(DATEADD(day, -60, GETDATE()) AS DATE) WHERE LandId = @done;
UPDATE dbo.LegalPayment SET PaymentDate = CAST(DATEADD(day, -60, GETDATE()) AS DATE) WHERE LandId = @done;
IF NOT EXISTS (SELECT 1 FROM dbo.LegalPayment WHERE LandId = @done AND TxnTypeId = @fin)
  INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payee, TransactionRef, Remarks, CreatedBy)
  VALUES (@done, CAST(DATEADD(day, -21, GETDATE()) AS DATE), @fin, 2600000, @rtgs, N'Bimal Sarkar & Kamal Sarkar', N'RTGS-UTIB-91007', N'Balance before registration', ${U.entry});
`);
    console.log("✓ consideration history, payment schedule, payments and a later valuation");

    await tx.commit();
    console.log("Done.");
    process.exit(0);
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
})().catch((e) => { console.error("✗ Nothing changed —", e.message); process.exit(1); });
