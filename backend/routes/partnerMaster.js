// backend/routes/partnerMaster.js
//
// Partner Master (Finance module) — every Partner gets TWO
// dbo.AccountHeadMaster rows (LHeadType='P'), not one: a Capital Account
// ledger and a Current Account ledger, standard partnership-accounting
// practice (Fixed Capital + fluctuating Current Account). Investments post
// against the Capital head, drawings/day-to-day movements against the
// Current head — there is no single "the partner's account" to pick from a
// dropdown, so this Master never asks for one.
//
// The two heads are linked by LHeadCode convention, not a schema change:
// given a Partner Code like "PTR-001", the Capital head is stored as
// "PTR-001-CAP" and the Current head as "PTR-001-CUR" (LHeadCode has a
// table-wide UNIQUE constraint, so the same literal code can't be reused
// for both). GET / strips the suffix and pairs rows with the same base
// code back into one Partner row for the list UI.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

const CAP_SUFFIX = "-CAP";
const CUR_SUFFIX = "-CUR";
// LHeadCode is NVARCHAR(20); the longer suffix (-CUR, 4 chars) must still
// fit, so the base Partner Code is capped at 16.
const MAX_BASE_CODE_LEN = 20 - CUR_SUFFIX.length;

const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

const requireUserName = (req, res) => {
  const email = req.user?.name || req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// Capital = the LEAF "Capital Account" group (LIABILITIES > Capital
// Account > Capital Account, LHeadCode='CAPA0') — its own parent, also
// named "Capital Account" (Code='CAPA'), is just a grouping shell and is
// never itself a postable target. Current = "Current Account" under
// CURRENT ASSETS (Code='CURAC'). Both seeded on dev to match production's
// existing structure — resolved by Code, not Name, since the two "Capital
// Account" levels share a name and only Code tells them apart.
let _partnerGroupsCache = null;
async function getPartnerGroups(pool) {
  if (_partnerGroupsCache) return _partnerGroupsCache;
  const result = await pool.request().query(`
    SELECT AGId AS id, Name AS label, Code AS code FROM dbo.AccountGroup
    WHERE Code IN ('CAPA0', 'CURAC')
  `);
  const capital = result.recordset.find((g) => g.code === "CAPA0") ?? null;
  const current = result.recordset.find((g) => g.code === "CURAC") ?? null;
  if (!capital || !current) {
    throw new Error(
      "Capital Account (CAPA0) / Current Account (CURAC) groups not found — seed them before using Partner Master.",
    );
  }
  _partnerGroupsCache = { capital, current };
  return _partnerGroupsCache;
}

// ── GET /group-options — informational only, for the list column ───────────
router.get("/group-options", requirePageRight("partner-master", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const groups = await getPartnerGroups(pool);
    res.json([groups.capital, groups.current]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch account groups", message: err.message });
  }
});

function stripSuffix(code) {
  if (code.endsWith(CAP_SUFFIX)) return { base: code.slice(0, -CAP_SUFFIX.length), kind: "capital" };
  if (code.endsWith(CUR_SUFFIX)) return { base: code.slice(0, -CUR_SUFFIX.length), kind: "current" };
  return { base: code, kind: null };
}

// ── GET / — list every Partner (paired Capital + Current rows) ─────────────
router.get("/", requirePageRight("partner-master", "view"), cache("partner-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("type", sql.VarChar(50), "P").query(`
      SELECT
        ahm.LHeadId    AS id,
        ahm.LHeadName  AS partnerName,
        ahm.LHeadCode  AS code,
        ahm.LHeadStatus AS status,
        ahm.LBelongsTo AS groupId,
        ag.Name        AS groupName,
        ahm.CreatedBy  AS createdBy,
        ahm.CreatedAt  AS createdAt
      FROM dbo.AccountHeadMaster ahm
      LEFT JOIN dbo.AccountGroup ag ON ag.AGId = ahm.LBelongsTo
      WHERE ahm.LHeadType = @type
      ORDER BY ahm.LHeadId DESC
    `);

    const byBase = new Map();
    for (const row of result.recordset) {
      const { base, kind } = stripSuffix(row.code || "");
      if (!kind) continue; // pre-suffix-convention row, if any — not a manageable pair
      const entry = byBase.get(base) ?? {
        partnerCode: base,
        partnerName: row.partnerName,
        status: row.status,
        createdAt: row.createdAt,
        capitalHeadId: null,
        currentHeadId: null,
        capitalGroupName: null,
        currentGroupName: null,
      };
      if (kind === "capital") {
        entry.capitalHeadId = row.id;
        entry.capitalGroupName = row.groupName;
      } else {
        entry.currentHeadId = row.id;
        entry.currentGroupName = row.groupName;
      }
      // Prefer the more recently created row's name/status if they ever
      // drift (shouldn't, since PUT updates both together) — last one wins.
      entry.partnerName = row.partnerName;
      entry.status = entry.status && row.status; // Active only if BOTH are active
      byBase.set(base, entry);
    }

    const partners = Array.from(byBase.values()).map((p) => ({ ...p, id: p.partnerCode }));
    res.json(partners);
  } catch (err) {
    console.error("GET PARTNER MASTER ERROR:", err);
    res.status(500).json({ error: "Failed to fetch partners", message: err.message });
  }
});

// ── POST / — create a Partner (Capital + Current heads together) ───────────
router.post("/", requirePageRight("partner-master", "create"), async (req, res) => {
  const { PartnerName, PartnerCode } = req.body;

  const name = cleanStr(PartnerName, 200);
  const baseCode = cleanStr(PartnerCode, MAX_BASE_CODE_LEN);
  if (!name) return res.status(400).json({ error: "Partner Name is required." });
  if (!baseCode) return res.status(400).json({ error: "Partner Code is required." });

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const groups = await getPartnerGroups(pool);

    await tx.begin();
    const insertHead = async (code, groupId, displayName) => {
      const request = new sql.Request(tx);
      const result = await request
        .input("LHeadName", sql.NVarChar(200), name)
        .input("DisplayName", sql.NVarChar(200), displayName)
        .input("LHeadType", sql.VarChar(50), "P")
        .input("LHeadCode", sql.NVarChar(20), code)
        .input("LHeadAddress", sql.NVarChar(300), "N/A")
        .input("LHeadContactPerson", sql.NVarChar(100), "N/A")
        .input("LHeadStatus", sql.Bit, 1)
        .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
        .input("LHeadCreditLimit", sql.Decimal(18, 2), 0)
        .input("LBelongsTo", sql.Int, groupId)
        .input("CreatedBy", sql.NVarChar(100), userEmail)
        .input("CreatedAt", sql.DateTime2, new Date()).query(`
          INSERT INTO dbo.AccountHeadMaster (
            LHeadName, DisplayName, LHeadType, LHeadCode, LHeadAddress, LHeadContactPerson,
            LHeadStatus, LHeadPaymentTerms, LHeadCreditLimit, LBelongsTo,
            CreatedBy, CreatedAt
          )
          OUTPUT INSERTED.LHeadId AS id
          VALUES (
            @LHeadName, @DisplayName, @LHeadType, @LHeadCode, @LHeadAddress, @LHeadContactPerson,
            @LHeadStatus, @LHeadPaymentTerms, @LHeadCreditLimit, @LBelongsTo,
            @CreatedBy, @CreatedAt
          )
        `);
      return result.recordset[0].id;
    };

    // Every other picker across the app that lists AccountHeadMaster rows
    // (Payment page's Payee/Party, Invoice's Payable To, Trial Balance,
    // etc.) shows ISNULL(DisplayName, LHeadName) — and both of this
    // Partner's heads share the same LHeadName, which would otherwise show
    // up twice with no way to tell them apart. DisplayName disambiguates
    // everywhere at once instead of patching every consumer's own query.
    const capitalHeadId = await insertHead(`${baseCode}${CAP_SUFFIX}`, groups.capital.id, `${name} (Capital Account)`);
    const currentHeadId = await insertHead(`${baseCode}${CUR_SUFFIX}`, groups.current.id, `${name} (Current Account)`);
    await tx.commit();

    await bumpCacheVersion("partner-master");
    res.status(201).json({
      id: baseCode,
      partnerCode: baseCode,
      partnerName: name,
      status: true,
      capitalHeadId,
      currentHeadId,
      capitalGroupName: groups.capital.label,
      currentGroupName: groups.current.label,
    });
  } catch (err) {
    await tx.rollback().catch(() => {});
    console.error("INSERT PARTNER MASTER ERROR:", err);
    if (err.number === 2627 || err.number === 547) {
      return res.status(400).json({
        error: "Validation failed",
        message: `Partner Code "${baseCode}" is already in use.`,
      });
    }
    res.status(500).json({ error: "Failed to create partner", message: err.message });
  }
});

// ── PUT /:code — update a Partner's name/status on both heads ──────────────
router.put("/:code", requirePageRight("partner-master", "edit"), async (req, res) => {
  const baseCode = decodeURIComponent(String(req.params.code || "")).trim();
  if (!baseCode) return res.status(400).json({ error: "Invalid Partner Code" });
  const { PartnerName, Status } = req.body;

  try {
    const pool = getPool();
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const newName = cleanStr(PartnerName, 200);
    const result = await pool
      .request()
      .input("CapCode", sql.NVarChar(20), `${baseCode}${CAP_SUFFIX}`)
      .input("CurCode", sql.NVarChar(20), `${baseCode}${CUR_SUFFIX}`)
      .input("LHeadName", sql.NVarChar(200), newName)
      .input("CapDisplayName", sql.NVarChar(200), newName ? `${newName} (Capital Account)` : null)
      .input("CurDisplayName", sql.NVarChar(200), newName ? `${newName} (Current Account)` : null)
      .input(
        "LHeadStatus",
        sql.Bit,
        Status !== undefined ? (Boolean(Status) ? 1 : 0) : null,
      )
      .input("UpdatedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.AccountHeadMaster SET
          LHeadName   = COALESCE(@LHeadName, LHeadName),
          DisplayName = COALESCE(
            CASE WHEN LHeadCode = @CapCode THEN @CapDisplayName
                 WHEN LHeadCode = @CurCode THEN @CurDisplayName END,
            DisplayName
          ),
          LHeadStatus = COALESCE(@LHeadStatus, LHeadStatus),
          isEdited    = 1,
          UpdatedBy   = @UpdatedBy,
          UpdatedAt   = SYSDATETIME()
        WHERE LHeadType = 'P' AND LHeadCode IN (@CapCode, @CurCode)
      `);
    if (result.rowsAffected?.[0] !== 2) {
      return res.status(404).json({ error: "Partner not found (expected both Capital and Current heads)." });
    }

    await bumpCacheVersion("partner-master");
    res.json({ success: true, message: "Partner updated successfully" });
  } catch (err) {
    console.error("UPDATE PARTNER MASTER ERROR:", err);
    res.status(500).json({ error: "Failed to update partner", message: err.message });
  }
});

// ── DELETE /:code — remove a Partner (both heads) ───────────────────────────
router.delete("/:code", requirePageRight("partner-master", "delete"), async (req, res) => {
  const baseCode = decodeURIComponent(String(req.params.code || "")).trim();
  if (!baseCode) return res.status(400).json({ error: "Invalid Partner Code" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("CapCode", sql.NVarChar(20), `${baseCode}${CAP_SUFFIX}`)
      .input("CurCode", sql.NVarChar(20), `${baseCode}${CUR_SUFFIX}`).query(`
        DELETE FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'P' AND LHeadCode IN (@CapCode, @CurCode)
      `);
    if (!result.rowsAffected?.[0]) {
      return res.status(404).json({ error: "Partner not found" });
    }

    await bumpCacheVersion("partner-master");
    res.json({ success: true, message: "Partner deleted successfully" });
  } catch (err) {
    console.error("DELETE PARTNER MASTER ERROR:", err);
    if (err.number === 547) {
      return res.status(409).json({
        error: "This Partner cannot be deleted — it already has ledger activity against it.",
      });
    }
    res.status(500).json({ error: "Failed to delete partner", message: err.message });
  }
});

module.exports = router;
