const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const {
  findApplicableTariff,
  getTariffSlabs,
  calculateElectricityCharge,
  resolveHandoverStatus,
} = require("../services/electricityTariff");

const METER_PAGE = "meter-reading-master";
const PROVIDER_PAGE = "electricity-provider-master";
const TARIFF_PAGE = "electricity-tariff-master";
const MAIN_PAGE = "maintenance-electricity";

const actorOf = (req) => req.user?.email || req.user?.name || "system";
const requestIp = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;

async function writeLog(pool, { meterId, readingId, billId, bookingId, action, oldValue, newValue, performedBy, deviceInfo, ipAddress, remarks }) {
  await pool.request()
    .input("MeterId", sql.Int, meterId ?? null)
    .input("ReadingId", sql.Int, readingId ?? null)
    .input("BillId", sql.Int, billId ?? null)
    .input("BookingId", sql.Int, bookingId ?? null)
    .input("Action", sql.NVarChar(40), action)
    .input("OldValue", sql.NVarChar(sql.MAX), oldValue != null ? JSON.stringify(oldValue) : null)
    .input("NewValue", sql.NVarChar(sql.MAX), newValue != null ? JSON.stringify(newValue) : null)
    .input("PerformedBy", sql.NVarChar(150), performedBy || null)
    .input("DeviceInfo", sql.NVarChar(300), deviceInfo || null)
    .input("IPAddress", sql.NVarChar(50), ipAddress || null)
    .input("Remarks", sql.NVarChar(500), remarks || null)
    .query(`
      INSERT INTO dbo.ElectricityAuditLog (MeterId, ReadingId, BillId, BookingId, Action, OldValue, NewValue, PerformedBy, DeviceInfo, IPAddress, Remarks)
      VALUES (@MeterId, @ReadingId, @BillId, @BookingId, @Action, @OldValue, @NewValue, @PerformedBy, @DeviceInfo, @IPAddress, @Remarks)
    `);
}

// Booking → Customer/Project/Tower(=Block)/Flat — same join every other
// Maintenance page uses (see maintenance.js's DIRECTORY_SELECT).
const BOOKING_JOIN = `
  JOIN dbo.CrmBooking cb ON cb.Id = m.BookingId
  JOIN dbo.CrmApplication capp ON capp.Id = cb.ApplicationId
  LEFT JOIN dbo.UnitMaster um    ON um.Id  = cb.UnitId
  LEFT JOIN dbo.BlockMaster blk  ON blk.Id = um.BlockId
  LEFT JOIN dbo.enterprise  proj ON proj.id = cb.ProjectId AND proj.business_type = 'P'
`;
// Deliberately does NOT re-select cb.Id AS BookingId — every caller already
// has a BookingId column of its own (MeterReadingMaster.BookingId /
// ElectricityBill.BookingId via m.*/b.*), and the mssql driver returns
// duplicate-named columns as an array rather than overwriting, which broke
// every downstream @bid parameter binding.
const BOOKING_COLS = `
  cb.BookingNo,
  capp.ApplicantName AS CustomerName,
  COALESCE(um.UnitName, cb.UnitNo)    AS UnitNo,
  COALESCE(blk.BlockName, cb.BlockName) AS BlockName,
  COALESCE(proj.name, cb.ProjectName) AS ProjectName
`;

