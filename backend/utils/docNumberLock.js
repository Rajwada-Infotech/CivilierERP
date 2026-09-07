/**
 * backend/utils/docNumberLock.js
 *
 * Generates and race-safely locks the next sequential document number for any
 * module that uses TypeOfDoc + DocNumberSequence.
 *
 * ── Number formats (three tiers, evaluated in order) ─────────────────────────
 *
 *  TIER 1 — New project-scoped convention  (migration 046+)
 *    Condition : TypeOfDoc.ModuleCode IS NOT NULL
 *                AND TypeOfDoc.ProjectCode IS NOT NULL
 *                AND TypeOfDoc.FinYearReset = 1
 *    Format    : {ProjectCode}-{ModuleCode}/{Serial}/{FinYear}
 *    Example   : GC-WO/0001/26-27
 *    Counter   : resets each financial year, scoped per (DocNoPrefix, FinYear)
 *
 *  TIER 2 — Existing dash format  (migration 035)
 *    Condition : TypeOfDoc.DocNoPrefix IS NOT NULL  (and not Tier 1)
 *    Format    : {DocNoPrefix}-{CalendarYear}-{Serial}
 *    Example   : ExB-PO-GRN-2026-00008
 *    Counter   : resets each calendar year, scoped per (DocNoPrefix, DocYear)
 *
 *  TIER 3 — Legacy slash format  (pre-migration 035)
 *    Condition : TypeOfDoc.DocNoPrefix IS NULL
 *    Format    : {FullPrefix}{Serial}/{FinYear}
 *    Example   : CI/WO/000042/2024-25
 *    Counter   : global, never resets
 *
 * ── Backward compatibility ────────────────────────────────────────────────────
 *
 *  All pre-existing rows continue to work without any data changes.
 *  The tier is determined purely by which columns are populated on the row.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *  const {
 *    lockNextDocNumber,
 *    previewNextDocNumber,
 *    backPatchRecordId,
 *    resolveDocTypeId,
 *    resolveGRNPrefix,
 *  } = require('../utils/docNumberLock');
 *
 *  // Resolve TypeOfDocId from canonical DocNoPrefix string:
 *  const docTypeId = await resolveDocTypeId(pool, sql, 'ExB-PO-GRN');
 *
 *  // Lock next number (Tier 1 example — project-scoped):
 *  const finalDocNo = await lockNextDocNumber(pool, sql, {
 *    docTypeId,
 *    finYear    : '26-27',          // required for Tier 1 and Tier 3
 *    tableName  : 'WorkOrderHeader',
 *    docNoColumn: 'DocNo',          // optional, defaults to 'DocNo'
 *    issuedBy   : req.user?.email,
 *    parentDocNo: null,
 *  });
 *
 *  // Stamp record id back after INSERT:
 *  await backPatchRecordId(pool, sql, finalDocNo, 'WorkOrderHeader', newId);
 */

"use strict";

// ── Date helpers ──────────────────────────────────────────────────────────────

/** 4-digit calendar year, e.g. 2026 */
function currentYear() {
  return new Date().getFullYear();
}

/**
 * Derive the current Indian financial year string (YY-YY).
 * April–March cycle: April 2026 → March 2027 = "26-27".
 * @param {Date} [date]  defaults to now
 * @returns {string}  e.g. "26-27"
 */
