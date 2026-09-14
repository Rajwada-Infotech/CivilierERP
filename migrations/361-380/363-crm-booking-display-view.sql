-- vw_CrmBookingDisplay: always shows live names from master tables.
-- Routes that need ProjectName/UnitNo/BlockName/UnitType should JOIN to this
-- view (keyed on BookingId = b.Id) instead of reading the snapshot columns
-- directly from CrmBooking. Financial fields (AreaSqFt, RatePerSqFt,
-- TotalValue, etc.) are intentional snapshots and are NOT in this view —
-- read them from the booking row itself.
CREATE OR ALTER VIEW dbo.vw_CrmBookingDisplay AS
SELECT
  b.Id AS BookingId,
  COALESCE(proj.name,     b.ProjectName) AS ProjectName,
  COALESCE(um.UnitName,   b.UnitNo)      AS UnitNo,
  COALESCE(blk.BlockName, b.BlockName)   AS BlockName,
  COALESCE(um.UnitType,   b.UnitType)    AS UnitType,
  um.BlockId
FROM dbo.CrmBooking b
LEFT JOIN dbo.UnitMaster  um   ON um.Id   = b.UnitId
LEFT JOIN dbo.BlockMaster blk  ON blk.Id  = um.BlockId
LEFT JOIN dbo.enterprise  proj ON proj.id = b.ProjectId AND proj.business_type = 'P';