async function getHandoverRow(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId)
    .query(`SELECT TOP 1 Status, ActualHandoverDate, ScheduledDate FROM dbo.CrmHandover WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
  return result.recordset[0] || null;
}

// ════════════════════════════════════════════════════════════════════
// Providers
// ════════════════════════════════════════════════════════════════════
router.get("/providers", requirePageRight(PROVIDER_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`SELECT * FROM dbo.ElectricityProvider ORDER BY Name`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/providers", requirePageRight(PROVIDER_PAGE, "create"), async (req, res) => {
  const { name, code, state, billingMethod, remarks } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "Provider name is required" });
  try {
    const pool = getPool();
    const dup = await pool.request().input("n", sql.NVarChar, name.trim()).query(`SELECT Id FROM dbo.ElectricityProvider WHERE Name = @n`);
    if (dup.recordset.length) return res.status(409).json({ error: "A provider with this name already exists" });
    const result = await pool.request()
      .input("Name", sql.NVarChar, name.trim())
      .input("Code", sql.NVarChar, code || null)
      .input("State", sql.NVarChar, state || null)
      .input("BillingMethod", sql.NVarChar, billingMethod || null)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.ElectricityProvider (Name, Code, State, BillingMethod, Remarks, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@Name, @Code, @State, @BillingMethod, @Remarks, @CreatedBy)
      `);
    res.json({ id: result.recordset[0].Id, message: "Provider added" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/providers/:id", requirePageRight(PROVIDER_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, code, state, billingMethod, status, remarks } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid provider id" });
  if (!name?.trim()) return res.status(400).json({ error: "Provider name is required" });
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar, name.trim())
      .input("Code", sql.NVarChar, code || null)
      .input("State", sql.NVarChar, state || null)
      .input("BillingMethod", sql.NVarChar, billingMethod || null)
      .input("Status", sql.NVarChar, status || "Active")
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("UpdatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.ElectricityProvider SET
          Name = @Name, Code = @Code, State = @State, BillingMethod = @BillingMethod,
          Status = @Status, Remarks = @Remarks, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Provider not found" });
    res.json({ message: "Provider updated" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Tariffs (+ slabs)
// ════════════════════════════════════════════════════════════════════
router.get("/tariffs", requirePageRight(TARIFF_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT t.*, p.Name AS ProviderName,
        (SELECT COUNT(*) FROM dbo.ElectricityTariffSlab s WHERE s.TariffId = t.Id) AS SlabCount
      FROM dbo.ElectricityTariff t
      JOIN dbo.ElectricityProvider p ON p.Id = t.ProviderId
      ORDER BY t.EffectiveFrom DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/tariffs/:id", requirePageRight(TARIFF_PAGE, "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tariff id" });
  try {
    const pool = getPool();
    const tariff = await pool.request().input("Id", sql.Int, id).query(`
      SELECT t.*, p.Name AS ProviderName FROM dbo.ElectricityTariff t
      JOIN dbo.ElectricityProvider p ON p.Id = t.ProviderId WHERE t.Id = @Id
    `);
    if (!tariff.recordset.length) return res.status(404).json({ error: "Tariff not found" });
    const slabs = await getTariffSlabs(pool, sql, id);
    res.json({ ...tariff.recordset[0], slabs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function validateSlabs(slabs) {
  if (!Array.isArray(slabs) || slabs.length === 0) throw new Error("At least one tariff slab is required");
  for (const s of slabs) {
    if (s.slabFrom === undefined || s.slabFrom === null || Number.isNaN(Number(s.slabFrom))) {
      throw new Error("Every slab needs a valid 'From' unit");
    }
    if (!(Number(s.ratePerUnit) >= 0)) throw new Error("Every slab needs a valid rate per unit");
  }
}

async function saveSlabs(tx, tariffId, slabs) {
  await tx.request().input("TariffId", sql.Int, tariffId).query(`DELETE FROM dbo.ElectricityTariffSlab WHERE TariffId = @TariffId`);
  for (const s of slabs) {
    await tx.request()
      .input("TariffId", sql.Int, tariffId)
      .input("SlabFrom", sql.Decimal(18, 2), Number(s.slabFrom))
      .input("SlabTo", sql.Decimal(18, 2), s.slabTo === "" || s.slabTo === null || s.slabTo === undefined ? null : Number(s.slabTo))
      .input("RatePerUnit", sql.Decimal(10, 4), Number(s.ratePerUnit))
      .query(`INSERT INTO dbo.ElectricityTariffSlab (TariffId, SlabFrom, SlabTo, RatePerUnit) VALUES (@TariffId, @SlabFrom, @SlabTo, @RatePerUnit)`);
  }
}

router.post("/tariffs", requirePageRight(TARIFF_PAGE, "create"), async (req, res) => {
  const { providerId, tariffName, effectiveFrom, effectiveTo, billingCycle, fixedCharge, minimumCharge, additionalCharge, slabs } = req.body || {};
  if (!providerId || !tariffName?.trim() || !effectiveFrom) return res.status(400).json({ error: "Provider, Tariff Name and Effective From are required" });
  try {
    validateSlabs(slabs);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const pool = getPool();
  const tx = pool.transaction();
  try {
    await tx.begin();
    const result = await tx.request()
      .input("ProviderId", sql.Int, providerId)
      .input("TariffName", sql.NVarChar, tariffName.trim())
      .input("EffectiveFrom", sql.Date, effectiveFrom)
      .input("EffectiveTo", sql.Date, effectiveTo || null)
      .input("BillingCycle", sql.NVarChar, billingCycle || "Monthly")
      .input("FixedCharge", sql.Decimal(18, 2), Number(fixedCharge) || 0)
      .input("MinimumCharge", sql.Decimal(18, 2), Number(minimumCharge) || 0)
      .input("AdditionalCharge", sql.Decimal(18, 2), Number(additionalCharge) || 0)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.ElectricityTariff (ProviderId, TariffName, EffectiveFrom, EffectiveTo, BillingCycle, FixedCharge, MinimumCharge, AdditionalCharge, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@ProviderId, @TariffName, @EffectiveFrom, @EffectiveTo, @BillingCycle, @FixedCharge, @MinimumCharge, @AdditionalCharge, @CreatedBy)
      `);
    const tariffId = result.recordset[0].Id;
    await saveSlabs(tx, tariffId, slabs);
    await tx.commit();
    res.json({ id: tariffId, message: "Tariff created" });
  } catch (err) {
    await tx.rollback();
    res.status(400).json({ error: err.message });
  }
});

router.put("/tariffs/:id", requirePageRight(TARIFF_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { providerId, tariffName, effectiveFrom, effectiveTo, billingCycle, fixedCharge, minimumCharge, additionalCharge, status, slabs } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tariff id" });
  if (!providerId || !tariffName?.trim() || !effectiveFrom) return res.status(400).json({ error: "Provider, Tariff Name and Effective From are required" });
  try {
    validateSlabs(slabs);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const pool = getPool();
  const tx = pool.transaction();
  try {
    await tx.begin();
    const result = await tx.request()
      .input("Id", sql.Int, id)
      .input("ProviderId", sql.Int, providerId)
      .input("TariffName", sql.NVarChar, tariffName.trim())
      .input("EffectiveFrom", sql.Date, effectiveFrom)
      .input("EffectiveTo", sql.Date, effectiveTo || null)
      .input("BillingCycle", sql.NVarChar, billingCycle || "Monthly")
      .input("FixedCharge", sql.Decimal(18, 2), Number(fixedCharge) || 0)
      .input("MinimumCharge", sql.Decimal(18, 2), Number(minimumCharge) || 0)
      .input("AdditionalCharge", sql.Decimal(18, 2), Number(additionalCharge) || 0)
      .input("Status", sql.NVarChar, status || "Active")
      .input("UpdatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.ElectricityTariff SET
          ProviderId = @ProviderId, TariffName = @TariffName, EffectiveFrom = @EffectiveFrom, EffectiveTo = @EffectiveTo,
          BillingCycle = @BillingCycle, FixedCharge = @FixedCharge, MinimumCharge = @MinimumCharge, AdditionalCharge = @AdditionalCharge,
          Status = @Status, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    if (!result.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: "Tariff not found" }); }
    await saveSlabs(tx, id, slabs);
    await tx.commit();
    res.json({ message: "Tariff updated" });
  } catch (err) {
    await tx.rollback();
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Meters (Meter Reading Master)
// ════════════════════════════════════════════════════════════════════
const METER_SELECT = `
  SELECT m.*, prov.Name AS ProviderName, ${BOOKING_COLS}
  FROM dbo.MeterReadingMaster m
  JOIN dbo.ElectricityProvider prov ON prov.Id = m.ProviderId
  ${BOOKING_JOIN}
`;

// Same as METER_SELECT, plus the latest Regular reading (Previous/Current/
// Units), the bill status for that latest reading's period, and the raw
// CrmHandover row — everything the main "Meters & Readings" table (spec
// §8/§9) needs in one row, without a client round-trip per meter.
const METER_LIST_SELECT = `
  SELECT m.*, prov.Name AS ProviderName, ${BOOKING_COLS},
    lr.PreviousReading AS LatestPreviousReading,
    lr.CurrentReading  AS LatestCurrentReading,
    lr.UnitsConsumed   AS LatestUnitsConsumed,
    lr.ReadingDate     AS LatestReadingDate,
    lr.BillingPeriodTo AS LatestPeriodTo,
    lb.BillStatus       AS LatestBillStatus,
    ho.Status            AS HandoverRawStatus,
    ho.ActualHandoverDate AS HandoverActualDate,
    ho.ScheduledDate      AS HandoverScheduledDate
  FROM dbo.MeterReadingMaster m
  JOIN dbo.ElectricityProvider prov ON prov.Id = m.ProviderId
  ${BOOKING_JOIN}
  OUTER APPLY (
    SELECT TOP 1 PreviousReading, CurrentReading, UnitsConsumed, ReadingDate, BillingPeriodTo
    FROM dbo.MeterReading
    WHERE MeterId = m.Id AND ReadingType = 'Regular' AND IsSuperseded = 0
    ORDER BY BillingPeriodTo DESC
  ) lr
  OUTER APPLY (
    SELECT TOP 1 BillStatus FROM dbo.ElectricityBill
    WHERE MeterId = m.Id AND BillStatus <> 'Cancelled'
    ORDER BY BillingPeriodTo DESC, CreatedAt DESC
  ) lb
  OUTER APPLY (
    SELECT TOP 1 Status, ActualHandoverDate, ScheduledDate FROM dbo.CrmHandover
    WHERE BookingId = cb.Id ORDER BY CreatedAt DESC
  ) ho
`;

router.get("/meters", requirePageRight(METER_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { search, providerId, billingCycle, status, project, tower, handoverStatus, billStatus } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (search) {
      req0.input("search", sql.NVarChar, `%${search}%`);
      conds.push(`(capp.ApplicantName LIKE @search OR m.MeterNumber LIKE @search OR m.MeterBoxNumber LIKE @search OR COALESCE(um.UnitName, cb.UnitNo) LIKE @search)`);
    }
    if (providerId) { req0.input("providerId", sql.Int, parseInt(providerId, 10)); conds.push("m.ProviderId = @providerId"); }
    if (billingCycle) { req0.input("billingCycle", sql.NVarChar, billingCycle); conds.push("m.BillingCycle = @billingCycle"); }
    if (status) { req0.input("status", sql.NVarChar, status); conds.push("m.Status = @status"); }
    if (project) { req0.input("project", sql.NVarChar, `%${project}%`); conds.push("COALESCE(proj.name, cb.ProjectName) LIKE @project"); }
    if (tower) { req0.input("tower", sql.NVarChar, `%${tower}%`); conds.push("COALESCE(blk.BlockName, cb.BlockName) LIKE @tower"); }
    if (billStatus) { req0.input("billStatus", sql.NVarChar, billStatus); conds.push("lb.BillStatus = @billStatus"); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await req0.query(`${METER_LIST_SELECT} ${where} ORDER BY m.CreatedAt DESC`);

    // Handover status is derived (resolveHandoverStatus), not a stored
    // column, so it's filtered in JS after resolution rather than in SQL.
    let rows = result.recordset.map((r) => {
      const { status: resolvedHandoverStatus, handoverDate } = resolveHandoverStatus(
        r.HandoverRawStatus ? { Status: r.HandoverRawStatus, ActualHandoverDate: r.HandoverActualDate, ScheduledDate: r.HandoverScheduledDate } : null,
      );
      const { HandoverRawStatus, HandoverActualDate, HandoverScheduledDate, ...rest } = r;
      return { ...rest, HandoverStatus: resolvedHandoverStatus, HandoverDate: handoverDate };
    });
    if (handoverStatus) rows = rows.filter((r) => r.HandoverStatus === handoverStatus);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/meters/:id", requirePageRight(METER_PAGE, "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid meter id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id).query(`${METER_SELECT} WHERE m.Id = @Id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Meter not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/meters", requirePageRight(METER_PAGE, "create"), async (req, res) => {
  const b = req.body || {};
  if (!b.bookingId) return res.status(400).json({ error: "Customer/Booking is required" });
  if (!b.meterNumber?.trim()) return res.status(400).json({ error: "Meter Number is required" });
  if (!b.providerId) return res.status(400).json({ error: "Electricity Provider is required" });
  try {
    const pool = getPool();
    const dup = await pool.request().input("mn", sql.NVarChar, b.meterNumber.trim()).query(`SELECT Id FROM dbo.MeterReadingMaster WHERE MeterNumber = @mn`);
    if (dup.recordset.length) return res.status(409).json({ error: "A meter with this Meter Number already exists" });

    const result = await pool.request()
      .input("BookingId", sql.Int, b.bookingId)
      .input("MeterBoxNumber", sql.NVarChar, b.meterBoxNumber || null)
      .input("MeterNumber", sql.NVarChar, b.meterNumber.trim())
      .input("ProviderId", sql.Int, b.providerId)
      .input("ConnectionType", sql.NVarChar, b.connectionType || null)
      .input("MeterType", sql.NVarChar, b.meterType || null)
      .input("BillingCycle", sql.NVarChar, b.billingCycle || "Monthly")
      .input("OpeningReading", sql.Decimal(18, 2), Number(b.openingReading) || 0)
      .input("OpeningReadingDate", sql.Date, b.openingReadingDate || null)
      .input("MeterInstallationDate", sql.Date, b.meterInstallationDate || null)
      .input("Remarks", sql.NVarChar(500), b.remarks || null)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.MeterReadingMaster
          (BookingId, MeterBoxNumber, MeterNumber, ProviderId, ConnectionType, MeterType, BillingCycle, OpeningReading, OpeningReadingDate, MeterInstallationDate, Remarks, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@BookingId, @MeterBoxNumber, @MeterNumber, @ProviderId, @ConnectionType, @MeterType, @BillingCycle, @OpeningReading, @OpeningReadingDate, @MeterInstallationDate, @Remarks, @CreatedBy)
      `);
    const meterId = result.recordset[0].Id;
    await writeLog(pool, { meterId, bookingId: b.bookingId, action: "METER_CREATED", newValue: b, performedBy: actorOf(req), ipAddress: requestIp(req) });
    res.json({ id: meterId, message: "Meter created" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/meters/:id", requirePageRight(METER_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid meter id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT * FROM dbo.MeterReadingMaster WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Meter not found" });
    const before = existing.recordset[0];

    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("MeterBoxNumber", sql.NVarChar, b.meterBoxNumber || null)
      .input("ProviderId", sql.Int, b.providerId)
      .input("ConnectionType", sql.NVarChar, b.connectionType || null)
      .input("MeterType", sql.NVarChar, b.meterType || null)
      .input("BillingCycle", sql.NVarChar, b.billingCycle || "Monthly")
      .input("Status", sql.NVarChar, b.status || "Active")
      .input("Remarks", sql.NVarChar(500), b.remarks || null)
      .input("UpdatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.MeterReadingMaster SET
          MeterBoxNumber = @MeterBoxNumber, ProviderId = @ProviderId, ConnectionType = @ConnectionType,
          MeterType = @MeterType, BillingCycle = @BillingCycle, Status = @Status, Remarks = @Remarks,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Meter not found" });
    const action = b.status && b.status !== "Active" && before.Status === "Active" ? "METER_DEACTIVATED" : "METER_UPDATED";
    await writeLog(pool, { meterId: id, bookingId: before.BookingId, action, oldValue: before, newValue: b, performedBy: actorOf(req), ipAddress: requestIp(req) });
    res.json({ message: "Meter updated" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Auto-fill info for the "+ Add Meter Reading" dialog (§10) ──────────
router.get("/meters/:id/next-reading-info", requirePageRight(METER_PAGE, "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid meter id" });
  try {
    const pool = getPool();
    const meterRes = await pool.request().input("Id", sql.Int, id).query(`${METER_SELECT} WHERE m.Id = @Id`);
    if (!meterRes.recordset.length) return res.status(404).json({ error: "Meter not found" });
    const meter = meterRes.recordset[0];

    const lastRes = await pool.request().input("MeterId", sql.Int, id).query(`
      SELECT TOP 1 * FROM dbo.MeterReading
      WHERE MeterId = @MeterId AND ReadingType = 'Regular' AND IsSuperseded = 0
      ORDER BY BillingPeriodTo DESC
    `);
    const last = lastRes.recordset[0] || null;

    const periodFrom = last ? addDays(last.BillingPeriodTo, 1) : (meter.OpeningReadingDate || meter.MeterInstallationDate || meter.CreatedAt);
    const periodTo = addMonthsMinusOneDay(periodFrom, 1);
    const previousReading = last ? Number(last.CurrentReading) : Number(meter.OpeningReading) || 0;

    const handover = await getHandoverRow(pool, meter.BookingId);
    const handoverInfo = resolveHandoverStatus(handover);

    res.json({
      meterId: id,
      previousReading,
      periodFrom: toISODate(periodFrom),
      periodTo: toISODate(periodTo),
      handoverStatus: handoverInfo.status,
      handoverDate: handoverInfo.handoverDate ? toISODate(handoverInfo.handoverDate) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function toISODate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}
function addDays(d, days) {
  const date = d instanceof Date ? new Date(d) : new Date(d);
  date.setDate(date.getDate() + days);
  return date;
}
function addMonthsMinusOneDay(d, months) {
  const date = d instanceof Date ? new Date(d) : new Date(d);
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() - 1);
  return date;
}

// ════════════════════════════════════════════════════════════════════
// Readings
// ════════════════════════════════════════════════════════════════════
router.post("/meters/:id/readings", requirePageRight(METER_PAGE, "create"), async (req, res) => {
  const meterId = parseInt(req.params.id, 10);
  const b = req.body || {};
  const readingType = b.readingType === "Handover" ? "Handover" : "Regular";
  if (!Number.isFinite(meterId)) return res.status(400).json({ error: "Invalid meter id" });
  if (b.currentReading === undefined || b.currentReading === null || Number.isNaN(Number(b.currentReading))) {
    return res.status(400).json({ error: "Current Reading is required" });
  }
  if (!b.readingDate) return res.status(400).json({ error: "Reading Date is required" });

  try {
    const pool = getPool();
    const meterRes = await pool.request().input("Id", sql.Int, meterId).query(`SELECT * FROM dbo.MeterReadingMaster WHERE Id = @Id`);
    if (!meterRes.recordset.length) return res.status(404).json({ error: "Meter not found" });
    const meter = meterRes.recordset[0];
    if (meter.Status !== "Active") {
      return res.status(400).json({ error: `Cannot record a reading against a meter that is ${meter.Status}` });
    }

    // Anchored on the reading's OWN date, not "whatever the most recently
    // stored reading happens to be" — a Handover reading is typically
    // entered mid-period, potentially before that period's own Regular
    // closing reading exists yet (or, if entered afterwards, must still
    // resolve against the period it actually falls in, not one that was
    // already closed by a later reading).
    const lastRes = await pool.request().input("MeterId", sql.Int, meterId).input("Before", sql.Date, b.readingDate).query(`
      SELECT TOP 1 * FROM dbo.MeterReading
      WHERE MeterId = @MeterId AND ReadingType = 'Regular' AND IsSuperseded = 0 AND BillingPeriodTo < @Before
      ORDER BY BillingPeriodTo DESC
    `);
    const last = lastRes.recordset[0] || null;
    const periodFrom = last ? addDays(last.BillingPeriodTo, 1) : (meter.OpeningReadingDate || meter.MeterInstallationDate || meter.CreatedAt);
    const periodTo = addMonthsMinusOneDay(periodFrom, 1);
    const previousReading = last ? Number(last.CurrentReading) : Number(meter.OpeningReading) || 0;
    const currentReading = Number(b.currentReading);

    if (currentReading < previousReading) {
      return res.status(400).json({ error: "Current meter reading cannot be less than the previous meter reading." });
    }

    if (readingType === "Regular") {
      const dupPeriod = await pool.request()
        .input("MeterId", sql.Int, meterId)
        .input("From", sql.Date, toISODate(periodFrom))
        .input("To", sql.Date, toISODate(periodTo))
        .query(`
          SELECT Id FROM dbo.MeterReading
          WHERE MeterId = @MeterId AND ReadingType = 'Regular' AND IsSuperseded = 0
            AND BillingPeriodFrom = @From AND BillingPeriodTo = @To
        `);
      if (dupPeriod.recordset.length) return res.status(409).json({ error: "A reading for this billing period has already been recorded for this meter." });

      const dupDate = await pool.request()
        .input("MeterId", sql.Int, meterId)
        .input("Date", sql.Date, b.readingDate)
        .query(`SELECT Id FROM dbo.MeterReading WHERE MeterId = @MeterId AND ReadingDate = @Date AND IsSuperseded = 0`);
      if (dupDate.recordset.length) return res.status(409).json({ error: "A reading has already been recorded for this meter on this date." });
    } else {
      const handover = await getHandoverRow(pool, meter.BookingId);
      const { status: handoverStatus } = resolveHandoverStatus(handover);
      if (handoverStatus !== "Handover Completed") {
        return res.status(400).json({ error: "A handover reading can only be recorded once the customer's handover is Completed." });
      }
      const dupHandover = await pool.request()
        .input("MeterId", sql.Int, meterId)
        .input("From", sql.Date, toISODate(periodFrom))
        .input("To", sql.Date, toISODate(periodTo))
        .query(`
          SELECT Id FROM dbo.MeterReading
          WHERE MeterId = @MeterId AND ReadingType = 'Handover' AND IsSuperseded = 0
            AND ReadingDate BETWEEN @From AND @To
        `);
      if (dupHandover.recordset.length) return res.status(409).json({ error: "A handover reading has already been recorded for this billing period." });
    }

    const unitsConsumed = currentReading - previousReading;
    const result = await pool.request()
      .input("MeterId", sql.Int, meterId)
      .input("From", sql.Date, toISODate(periodFrom))
      .input("To", sql.Date, toISODate(periodTo))
      .input("ReadingDate", sql.Date, b.readingDate)
      .input("PreviousReading", sql.Decimal(18, 2), previousReading)
      .input("CurrentReading", sql.Decimal(18, 2), currentReading)
      .input("UnitsConsumed", sql.Decimal(18, 2), unitsConsumed)
      .input("ReadingType", sql.NVarChar(20), readingType)
      .input("IsHandoverReading", sql.Bit, readingType === "Handover" ? 1 : 0)
      .input("EnteredBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.MeterReading
          (MeterId, BillingPeriodFrom, BillingPeriodTo, ReadingDate, PreviousReading, CurrentReading, UnitsConsumed, ReadingType, IsHandoverReading, EnteredBy)
        OUTPUT INSERTED.Id
        VALUES (@MeterId, @From, @To, @ReadingDate, @PreviousReading, @CurrentReading, @UnitsConsumed, @ReadingType, @IsHandoverReading, @EnteredBy)
      `);
    const readingId = result.recordset[0].Id;
    await writeLog(pool, {
      meterId, readingId, bookingId: meter.BookingId,
      action: readingType === "Handover" ? "HANDOVER_READING_CREATED" : "READING_CREATED",
      newValue: { previousReading, currentReading, unitsConsumed, periodFrom: toISODate(periodFrom), periodTo: toISODate(periodTo) },
      performedBy: actorOf(req), ipAddress: requestIp(req),
    });
    res.json({ id: readingId, unitsConsumed, periodFrom: toISODate(periodFrom), periodTo: toISODate(periodTo), message: "Reading recorded" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/meters/:id/readings", requirePageRight(METER_PAGE, "view"), async (req, res) => {
  const meterId = parseInt(req.params.id, 10);
  if (!Number.isFinite(meterId)) return res.status(400).json({ error: "Invalid meter id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("MeterId", sql.Int, meterId)
      .query(`SELECT * FROM dbo.MeterReading WHERE MeterId = @MeterId ORDER BY ReadingDate ASC, Id ASC`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/readings/:id/correct", requirePageRight(METER_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { correctedCurrentReading, reason, approvedBy } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid reading id" });
  if (correctedCurrentReading === undefined || Number.isNaN(Number(correctedCurrentReading))) return res.status(400).json({ error: "Corrected Current Reading is required" });
  if (!reason?.trim()) return res.status(400).json({ error: "A reason is required for a correction" });
  if (!approvedBy?.trim()) return res.status(400).json({ error: "Approved By is required for a correction" });

  const pool = getPool();
  try {
    const original = await pool.request().input("Id", sql.Int, id).query(`SELECT * FROM dbo.MeterReading WHERE Id = @Id`);
    if (!original.recordset.length) return res.status(404).json({ error: "Reading not found" });
    const orig = original.recordset[0];
    if (orig.IsSuperseded) return res.status(400).json({ error: "This reading has already been corrected" });

    const usedInBill = await pool.request().input("From", sql.Date, orig.BillingPeriodFrom).input("To", sql.Date, orig.BillingPeriodTo).input("MeterId", sql.Int, orig.MeterId)
      .query(`
        SELECT TOP 1 Id, BillStatus FROM dbo.ElectricityBill
        WHERE MeterId = @MeterId AND BillStatus <> 'Cancelled'
          AND NOT (BillingPeriodTo < @From OR BillingPeriodFrom > @To)
      `);
    if (usedInBill.recordset.length && usedInBill.recordset[0].BillStatus === "AddedToCustomerBill") {
      return res.status(409).json({ error: "This reading's bill has already been added to the customer's bill — cancel/adjust that bill first before correcting the reading." });
    }

    const newCurrent = Number(correctedCurrentReading);
    if (newCurrent < Number(orig.PreviousReading)) {
      return res.status(400).json({ error: "Current meter reading cannot be less than the previous meter reading." });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      const insertRes = await tx.request()
        .input("MeterId", sql.Int, orig.MeterId)
        .input("From", sql.Date, orig.BillingPeriodFrom)
        .input("To", sql.Date, orig.BillingPeriodTo)
        .input("ReadingDate", sql.Date, orig.ReadingDate)
        .input("PreviousReading", sql.Decimal(18, 2), orig.PreviousReading)
        .input("CurrentReading", sql.Decimal(18, 2), newCurrent)
        .input("UnitsConsumed", sql.Decimal(18, 2), newCurrent - Number(orig.PreviousReading))
        .input("ReadingType", sql.NVarChar(20), "Correction")
        .input("IsHandoverReading", sql.Bit, orig.IsHandoverReading)
        .input("EnteredBy", sql.NVarChar(150), actorOf(req))
        .input("CorrectedFromReadingId", sql.Int, orig.Id)
        .input("CorrectionReason", sql.NVarChar(500), reason.trim())
        .input("CorrectionApprovedBy", sql.NVarChar(150), approvedBy.trim())
        .query(`
          INSERT INTO dbo.MeterReading
            (MeterId, BillingPeriodFrom, BillingPeriodTo, ReadingDate, PreviousReading, CurrentReading, UnitsConsumed, ReadingType, IsHandoverReading, EnteredBy, CorrectedFromReadingId, CorrectionReason, CorrectionApprovedBy, CorrectionApprovedAt)
          OUTPUT INSERTED.Id
          VALUES (@MeterId, @From, @To, @ReadingDate, @PreviousReading, @CurrentReading, @UnitsConsumed, @ReadingType, @IsHandoverReading, @EnteredBy, @CorrectedFromReadingId, @CorrectionReason, @CorrectionApprovedBy, SYSDATETIME())
        `);
      await tx.request().input("Id", sql.Int, orig.Id).query(`UPDATE dbo.MeterReading SET IsSuperseded = 1 WHERE Id = @Id`);
      if (usedInBill.recordset.length) {
        await tx.request().input("Id", sql.Int, usedInBill.recordset[0].Id).query(`UPDATE dbo.ElectricityBill SET BillStatus = 'Revised' WHERE Id = @Id`);
      }
      await tx.commit();
      await writeLog(pool, {
        meterId: orig.MeterId, readingId: insertRes.recordset[0].Id, action: "READING_CORRECTED",
        oldValue: { currentReading: orig.CurrentReading }, newValue: { currentReading: newCurrent },
        performedBy: actorOf(req), remarks: reason.trim(), ipAddress: requestIp(req),
      });
      res.json({ id: insertRes.recordset[0].Id, message: "Reading corrected" });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Bills
// ════════════════════════════════════════════════════════════════════
async function computeBill(pool, { meterId, periodFrom, periodTo }) {
  const meterRes = await pool.request().input("Id", sql.Int, meterId).query(`${METER_SELECT} WHERE m.Id = @Id`);
  if (!meterRes.recordset.length) throw Object.assign(new Error("Meter not found"), { status: 404 });
  const meter = meterRes.recordset[0];

  const readingsRes = await pool.request()
    .input("MeterId", sql.Int, meterId).input("From", sql.Date, periodFrom).input("To", sql.Date, periodTo)
    .query(`
      SELECT * FROM dbo.MeterReading
      WHERE MeterId = @MeterId AND ReadingType = 'Regular' AND IsSuperseded = 0
        AND BillingPeriodFrom >= @From AND BillingPeriodTo <= @To
      ORDER BY BillingPeriodFrom ASC
    `);
  const readings = readingsRes.recordset;
  if (!readings.length) throw Object.assign(new Error("No meter readings found for this billing period"), { status: 400 });

  const overlap = await pool.request()
    .input("MeterId", sql.Int, meterId).input("From", sql.Date, periodFrom).input("To", sql.Date, periodTo)
    .query(`
      SELECT TOP 1 Id, BillNo = Id FROM dbo.ElectricityBill
      WHERE MeterId = @MeterId AND BillStatus NOT IN ('Cancelled', 'Revised')
        AND NOT (BillingPeriodTo < @From OR BillingPeriodFrom > @To)
    `);
  if (overlap.recordset.length) {
    throw Object.assign(new Error("Electricity charge for this billing period has already been added to the customer bill."), { status: 409 });
  }

  const previousReadingRow = readings[0];
  const currentReadingRow = readings[readings.length - 1];
  const totalUnits = Number(currentReadingRow.CurrentReading) - Number(previousReadingRow.PreviousReading);

  const handoverRow = await getHandoverRow(pool, meter.BookingId);
  const { status: handoverStatus, handoverDate } = resolveHandoverStatus(handoverRow);

  let rajwadaUnits = totalUnits;
  let postHandoverUnits = 0;
  let handoverReadingRow = null;

  if (handoverStatus === "Handover Completed" && handoverDate) {
    const hd = toISODate(handoverDate);
    if (hd >= toISODate(periodFrom) && hd <= toISODate(periodTo)) {
      const handoverRes = await pool.request()
        .input("MeterId", sql.Int, meterId).input("From", sql.Date, periodFrom).input("To", sql.Date, periodTo)
        .query(`
          SELECT TOP 1 * FROM dbo.MeterReading
          WHERE MeterId = @MeterId AND ReadingType = 'Handover' AND IsSuperseded = 0
            AND ReadingDate BETWEEN @From AND @To
          ORDER BY ReadingDate DESC
        `);
      if (!handoverRes.recordset.length) {
        throw Object.assign(new Error("Handover meter reading required. Electricity bill cannot be finalized for the Rajwada supply period."), { status: 400, code: "HANDOVER_READING_REQUIRED" });
      }
      handoverReadingRow = handoverRes.recordset[0];
      rajwadaUnits = Number(handoverReadingRow.CurrentReading) - Number(previousReadingRow.PreviousReading);
      postHandoverUnits = Number(currentReadingRow.CurrentReading) - Number(handoverReadingRow.CurrentReading);
    } else if (hd < toISODate(periodFrom)) {
      // Already fully handed over before this period started — nothing
      // in this period belongs to Rajwada's supply.
      rajwadaUnits = 0;
      postHandoverUnits = totalUnits;
    }
    // hd > periodTo: handover happens later — this whole period is still
    // pre-handover, rajwadaUnits stays = totalUnits (the default above).
  }

  const tariff = await findApplicableTariff(pool, sql, { providerId: meter.ProviderId, billingCycle: meter.BillingCycle, periodEndDate: periodTo });
  if (!tariff) throw Object.assign(new Error(`No applicable Electricity Tariff found for ${meter.ProviderName} (${meter.BillingCycle}) covering ${periodTo}`), { status: 400 });
  const slabs = await getTariffSlabs(pool, sql, tariff.Id);
  const charge = calculateElectricityCharge(rajwadaUnits, tariff, slabs);

  return {
    meter, previousReadingRow, currentReadingRow, handoverReadingRow,
    totalUnits, rajwadaUnits, postHandoverUnits,
    handoverStatus, handoverDate: handoverDate ? toISODate(handoverDate) : null,
    tariff, charge,
  };
}

router.get("/bills/preview", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  const meterId = parseInt(req.query.meterId, 10);
  const { periodFrom, periodTo } = req.query;
  if (!Number.isFinite(meterId) || !periodFrom || !periodTo) return res.status(400).json({ error: "meterId, periodFrom and periodTo are required" });
  try {
    const pool = getPool();
    const r = await computeBill(pool, { meterId, periodFrom, periodTo });
    res.json({
      meterId, periodFrom, periodTo,
      customerName: r.meter.CustomerName, unitNo: r.meter.UnitNo, blockName: r.meter.BlockName, projectName: r.meter.ProjectName,
      meterNumber: r.meter.MeterNumber, providerName: r.meter.ProviderName,
      previousReading: r.previousReadingRow.PreviousReading, currentReading: r.currentReadingRow.CurrentReading,
      totalUnits: r.totalUnits, handoverStatus: r.handoverStatus, handoverDate: r.handoverDate,
      handoverReading: r.handoverReadingRow ? r.handoverReadingRow.CurrentReading : null,
      rajwadaUnits: r.rajwadaUnits, postHandoverUnits: r.postHandoverUnits,
      tariffName: r.tariff.TariffName, ...r.charge,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

router.post("/bills", requirePageRight(MAIN_PAGE, "create"), async (req, res) => {
  const { meterId, periodFrom, periodTo } = req.body || {};
  if (!meterId || !periodFrom || !periodTo) return res.status(400).json({ error: "meterId, periodFrom and periodTo are required" });
  try {
    const pool = getPool();
    const r = await computeBill(pool, { meterId, periodFrom, periodTo });
    const result = await pool.request()
      .input("MeterId", sql.Int, meterId)
      .input("BookingId", sql.Int, r.meter.BookingId)
      .input("From", sql.Date, periodFrom)
      .input("To", sql.Date, periodTo)
      .input("PreviousReadingId", sql.Int, r.previousReadingRow.Id)
      .input("CurrentReadingId", sql.Int, r.currentReadingRow.Id)
      .input("HandoverReadingId", sql.Int, r.handoverReadingRow ? r.handoverReadingRow.Id : null)
      .input("TotalUnits", sql.Decimal(18, 2), r.totalUnits)
      .input("HandoverDate", sql.Date, r.handoverDate)
      .input("HandoverReading", sql.Decimal(18, 2), r.handoverReadingRow ? r.handoverReadingRow.CurrentReading : null)
      .input("RajwadaUnits", sql.Decimal(18, 2), r.rajwadaUnits)
      .input("PostHandoverUnits", sql.Decimal(18, 2), r.postHandoverUnits)
      .input("TariffId", sql.Int, r.tariff.Id)
      .input("EnergyCharge", sql.Decimal(18, 2), r.charge.energyCharge)
      .input("FixedCharge", sql.Decimal(18, 2), r.charge.fixedCharge)
      .input("OtherCharge", sql.Decimal(18, 2), r.charge.otherCharge)
      .input("TotalAmount", sql.Decimal(18, 2), r.charge.totalAmount)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.ElectricityBill
          (MeterId, BookingId, BillingPeriodFrom, BillingPeriodTo, PreviousReadingId, CurrentReadingId, HandoverReadingId,
           TotalUnits, HandoverDate, HandoverReading, RajwadaUnits, PostHandoverUnits, TariffId,
           EnergyCharge, FixedCharge, OtherCharge, TotalAmount, BillStatus, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@MeterId, @BookingId, @From, @To, @PreviousReadingId, @CurrentReadingId, @HandoverReadingId,
                @TotalUnits, @HandoverDate, @HandoverReading, @RajwadaUnits, @PostHandoverUnits, @TariffId,
                @EnergyCharge, @FixedCharge, @OtherCharge, @TotalAmount, 'PendingVerification', @CreatedBy)
      `);
    const billId = result.recordset[0].Id;
    await writeLog(pool, {
      meterId, billId, bookingId: r.meter.BookingId, action: "BILL_GENERATED",
      newValue: { totalUnits: r.totalUnits, rajwadaUnits: r.rajwadaUnits, totalAmount: r.charge.totalAmount },
      performedBy: actorOf(req), ipAddress: requestIp(req),
    });
    res.json({ id: billId, message: "Electricity bill generated", totalAmount: r.charge.totalAmount });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

const BILL_SELECT = `
  SELECT b.*, m.MeterNumber, prov.Name AS ProviderName, ${BOOKING_COLS}
  FROM dbo.ElectricityBill b
  JOIN dbo.MeterReadingMaster m ON m.Id = b.MeterId
  JOIN dbo.ElectricityProvider prov ON prov.Id = m.ProviderId
  JOIN dbo.CrmBooking cb ON cb.Id = b.BookingId
  JOIN dbo.CrmApplication capp ON capp.Id = cb.ApplicationId
  LEFT JOIN dbo.UnitMaster um    ON um.Id  = cb.UnitId
  LEFT JOIN dbo.BlockMaster blk  ON blk.Id = um.BlockId
  LEFT JOIN dbo.enterprise  proj ON proj.id = cb.ProjectId AND proj.business_type = 'P'
`;

router.get("/bills", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { meterId, bookingId, providerId, billStatus, dateFrom, dateTo } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (meterId) { req0.input("meterId", sql.Int, parseInt(meterId, 10)); conds.push("b.MeterId = @meterId"); }
    if (bookingId) { req0.input("bookingId", sql.Int, parseInt(bookingId, 10)); conds.push("b.BookingId = @bookingId"); }
    if (providerId) { req0.input("providerId", sql.Int, parseInt(providerId, 10)); conds.push("m.ProviderId = @providerId"); }
    if (billStatus) { req0.input("billStatus", sql.NVarChar, billStatus); conds.push("b.BillStatus = @billStatus"); }
    if (dateFrom) { req0.input("dateFrom", sql.Date, dateFrom); conds.push("b.BillingPeriodTo >= @dateFrom"); }
    if (dateTo) { req0.input("dateTo", sql.Date, dateTo); conds.push("b.BillingPeriodFrom <= @dateTo"); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await req0.query(`${BILL_SELECT} ${where} ORDER BY b.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/bills/:id", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id).query(`${BILL_SELECT} WHERE b.Id = @Id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Bill not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/bills/:id/verify", requirePageRight(MAIN_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT * FROM dbo.ElectricityBill WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Bill not found" });
    if (existing.recordset[0].BillStatus !== "PendingVerification") {
      return res.status(409).json({ error: `Only a bill Pending Verification can be verified (current status: ${existing.recordset[0].BillStatus})` });
    }
    await pool.request().input("Id", sql.Int, id).input("VerifiedBy", sql.NVarChar(150), actorOf(req))
      .query(`UPDATE dbo.ElectricityBill SET BillStatus = 'Verified', VerifiedBy = @VerifiedBy, VerifiedAt = SYSDATETIME() WHERE Id = @Id`);
    await writeLog(pool, { billId: id, meterId: existing.recordset[0].MeterId, bookingId: existing.recordset[0].BookingId, action: "BILL_VERIFIED", performedBy: actorOf(req), ipAddress: requestIp(req) });
    res.json({ message: "Bill verified" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/bills/:id/add-to-customer-bill", requirePageRight(MAIN_PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { maintenanceBillId } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  if (!maintenanceBillId) return res.status(400).json({ error: "maintenanceBillId is required — pick (or create) the customer's maintenance bill first" });

  const pool = getPool();
  try {
    const ebRes = await pool.request().input("Id", sql.Int, id).query(`SELECT * FROM dbo.ElectricityBill WHERE Id = @Id`);
    if (!ebRes.recordset.length) return res.status(404).json({ error: "Electricity bill not found" });
    const eb = ebRes.recordset[0];
    if (eb.BillStatus === "AddedToCustomerBill") {
      return res.status(409).json({ error: "Electricity charge for this billing period has already been added to the customer bill." });
    }
    if (eb.BillStatus !== "Verified") {
      return res.status(400).json({ error: "Only a Verified electricity bill can be added to the customer's bill" });
    }

    const mbRes = await pool.request().input("Id", sql.Int, maintenanceBillId).query(`SELECT * FROM dbo.MaintenanceBill WHERE Id = @Id`);
    if (!mbRes.recordset.length) return res.status(404).json({ error: "Maintenance bill not found" });
    const mb = mbRes.recordset[0];
    if (mb.Status === "Cancelled") return res.status(400).json({ error: "Cannot add to a cancelled maintenance bill" });
    if (mb.BookingId !== eb.BookingId) return res.status(400).json({ error: "That maintenance bill belongs to a different customer/booking" });

    const periodLabel = `${toISODate(eb.BillingPeriodFrom)} to ${toISODate(eb.BillingPeriodTo)}`;
    const rate = Number(eb.TotalAmount) || 0;

    const tx = pool.transaction();
    await tx.begin();
    try {
      const itemRes = await tx.request()
        .input("BillId", sql.Int, maintenanceBillId)
        .input("ElectricityBillId", sql.Int, id)
        .input("ChargeHeadName", sql.NVarChar(200), `Electricity – Rajwada Supply (${periodLabel})`)
        .input("Rate", sql.Decimal(18, 2), rate)
        .query(`
          INSERT INTO dbo.MaintenanceBillItem (BillId, ChargeHeadId, ElectricityBillId, ChargeHeadName, HsnId, HsnCode, Rate, TaxPct, TaxAmount, TotalAmount)
          OUTPUT INSERTED.Id
          VALUES (@BillId, NULL, @ElectricityBillId, @ChargeHeadName, NULL, NULL, @Rate, 0, 0, @Rate)
        `);
      const itemId = itemRes.recordset[0].Id;

      await tx.request()
        .input("Id", sql.Int, maintenanceBillId).input("Rate", sql.Decimal(18, 2), rate)
        .query(`
          UPDATE dbo.MaintenanceBill SET
            Subtotal = Subtotal + @Rate, GrandTotal = GrandTotal + @Rate, UpdatedAt = GETDATE()
          WHERE Id = @Id
        `);

      await tx.request().input("Id", sql.Int, id).input("MaintenanceBillId", sql.Int, maintenanceBillId).input("MaintenanceBillItemId", sql.Int, itemId)
        .query(`
          UPDATE dbo.ElectricityBill SET
            BillStatus = 'AddedToCustomerBill', MaintenanceBillId = @MaintenanceBillId, MaintenanceBillItemId = @MaintenanceBillItemId, UpdatedAt = SYSDATETIME()
          WHERE Id = @Id
        `);

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    await writeLog(pool, { billId: id, meterId: eb.MeterId, bookingId: eb.BookingId, action: "BILL_ADDED_TO_CUSTOMER", newValue: { maintenanceBillId, amount: rate }, performedBy: actorOf(req), ipAddress: requestIp(req) });
    res.json({ message: "Electricity charge added to the customer's bill" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/bills/:id/cancel", requirePageRight(MAIN_PAGE, "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  if (!reason?.trim()) return res.status(400).json({ error: "A cancellation reason is required" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT * FROM dbo.ElectricityBill WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Bill not found" });
    if (existing.recordset[0].BillStatus === "AddedToCustomerBill") {
      return res.status(409).json({ error: "This bill has already been added to the customer's bill — it cannot be cancelled directly. Adjust the customer's maintenance bill first." });
    }
    if (existing.recordset[0].BillStatus === "Cancelled") return res.status(409).json({ error: "Bill is already cancelled" });

    await pool.request().input("Id", sql.Int, id).input("Reason", sql.NVarChar(500), reason.trim())
      .query(`UPDATE dbo.ElectricityBill SET BillStatus = 'Cancelled', CancelReason = @Reason, UpdatedAt = SYSDATETIME() WHERE Id = @Id`);
    await writeLog(pool, { billId: id, meterId: existing.recordset[0].MeterId, bookingId: existing.recordset[0].BookingId, action: "BILL_CANCELLED", remarks: reason.trim(), performedBy: actorOf(req), ipAddress: requestIp(req) });
    res.json({ message: "Bill cancelled" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Dashboard
// ════════════════════════════════════════════════════════════════════
router.get("/dashboard", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const totalMeters = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.MeterReadingMaster WHERE Status = 'Active'`);

    const pending = await pool.request().query(`
      SELECT COUNT(*) AS Cnt FROM dbo.MeterReadingMaster m
      WHERE m.Status = 'Active'
        AND DATEADD(DAY, 31, COALESCE(
              (SELECT MAX(BillingPeriodTo) FROM dbo.MeterReading r WHERE r.MeterId = m.Id AND r.ReadingType = 'Regular' AND r.IsSuperseded = 0),
              m.OpeningReadingDate, m.MeterInstallationDate, CAST(m.CreatedAt AS DATE)
            )) <= GETDATE()
    `);

    const billsGenerated = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.ElectricityBill WHERE BillStatus <> 'Cancelled'`);
    const currentAmount = await pool.request().query(`SELECT ISNULL(SUM(TotalAmount), 0) AS Amt FROM dbo.ElectricityBill WHERE BillStatus <> 'Cancelled'`);

    res.json({
      totalMeters: totalMeters.recordset[0].Cnt,
      readingPending: pending.recordset[0].Cnt,
      billsGenerated: billsGenerated.recordset[0].Cnt,
      currentAmount: Number(currentAmount.recordset[0].Amt) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Reports
// ════════════════════════════════════════════════════════════════════
router.get("/reports/monthly", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  try {
    const pool = getPool();
    const req0 = pool.request();
    const conds = ["BillStatus <> 'Cancelled'"];
    if (dateFrom) { req0.input("dateFrom", sql.Date, dateFrom); conds.push("BillingPeriodTo >= @dateFrom"); }
    if (dateTo) { req0.input("dateTo", sql.Date, dateTo); conds.push("BillingPeriodFrom <= @dateTo"); }
    const totals = await req0.query(`
      SELECT
        ISNULL(SUM(TotalUnits), 0) AS TotalUnits,
        ISNULL(SUM(RajwadaUnits), 0) AS RajwadaUnits,
        ISNULL(SUM(PostHandoverUnits), 0) AS PostHandoverUnits,
        ISNULL(SUM(TotalAmount), 0) AS TotalAmount,
        COUNT(*) AS BillsCount
      FROM dbo.ElectricityBill WHERE ${conds.join(" AND ")}
    `);
    const totalMeters = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.MeterReadingMaster WHERE Status = 'Active'`);
    const row = totals.recordset[0];
    res.json({
      totalMeters: totalMeters.recordset[0].Cnt,
      readingsCompleted: row.BillsCount,
      totalUnitsConsumed: Number(row.TotalUnits) || 0,
      rajwadaSupplyUnits: Number(row.RajwadaUnits) || 0,
      postHandoverUnits: Number(row.PostHandoverUnits) || 0,
      totalElectricityAmount: Number(row.TotalAmount) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reports/provider-wise", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  try {
    const pool = getPool();
    const req0 = pool.request();
    const conds = ["b.BillStatus <> 'Cancelled'"];
    if (dateFrom) { req0.input("dateFrom", sql.Date, dateFrom); conds.push("b.BillingPeriodTo >= @dateFrom"); }
    if (dateTo) { req0.input("dateTo", sql.Date, dateTo); conds.push("b.BillingPeriodFrom <= @dateTo"); }
    const result = await req0.query(`
      SELECT prov.Name AS ProviderName,
        COUNT(DISTINCT b.MeterId) AS MeterCount,
        ISNULL(SUM(b.TotalUnits), 0) AS TotalUnits,
        ISNULL(SUM(b.TotalAmount), 0) AS TotalAmount
      FROM dbo.ElectricityBill b
      JOIN dbo.MeterReadingMaster m ON m.Id = b.MeterId
      JOIN dbo.ElectricityProvider prov ON prov.Id = m.ProviderId
      WHERE ${conds.join(" AND ")}
      GROUP BY prov.Name
      ORDER BY prov.Name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reports/customer-wise", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  try {
    const pool = getPool();
    const req0 = pool.request();
    const conds = ["b.BillStatus <> 'Cancelled'"];
    if (dateFrom) { req0.input("dateFrom", sql.Date, dateFrom); conds.push("b.BillingPeriodTo >= @dateFrom"); }
    if (dateTo) { req0.input("dateTo", sql.Date, dateTo); conds.push("b.BillingPeriodFrom <= @dateTo"); }
    const result = await req0.query(`
      ${BILL_SELECT}
      WHERE ${conds.join(" AND ")}
      ORDER BY b.BillingPeriodFrom DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Audit log
// ════════════════════════════════════════════════════════════════════
router.get("/audit-log", requirePageRight(MAIN_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { meterId, billId, readingId } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (meterId) { req0.input("meterId", sql.Int, parseInt(meterId, 10)); conds.push("MeterId = @meterId"); }
    if (billId) { req0.input("billId", sql.Int, parseInt(billId, 10)); conds.push("BillId = @billId"); }
    if (readingId) { req0.input("readingId", sql.Int, parseInt(readingId, 10)); conds.push("ReadingId = @readingId"); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await req0.query(`SELECT * FROM dbo.ElectricityAuditLog ${where} ORDER BY PerformedAt DESC`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
