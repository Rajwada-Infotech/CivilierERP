const express = require("express");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const role = require("../middleware/role");
const { MODULE_MAP, getRecordStatus } = require("../services/approvalService");
const { applyAmendment } = require("../services/amendmentEngine");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const APPROVER_ROLES = ["admin", "director", "manager"];
const FALLBACK_DOC_PREFIX = "AMD";
const LIST_COLUMNS = `
  Id,
  AmendmentNo,
  RefDocType,
  RefDocId,
  RefDocNo,
  ProjectName,
  CompanyName,
  Description,
  Reason,
  CONVERT(VARCHAR(10), AmendmentDate, 23) AS AmendmentDate,
  OriginalValue,
  RevisedValue,
  ValueDifference,
  Status,
  ApprovedBy,
  ApprovedAt,
  RejectedBy,
  RejectedAt,
  RejectionNote,
  CreatedBy,
  CreatedAt,
  UpdatedBy,
  UpdatedAt
`;

router.use(authMiddleware);
router.use(apiRateLimit);

function requireUserName(req, res) {
  const userName = req.user?.name || req.user?.email || null;
  if (!userName) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userName;
}

function parseId(rawId) {
  const id = parseInt(rawId, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function getPayload(body) {
  const originalValue = normalizeNumber(body?.OriginalValue);
  const revisedValue = normalizeNumber(body?.RevisedValue);
  const refDocId = normalizeNumber(body?.RefDocId);

  if (
    Number.isNaN(originalValue) ||
    Number.isNaN(revisedValue) ||
    Number.isNaN(refDocId)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  return {
    RefDocType: normalizeText(body?.RefDocType),
    RefDocId: refDocId,
    RefDocNo: normalizeText(body?.RefDocNo),
    ProjectName: normalizeText(body?.ProjectName),
    CompanyName: normalizeText(body?.CompanyName),
    Description: normalizeText(body?.Description),
    Reason: normalizeText(body?.Reason),
    AmendmentDate: normalizeText(body?.AmendmentDate),
    OriginalValue: originalValue,
    RevisedValue: revisedValue,
  };
}

function isUniqueConstraintError(err) {
  return err?.number === 2627 || err?.number === 2601;
}

async function getAmendmentStatus(id) {
  const result = await getPool()
    .request()
    .input("Id", sql.Int, id)
    .query(`
      SELECT Status
      FROM dbo.Amendments
      WHERE Id = @Id AND IsDeleted = 0
    `);

  return result.recordset[0]?.Status ?? null;
}

async function generateAmendmentNumber(transaction, userName) {
  const fallback = `${FALLBACK_DOC_PREFIX}-${Date.now()}`;

  try {
    const typeResult = await new sql.Request(transaction)
      .input("ExactPrefix", sql.NVarChar(30), FALLBACK_DOC_PREFIX)
      .input("LikePrefix", sql.NVarChar(30), `${FALLBACK_DOC_PREFIX}%`)
      .query(`
        SELECT TOP 1 TypeOfDocId, Prefix, FullPrefix, StartingDocNo
        FROM dbo.TypeOfDoc
        WHERE IsActive = 1
          AND (
            UPPER(ISNULL(Prefix, '')) = @ExactPrefix
            OR UPPER(ISNULL(FullPrefix, '')) LIKE @LikePrefix
          )
        ORDER BY TypeOfDocId ASC
      `);

    const typeRow = typeResult.recordset[0];
    if (!typeRow) {
      return { amendmentNo: fallback, reserved: false };
    }

    const rawPrefix =
      typeRow.FullPrefix || typeRow.Prefix || FALLBACK_DOC_PREFIX;
    const prefix = rawPrefix.replace(/\d+$/, "") || FALLBACK_DOC_PREFIX;
    const startingNumber =
      Number.isFinite(Number(typeRow.StartingDocNo)) &&
      Number(typeRow.StartingDocNo) > 0
        ? Number(typeRow.StartingDocNo)
        : 1;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const maxResult = await new sql.Request(transaction)
        .input("TypeOfDocId", sql.Int, typeRow.TypeOfDocId)
        .input("PrefixLength", sql.Int, prefix.length)
        .input("PrefixLike", sql.NVarChar(100), `${prefix}%`)
        .query(`
          SELECT MAX(
            TRY_CAST(SUBSTRING(DocNo, @PrefixLength + 1, 6) AS INT)
          ) AS MaxSeq
          FROM dbo.DocNumberSequence
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @PrefixLike
        `);

      const maxSeq = Number(maxResult.recordset[0]?.MaxSeq ?? 0);
      const nextSeq = Math.max(maxSeq + 1, startingNumber);
      const amendmentNo = `${prefix}${String(nextSeq).padStart(6, "0")}`;

      try {
        await new sql.Request(transaction)
          .input("TypeOfDocId", sql.Int, typeRow.TypeOfDocId)
          .input("DocNo", sql.NVarChar(100), amendmentNo)
          .input("TableName", sql.NVarChar(100), "Amendments")
          .input("IssuedBy", sql.NVarChar(200), userName)
          .query(`
            INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
            VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
          `);

        return { amendmentNo, reserved: true };
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
      }
    }
  } catch (err) {
    console.warn("amendments doc number fallback:", err.message);
  }

  return { amendmentNo: fallback, reserved: false };
}

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.pageSize, 10) || 20),
    );
    const offset = (page - 1) * pageSize;
    const search = normalizeText(req.query.search);
    const status = normalizeText(req.query.status);
    const refDocType = normalizeText(req.query.refDocType);
    const refDocId = normalizeNumber(req.query.refDocId);

    const filters = ["IsDeleted = 0"];
    if (search) {
      filters.push(`
        (
          AmendmentNo LIKE @Search
          OR RefDocNo LIKE @Search
          OR ProjectName LIKE @Search
          OR CompanyName LIKE @Search
        )
      `);
    }
    if (status) filters.push("Status = @Status");
    if (refDocType) filters.push("RefDocType = @RefDocType");
    if (!Number.isNaN(refDocId)) filters.push("RefDocId = @RefDocId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const buildRequest = () => {
      const request = pool.request();
      if (search) request.input("Search", sql.NVarChar(255), `%${search}%`);
      if (status) request.input("Status", sql.NVarChar(20), status);
      if (refDocType) {
        request.input("RefDocType", sql.NVarChar(100), refDocType);
      }
      if (!Number.isNaN(refDocId)) request.input("RefDocId", sql.Int, refDocId);
      return request;
    };

    const countResult = await buildRequest().query(`
      SELECT COUNT(*) AS Total
      FROM dbo.Amendments
      ${whereClause}
    `);

    const total = Number(countResult.recordset[0]?.Total ?? 0);

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize)
      .query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.Amendments
        ${whereClause}
        ORDER BY CreatedAt DESC, Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `);

    res.json({
      data: dataResult.recordset,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("amendments GET error:", err);
    res.status(500).json({ error: "Failed to fetch amendments" });
  }
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid amendment id" });
  }

  try {
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.Amendments
        WHERE Id = @Id AND IsDeleted = 0
      `);

    const record = result.recordset[0];
    if (!record) {
      return res.status(404).json({ error: "Amendment not found" });
    }

    res.json(record);
  } catch (err) {
    console.error("amendments GET/:id error:", err);
    res.status(500).json({ error: "Failed to fetch amendment" });
  }
});

