-- Migration 089: Add indexes for MR → PO linkage columns
-- These columns (SourceMRId, SourceMRDocNo) are already created by prior migrations.
-- This migration ensures they exist (safe IF NOT EXISTS guards) and adds indexes.

-- 1. Ensure SourceMRId column exists on PurchaseOrders
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders') AND name = N'SourceMRId'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders ADD SourceMRId INT NULL;
END

-- 2. Ensure SourceMRDocNo column exists on PurchaseOrders
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders') AND name = N'SourceMRDocNo'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders ADD SourceMRDocNo NVARCHAR(50) NULL;
END

-- 3. Index on SourceMRId for fast lookup of "all POs raised from MR #N"
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders') AND name = N'IX_PurchaseOrders_SourceMRId'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_PurchaseOrders_SourceMRId
    ON dbo.PurchaseOrders (SourceMRId)
    WHERE SourceMRId IS NOT NULL;
END

-- 4. Index on SourceMRDocNo for doc-number-based lookups from the PO form
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders') AND name = N'IX_PurchaseOrders_SourceMRDocNo'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_PurchaseOrders_SourceMRDocNo
    ON dbo.PurchaseOrders (SourceMRDocNo)
    WHERE SourceMRDocNo IS NOT NULL;
END

-- 5. Add a by-DocNo lookup index on MaterialRequests.DocNo (used by the new
--    GET /api/material-requests/by-docno/:docNo endpoint)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.MaterialRequests') AND name = N'IX_MaterialRequests_DocNo'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_MaterialRequests_DocNo
    ON dbo.MaterialRequests (DocNo)
    WHERE DocNo IS NOT NULL;
END
