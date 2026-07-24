-- Vehicle In/Out's per-item "Qty This Lot" row now has a camera icon next
-- to it (VehicleInOut.tsx) so the person logging the gate-in can snap a
-- real-time photo of that specific item as it's unloaded — separate from
-- the existing header-level Attachments (binary, vehicle/plate photos).
-- Stored as base64 directly on the line item rather than through the
-- binary VehicleInOutAttachments pipeline, per-item rather than per-record.
ALTER TABLE dbo.VehicleInOutItems ADD
  PhotoBase64 NVARCHAR(MAX) NULL;
GO
