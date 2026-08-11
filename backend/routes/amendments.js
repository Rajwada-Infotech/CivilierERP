const express = require("express");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const role = require("../middleware/role");

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

    await getPool()
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

    res.json({ success: true, status: "Approved" });
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