router.post("/", requirePageRight("amendments", "create"), async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  const transaction = new sql.Transaction(getPool());

  try {
    await transaction.begin();

    const { amendmentNo, reserved } = await generateAmendmentNumber(
      transaction,
      userName,
    );

    const insertResult = await new sql.Request(transaction)
      .input("AmendmentNo", sql.NVarChar(100), amendmentNo)
      .input("RefDocType", sql.NVarChar(100), payload.RefDocType)
      .input("RefDocId", sql.Int, payload.RefDocId)
      .input("RefDocNo", sql.NVarChar(100), payload.RefDocNo)
      .input("ProjectName", sql.NVarChar(255), payload.ProjectName)
      .input("CompanyName", sql.NVarChar(255), payload.CompanyName)
      .input("Description", sql.NVarChar(sql.MAX), payload.Description)
      .input("Reason", sql.NVarChar(500), payload.Reason)
      .input("AmendmentDate", sql.Date, payload.AmendmentDate)
      .input("OriginalValue", sql.Decimal(18, 2), payload.OriginalValue)
      .input("RevisedValue", sql.Decimal(18, 2), payload.RevisedValue)
      .input("CreatedBy", sql.NVarChar(100), userName)
      .query(`
        INSERT INTO dbo.Amendments (
          AmendmentNo,
          RefDocType,
          RefDocId,
          RefDocNo,
          ProjectName,
          CompanyName,
          Description,
          Reason,
          AmendmentDate,
          OriginalValue,
          RevisedValue,
          Status,
          CreatedBy,
          CreatedAt
        )
        OUTPUT INSERTED.Id, INSERTED.AmendmentNo, INSERTED.Status
        VALUES (
          @AmendmentNo,
          @RefDocType,
          @RefDocId,
          @RefDocNo,
          @ProjectName,
          @CompanyName,
          @Description,
          @Reason,
          @AmendmentDate,
          @OriginalValue,
          @RevisedValue,
          'Draft',
          @CreatedBy,
          SYSDATETIME()
        )
      `);

    const created = insertResult.recordset[0];

    if (reserved && created?.Id) {
      await new sql.Request(transaction)
        .input("DocNo", sql.NVarChar(100), amendmentNo)
        .input("RecordId", sql.Int, created.Id)
        .query(`
          UPDATE dbo.DocNumberSequence
          SET RecordId = @RecordId
          WHERE DocNo = @DocNo AND TableName = 'Amendments'
        `);
    }

    await transaction.commit();
    res.status(201).json(created);
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {}
    console.error("amendments POST error:", err);
    res.status(500).json({ error: "Failed to create amendment" });
  }
});

