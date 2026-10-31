"use strict";

const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");

const router = express.Router();
router.use(apiRateLimit);

/** Helper to check if a table exists in dbo */
async function tableExists(pool, tableName) {
  try {
    const res = await pool.request()
      .input("tbl", sql.NVarChar(128), tableName)
      .query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl`);
    return res.recordset.length > 0;
  } catch {
    return false;
  }
}

// ── 1. REGISTRATION SEARCH ENDPOINTS ─────────────────────────────────────────

// GET /api/legal/searches
router.get("/searches", requirePageRight("legal-registration-search", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const hasSessionTbl = await tableExists(pool, "LegalSearchSession");

    if (hasSessionTbl) {
      const result = await pool.request().query(`
        SELECT s.SessionId AS SearchId,
               s.SessionNumber AS SearchNumber,
               s.RegistrationDate AS PlannedSearchDate,
               s.PerformedAt AS ActualSearchDate,
               s.OfficeId,
               o.OfficeName, o.OfficeCode,
               pl.Url AS PortalUrl, pl.LinkLabel,
               m.MouzaName, m.JLNo,
               s.RsPlotNo AS PlotNo,
               s.RsKhatianNo AS KhatianNo,
               s.RsPlotNo AS RsDag,
               s.LrPlotNo AS LrDag,
               s.RsKhatianNo AS RsKhatian,
               s.LrKhatianNo AS LrKhatian,
               s.PartyName,
               s.DeedNo,
               s.DeedYear,
               s.SearchStatus AS SearchOutcome,
               s.EvidenceRef AS OfficialReceiptRef,
               s.EvidenceAmount AS ReceiptAmount,
               s.Notes AS SearchNotes,
               s.SearchStatus AS Status,
               u.name AS AssignedUserName,
               cu.name AS CreatedByName
        FROM dbo.LegalSearchSession s
        LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = s.OfficeId
        LEFT JOIN dbo.LegalPortalLink pl ON pl.OfficeId = s.OfficeId OR pl.OfficeId IS NULL
        LEFT JOIN dbo.LegalMouza m ON m.MouzaId = s.MouzaId
        LEFT JOIN dbo.users u ON u.id = s.PerformedBy
        LEFT JOIN dbo.users cu ON cu.id = s.CreatedBy
        WHERE s.IsActive = 1
        ORDER BY s.RegistrationDate DESC, s.SessionId DESC
      `);
      return res.json(result.recordset);
    }

    // Fallback if older table exists
    const result = await pool.request().query(`
      SELECT s.*, 
             o.OfficeName, o.OfficeCode,
             pl.Url AS PortalUrl, pl.LinkLabel,
             m.MouzaName, m.JLNo,
             s.PlotNo AS RsDag,
             s.PlotNo AS LrDag,
             s.KhatianNo AS RsKhatian,
             NULL AS LrKhatian,
             u.name AS AssignedUserName,
             cu.name AS CreatedByName
      FROM dbo.LegalRegistrationSearch s
      LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = s.OfficeId
      LEFT JOIN dbo.LegalPortalLink pl ON pl.LinkId = s.PortalLinkId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = s.MouzaId
      LEFT JOIN dbo.users u ON u.id = s.AssignedUserId
      LEFT JOIN dbo.users cu ON cu.id = s.CreatedBy
      WHERE s.IsActive = 1
      ORDER BY s.PlannedSearchDate DESC, s.SearchId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[legalOperations] GET /searches error:", err.message);
    res.status(500).json({ error: "Failed to retrieve registration searches" });
  }
});

