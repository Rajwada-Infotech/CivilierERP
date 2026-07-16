-- Migration 120: Indexes to support the unified Records module
-- (backend/routes/recordsRoutes.js).
--
-- Records aggregates and sorts attachments from three existing tables by
-- their upload/created timestamp, descending, across the WHOLE table (not
-- scoped to one parent record like each source module's own queries are).
-- None of the three tables had an index usable for that access pattern:
--   - dbo.ticket_attachments was indexed on ticket_id / comment_id only
--   - dbo.VehicleInOutAttachments was indexed on VehicleInOutID only
--   - dbo.FollowupDocumentVault was indexed on ApplicantId / Category / IsDeleted
--
-- These indexes are purely additive (no column/table changes) and safe to
-- re-run — all guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TicketAttachments_UploadedAt'
    AND object_id = OBJECT_ID('dbo.ticket_attachments')
)
  CREATE INDEX IX_TicketAttachments_UploadedAt
    ON dbo.ticket_attachments (uploaded_at DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_VehicleInOutAttachments_UploadedAt'
    AND object_id = OBJECT_ID('dbo.VehicleInOutAttachments')
)
  CREATE INDEX IX_VehicleInOutAttachments_UploadedAt
    ON dbo.VehicleInOutAttachments (UploadedAt DESC)
    WHERE VehicleInOutID IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FDV_CreatedAt_NotDeleted'
    AND object_id = OBJECT_ID('dbo.FollowupDocumentVault')
)
  CREATE INDEX IX_FDV_CreatedAt_NotDeleted
    ON dbo.FollowupDocumentVault (CreatedAt DESC)
    WHERE IsDeleted = 0;
GO

PRINT '================================================================';
PRINT '120-records-module-indexes applied successfully.';
PRINT '================================================================';
GO
