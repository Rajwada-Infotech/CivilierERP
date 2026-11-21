-- Migration 284: split Unit GST and Parking GST into their own tracked
-- figures on CrmBooking, and fix GrandTotal to actually include Unit's own
-- share of the fixed Unit+Parking GST.
--
-- Migration 283 already computed UnitParkingGstAmount (the combined GST on
-- Unit+Parking together) and correctly folded PARKING's own tax-inclusive
-- total into GrandTotal (via ParkingTotal). But Unit's own share of that
-- same combined GST was only ever shown, never actually added into
-- GrandTotal — so the real payable total silently excluded Unit's tax. This
-- migration adds the two split columns so both halves are visible and
-- auditable on their own; the code fix (crmGst.js) is what actually
-- corrects GrandTotal.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitGstAmount')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD UnitGstAmount DECIMAL(18,2) NULL;
  PRINT 'Added CrmBooking.UnitGstAmount';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'ParkingGstAmount')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD ParkingGstAmount DECIMAL(18,2) NULL;
  PRINT 'Added CrmBooking.ParkingGstAmount';
END
GO

;WITH BookingBase AS (
  SELECT
    b.Id,
    ISNULL(b.TotalValue, 0) AS UnitBase,
    ISNULL((
      SELECT SUM(ISNULL(pa.RateSnapshot, 0) * ISNULL(pa.Quantity, 1))
      FROM dbo.CrmParkingAllotment pa
      WHERE pa.BookingId = b.Id AND pa.IsActive = 1
    ), 0) AS ParkingBase
  FROM dbo.CrmBooking b
  WHERE b.IsActive = 1
),
RatePick AS (
  SELECT
    bb.Id,
    CASE WHEN bb.UnitBase + bb.ParkingBase <= 4500000 THEN '9954AFH' ELSE '9954OTH' END AS HsnCode,
    CAST(ISNULL(
      (SELECT TOP 1
        CASE
          WHEN ISNULL(h.HCGST, 0) + ISNULL(h.HSGST, 0) > 0 THEN ISNULL(h.HCGST, 0) + ISNULL(h.HSGST, 0)
          ELSE ISNULL(h.HIGST, 0)
        END
       FROM dbo.HSN h
       WHERE h.HCode = CASE WHEN bb.UnitBase + bb.ParkingBase <= 4500000 THEN '9954AFH' ELSE '9954OTH' END
         AND h.HStatus = 1), 0) AS DECIMAL(5,2)) AS GstRate
  FROM BookingBase bb
)
UPDATE pa
SET
  GstRateSnapshot = rp.GstRate,
  GstAmount = ROUND((ISNULL(pa.RateSnapshot, 0) * ISNULL(pa.Quantity, 1)) * rp.GstRate / 100, 2),
  TotalAmount = (ISNULL(pa.RateSnapshot, 0) * ISNULL(pa.Quantity, 1)) + ROUND((ISNULL(pa.RateSnapshot, 0) * ISNULL(pa.Quantity, 1)) * rp.GstRate / 100, 2)
FROM dbo.CrmParkingAllotment pa
JOIN RatePick rp ON rp.Id = pa.BookingId
WHERE pa.IsActive = 1;
GO

;WITH BookingAmounts AS (
  SELECT
    b.Id,
    ISNULL(b.TotalValue, 0) AS UnitBase,
    ISNULL((
      SELECT SUM(ISNULL(pa.RateSnapshot, 0) * ISNULL(pa.Quantity, 1))
      FROM dbo.CrmParkingAllotment pa
      WHERE pa.BookingId = b.Id AND pa.IsActive = 1
    ), 0) AS ParkingBase,
    ISNULL((
      SELECT SUM(ISNULL(pa.TotalAmount, 0))
      FROM dbo.CrmParkingAllotment pa
      WHERE pa.BookingId = b.Id AND pa.IsActive = 1
    ), 0) AS ParkingTotal,
    ISNULL((
      SELECT SUM(ISNULL(ec.TotalAmount, 0))
      FROM dbo.CrmExtraCharge ec
      WHERE ec.BookingId = b.Id AND ec.IsActive = 1
    ), 0) AS ExtraTotal,
    ISNULL((
      SELECT SUM(ISNULL(ec.GstAmount, 0))
      FROM dbo.CrmExtraCharge ec
      WHERE ec.BookingId = b.Id AND ec.IsActive = 1
    ), 0) AS ExtraGst
  FROM dbo.CrmBooking b
  WHERE b.IsActive = 1
),
RatePick AS (
  SELECT
    ba.*,
    CASE WHEN ba.UnitBase + ba.ParkingBase <= 4500000 THEN '9954AFH' ELSE '9954OTH' END AS HsnCode,
    CAST(ISNULL(
      (SELECT TOP 1
        CASE
          WHEN ISNULL(h.HCGST, 0) + ISNULL(h.HSGST, 0) > 0 THEN ISNULL(h.HCGST, 0) + ISNULL(h.HSGST, 0)
          ELSE ISNULL(h.HIGST, 0)
        END
       FROM dbo.HSN h
       WHERE h.HCode = CASE WHEN ba.UnitBase + ba.ParkingBase <= 4500000 THEN '9954AFH' ELSE '9954OTH' END
         AND h.HStatus = 1), 0) AS DECIMAL(5,2)) AS GstRate
  FROM BookingAmounts ba
),
FinalAmounts AS (
  SELECT
    rp.*,
    ROUND(rp.UnitBase * rp.GstRate / 100, 2) AS UnitGst,
    ROUND(rp.ParkingTotal - rp.ParkingBase, 2) AS ParkingGst
  FROM RatePick rp
)
UPDATE b
SET
  ParkingTotal = fa.ParkingTotal,
  ExtraChargesTotal = fa.ExtraTotal,
  GrandTotal = ROUND(fa.UnitBase + fa.UnitGst + fa.ParkingTotal + fa.ExtraTotal, 2),
  HsnCode = fa.HsnCode,
  UnitParkingGstRate = fa.GstRate,
  UnitGstAmount = fa.UnitGst,
  ParkingGstAmount = fa.ParkingGst,
  UnitParkingGstAmount = ROUND(fa.UnitGst + fa.ParkingGst, 2),
  ExtraWorkGstAmount = ROUND(fa.ExtraGst, 2),
  TotalGstAmount = ROUND(fa.UnitGst + fa.ParkingGst + fa.ExtraGst, 2)
FROM dbo.CrmBooking b
JOIN FinalAmounts fa ON fa.Id = b.Id;
GO

PRINT 'Backfilled CRM booking Unit/Parking GST split and GrandTotal from HSN Master';
GO