// POST /api/legal/searches
router.post("/searches", requirePageRight("legal-registration-search", "create"), async (req, res) => {
  const {
    PlannedSearchDate, OfficeId, PortalLinkId, AssignedUserId,
    MouzaId, PlotNo, KhatianNo, RsDag, LrDag, RsKhatian, LrKhatian,
    PartyName, DeedNo, DeedYear, SearchNotes
  } = req.body;

  if (!PlannedSearchDate) return res.status(400).json({ error: "PlannedSearchDate is required" });
  if (!OfficeId) return res.status(400).json({ error: "Registration Office is required" });

  try {
    const pool = getPool();
    const hasSessionTbl = await tableExists(pool, "LegalSearchSession");
    const year = new Date().getFullYear();

    if (hasSessionTbl) {
      const countRes = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.LegalSearchSession");
      const searchNum = `SRCH-${year}-${String(countRes.recordset[0].total + 1).padStart(4, "0")}`;

      const insertRes = await pool.request()
        .input("SessionNumber", sql.NVarChar(50), searchNum)
        .input("RegistrationDate", sql.Date, PlannedSearchDate)
        .input("OfficeId", sql.Int, OfficeId)
        .input("MouzaId", sql.Int, MouzaId || null)
        .input("RsPlotNo", sql.NVarChar(50), RsDag || PlotNo || null)
        .input("LrPlotNo", sql.NVarChar(50), LrDag || null)
        .input("RsKhatianNo", sql.NVarChar(50), RsKhatian || KhatianNo || null)
        .input("LrKhatianNo", sql.NVarChar(50), LrKhatian || null)
        .input("PartyName", sql.NVarChar(200), PartyName || null)
        .input("DeedNo", sql.NVarChar(100), DeedNo || null)
        .input("DeedYear", sql.Int, DeedYear || null)
        .input("Notes", sql.NVarChar(sql.MAX), SearchNotes || null)
        .input("PerformedBy", sql.Int, AssignedUserId || null)
        .input("CreatedBy", sql.Int, req.user?.userId || null)
        .query(`
          INSERT INTO dbo.LegalSearchSession (
            SessionNumber, RegistrationDate, OfficeId, MouzaId,
            RsPlotNo, LrPlotNo, RsKhatianNo, LrKhatianNo, PartyName,
            DeedNo, DeedYear, Notes, PerformedBy, CreatedBy, CreatedAt
          )
          OUTPUT INSERTED.SessionId
          VALUES (
            @SessionNumber, @RegistrationDate, @OfficeId, @MouzaId,
            @RsPlotNo, @LrPlotNo, @RsKhatianNo, @LrKhatianNo, @PartyName,
            @DeedNo, @DeedYear, @Notes, @PerformedBy, @CreatedBy, SYSUTCDATETIME()
          )
        `);

      return res.status(201).json({
        searchId: insertRes.recordset[0].SessionId,
        searchNumber: searchNum,
        message: "Search session started successfully",
      });
    }

    // Fallback to LegalRegistrationSearch
    const countRes = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.LegalRegistrationSearch");
    const searchNum = `SRCH-${year}-${String(countRes.recordset[0].total + 1).padStart(4, "0")}`;

    const insertRes = await pool.request()
      .input("SearchNumber", sql.NVarChar(50), searchNum)
      .input("PlannedSearchDate", sql.Date, PlannedSearchDate)
      .input("OfficeId", sql.Int, OfficeId)
      .input("PortalLinkId", sql.Int, PortalLinkId || null)
      .input("AssignedUserId", sql.Int, AssignedUserId || null)
      .input("MouzaId", sql.Int, MouzaId || null)
      .input("PlotNo", sql.NVarChar(50), RsDag || PlotNo || null)
      .input("KhatianNo", sql.NVarChar(50), RsKhatian || KhatianNo || null)
      .input("PartyName", sql.NVarChar(200), PartyName || null)
      .input("SearchNotes", sql.NVarChar(sql.MAX), SearchNotes || null)
      .input("CreatedBy", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalRegistrationSearch (
          SearchNumber, PlannedSearchDate, OfficeId, PortalLinkId, AssignedUserId,
          MouzaId, PlotNo, KhatianNo, PartyName, SearchNotes, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.SearchId
        VALUES (
          @SearchNumber, @PlannedSearchDate, @OfficeId, @PortalLinkId, @AssignedUserId,
          @MouzaId, @PlotNo, @KhatianNo, @PartyName, @SearchNotes, @CreatedBy, SYSUTCDATETIME()
        )
      `);

    res.status(201).json({
      searchId: insertRes.recordset[0].SearchId,
      searchNumber: searchNum,
      message: "Search planned successfully",
    });
  } catch (err) {
    console.error("[legalOperations] POST /searches error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/legal/searches/:id/outcome
router.put("/searches/:id/outcome", requirePageRight("legal-registration-search", "edit"), async (req, res) => {
  const { id } = req.params;
  const { ActualSearchDate, SearchOutcome, OfficialReceiptRef, ReceiptAmount, SearchNotes } = req.body;

  if (!SearchOutcome) return res.status(400).json({ error: "SearchOutcome is required" });

  try {
    const pool = getPool();
    const hasSessionTbl = await tableExists(pool, "LegalSearchSession");

    if (hasSessionTbl) {
      await pool.request()
        .input("SessionId", sql.Int, id)
        .input("SearchStatus", sql.NVarChar(50), SearchOutcome)
        .input("EvidenceRef", sql.NVarChar(100), OfficialReceiptRef || null)
        .input("EvidenceAmount", sql.Decimal(18, 2), ReceiptAmount || null)
        .input("Notes", sql.NVarChar(sql.MAX), SearchNotes || null)
        .input("PerformedAt", sql.DateTime2, ActualSearchDate ? `${ActualSearchDate} 12:00:00` : null)
        .input("UpdatedBy", sql.Int, req.user?.userId || null)
        .query(`
          UPDATE dbo.LegalSearchSession
          SET SearchStatus = @SearchStatus,
              EvidenceRef = @EvidenceRef,
              EvidenceAmount = @EvidenceAmount,
              Notes = @Notes,
              PerformedAt = ISNULL(@PerformedAt, SYSUTCDATETIME()),
              UpdatedBy = @UpdatedBy,
              UpdatedAt = SYSUTCDATETIME()
          WHERE SessionId = @SessionId
        `);

      return res.json({ message: "Search outcome recorded successfully" });
    }

    const status = SearchOutcome === "Pending" ? "Search Pending" : "Search Completed";
    await pool.request()
      .input("SearchId", sql.Int, id)
      .input("ActualSearchDate", sql.Date, ActualSearchDate || new Date().toISOString().slice(0, 10))
      .input("SearchOutcome", sql.NVarChar(60), SearchOutcome)
      .input("OfficialReceiptRef", sql.NVarChar(100), OfficialReceiptRef || null)
      .input("ReceiptAmount", sql.Decimal(18, 2), ReceiptAmount || null)
      .input("SearchNotes", sql.NVarChar(sql.MAX), SearchNotes || null)
      .input("Status", sql.NVarChar(40), status)
      .input("UpdatedBy", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalRegistrationSearch
        SET ActualSearchDate = @ActualSearchDate,
            SearchOutcome = @SearchOutcome,
            OfficialReceiptRef = @OfficialReceiptRef,
            ReceiptAmount = @ReceiptAmount,
            SearchNotes = @SearchNotes,
            Status = @Status,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSUTCDATETIME()
        WHERE SearchId = @SearchId
      `);

    res.json({ message: "Search outcome recorded successfully" });
  } catch (err) {
    console.error("[legalOperations] PUT /searches outcome error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. DEED REGISTRATION RECORDS ENDPOINTS ───────────────────────────────────

// GET /api/legal/deeds
router.get("/deeds", requirePageRight("legal-deed-registrations", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");

    if (hasDossierTbl) {
      const result = await pool.request().query(`
        SELECT d.DossierId AS DeedRecordId,
               d.DossierNumber AS DeedFileNo,
               d.DeedNumber AS DeedNo,
               d.DeedYear,
               d.DeedDate,
               d.DeedTypeId,
               dt.DeedTypeName,
               d.TransactionType,
               d.RegistrationOfficeId AS OfficeId,
               o.OfficeName, o.OfficeCode,
               d.ProjectId,
               p.name AS ProjectName,
               d.MouzaId,
               m.MouzaName, m.JLNo,
               d.RsDag,
               d.LrDag,
               d.RsKhatian,
               d.LrKhatian,
               d.RsDag AS RsPlotNo,
               d.RsKhatian AS RsKhatianNo,
               d.PurchasedArea,
               u.UnitName AS AreaUnitName,
               d.ConsiderationAmount,
               d.MarketValue,
               d.StampDutyAmount,
               d.OverallStatus,
               CASE WHEN d.ApprovalStatus = 'L1 Approved' OR d.ApprovalStatus = 'L2 Approved' THEN 'Approved'
                    WHEN d.ApprovalStatus = 'L1 Returned' THEN 'Returned'
                    ELSE 'Pending' END AS L1Status,
               CASE WHEN d.ApprovalStatus = 'L2 Approved' THEN 'Approved'
                    WHEN d.ApprovalStatus = 'L2 Returned' THEN 'Returned'
                    ELSE 'Pending' END AS L2Status,
               owner.name AS AssignedExecutiveName,
               l1.name AS L1ReviewerName,
               l2.name AS L2ApproverName,
               (SELECT TOP 1 pt.FullName FROM dbo.LegalDossierParty dp JOIN dbo.LegalPerson pt ON pt.PersonId = dp.PartyId WHERE dp.DossierId = d.DossierId AND dp.PartyRole LIKE '%Seller%') AS SellerName,
               (SELECT TOP 1 pt.FullName FROM dbo.LegalDossierParty dp JOIN dbo.LegalPerson pt ON pt.PersonId = dp.PartyId WHERE dp.DossierId = d.DossierId AND dp.PartyRole LIKE '%Buyer%') AS BuyerName,
               (SELECT COUNT(*) FROM dbo.LegalDossierDocument doc WHERE doc.DossierId = d.DossierId AND doc.IsActive = 1) AS TotalDocs,
               (SELECT COUNT(*) FROM dbo.LegalDossierDocument doc WHERE doc.DossierId = d.DossierId AND doc.IsActive = 1 AND doc.DocumentStatus = 'Accepted') AS AcceptedDocs,
               (SELECT COUNT(*) FROM dbo.LegalDossierDocument doc WHERE doc.DossierId = d.DossierId AND doc.IsActive = 1 AND doc.RequirementType = 'Required' AND doc.DocumentStatus NOT IN ('Accepted', 'Waived')) AS PendingMandatoryDocs
        FROM dbo.LegalDeedDossier d
        JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId
        JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.RegistrationOfficeId
        LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
        LEFT JOIN dbo.LegalMouza m ON m.MouzaId = d.MouzaId
        LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = d.AreaUnitId
        LEFT JOIN dbo.users owner ON owner.id = d.AssignedOwnerId
        LEFT JOIN dbo.users l1 ON l1.id = d.L1ReviewerId
        LEFT JOIN dbo.users l2 ON l2.id = d.L2ApproverId
        WHERE d.IsActive = 1
        ORDER BY d.DossierId DESC
      `);
      return res.json(result.recordset);
    }

    // Fallback to LegalDeedRecord
    const result = await pool.request().query(`
      SELECT d.*,
             dt.DeedTypeName, dt.TransactionType,
             tt.TaskTypeName,
             o.OfficeName, o.OfficeCode,
             p.name AS ProjectName,
             m.MouzaName, m.JLNo,
             rp.PlotNo AS RsPlotNo,
             rk.KhatianNo AS RsKhatianNo,
             rp.PlotNo AS RsDag,
             rp.PlotNo AS LrDag,
             rk.KhatianNo AS RsKhatian,
             NULL AS LrKhatian,
             u.UnitName AS AreaUnitName,
             sp.FullName AS SellerName,
             bp.FullName AS BuyerName,
             ae.name AS AssignedExecutiveName,
             l1.name AS L1ReviewerName,
             l2.name AS L2ApproverName,
             (SELECT COUNT(*) FROM dbo.LegalDeedDocument doc WHERE doc.DeedRecordId = d.DeedRecordId AND doc.IsActive = 1) AS TotalDocs,
             (SELECT COUNT(*) FROM dbo.LegalDeedDocument doc WHERE doc.DeedRecordId = d.DeedRecordId AND doc.IsActive = 1 AND doc.VerificationStatus = 'Accepted') AS AcceptedDocs,
             (SELECT COUNT(*) FROM dbo.LegalDeedDocument doc WHERE doc.DeedRecordId = d.DeedRecordId AND doc.IsActive = 1 AND doc.IsMandatory = 1 AND doc.VerificationStatus NOT IN ('Accepted', 'Waived')) AS PendingMandatoryDocs
      FROM dbo.LegalDeedRecord d
      JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId
      LEFT JOIN dbo.LegalTaskType tt ON tt.TaskTypeId = d.TaskTypeId
      JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.OfficeId
      LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = d.MouzaId
      LEFT JOIN dbo.LegalRsPlot rp ON rp.RsPlotId = d.RsPlotId
      LEFT JOIN dbo.LegalRsKhatian rk ON rk.RsKhatianId = d.RsKhatianId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = d.AreaUnitId
      LEFT JOIN dbo.LegalPerson sp ON sp.PersonId = d.SellerPartyId
      LEFT JOIN dbo.LegalPerson bp ON bp.PersonId = d.BuyerPartyId
      LEFT JOIN dbo.users ae ON ae.id = d.AssignedExecutiveId
      LEFT JOIN dbo.users l1 ON l1.id = d.L1ReviewerId
      LEFT JOIN dbo.users l2 ON l2.id = d.L2ApproverId
      WHERE d.IsActive = 1
      ORDER BY d.DeedRecordId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[legalOperations] GET /deeds error:", err.message);
    res.status(500).json({ error: "Failed to retrieve deed registrations" });
  }
});

// GET /api/legal/deeds/:id
router.get("/deeds/:id", requirePageRight("legal-deed-registrations", "view"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");

    if (hasDossierTbl) {
      const deedRes = await pool.request().input("Id", sql.Int, id).query(`
        SELECT d.DossierId AS DeedRecordId,
               d.DossierNumber AS DeedFileNo,
               d.DeedNumber AS DeedNo,
               d.DeedYear,
               d.DeedDate,
               d.DeedTypeId,
               dt.DeedTypeName,
               d.TransactionType,
               d.RegistrationOfficeId AS OfficeId,
               o.OfficeName, o.OfficeCode,
               d.ProjectId,
               p.name AS ProjectName,
               d.MouzaId,
               m.MouzaName, m.JLNo,
               d.RsDag,
               d.LrDag,
               d.RsKhatian,
               d.LrKhatian,
               d.RsDag AS RsPlotNo,
               d.RsKhatian AS RsKhatianNo,
               d.PurchasedArea,
               u.UnitName AS AreaUnitName,
               d.ConsiderationAmount,
               d.MarketValue,
               d.StampDutyAmount,
               d.RegistrationFee,
               d.OverallStatus,
               CASE WHEN d.ApprovalStatus = 'L1 Approved' OR d.ApprovalStatus = 'L2 Approved' THEN 'Approved'
                    WHEN d.ApprovalStatus = 'L1 Returned' THEN 'Returned'
                    ELSE 'Pending' END AS L1Status,
               CASE WHEN d.ApprovalStatus = 'L2 Approved' THEN 'Approved'
                    WHEN d.ApprovalStatus = 'L2 Returned' THEN 'Returned'
                    ELSE 'Pending' END AS L2Status,
               owner.name AS AssignedExecutiveName,
               l1.name AS L1ReviewerName,
               l2.name AS L2ApproverName,
               (SELECT TOP 1 pt.FullName FROM dbo.LegalDossierParty dp JOIN dbo.LegalPerson pt ON pt.PersonId = dp.PartyId WHERE dp.DossierId = d.DossierId AND dp.PartyRole LIKE '%Seller%') AS SellerName,
               (SELECT TOP 1 pt.FullName FROM dbo.LegalDossierParty dp JOIN dbo.LegalPerson pt ON pt.PersonId = dp.PartyId WHERE dp.DossierId = d.DossierId AND dp.PartyRole LIKE '%Buyer%') AS BuyerName
        FROM dbo.LegalDeedDossier d
        JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId
        JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.RegistrationOfficeId
        LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
        LEFT JOIN dbo.LegalMouza m ON m.MouzaId = d.MouzaId
        LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = d.AreaUnitId
        LEFT JOIN dbo.users owner ON owner.id = d.AssignedOwnerId
        LEFT JOIN dbo.users l1 ON l1.id = d.L1ReviewerId
        LEFT JOIN dbo.users l2 ON l2.id = d.L2ApproverId
        WHERE d.DossierId = @Id
      `);

      if (!deedRes.recordset.length) return res.status(404).json({ error: "Deed dossier not found" });

      const docsRes = await pool.request().input("Id", sql.Int, id).query(`
        SELECT doc.DocumentId,
               doc.DossierId AS DeedRecordId,
               doc.DocTypeId,
               dt.DocTypeName,
               dt.Category AS DocCategory,
               doc.VersionNo,
               doc.FileName,
               doc.FilePath,
               doc.DocumentStatus AS VerificationStatus,
               CASE WHEN doc.RequirementType = 'Required' THEN 1 ELSE 0 END AS IsMandatory,
               doc.IsWaived,
               doc.WaiverReason,
               w.name AS WaivedByName,
               CASE WHEN doc.Applicability = 'Not Applicable' THEN 1 ELSE 0 END AS IsNA,
               doc.NAReason,
               doc.RejectionReason,
               doc.ReviewNotes AS VerificationNotes,
               v.name AS VerifiedByName,
               u.name AS ResponsibleUserName,
               doc.DueDate
        FROM dbo.LegalDossierDocument doc
        JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = doc.DocTypeId
        LEFT JOIN dbo.users u ON u.id = doc.ResponsibleUserId
        LEFT JOIN dbo.users v ON v.id = doc.VerifiedBy
        LEFT JOIN dbo.users w ON w.id = doc.WaivedBy
        WHERE doc.DossierId = @Id AND doc.IsActive = 1
        ORDER BY doc.DocumentId ASC
      `);

      const logsRes = await pool.request().input("Id", sql.Int, id).query(`
        SELECT ev.EventId AS LogId,
               ev.EntityId AS DeedRecordId,
               'Workflow' AS Stage,
               ev.Action AS Action,
               ev.NewState AS NewStatus,
               ev.Comments AS Comments,
               u.name AS ActionByName,
               ev.Timestamp AS ActionAt
        FROM dbo.LegalAuditEvent ev
        LEFT JOIN dbo.users u ON u.id = ev.ActorId
        WHERE ev.EntityName = 'LegalDeedDossier' AND ev.EntityId = @Id
        ORDER BY ev.EventId DESC
      `);

      return res.json({
        deed: deedRes.recordset[0],
        documents: docsRes.recordset,
        logs: logsRes.recordset,
      });
    }

    // Fallback to LegalDeedRecord
    const deedRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT d.*,
             dt.DeedTypeName, dt.TransactionType,
             tt.TaskTypeName,
             o.OfficeName, o.OfficeCode,
             p.name AS ProjectName,
             m.MouzaName, m.JLNo,
             rp.PlotNo AS RsPlotNo,
             rk.KhatianNo AS RsKhatianNo,
             rp.PlotNo AS RsDag,
             rp.PlotNo AS LrDag,
             rk.KhatianNo AS RsKhatian,
             NULL AS LrKhatian,
             u.UnitName AS AreaUnitName,
             sp.FullName AS SellerName,
             bp.FullName AS BuyerName,
             ae.name AS AssignedExecutiveName,
             l1.name AS L1ReviewerName,
             l2.name AS L2ApproverName
      FROM dbo.LegalDeedRecord d
      JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId
      LEFT JOIN dbo.LegalTaskType tt ON tt.TaskTypeId = d.TaskTypeId
      JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.OfficeId
      LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = d.MouzaId
      LEFT JOIN dbo.LegalRsPlot rp ON rp.RsPlotId = d.RsPlotId
      LEFT JOIN dbo.LegalRsKhatian rk ON rk.RsKhatianId = d.RsKhatianId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = d.AreaUnitId
      LEFT JOIN dbo.LegalPerson sp ON sp.PersonId = d.SellerPartyId
      LEFT JOIN dbo.LegalPerson bp ON bp.PersonId = d.BuyerPartyId
      LEFT JOIN dbo.users ae ON ae.id = d.AssignedExecutiveId
      LEFT JOIN dbo.users l1 ON l1.id = d.L1ReviewerId
      LEFT JOIN dbo.users l2 ON l2.id = d.L2ApproverId
      WHERE d.DeedRecordId = @Id
    `);

    if (!deedRes.recordset.length) return res.status(404).json({ error: "Deed record not found" });

    const docsRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT doc.*,
             dt.DocTypeName, dt.Category AS DocCategory,
             u.name AS ResponsibleUserName,
             v.name AS VerifiedByName,
             w.name AS WaivedByName
      FROM dbo.LegalDeedDocument doc
      JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = doc.DocTypeId
      LEFT JOIN dbo.users u ON u.id = doc.ResponsibleUserId
      LEFT JOIN dbo.users v ON v.id = doc.VerifiedBy
      LEFT JOIN dbo.users w ON w.id = doc.WaivedBy
      WHERE doc.DeedRecordId = @Id AND doc.IsActive = 1
      ORDER BY doc.DocumentId ASC
    `);

    const logsRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT log.*, u.name AS ActionByName
      FROM dbo.LegalDeedApprovalLog log
      JOIN dbo.users u ON u.id = log.ActionBy
      WHERE log.DeedRecordId = @Id
      ORDER BY log.LogId DESC
    `);

    res.json({
      deed: deedRes.recordset[0],
      documents: docsRes.recordset,
      logs: logsRes.recordset,
    });
  } catch (err) {
    console.error("[legalOperations] GET /deeds/:id error:", err.message);
    res.status(500).json({ error: "Failed to retrieve deed details" });
  }
});

// POST /api/legal/deeds
router.post("/deeds", requirePageRight("legal-deed-registrations", "create"), async (req, res) => {
  const {
    DeedNo, DeedYear, DeedDate, DeedTypeId, TaskTypeId, OfficeId, ProjectId, SearchId,
    MouzaId, RsDag, LrDag, RsKhatian, LrKhatian, RsPlotId, RsKhatianId, LrRorId, PlotDescription,
    PurchasedArea, AreaUnitId, MarketValue, ConsiderationAmount, StampDutyAmount, RegistrationFee,
    SellerPartyId, BuyerPartyId, AssignedExecutiveId, TargetCompletionDate
  } = req.body;

  if (!DeedTypeId) return res.status(400).json({ error: "Deed Type is required" });
  if (!OfficeId) return res.status(400).json({ error: "Registration Office is required" });

  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");
    const year = DeedYear || new Date().getFullYear();

    if (hasDossierTbl) {
      const countRes = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.LegalDeedDossier");
      const fileNo = `DEED-${year}-${String(countRes.recordset[0].total + 1).padStart(4, "0")}`;

      const insertRes = await pool.request()
        .input("DossierNumber", sql.NVarChar(50), fileNo)
        .input("SearchSessionId", sql.Int, SearchId || null)
        .input("DeedNumber", sql.NVarChar(100), DeedNo || null)
        .input("DeedYear", sql.Int, year)
        .input("DeedDate", sql.Date, DeedDate || null)
        .input("RegistrationOfficeId", sql.Int, OfficeId)
        .input("DeedTypeId", sql.Int, DeedTypeId)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("MouzaId", sql.Int, MouzaId || null)
        .input("RsDag", sql.NVarChar(50), RsDag || null)
        .input("LrDag", sql.NVarChar(50), LrDag || null)
        .input("RsKhatian", sql.NVarChar(50), RsKhatian || null)
        .input("LrKhatian", sql.NVarChar(50), LrKhatian || null)
        .input("PurchasedArea", sql.Decimal(18, 6), PurchasedArea || null)
        .input("AreaUnitId", sql.Int, AreaUnitId || null)
        .input("PropertyDescription", sql.NVarChar(1000), PlotDescription || null)
        .input("ConsiderationAmount", sql.Decimal(18, 2), ConsiderationAmount || null)
        .input("MarketValue", sql.Decimal(18, 2), MarketValue || null)
        .input("StampDutyAmount", sql.Decimal(18, 2), StampDutyAmount || null)
        .input("RegistrationFee", sql.Decimal(18, 2), RegistrationFee || null)
        .input("AssignedOwnerId", sql.Int, AssignedExecutiveId || req.user?.userId || null)
        .input("TargetCompletionDate", sql.Date, TargetCompletionDate || null)
        .input("CreatedBy", sql.Int, req.user?.userId || null)
        .query(`
          INSERT INTO dbo.LegalDeedDossier (
            DossierNumber, SearchSessionId, DeedNumber, DeedYear, DeedDate,
            RegistrationOfficeId, DeedTypeId, ProjectId, MouzaId,
            RsDag, LrDag, RsKhatian, LrKhatian, PurchasedArea, AreaUnitId,
            PropertyDescription, ConsiderationAmount, MarketValue, StampDutyAmount, RegistrationFee,
            AssignedOwnerId, TargetCompletionDate, CreatedBy, CreatedAt
          )
          OUTPUT INSERTED.DossierId
          VALUES (
            @DossierNumber, @SearchSessionId, @DeedNumber, @DeedYear, @DeedDate,
            @RegistrationOfficeId, @DeedTypeId, @ProjectId, @MouzaId,
            @RsDag, @LrDag, @RsKhatian, @LrKhatian, @PurchasedArea, @AreaUnitId,
            @PropertyDescription, @ConsiderationAmount, @MarketValue, @StampDutyAmount, @RegistrationFee,
            @AssignedOwnerId, @TargetCompletionDate, @CreatedBy, SYSUTCDATETIME()
          )
        `);

      const dossierId = insertRes.recordset[0].DossierId;

      // Insert parties if provided
      if (SellerPartyId) {
        await pool.request()
          .input("DossierId", sql.Int, dossierId)
          .input("PartyId", sql.Int, SellerPartyId)
          .input("PartyRole", sql.NVarChar(50), "Seller / Landowner")
          .query(`INSERT INTO dbo.LegalDossierParty (DossierId, PartyId, PartyRole, IsPrimary) VALUES (@DossierId, @PartyId, @PartyRole, 1)`);
      }
      if (BuyerPartyId) {
        await pool.request()
          .input("DossierId", sql.Int, dossierId)
          .input("PartyId", sql.Int, BuyerPartyId)
          .input("PartyRole", sql.NVarChar(50), "Buyer (Company)")
          .query(`INSERT INTO dbo.LegalDossierParty (DossierId, PartyId, PartyRole, IsPrimary) VALUES (@DossierId, @PartyId, @PartyRole, 1)`);
      }

      // Populate checklist items
      await pool.request().input("DossierId", sql.Int, dossierId).input("DeedTypeId", sql.Int, DeedTypeId).query(`
        INSERT INTO dbo.LegalDossierDocument (
          DossierId, DocTypeId, ChecklistItemId, VersionNo, DocumentStatus, RequirementType, Applicability, IsActive, CreatedAt
        )
        SELECT @DossierId, ci.DocTypeId, ci.ItemId, 1, 'Not Started', 
               ci.Requirement, 'Applicable', 1, SYSUTCDATETIME()
        FROM dbo.LegalChecklistItem ci
        JOIN dbo.LegalChecklistTemplate ct ON ct.TemplateId = ci.TemplateId
        WHERE ct.IsActive = 1 AND (ct.DeedTypeId = @DeedTypeId OR ct.DeedTypeId IS NULL)
        ORDER BY ci.SortOrder ASC
      `);

      return res.status(201).json({ deedRecordId: dossierId, deedFileNo: fileNo, message: "Deed dossier created successfully" });
    }

    // Fallback to LegalDeedRecord
    const countRes = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.LegalDeedRecord");
    const fileNo = `DEED-${new Date().getFullYear()}-${String(countRes.recordset[0].total + 1).padStart(4, "0")}`;

    const insertRes = await pool.request()
      .input("DeedFileNo", sql.NVarChar(50), fileNo)
      .input("DeedNo", sql.NVarChar(100), DeedNo || null)
      .input("DeedYear", sql.Int, DeedYear || null)
      .input("DeedDate", sql.Date, DeedDate || null)
      .input("DeedTypeId", sql.Int, DeedTypeId)
      .input("TaskTypeId", sql.Int, TaskTypeId || null)
      .input("OfficeId", sql.Int, OfficeId)
      .input("ProjectId", sql.Int, ProjectId || null)
      .input("SearchId", sql.Int, SearchId || null)
      .input("MouzaId", sql.Int, MouzaId || null)
      .input("RsPlotId", sql.Int, RsPlotId || null)
      .input("RsKhatianId", sql.Int, RsKhatianId || null)
      .input("LrRorId", sql.Int, LrRorId || null)
      .input("PlotDescription", sql.NVarChar(500), PlotDescription || null)
      .input("PurchasedArea", sql.Decimal(18, 6), PurchasedArea || null)
      .input("AreaUnitId", sql.Int, AreaUnitId || null)
      .input("MarketValue", sql.Decimal(18, 2), MarketValue || null)
      .input("ConsiderationAmount", sql.Decimal(18, 2), ConsiderationAmount || null)
      .input("StampDutyAmount", sql.Decimal(18, 2), StampDutyAmount || null)
      .input("RegistrationFee", sql.Decimal(18, 2), RegistrationFee || null)
      .input("SellerPartyId", sql.Int, SellerPartyId || null)
      .input("BuyerPartyId", sql.Int, BuyerPartyId || null)
      .input("AssignedExecutiveId", sql.Int, AssignedExecutiveId || null)
      .input("TargetCompletionDate", sql.Date, TargetCompletionDate || null)
      .input("CreatedBy", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalDeedRecord (
          DeedFileNo, DeedNo, DeedYear, DeedDate, DeedTypeId, TaskTypeId, OfficeId, ProjectId, SearchId,
          MouzaId, RsPlotId, RsKhatianId, LrRorId, PlotDescription, PurchasedArea, AreaUnitId,
          MarketValue, ConsiderationAmount, StampDutyAmount, RegistrationFee,
          SellerPartyId, BuyerPartyId, AssignedExecutiveId, TargetCompletionDate,
          CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.DeedRecordId
        VALUES (
          @DeedFileNo, @DeedNo, @DeedYear, @DeedDate, @DeedTypeId, @TaskTypeId, @OfficeId, @ProjectId, @SearchId,
          @MouzaId, @RsPlotId, @RsKhatianId, @LrRorId, @PlotDescription, @PurchasedArea, @AreaUnitId,
          @MarketValue, @ConsiderationAmount, @StampDutyAmount, @RegistrationFee,
          @SellerPartyId, @BuyerPartyId, @AssignedExecutiveId, @TargetCompletionDate,
          @CreatedBy, SYSUTCDATETIME()
        )
      `);

    const deedRecordId = insertRes.recordset[0].DeedRecordId;
    res.status(201).json({ deedRecordId, deedFileNo: fileNo, message: "Deed registration record created" });
  } catch (err) {
    console.error("[legalOperations] POST /deeds error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. DOCUMENT VERIFICATION & WAIVER ────────────────────────────────────────

// PUT /api/legal/deeds/:id/documents/:docId/verify
router.put("/deeds/:id/documents/:docId/verify", requirePageRight("legal-deed-registrations", "edit"), async (req, res) => {
  const { id, docId } = req.params;
  const { VerificationStatus, RejectionReason, VerificationNotes, IsNA, NAReason, IsWaived, WaiverReason } = req.body;

  try {
    const pool = getPool();
    const hasDossierDocTbl = await tableExists(pool, "LegalDossierDocument");

    if (hasDossierDocTbl) {
      await pool.request()
        .input("DocId", sql.Int, docId)
        .input("DossierId", sql.Int, id)
        .input("DocumentStatus", sql.NVarChar(40), VerificationStatus)
        .input("RejectionReason", sql.NVarChar(500), RejectionReason || null)
        .input("ReviewNotes", sql.NVarChar(1000), VerificationNotes || null)
        .input("Applicability", sql.NVarChar(30), IsNA ? "Not Applicable" : "Applicable")
        .input("NAReason", sql.NVarChar(500), NAReason || null)
        .input("IsWaived", sql.Bit, IsWaived ? 1 : 0)
        .input("WaiverReason", sql.NVarChar(500), WaiverReason || null)
        .input("UserId", sql.Int, req.user?.userId || null)
        .query(`
          UPDATE dbo.LegalDossierDocument
          SET DocumentStatus = @DocumentStatus,
              RejectionReason = @RejectionReason,
              ReviewNotes = @ReviewNotes,
              Applicability = @Applicability,
              NAReason = @NAReason,
              IsWaived = @IsWaived,
              WaiverReason = @WaiverReason,
              WaivedBy = CASE WHEN @IsWaived = 1 THEN @UserId ELSE WaivedBy END,
              WaivedAt = CASE WHEN @IsWaived = 1 THEN SYSUTCDATETIME() ELSE WaivedAt END,
              VerifiedBy = @UserId,
              VerifiedAt = SYSUTCDATETIME()
          WHERE DocumentId = @DocId AND DossierId = @DossierId
        `);

      return res.json({ message: "Document verification status updated" });
    }

    // Fallback to LegalDeedDocument
    await pool.request()
      .input("DocId", sql.Int, docId)
      .input("DeedRecordId", sql.Int, id)
      .input("VerificationStatus", sql.NVarChar(40), VerificationStatus)
      .input("RejectionReason", sql.NVarChar(500), RejectionReason || null)
      .input("VerificationNotes", sql.NVarChar(1000), VerificationNotes || null)
      .input("IsNA", sql.Bit, IsNA ? 1 : 0)
      .input("NAReason", sql.NVarChar(500), NAReason || null)
      .input("IsWaived", sql.Bit, IsWaived ? 1 : 0)
      .input("WaiverReason", sql.NVarChar(500), WaiverReason || null)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalDeedDocument
        SET VerificationStatus = @VerificationStatus,
            RejectionReason = @RejectionReason,
            VerificationNotes = @VerificationNotes,
            IsNA = @IsNA,
            NAReason = @NAReason,
            IsWaived = @IsWaived,
            WaiverReason = @WaiverReason,
            WaivedBy = CASE WHEN @IsWaived = 1 THEN @UserId ELSE WaivedBy END,
            WaivedAt = CASE WHEN @IsWaived = 1 THEN SYSUTCDATETIME() ELSE WaivedAt END,
            VerifiedBy = @UserId,
            VerifiedAt = SYSUTCDATETIME(),
            UpdatedBy = @UserId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE DocumentId = @DocId AND DeedRecordId = @DeedRecordId
      `);

    res.json({ message: "Document verification status updated" });
  } catch (err) {
    console.error("[legalOperations] verify document error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 4. TWO-LEVEL APPROVAL WORKFLOW (L1 & L2) ──────────────────────────────────

// POST /api/legal/deeds/:id/submit-l1
router.post("/deeds/:id/submit-l1", requirePageRight("legal-approvals", "edit"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");

    if (hasDossierTbl) {
      await pool.request()
        .input("Id", sql.Int, id)
        .input("UserId", sql.Int, req.user?.userId || null)
        .query(`
          UPDATE dbo.LegalDeedDossier
          SET OverallStatus = 'L1 Pending',
              ApprovalStatus = 'L1 Pending',
              UpdatedBy = @UserId,
              UpdatedAt = SYSUTCDATETIME()
          WHERE DossierId = @Id
        `);
      return res.json({ message: "Deed submitted for L1 Review" });
    }

    await pool.request()
      .input("Id", sql.Int, id)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalDeedRecord
        SET OverallStatus = 'L1 Pending',
            L1Status = 'Pending',
            UpdatedBy = @UserId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE DeedRecordId = @Id
      `);

    res.json({ message: "Deed submitted for L1 Review" });
  } catch (err) {
    console.error("[legalOperations] submit L1 error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/legal/deeds/:id/l1-action (Approve / Return)
router.post("/deeds/:id/l1-action", requirePageRight("legal-approvals", "approve"), async (req, res) => {
  const { id } = req.params;
  const { action, remarks } = req.body;

  if (!["Approve", "Return"].includes(action)) {
    return res.status(400).json({ error: "Invalid action. Must be Approve or Return" });
  }

  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");
    const newL1Status = action === "Approve" ? "L1 Approved" : "L1 Returned";
    const newOverallStatus = action === "Approve" ? "L2 Pending" : "L1 Returned";

    if (hasDossierTbl) {
      await pool.request()
        .input("Id", sql.Int, id)
        .input("ApprovalStatus", sql.NVarChar(40), newL1Status)
        .input("OverallStatus", sql.NVarChar(50), newOverallStatus)
        .input("Remarks", sql.NVarChar(1000), remarks || null)
        .input("UserId", sql.Int, req.user?.userId || null)
        .query(`
          UPDATE dbo.LegalDeedDossier
          SET ApprovalStatus = @ApprovalStatus,
              OverallStatus = @OverallStatus,
              L1ReviewerId = @UserId,
              L1ReviewedAt = SYSUTCDATETIME(),
              L1Remarks = @Remarks,
              UpdatedBy = @UserId,
              UpdatedAt = SYSUTCDATETIME()
          WHERE DossierId = @Id
        `);
      return res.json({ message: `Deed L1 ${action}ed successfully` });
    }

    await pool.request()
      .input("Id", sql.Int, id)
      .input("L1Status", sql.NVarChar(30), action === "Approve" ? "Approved" : "Returned")
      .input("OverallStatus", sql.NVarChar(50), newOverallStatus)
      .input("Remarks", sql.NVarChar(1000), remarks || null)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalDeedRecord
        SET L1Status = @L1Status,
            OverallStatus = @OverallStatus,
            L1ReviewerId = @UserId,
            L1ReviewedAt = SYSUTCDATETIME(),
            L1Remarks = @Remarks,
            UpdatedBy = @UserId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE DeedRecordId = @Id
      `);

    res.json({ message: `Deed L1 ${action}ed successfully` });
  } catch (err) {
    console.error("[legalOperations] L1 action error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/legal/deeds/:id/l2-action (Approve / Return / Reject)
router.post("/deeds/:id/l2-action", requirePageRight("legal-approvals", "approve"), async (req, res) => {
  const { id } = req.params;
  const { action, remarks } = req.body;

  if (!["Approve", "Return", "Reject"].includes(action)) {
    return res.status(400).json({ error: "Invalid action. Must be Approve, Return or Reject" });
  }

  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");
    const newL2Status = action === "Approve" ? "L2 Approved" : action === "Return" ? "L2 Returned" : "Rejected";
    const newOverallStatus = action === "Approve" ? "Completed" : action === "Return" ? "L2 Returned" : "Rejected";

    if (hasDossierTbl) {
      await pool.request()
        .input("Id", sql.Int, id)
        .input("ApprovalStatus", sql.NVarChar(40), newL2Status)
        .input("OverallStatus", sql.NVarChar(50), newOverallStatus)
        .input("Remarks", sql.NVarChar(1000), remarks || null)
        .input("UserId", sql.Int, req.user?.userId || null)
        .query(`
          UPDATE dbo.LegalDeedDossier
          SET ApprovalStatus = @ApprovalStatus,
              OverallStatus = @OverallStatus,
              L2ApproverId = @UserId,
              L2ApprovedAt = SYSUTCDATETIME(),
              L2Remarks = @Remarks,
              CompletionDate = CASE WHEN @ApprovalStatus = 'L2 Approved' THEN CAST(SYSUTCDATETIME() AS DATE) ELSE NULL END,
              UpdatedBy = @UserId,
              UpdatedAt = SYSUTCDATETIME()
          WHERE DossierId = @Id
        `);
      return res.json({ message: `Deed L2 ${action}ed successfully. ${action === "Approve" ? "Registration completed!" : ""}` });
    }

    await pool.request()
      .input("Id", sql.Int, id)
      .input("L2Status", sql.NVarChar(30), action === "Approve" ? "Approved" : action === "Return" ? "Returned" : "Rejected")
      .input("OverallStatus", sql.NVarChar(50), newOverallStatus)
      .input("Remarks", sql.NVarChar(1000), remarks || null)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalDeedRecord
        SET L2Status = @L2Status,
            OverallStatus = @OverallStatus,
            L2ApproverId = @UserId,
            L2ApprovedAt = SYSUTCDATETIME(),
            L2Remarks = @Remarks,
            UpdatedBy = @UserId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE DeedRecordId = @Id
      `);

    res.json({ message: `Deed L2 ${action}ed successfully. ${action === "Approve" ? "Registration completed!" : ""}` });
  } catch (err) {
    console.error("[legalOperations] L2 action error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 5. PENDING QUEUES & OVERDUE METRICS ───────────────────────────────────────

// GET /api/legal/pending-queue
router.get("/pending-queue", requirePageRight("legal-pending-queue", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const hasDossierTbl = await tableExists(pool, "LegalDeedDossier");

    if (hasDossierTbl) {
      const [pendingDeeds, missingDocs, approvalQueue] = await Promise.all([
        pool.request().query(`
          SELECT d.DossierId AS DeedRecordId, d.DossierNumber AS DeedFileNo, d.DeedNumber AS DeedNo,
                 d.OverallStatus, d.TargetCompletionDate, o.OfficeName, p.name AS ProjectName,
                 ae.name AS AssignedExecutiveName,
                 DATEDIFF(day, d.CreatedAt, SYSUTCDATETIME()) AS AgeDays
          FROM dbo.LegalDeedDossier d
          JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.RegistrationOfficeId
          LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
          LEFT JOIN dbo.users ae ON ae.id = d.AssignedOwnerId
          WHERE d.IsActive = 1 AND d.OverallStatus NOT IN ('Completed', 'Rejected')
          ORDER BY d.CreatedAt ASC
        `),
        pool.request().query(`
          SELECT doc.DocumentId, doc.DossierId AS DeedRecordId, d.DossierNumber AS DeedFileNo,
                 dt.DocTypeName, dt.Category, doc.DocumentStatus AS VerificationStatus,
                 doc.DueDate, doc.RejectionReason, u.name AS ResponsibleUserName, p.name AS ProjectName
          FROM dbo.LegalDossierDocument doc
          JOIN dbo.LegalDeedDossier d ON d.DossierId = doc.DossierId
          JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = doc.DocTypeId
          LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
          LEFT JOIN dbo.users u ON u.id = doc.ResponsibleUserId
          WHERE doc.IsActive = 1 AND doc.RequirementType = 'Required'
            AND doc.DocumentStatus NOT IN ('Accepted', 'Waived')
          ORDER BY doc.DueDate ASC, doc.DocumentId ASC
        `),
        pool.request().query(`
          SELECT d.DossierId AS DeedRecordId, d.DossierNumber AS DeedFileNo, d.OverallStatus,
                 d.ApprovalStatus AS L1Status, d.ApprovalStatus AS L2Status,
                 dt.DeedTypeName, o.OfficeName, p.name AS ProjectName,
                 DATEDIFF(day, ISNULL(d.UpdatedAt, d.CreatedAt), SYSUTCDATETIME()) AS WaitingDays
          FROM dbo.LegalDeedDossier d
          JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId
          JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.RegistrationOfficeId
          LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
          WHERE d.IsActive = 1 AND d.OverallStatus IN ('L1 Pending', 'L2 Pending')
          ORDER BY d.UpdatedAt ASC
        `),
      ]);

      return res.json({
        pendingDeeds: pendingDeeds.recordset,
        missingDocs: missingDocs.recordset,
        approvalQueue: approvalQueue.recordset,
      });
    }

    // Fallback to LegalDeedRecord
    const [pendingDeeds, missingDocs, approvalQueue] = await Promise.all([
      pool.request().query(`
        SELECT d.DeedRecordId, d.DeedFileNo, d.DeedNo, d.OverallStatus, d.TargetCompletionDate,
               o.OfficeName, p.name AS ProjectName, ae.name AS AssignedExecutiveName,
               DATEDIFF(day, d.CreatedAt, SYSUTCDATETIME()) AS AgeDays
        FROM dbo.LegalDeedRecord d
        JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.OfficeId
        LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
        LEFT JOIN dbo.users ae ON ae.id = d.AssignedExecutiveId
        WHERE d.IsActive = 1 AND d.OverallStatus IN ('Awaiting Registered Deed', 'Pending Documents', 'L1 Returned', 'L2 Returned', 'On Hold')
        ORDER BY d.CreatedAt ASC
      `),
      pool.request().query(`
        SELECT doc.DocumentId, doc.DeedRecordId, d.DeedFileNo, dt.DocTypeName, dt.Category,
               doc.VerificationStatus, doc.DueDate, doc.RejectionReason,
               u.name AS ResponsibleUserName, p.name AS ProjectName
        FROM dbo.LegalDeedDocument doc
        JOIN dbo.LegalDeedRecord d ON d.DeedRecordId = doc.DeedRecordId
        JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = doc.DocTypeId
        LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
        LEFT JOIN dbo.users u ON u.id = doc.ResponsibleUserId
        WHERE doc.IsActive = 1 AND doc.IsMandatory = 1 
          AND doc.VerificationStatus IN ('Not Started', 'Requested', 'Rejected', 'Under Review')
        ORDER BY doc.DueDate ASC, doc.DocumentId ASC
      `),
      pool.request().query(`
        SELECT d.DeedRecordId, d.DeedFileNo, d.OverallStatus, d.L1Status, d.L2Status,
               dt.DeedTypeName, o.OfficeName, p.name AS ProjectName,
               DATEDIFF(day, ISNULL(d.UpdatedAt, d.CreatedAt), SYSUTCDATETIME()) AS WaitingDays
        FROM dbo.LegalDeedRecord d
        JOIN dbo.LegalDeedType dt ON dt.DeedTypeId = d.DeedTypeId
        JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = d.OfficeId
        LEFT JOIN dbo.enterprise p ON p.id = d.ProjectId
        WHERE d.IsActive = 1 AND d.OverallStatus IN ('L1 Pending', 'L2 Pending')
        ORDER BY d.UpdatedAt ASC
      `),
    ]);

    res.json({
      pendingDeeds: pendingDeeds.recordset,
      missingDocs: missingDocs.recordset,
      approvalQueue: approvalQueue.recordset,
    });
  } catch (err) {
    console.error("[legalOperations] GET /pending-queue error:", err.message);
    res.status(500).json({ error: "Failed to retrieve pending queues" });
  }
});

module.exports = router;