// module slug (services/approvalService.js MODULE_MAP) ← RefDocType string
// AmendmentMenu.tsx and each document type's own edit form both use. Only
// document types wired into the propose→approve→apply engine need an entry
// here — anything else still goes through the legacy free-text amendment
// flow below (POST /) until its edit form is migrated too.
const REFDOC_TO_MODULE = {
  ExpenseBooking: "expense-booking",
  PurchaseOrder: "purchase-orders",
  GRN: "grn",
  Payment: "payments",
  FundTransfer: "fund-transfer",
  WorkOrder: "work-orders",
  BOQ: "boq",
  WorkDone: "work-done",
};

// ── proposeAmendment — reused-edit-form amendment entry point ──────────────
// A document's own PUT route calls this directly (see
// routes/expenseBooking.js PUT /:id) instead of updating the row, whenever
// the record is Approved — as well as the POST /propose HTTP route below,
// for any caller that isn't the document's own route (e.g. a future
// generic frontend fallback). The live document and its GL posting stay
// untouched until this is approved — see POST /:id/approve, which calls
// applyAmendment().
//
// Throws on validation failure (caller maps to an HTTP status); returns the
// created Amendments row + changedFieldCount on success.
async function proposeAmendment({
  refDocType, refDocId, refDocNo, proposedChanges,
  description, reason, projectName, companyName, userName,
}) {
  const module = REFDOC_TO_MODULE[refDocType];
  if (!module) {
    const err = new Error(`Unsupported document type for amendments: ${refDocType}`);
    err.status = 400;
    throw err;
  }
  const id = parseId(refDocId);
  if (!id) {
    const err = new Error("Invalid refDocId");
    err.status = 400;
    throw err;
  }
  if (!proposedChanges || typeof proposedChanges !== "object" || Array.isArray(proposedChanges)) {
    const err = new Error("proposedChanges must be an object of {column: newValue}");
    err.status = 400;
    throw err;
  }

  const map = MODULE_MAP[module];
  const status = await getRecordStatus(module, id);
  if (status !== "Approved") {
    const err = new Error("Only an Approved document can be amended — edit it directly instead.");
    err.status = 400;
    throw err;
  }

  const pool = getPool();
  // Snapshot the current row so the diff (AmendmentLineChanges) and the
  // header's OriginalValue can be computed automatically — the user never
  // hand-types old/new values anymore, that was the whole point.
  const originalRes = await pool.request().input("__id", sql.Int, id)
    .query(`SELECT * FROM ${map.table} WHERE ${map.pk} = @__id`);
  const original = originalRes.recordset[0];
  if (!original) {
    const err = new Error("Source document not found");
    err.status = 404;
    throw err;
  }

  const changedKeys = Object.keys(proposedChanges).filter((k) => {
    const before = original[k];
    const after = proposedChanges[k];
    // Loose compare — DB values often come back as different JS types
    // (Decimal as string/number, Date objects vs "YYYY-MM-DD" strings)
    // than what the form posts; stringifying both sides is a simple,
    // good-enough way to avoid flagging non-changes as changes.
    return String(before ?? "") !== String(after ?? "");
  });

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const { amendmentNo, reserved } = await generateAmendmentNumber(transaction, userName);

    const insertResult = await new sql.Request(transaction)
      .input("AmendmentNo", sql.NVarChar(100), amendmentNo)
      .input("RefDocType", sql.NVarChar(100), refDocType)
      .input("RefDocId", sql.Int, id)
      .input("RefDocNo", sql.NVarChar(100), normalizeText(refDocNo))
      .input("ProjectName", sql.NVarChar(255), normalizeText(projectName))
      .input("CompanyName", sql.NVarChar(255), normalizeText(companyName))
      .input("Description", sql.NVarChar(sql.MAX), normalizeText(description))
      .input("Reason", sql.NVarChar(500), normalizeText(reason))
      .input("ProposedChanges", sql.NVarChar(sql.MAX), JSON.stringify(proposedChanges))
      .input("CreatedBy", sql.NVarChar(100), userName)
      .query(`
        INSERT INTO dbo.Amendments (
          AmendmentNo, RefDocType, RefDocId, RefDocNo, ProjectName, CompanyName,
          Description, Reason, AmendmentDate, ProposedChanges, Status, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id, INSERTED.AmendmentNo, INSERTED.Status
        VALUES (
          @AmendmentNo, @RefDocType, @RefDocId, @RefDocNo, @ProjectName, @CompanyName,
          @Description, @Reason, CAST(SYSDATETIME() AS DATE), @ProposedChanges, 'Pending', @CreatedBy, SYSDATETIME()
        )
      `);
    const created = insertResult.recordset[0];

    if (reserved && created?.Id) {
      await new sql.Request(transaction)
        .input("DocNo", sql.NVarChar(100), amendmentNo)
        .input("RecordId", sql.Int, created.Id)
        .query(`UPDATE dbo.DocNumberSequence SET RecordId = @RecordId WHERE DocNo = @DocNo AND TableName = 'Amendments'`);
    }

    for (const key of changedKeys) {
      await new sql.Request(transaction)
        .input("AmendmentId", sql.Int, created.Id)
        .input("FieldName", sql.NVarChar(200), key)
        .input("OldValue", sql.NVarChar(sql.MAX), normalizeText(original[key]))
        .input("NewValue", sql.NVarChar(sql.MAX), normalizeText(proposedChanges[key]))
        .input("ChangedBy", sql.NVarChar(200), userName)
        .query(`
          INSERT INTO dbo.AmendmentLineChanges (AmendmentId, FieldName, FieldLabel, OldValue, NewValue, ChangedBy)
          VALUES (@AmendmentId, @FieldName, @FieldName, @OldValue, @NewValue, @ChangedBy)
        `);
    }

    await transaction.commit();
    return { ...created, changedFieldCount: changedKeys.length };
  } catch (err) {
    try { await transaction.rollback(); } catch {}
    throw err;
  }
}

