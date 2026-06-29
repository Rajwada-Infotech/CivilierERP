const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin, isSaTeamLead } = require("../services/saAccess");

const router = express.Router();
router.use(authMiddleware);

// ── GET / ──────────────────────────────────────────────────────────────────
// Admin: all requests.  TL: only requests they raised.
router.get("/", requirePageRight("sa-lead-transfers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let whereClause = "";
    if (!isSaAdmin(req)) {
      request.input("ActorId", sql.Int, actorId(req));
      whereClause = "WHERE r.RequestedByUserId = @ActorId";
    }

    const result = await request.query(`
      SELECT
        r.Id,
        r.Status,
        r.RequestNotes,
        r.AdminNotes,
        r.CreatedAt,
        r.ResolvedAt,
        fromTL.name  AS FromTeamLeadName,
        fromTL.email AS FromTeamLeadEmail,
        toTL.name    AS ToTeamLeadName,
        toTL.email   AS ToTeamLeadEmail,
        resolver.name AS ResolvedByName,
        r.FromTeamLeadId,
        r.ToTeamLeadId,
        r.RequestedByUserId,
        (SELECT COUNT(*) FROM dbo.SaLeadTransferRequestItem i WHERE i.TransferRequestId = r.Id)          AS TotalLeads,
        (SELECT COUNT(*) FROM dbo.SaLeadTransferRequestItem i WHERE i.TransferRequestId = r.Id AND i.Transferred = 1) AS TransferredLeads
      FROM dbo.SaLeadTransferRequest r
      LEFT JOIN dbo.Users fromTL   ON fromTL.id   = r.FromTeamLeadId
      LEFT JOIN dbo.Users toTL     ON toTL.id     = r.ToTeamLeadId
      LEFT JOIN dbo.Users resolver ON resolver.id = r.ResolvedBy
      ${whereClause}
      ORDER BY r.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[sa-lead-transfers] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/items ─────────────────────────────────────────────────────────
// Lead list for a specific request
router.get("/:id/items", requirePageRight("sa-lead-transfers", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("RequestId", sql.Int, id)
      .query(`
        SELECT
          i.Id,
          i.LeadId,
          i.Transferred,
          l.LeadUid,
          l.CustomerName,
          l.Mobile,
          l.Status      AS LeadStatus,
          l.Classification,
          l.AssignedToUserId,
          sp.name       AS CurrentSalesperson
        FROM dbo.SaLeadTransferRequestItem i
        JOIN dbo.SaLead l ON l.Id = i.LeadId
        LEFT JOIN dbo.Users sp ON sp.id = l.AssignedToUserId
        WHERE i.TransferRequestId = @RequestId
        ORDER BY l.CustomerName
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[sa-lead-transfers] GET /:id/items error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────
// TL submits a transfer request
router.post("/", requirePageRight("sa-lead-transfers", "create"), async (req, res) => {
  const { ToTeamLeadId, LeadIds, RequestNotes } = req.body;

  if (!ToTeamLeadId || !Number.isFinite(parseInt(ToTeamLeadId)))
    return res.status(400).json({ error: "ToTeamLeadId is required" });
  if (!Array.isArray(LeadIds) || LeadIds.length === 0)
    return res.status(400).json({ error: "At least one lead must be selected" });

  const actor = actorId(req);

  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Verify destination TL exists and has STL role
      const tlCheck = await tx.request()
        .input("ToTLId", sql.Int, parseInt(ToTeamLeadId))
        .query(`
          SELECT u.id FROM dbo.Users u
          JOIN dbo.Role r ON r.RId = u.RoleId
          WHERE u.id = @ToTLId AND r.RName IN ('sales_team_lead','admin','superadmin')
        `);
      if (!tlCheck.recordset.length)
        throw new Error("Destination user is not a team lead");

      // Insert request header
      const headerResult = await tx.request()
        .input("RequestedByUserId", sql.Int, actor)
        .input("FromTeamLeadId", sql.Int, actor)
        .input("ToTeamLeadId", sql.Int, parseInt(ToTeamLeadId))
        .input("RequestNotes", sql.NVarChar(1000), RequestNotes || null)
        .query(`
          INSERT INTO dbo.SaLeadTransferRequest
            (RequestedByUserId, FromTeamLeadId, ToTeamLeadId, Status, RequestNotes, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@RequestedByUserId, @FromTeamLeadId, @ToTeamLeadId, 'Pending', @RequestNotes, GETDATE())
        `);
      const newId = headerResult.recordset[0].Id;

      // Insert items
      for (const leadId of LeadIds) {
        const lid = parseInt(leadId);
        if (!Number.isFinite(lid)) continue;
        await tx.request()
          .input("TransferRequestId", sql.Int, newId)
          .input("LeadId", sql.Int, lid)
          .query(`
            INSERT INTO dbo.SaLeadTransferRequestItem (TransferRequestId, LeadId)
            VALUES (@TransferRequestId, @LeadId)
          `);
      }

      await tx.commit();
      res.json({ message: "Transfer request submitted", id: newId });
    } catch (innerErr) {
      await tx.rollback();
      throw innerErr;
    }
  } catch (err) {
    console.error("[sa-lead-transfers] POST error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /:id/approve ──────────────────────────────────────────────────────
// Admin approves: reassigns all leads to the destination TL
router.post("/:id/approve", requirePageRight("sa-lead-transfers", "edit"), async (req, res) => {
  if (!isSaAdmin(req)) return res.status(403).json({ error: "Only admins can approve transfer requests" });

  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { AdminNotes } = req.body;
  const actor = actorId(req);

  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Fetch request
      const reqResult = await tx.request()
        .input("Id", sql.Int, id)
        .query("SELECT * FROM dbo.SaLeadTransferRequest WHERE Id = @Id");
      if (!reqResult.recordset.length) throw new Error("Request not found");
      const tfReq = reqResult.recordset[0];
      if (tfReq.Status !== "Pending") throw new Error(`Request is already ${tfReq.Status}`);

      // Fetch items
      const items = await tx.request()
        .input("RequestId", sql.Int, id)
        .query("SELECT LeadId FROM dbo.SaLeadTransferRequestItem WHERE TransferRequestId = @RequestId");

      // Reassign each lead: AssignedToUserId = ToTeamLeadId (TL re-distributes via Distribution module)
      for (const item of items.recordset) {
        await tx.request()
          .input("LeadId", sql.Int, item.LeadId)
          .input("ToTLId", sql.Int, tfReq.ToTeamLeadId)
          .query(`
            UPDATE dbo.SaLead SET
              AssignedToUserId = @ToTLId,
              UpdatedAt        = GETDATE()
            WHERE Id = @LeadId
          `);

        await tx.request()
          .input("RequestId", sql.Int, id)
          .input("LeadId", sql.Int, item.LeadId)
          .query(`
            UPDATE dbo.SaLeadTransferRequestItem SET Transferred = 1
            WHERE TransferRequestId = @RequestId AND LeadId = @LeadId
          `);
      }

      // Mark request approved
      await tx.request()
        .input("Id", sql.Int, id)
        .input("AdminNotes", sql.NVarChar(1000), AdminNotes || null)
        .input("ResolvedBy", sql.Int, actor)
        .input("ResolvedAt", sql.DateTime2(3), new Date())
        .query(`
          UPDATE dbo.SaLeadTransferRequest SET
            Status     = 'Approved',
            AdminNotes = @AdminNotes,
            ResolvedBy = @ResolvedBy,
            ResolvedAt = @ResolvedAt,
            UpdatedAt  = GETDATE()
          WHERE Id = @Id
        `);

      await tx.commit();
      res.json({ message: `${items.recordset.length} lead(s) transferred successfully` });
    } catch (innerErr) {
      await tx.rollback();
      throw innerErr;
    }
  } catch (err) {
    console.error("[sa-lead-transfers] POST /approve error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /:id/reject ───────────────────────────────────────────────────────
router.post("/:id/reject", requirePageRight("sa-lead-transfers", "edit"), async (req, res) => {
  if (!isSaAdmin(req)) return res.status(403).json({ error: "Only admins can reject transfer requests" });

  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { AdminNotes } = req.body;
  const actor = actorId(req);

  try {
    const pool = getPool();
    const check = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Status FROM dbo.SaLeadTransferRequest WHERE Id = @Id");
    if (!check.recordset.length) return res.status(404).json({ error: "Request not found" });
    if (check.recordset[0].Status !== "Pending")
      return res.status(400).json({ error: `Request is already ${check.recordset[0].Status}` });

    await pool.request()
      .input("Id", sql.Int, id)
      .input("AdminNotes", sql.NVarChar(1000), AdminNotes || null)
      .input("ResolvedBy", sql.Int, actor)
      .input("ResolvedAt", sql.DateTime2(3), new Date())
      .query(`
        UPDATE dbo.SaLeadTransferRequest SET
          Status     = 'Rejected',
          AdminNotes = @AdminNotes,
          ResolvedBy = @ResolvedBy,
          ResolvedAt = @ResolvedAt,
          UpdatedAt  = GETDATE()
        WHERE Id = @Id
      `);
    res.json({ message: "Transfer request rejected" });
  } catch (err) {
    console.error("[sa-lead-transfers] POST /reject error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
