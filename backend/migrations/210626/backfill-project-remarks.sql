-- One-time backfill: copy any legacy remarks that were stored in
-- dbo.enterprise.pan (before projectMaster.js was fixed to use the
-- existing dbo.enterprise.remarks column) over to remarks.
-- Safe to re-run — only touches rows where remarks is still empty.

UPDATE dbo.enterprise
SET remarks = pan
WHERE business_type = 'P'
  AND pan IS NOT NULL
  AND (remarks IS NULL OR remarks = '');