function currentFinYear(date) {
  const d = date || new Date();
  const yr = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const startYear = month >= 4 ? yr : yr - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

/**
 * Extract the 4-digit start-calendar-year from a finYear string, for
 * Tier-2 ("new-dash") doc numbers that embed a plain calendar year.
 * Accepts "FY 2025-26", "2025-26", or "25-26" style strings.
 * @param {string|null|undefined} finYear
 * @returns {number|null}
 */
function finYearToCalendarYear(finYear) {
  if (!finYear) return null;
  const s = String(finYear);
  const full = s.match(/(\d{4})/);
  if (full) return parseInt(full[1], 10);
  const short = s.match(/(\d{2})-(\d{2})/);
  if (short) return 2000 + parseInt(short[1], 10);
  return null;
}

// ── Tier detection ────────────────────────────────────────────────────────────

/**
 * Determine which format tier applies for a given TypeOfDoc row.
 * @returns {"new-project"|"new-dash"|"legacy"}
 */
function detectTier(typeRow) {
  if (
    typeRow.ModuleCode &&
    typeRow.ProjectCode &&
    typeRow.FinYearReset === true
  ) {
    return "new-project";
  }
  if (typeRow.DocNoPrefix) {
    return "new-dash";
  }
  return "legacy";
}

// ── DocNo builders ────────────────────────────────────────────────────────────

/**
 * Build the final DocNo string for the correct tier.
 *
 * Tier 1 (new-project): "GC-WO/0001/26-27"
 * Tier 2 (new-dash):    "ExB-PO-GRN-2026-00008"
 * Tier 3 (legacy):      "CI/WO/000042/2024-25"
 */
function buildDocNo({
  tier,
  projectCode,
  moduleCode,
  docNoPrefix,
  truePrefix,
  serial,
  padding,
  finYear,
}) {
  const padded = String(serial).padStart(padding || 5, "0");

  if (tier === "new-project") {
    // GC-WO/0001/26-27
    const fy = (finYear || currentFinYear()).toString().trim();
    return `${projectCode}-${moduleCode}/${padded}/${fy}`;
  }

  if (tier === "new-dash") {
    // ExB-PO-GRN-2026-00008
    const y = finYearToCalendarYear(finYear) ?? currentYear();
    return `${docNoPrefix}-${y}-${padded}`;
  }

  // legacy: CI/WO/000042/2024-25
  const fy = (finYear || "").toString().trim();
  return fy ? `${truePrefix}${padded}/${fy}` : `${truePrefix}${padded}`;
}

// ── Max-serial finders ────────────────────────────────────────────────────────

/**
 * Tier 1 — project-scoped format.
 * Scope: DocNoPrefix (= "{ProjectCode}-{ModuleCode}") + FinYear.
 * LIKE pattern: "GC-WO/%/26-27" won't work cleanly; we use the stored
 * DocNoPrefix + FinYear columns on DocNumberSequence instead.
 */
async function getMaxSerial_NewProject({
  pool,
  sql,
  docNoPrefix,
  finYear,
  tableName,
  col,
}) {
  // DocNumberSequence stores DocNoPrefix and FinYear explicitly (migration 046).
  const dnsRes = await pool
    .request()
    .input("Prefix", sql.NVarChar(50), docNoPrefix)
    .input("FinYear", sql.NVarChar(20), finYear).query(`
      SELECT MAX(ISNULL(DocSerial, 0)) AS MaxSeq
      FROM   dbo.DocNumberSequence
      WHERE  DocNoPrefix = @Prefix
        AND  FinYear     = @FinYear
    `);
  const dnsMax = dnsRes.recordset[0]?.MaxSeq ?? 0;

  // Also check committed rows in the target table for safety.
  // New-project format: "{ProjectCode}-{ModuleCode}/{Serial}/{FinYear}"
  // Serial is the segment between the last "/" before the finYear and the finYear itself.
  // LIKE pattern: "GC-WO/%/26-27"
  // Safer: use the full DocNoPrefix as the prefix for the LIKE
  const likeFull = `${docNoPrefix}/%/${finYear}`;
  const tblRes = await pool
    .request()
    .input("Like2", sql.NVarChar(200), likeFull).query(`
      SELECT MAX(
        TRY_CAST(
          SUBSTRING(
            ${col},
            CHARINDEX('/', ${col}) + 1,
            CHARINDEX('/', ${col}, CHARINDEX('/', ${col}) + 1) - CHARINDEX('/', ${col}) - 1
          )
        AS INT)
      ) AS MaxSeq
      FROM dbo.${tableName}
      WHERE ${col} LIKE @Like2
    `);
  const tableMax = tblRes.recordset[0]?.MaxSeq ?? 0;

  return Math.max(dnsMax, tableMax);
}

/**
 * Tier 2 — dash format scoped by (DocNoPrefix, CalendarYear).
 */
async function getMaxSerial_NewDash({
  pool,
  sql,
  docNoPrefix,
  year,
  tableName,
  col,
}) {
  const like = `${docNoPrefix}-${year}-%`;

  const dnsRes = await pool
    .request()
    .input("Like1", sql.NVarChar(120), like)
    .input("Prefix", sql.NVarChar(30), docNoPrefix)
    .input("Year", sql.SmallInt, year).query(`
      SELECT MAX(ISNULL(DocSerial, 0)) AS MaxSeq
      FROM   dbo.DocNumberSequence
      WHERE  DocNo LIKE @Like1
        AND  (DocNoPrefix = @Prefix OR DocNoPrefix IS NULL)
        AND  (DocYear = @Year OR DocYear IS NULL)
    `);
  const dnsMax = dnsRes.recordset[0]?.MaxSeq ?? 0;

  // Serial is the last hyphen-segment in "ExB-PO-GRN-2026-00008"
  const tblRes = await pool.request().input("Like2", sql.NVarChar(120), like)
    .query(`
      SELECT MAX(
        TRY_CAST(
          REVERSE(SUBSTRING(REVERSE(${col}), 1, CHARINDEX('-', REVERSE(${col})) - 1))
        AS INT)
      ) AS MaxSeq
      FROM dbo.${tableName}
      WHERE ${col} LIKE @Like2
    `);
  const tableMax = tblRes.recordset[0]?.MaxSeq ?? 0;

  return Math.max(dnsMax, tableMax);
}

/**
 * Tier 3 — legacy slash format (global counter, no year scope).
 */
async function getMaxSerial_Legacy({ pool, sql, truePrefix, tableName, col }) {
  const dnsRes = await pool
    .request()
    .input("Prefix", sql.NVarChar(100), truePrefix)
    .input("PrefixLike", sql.NVarChar(100), truePrefix + "%").query(`
      SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
      FROM   dbo.DocNumberSequence
      WHERE  DocNo LIKE @PrefixLike
    `);
  const dnsMax = dnsRes.recordset[0]?.MaxSeq ?? 0;

  const tblRes = await pool
    .request()
    .input("Prefix2", sql.NVarChar(100), truePrefix)
    .input("PrefixLike2", sql.NVarChar(100), truePrefix + "%").query(`
      SELECT MAX(TRY_CAST(SUBSTRING(${col}, LEN(@Prefix2) + 1, 6) AS INT)) AS MaxSeq
      FROM   dbo.${tableName}
      WHERE  ${col} LIKE @PrefixLike2
    `);
  const tableMax = tblRes.recordset[0]?.MaxSeq ?? 0;

  return Math.max(dnsMax, tableMax);
}

/**
 * Dispatch to the right getMaxSerial function based on tier.
 */
async function getMaxSerial({
  pool,
  sql,
  tier,
  docNoPrefix,
  truePrefix,
  finYear,
  year,
  tableName,
  col,
}) {
  if (tier === "new-project") {
    return getMaxSerial_NewProject({
      pool,
      sql,
      docNoPrefix,
      finYear,
      tableName,
      col,
    });
  }
  if (tier === "new-dash") {
    return getMaxSerial_NewDash({
      pool,
      sql,
      docNoPrefix,
      year,
      tableName,
      col,
    });
  }
  return getMaxSerial_Legacy({ pool, sql, truePrefix, tableName, col });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve TypeOfDocId from a canonical DocNoPrefix string.
 * @param {object} pool
 * @param {object} sql
 * @param {string} prefix  e.g. "ExB-PO-GRN", "ISS", "PAY", "GC-WO"
 * @returns {Promise<number>}
 */
async function resolveDocTypeId(pool, sql, prefix) {
  const result = await pool
    .request()
    .input("DocNoPrefix", sql.NVarChar(50), prefix).query(`
      SELECT TOP 1 TypeOfDocId
      FROM   dbo.TypeOfDoc
      WHERE  DocNoPrefix = @DocNoPrefix AND IsActive = 1
      ORDER  BY TypeOfDocId ASC
    `);
  const row = result.recordset[0];
  if (!row) throw new Error(`No active TypeOfDoc found for prefix "${prefix}"`);
  return row.TypeOfDocId;
}

/**
 * Determine the correct GRN DocNoPrefix based on parent document context.
 *
 *   New-project parent "GC-WO/..."     → "GC-GRN"   (project-scoped GRN)
 *   Dash parent "ExB-PO-YYYY-NNNNN"    → "ExB-PO-GRN"
 *   Dash parent "ExB-WO-YYYY-NNNNN"    → "ExB-WO-GRN"
 *   Dash parent "ExB-YYYY-NNNNN"       → "ExB-GRN"
 *   anything else                       → "GRN"
 *
 * @param {string|null} parentDocNo  DocNo of the parent PO or WO
 * @returns {string}
 */
function resolveGRNPrefix(parentDocNo) {
  if (!parentDocNo) return "GRN";
  const p = String(parentDocNo).toUpperCase();

  // New-project format: "{ProjectCode}-{ModuleCode}/{Serial}/{FinYear}"
  // e.g. "GC-WO/0012/26-27" → project = "GC", module = "WO" → GRN prefix = "GC-GRN"
  const projectSlashMatch = p.match(/^([A-Z]+)-[A-Z_]+\//);
  if (projectSlashMatch) {
    return `${projectSlashMatch[1]}-GRN`;
  }

  // Dash format (Tier 2)
  if (p.startsWith("EXB-PO-")) return "ExB-PO-GRN";
  if (p.startsWith("EXB-WO-")) return "ExB-WO-GRN";
  if (p.startsWith("EXB-")) return "ExB-GRN";

  return "GRN";
}

/**
 * Generate and atomically lock the next document number.
 *
 * IMPORTANT: pass pool (NOT a transaction) — the INSERT into DocNumberSequence
 * must commit independently so the UNIQUE constraint prevents race conditions.
 *
 * @param {object} pool
 * @param {object} sql
 * @param {object} opts
 *   @param {number}  opts.docTypeId
 *   @param {string}  [opts.finYear]      financial year string, e.g. "26-27".
 *                                        Required for Tier 1 and Tier 3.
 *                                        Auto-derived from today if omitted on Tier 1.
 *   @param {string}  opts.tableName
 *   @param {string}  [opts.docNoColumn]  defaults to "DocNo"
 *   @param {string}  [opts.issuedBy]
 *   @param {string}  [opts.parentDocNo]  stored in DocNumberSequence for lineage
 *   @param {string}  [opts.rootExBDocNo] root ExB number for lineage
 * @returns {Promise<string>}
 */
async function lockNextDocNumber(
  pool,
  sql,
  {
    docTypeId,
    finYear,
    tableName,
    docNoColumn,
    issuedBy,
    parentDocNo,
    rootExBDocNo,
  },
) {
  // 1. Fetch doc type config — include all columns added by migrations 035 + 046
  const typeResult = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId).query(`
      SELECT Prefix, FullPrefix, StartingDocNo,
             DocNoPrefix, ISNULL(DocNoPadding, 5) AS DocNoPadding,
             ModuleCode, ProjectCode,
             ISNULL(FinYearReset, 0) AS FinYearReset
      FROM   dbo.TypeOfDoc
      WHERE  TypeOfDocId = @TypeOfDocId AND IsActive = 1
    `);

  const typeRow = typeResult.recordset[0];
  if (!typeRow)
    throw new Error("Selected document type not found or inactive.");

  const tier = detectTier(typeRow);
  const docNoPrefix = typeRow.DocNoPrefix ?? null;
  const moduleCode = typeRow.ModuleCode ?? null;
  const projectCode = typeRow.ProjectCode ?? null;
  const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
  const truePrefix = rawPrefix.replace(/\d+$/, "");
  const startFrom = typeRow.StartingDocNo ?? 1;
  const padding = typeRow.DocNoPadding ?? 5;
  const col = docNoColumn || "DocNo";
  // For Tier 2 ("new-dash"), derive the embedded calendar year from the
  // caller-supplied finYear (e.g. "FY 2025-26" -> 2025) so doc numbers
  // match the fin year the user selected, not just today's date.
  const year = finYearToCalendarYear(finYear) ?? currentYear();

  // For Tier 1, derive finYear from today if not supplied
  const resolvedFinYear =
    finYear || (tier === "new-project" ? currentFinYear() : null);

  // 2. Find current max serial
  const maxSerial = await getMaxSerial({
    pool,
    sql,
    tier,
    docNoPrefix:
      tier === "new-project"
        ? `${projectCode}-${moduleCode}` // e.g. "GC-WO"
        : docNoPrefix,
    truePrefix,
    finYear: resolvedFinYear,
    year,
    tableName,
    col,
  });
  let nextSeq = Math.max(maxSerial + 1, startFrom);

  // Effective DocNoPrefix stored in DocNumberSequence
  const effectiveDocNoPrefix =
    tier === "new-project" ? `${projectCode}-${moduleCode}` : docNoPrefix;

  // 3. Build candidate DocNo
  let finalDocNo = buildDocNo({
    tier,
    projectCode,
    moduleCode,
    docNoPrefix: effectiveDocNoPrefix,
    truePrefix,
    serial: nextSeq,
    padding,
    finYear: resolvedFinYear,
  });

  // 4. INSERT into DocNumberSequence to lock (UNIQUE on DocNo prevents dups)
  const tryInsert = async (docNo, seq) => {
    await pool
      .request()
      .input("TypeOfDocId", sql.Int, docTypeId)
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("DocNoPrefix", sql.NVarChar(50), effectiveDocNoPrefix || null)
      .input("DocYear", sql.SmallInt, tier === "new-dash" ? year : null)
      .input(
        "FinYear",
        sql.NVarChar(20),
        tier !== "legacy" ? resolvedFinYear : null,
      )
      .input("DocSerial", sql.Int, seq)
      .input("TableName", sql.NVarChar(100), tableName)
      .input("IssuedBy", sql.NVarChar(200), issuedBy || null).query(`
        INSERT INTO dbo.DocNumberSequence
          (TypeOfDocId, DocNo, DocNoPrefix, DocYear, FinYear, DocSerial, TableName, IssuedBy)
        VALUES
          (@TypeOfDocId, @DocNo, @DocNoPrefix, @DocYear, @FinYear, @DocSerial, @TableName, @IssuedBy)
      `);
  };

  try {
    await tryInsert(finalDocNo, nextSeq);
  } catch (_collision) {
    // Concurrent request grabbed this number — bump and retry up to 5 times
    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      const retryMax = await getMaxSerial({
        pool,
        sql,
        tier,
        docNoPrefix: effectiveDocNoPrefix,
        truePrefix,
        finYear: resolvedFinYear,
        year,
        tableName,
        col,
      });
      const retrySeq = Math.max(retryMax + 1, nextSeq + 1);
      finalDocNo = buildDocNo({
        tier,
        projectCode,
        moduleCode,
        docNoPrefix: effectiveDocNoPrefix,
        truePrefix,
        serial: retrySeq,
        padding,
        finYear: resolvedFinYear,
      });
      try {
        await tryInsert(finalDocNo, retrySeq);
        return finalDocNo;
      } catch {
        // keep looping
      }
    }
    throw _collision;
  }

  return finalDocNo;
}

/**
 * After the main INSERT, stamp the new RecordId back into DocNumberSequence.
 * Also syncs ExpenseBooking.RootExBDocNo when the table is ExpenseBooking.
 *
 * @param {object} pool
 * @param {object} sql
 * @param {string} docNo
 * @param {string} tableName
 * @param {number} recordId
 */
async function backPatchRecordId(pool, sql, docNo, tableName, recordId) {
  if (!docNo || !recordId) return;

  await pool
    .request()
    .input("DocNo", sql.NVarChar(100), docNo)
    .input("TableName", sql.NVarChar(100), tableName)
    .input("RecordId", sql.Int, parseInt(recordId, 10)).query(`
      UPDATE dbo.DocNumberSequence
      SET    RecordId = @RecordId
      WHERE  DocNo = @DocNo AND TableName = @TableName
    `);

  // For ExpenseBooking: keep RootExBDocNo in sync with EDocNo
  if (tableName === "ExpenseBooking") {
    await pool
      .request()
      .input("Eid", sql.Int, parseInt(recordId, 10))
      .input("RootExBDocNo", sql.NVarChar(100), docNo).query(`
        UPDATE dbo.ExpenseBooking
        SET    RootExBDocNo = @RootExBDocNo
        WHERE  Eid = @Eid
          AND  (RootExBDocNo IS NULL OR RootExBDocNo <> @RootExBDocNo)
      `);
  }
}

/**
 * Preview the next DocNo without locking it (read-only, for UI display).
 * Checks DocNumberSequence only — no target-table scan needed for preview.
 *
 * @param {object} pool
 * @param {object} sql
 * @param {number} docTypeId
 * @param {string} [finYear]   financial year string; auto-derived if omitted
 * @returns {Promise<{nextDocNo: string, prefix: string, nextSeq: number, finYear: string|null}>}
 */
async function previewNextDocNumber(pool, sql, docTypeId, finYear) {
  // FIX: the original code ran two sequential DB round-trips:
  //   1. fetch TypeOfDoc row
  //   2. query DocNumberSequence for max serial
  // The second query depends on columns from the first (tier, prefix, finYear),
  // so they can't be naively parallelised — but we CAN start the TypeOfDoc fetch
  // and derive all tier info immediately, then fire the sequence query.
  // The real win: run the TypeOfDoc fetch and a combined single-query approach
  // that joins TypeOfDoc + DocNumberSequence in one round-trip.

  const clientFinYear = finYear || null;
  // Mirror lockNextDocNumber: Tier 2 embeds the calendar year derived from
  // the caller-supplied finYear, not always today's year.
  const year = finYearToCalendarYear(clientFinYear) ?? currentYear();

  // Single query: join TypeOfDoc with an aggregated DocNumberSequence max.
  // The CROSS APPLY computes the effective prefix and filters DocNumberSequence
  // in the same execution plan — one network round-trip instead of two.
  // Tier detection logic mirrors detectTier() in JS.
  const result = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId)
    .input("ClientFinYear", sql.NVarChar(20), clientFinYear)
    .input("Year", sql.SmallInt, year)
    .input("YearPct", sql.NVarChar(20), `%-${year}-%`).query(`
      SELECT
        t.Prefix, t.FullPrefix, t.StartingDocNo,
        t.DocNoPrefix, ISNULL(t.DocNoPadding, 5) AS DocNoPadding,
        t.ModuleCode, t.ProjectCode,
        ISNULL(t.FinYearReset, 0) AS FinYearReset,
        ISNULL(seq.MaxSeq, 0) AS MaxSeq
      FROM dbo.TypeOfDoc t
      CROSS APPLY (
        SELECT MAX(ISNULL(s.DocSerial, 0)) AS MaxSeq
        FROM dbo.DocNumberSequence s
        WHERE
          -- Tier 1 (new-project): match on computed prefix + FinYear
          (
            t.ModuleCode IS NOT NULL AND t.ProjectCode IS NOT NULL AND t.FinYearReset = 1
            AND s.DocNoPrefix = CONCAT(t.ProjectCode, '-', t.ModuleCode)
            AND s.FinYear = COALESCE(@ClientFinYear,
              CASE WHEN MONTH(GETDATE()) >= 4
                THEN CONCAT(RIGHT(YEAR(GETDATE()),2),'-',RIGHT(YEAR(GETDATE())+1,2))
                ELSE CONCAT(RIGHT(YEAR(GETDATE())-1,2),'-',RIGHT(YEAR(GETDATE()),2))
              END)
          )
          OR
          -- Tier 2 (new-dash): match on DocNoPrefix + year
          (
            t.DocNoPrefix IS NOT NULL AND NOT (t.ModuleCode IS NOT NULL AND t.ProjectCode IS NOT NULL AND t.FinYearReset = 1)
            AND (s.DocNoPrefix = t.DocNoPrefix OR s.DocNoPrefix IS NULL)
            AND (s.DocYear = @Year OR s.DocYear IS NULL)
            AND s.DocNo LIKE @YearPct
          )
          OR
          -- Tier 3 (legacy): match by prefix LIKE
          (
            t.DocNoPrefix IS NULL
            AND s.DocNo LIKE CONCAT(REPLACE(REPLACE(ISNULL(t.FullPrefix, t.Prefix), '%', '[%]'), '_', '[_]'), '%')
          )
      ) seq
      WHERE t.TypeOfDocId = @TypeOfDocId AND t.IsActive = 1
    `);

  const typeRow = result.recordset[0];
  if (!typeRow) throw new Error("Document type not found");

  const tier = detectTier(typeRow);
  const docNoPrefix = typeRow.DocNoPrefix ?? null;
  const moduleCode = typeRow.ModuleCode ?? null;
  const projectCode = typeRow.ProjectCode ?? null;
  const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
  const truePrefix = rawPrefix.replace(/\d+$/, "");
  const startFrom = typeRow.StartingDocNo ?? 1;
  const padding = typeRow.DocNoPadding ?? 5;

  const resolvedFinYear =
    clientFinYear || (tier === "new-project" ? currentFinYear() : null);
  const effectiveDocNoPrefix =
    tier === "new-project" ? `${projectCode}-${moduleCode}` : docNoPrefix;

  const dnsMax = typeRow.MaxSeq ?? 0;
  const nextSeq = Math.max(dnsMax + 1, startFrom);

  const nextDocNo = buildDocNo({
    tier,
    projectCode,
    moduleCode,
    docNoPrefix: effectiveDocNoPrefix,
    truePrefix,
    serial: nextSeq,
    padding,
    finYear: resolvedFinYear,
  });

  return {
    nextDocNo,
    prefix: effectiveDocNoPrefix || truePrefix,
    nextSeq,
    finYear: resolvedFinYear,
  };
}

module.exports = {
  lockNextDocNumber,
  previewNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  resolveGRNPrefix,
  // exported for testing
  currentFinYear,
  detectTier,
};
