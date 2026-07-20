-- ============================================================
-- Migration 189: Parking Booking page definition
-- Parking allotment logic (backend/routes/crmParking.js) already existed
-- and was fully functional, but had NO dedicated page of its own — it was
-- only reachable by drilling into a specific booking's Details tab. There
-- was also no way to sell parking standalone (no unit booking at all) even
-- though the backend's POST /standalone endpoint already supported it.
-- This registers a real "Parking Booking" page (like Unit Matrix / Parking
-- Matrix already have) so it shows up in Menu Rights / RoleRights and can
-- be given its own sidebar entry.
-- ============================================================
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-parking-booking', 'Parking Booking', 'CRM', 'CRM Finance', 'view,create,edit', 640, 1, 'migration-189')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());
GO

PRINT '189-crm-parking-booking-page: done';
