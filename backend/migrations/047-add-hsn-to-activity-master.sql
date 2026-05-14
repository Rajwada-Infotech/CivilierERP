-- Migration 047: Add hsn_code to ActivityMaster
-- Links an HSN code to an Activity (not Group).
-- Nullable — Groups always stay NULL, Activities can optionally have one.

ALTER TABLE dbo.ActivityMaster
  ADD hsn_code NVARCHAR(50) NULL;

GO

-- Optional: add comment index documentation
-- hsn_code: stores the HSN code string (e.g. '7308') linked to this activity.
-- Only populated when activity_type = 1 (Activity). Always NULL for Groups (activity_type = 0).