router.post("/propose", requirePageRight("amendments", "create"), async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const result = await proposeAmendment({ ...req.body, userName });
    res.status(201).json(result);
  } catch (err) {
    console.error("amendments propose error:", err);
    res.status(err.status || 500).json({ error: err.message || "Failed to propose amendment" });
  }
});

router.put("/:id", requirePageRight("amendments", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid amendment id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const currentStatus = await getAmendmentStatus(id);
    if (!currentStatus) {
      return res.status(404).json({ error: "Amendment not found" });
    }
    if (currentStatus !== "Draft") {
      return res
        .status(400)
        .json({ error: "Only Draft amendments can be edited" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("RefDocType", sql.NVarChar(100), payload.RefDocType)
      .input("RefDocId", sql.Int, payload.RefDocId)
      .input("RefDocNo", sql.NVarChar(100), payload.RefDocNo)
      .input("ProjectName", sql.NVarChar(255), payload.ProjectName)
      .input("CompanyName", sql.NVarChar(255), payload.CompanyName)
      .input("Description", sql.NVarChar(sql.MAX), payload.Description)
      .input("Reason", sql.NVarChar(500), payload.Reason)
      .input("AmendmentDate", sql.Date, payload.AmendmentDate)
      .input("OriginalValue", sql.Decimal(18, 2), payload.OriginalValue)
      .input("RevisedValue", sql.Decimal(18, 2), payload.RevisedValue)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.Amendments
        SET
          RefDocType = @RefDocType,
          RefDocId = @RefDocId,
          RefDocNo = @RefDocNo,
          ProjectName = @ProjectName,
          CompanyName = @CompanyName,
          Description = @Description,
          Reason = @Reason,
          AmendmentDate = @AmendmentDate,
          OriginalValue = @OriginalValue,
          RevisedValue = @RevisedValue,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("amendments PUT error:", err);
    res.status(500).json({ error: "Failed to update amendment" });
  }
});

router.post("/:id/submit", requirePageRight("amendments", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid amendment id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const currentStatus = await getAmendmentStatus(id);
    if (!currentStatus) {
      return res.status(404).json({ error: "Amendment not found" });
    }
    if (currentStatus !== "Draft") {
      return res
        .status(400)
        .json({ error: "Only Draft amendments can be submitted" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.Amendments
        SET Status = 'Pending', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true, status: "Pending" });
  } catch (err) {
    console.error("amendments submit error:", err);
    res.status(500).json({ error: "Failed to submit amendment" });
  }
});

router.post("/:id/approve", role(...APPROVER_ROLES), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid amendment id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const currentStatus = await getAmendmentStatus(id);
    if (!currentStatus) {
      return res.status(404).json({ error: "Amendment not found" });
    }
    if (currentStatus !== "Pending") {
      return res
        .status(400)
        .json({ error: "Only Pending amendments can be approved" });
    }

    const pool = getPool();
    const docRes = await pool.request().input("Id", sql.Int, id)
      .query(`SELECT RefDocType, RefDocId, ProposedChanges FROM dbo.Amendments WHERE Id = @Id AND IsDeleted = 0`);
    const doc = docRes.recordset[0];

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("ApprovedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.Amendments
        SET
          Status = 'Approved',
          ApprovedBy = @ApprovedBy,
          ApprovedAt = SYSDATETIME(),
          UpdatedBy = @ApprovedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    // Apply happens AFTER the approval status commits — the approval
    // decision itself is real even if the downstream write-back/GL repost
    // hits a snag; that failure is recorded on the amendment (ApplyError)
    // rather than rolling back or blocking the approval. Same discipline
    // approvalService.js's own GL posting uses.
    let applyOutcome = null;
    if (doc?.ProposedChanges) {
      const module = REFDOC_TO_MODULE[doc.RefDocType];
      try {
        let proposedChanges;
        try {
          proposedChanges = JSON.parse(doc.ProposedChanges);
        } catch {
          throw new Error("Stored ProposedChanges is not valid JSON");
        }
        if (!module) throw new Error(`No apply mapping for RefDocType "${doc.RefDocType}"`);
        applyOutcome = await applyAmendment(pool, module, doc.RefDocId, proposedChanges, userName);
        await pool.request().input("Id", sql.Int, id).input("PropagatedBy", sql.NVarChar(100), userName)
          .query(`UPDATE dbo.Amendments SET AppliedAt = SYSDATETIME(), PropagatedAt = SYSDATETIME(), PropagatedBy = @PropagatedBy WHERE Id = @Id`);
      } catch (applyErr) {
        console.error(`amendments apply error (amendment #${id}):`, applyErr.message);
        await pool.request().input("Id", sql.Int, id).input("ApplyError", sql.NVarChar(500), applyErr.message.slice(0, 500))
          .query(`UPDATE dbo.Amendments SET ApplyError = @ApplyError WHERE Id = @Id`);
      }
    }

    res.json({ success: true, status: "Approved", applied: !!applyOutcome?.updated, reposted: !!applyOutcome?.reposted });
  } catch (err) {
    console.error("amendments approve error:", err);
    res.status(500).json({ error: "Failed to approve amendment" });
  }
});

router.post("/:id/reject", role(...APPROVER_ROLES), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid amendment id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  const note = normalizeText(req.body?.note);
  if (!note) {
    return res.status(400).json({ error: "Rejection note is required" });
  }

  try {
    const currentStatus = await getAmendmentStatus(id);
    if (!currentStatus) {
      return res.status(404).json({ error: "Amendment not found" });
    }
    if (currentStatus !== "Pending") {
      return res
        .status(400)
        .json({ error: "Only Pending amendments can be rejected" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("RejectedBy", sql.NVarChar(100), userName)
      .input("RejectionNote", sql.NVarChar(500), note)
      .query(`
        UPDATE dbo.Amendments
        SET
          Status = 'Rejected',
          RejectedBy = @RejectedBy,
          RejectedAt = SYSDATETIME(),
          RejectionNote = @RejectionNote,
          UpdatedBy = @RejectedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true, status: "Rejected" });
  } catch (err) {
    console.error("amendments reject error:", err);
    res.status(500).json({ error: "Failed to reject amendment" });
  }
});

router.delete("/:id", requirePageRight("amendments", "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid amendment id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const currentStatus = await getAmendmentStatus(id);
    if (!currentStatus) {
      return res.status(404).json({ error: "Amendment not found" });
    }
    if (currentStatus !== "Draft") {
      return res
        .status(400)
        .json({ error: "Only Draft amendments can be deleted" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.Amendments
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("amendments DELETE error:", err);
    res.status(500).json({ error: "Failed to delete amendment" });
  }
});

// ── Line Changes (per-field audit trail) ─────────────────────────────────────

router.get("/:id/line-changes", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid amendment id" });

  try {
    const result = await getPool()
      .request()
      .input("AmendmentId", sql.Int, id)
      .query(`
        SELECT
          Id,
          AmendmentId,
          FieldName,
          FieldLabel,
          OldValue,
          NewValue,
          ChangedBy,
          CONVERT(VARCHAR(23), ChangedAt, 126) AS ChangedAt
        FROM dbo.AmendmentLineChanges
        WHERE AmendmentId = @AmendmentId
        ORDER BY ChangedAt ASC, Id ASC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("amendment line-changes GET error:", err);
    res.status(500).json({ error: "Failed to fetch line changes" });
  }
});

router.post("/:id/line-changes", requirePageRight("amendments", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid amendment id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: "changes array is required" });
  }

  try {
    const status = await getAmendmentStatus(id);
    if (!status) return res.status(404).json({ error: "Amendment not found" });
    if (status !== "Draft") {
      return res.status(400).json({ error: "Line changes can only be added to Draft amendments" });
    }

    const pool = getPool();
    for (const change of changes) {
      const fieldName = normalizeText(change?.FieldName);
      if (!fieldName) continue;

      await pool.request()
        .input("AmendmentId", sql.Int, id)
        .input("FieldName", sql.NVarChar(200), fieldName)
        .input("FieldLabel", sql.NVarChar(200), normalizeText(change?.FieldLabel))
        .input("OldValue", sql.NVarChar(sql.MAX), normalizeText(change?.OldValue))
        .input("NewValue", sql.NVarChar(sql.MAX), normalizeText(change?.NewValue))
        .input("ChangedBy", sql.NVarChar(200), userName)
        .query(`
          INSERT INTO dbo.AmendmentLineChanges
            (AmendmentId, FieldName, FieldLabel, OldValue, NewValue, ChangedBy)
          VALUES
            (@AmendmentId, @FieldName, @FieldLabel, @OldValue, @NewValue, @ChangedBy)
        `);
    }

    res.status(201).json({ success: true, count: changes.length });
  } catch (err) {
    console.error("amendment line-changes POST error:", err);
    res.status(500).json({ error: "Failed to save line changes" });
  }
});

module.exports = router;
module.exports.proposeAmendment = proposeAmendment;
module.exports.REFDOC_TO_MODULE = REFDOC_TO_MODULE;




