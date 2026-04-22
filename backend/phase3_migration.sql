-- ============================================================
-- PHASE 3 MIGRATION — Workflow Engine Columns
-- Database: Civilier
-- Run this entire script in SSMS once.
-- Safe to run: every ALTER uses IF NOT EXISTS guard.
-- ============================================================

USE Civilier;
GO

-- ─────────────────────────────────────────────────────────────
-- 1. PurchaseOrders
--    Already has: Status, ApprovedBy, ApprovedAt, UpdatedBy, UpdatedAt
--    Missing:     RejectedBy, RejectedAt, RejectionNote
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'RejectedBy'
)
  ALTER TABLE dbo.PurchaseOrders ADD RejectedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'RejectedAt'
)
  ALTER TABLE dbo.PurchaseOrders ADD RejectedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'RejectionNote'
)
  ALTER TABLE dbo.PurchaseOrders ADD RejectionNote NVARCHAR(500) NULL;
GO

-- ─────────────────────────────────────────────────────────────
-- 2. WorkOrderHeader
--    Already has: Status, UpdatedBy, UpdatedAt
--    Missing:     ApprovedBy, ApprovedAt, RejectedBy, RejectedAt, RejectionNote
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'WorkOrderHeader' AND COLUMN_NAME = 'ApprovedBy'
)
  ALTER TABLE dbo.WorkOrderHeader ADD ApprovedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'WorkOrderHeader' AND COLUMN_NAME = 'ApprovedAt'
)
  ALTER TABLE dbo.WorkOrderHeader ADD ApprovedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'WorkOrderHeader' AND COLUMN_NAME = 'RejectedBy'
)
  ALTER TABLE dbo.WorkOrderHeader ADD RejectedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'WorkOrderHeader' AND COLUMN_NAME = 'RejectedAt'
)
  ALTER TABLE dbo.WorkOrderHeader ADD RejectedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'WorkOrderHeader' AND COLUMN_NAME = 'RejectionNote'
)
  ALTER TABLE dbo.WorkOrderHeader ADD RejectionNote NVARCHAR(500) NULL;
GO

-- ─────────────────────────────────────────────────────────────
-- 3. NewPayment
--    Already has: Status
--    Missing:     ApprovedBy, ApprovedAt, RejectedBy, RejectedAt,
--                 RejectionNote, UpdatedBy, UpdatedAt
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'ApprovedBy'
)
  ALTER TABLE dbo.NewPayment ADD ApprovedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'ApprovedAt'
)
  ALTER TABLE dbo.NewPayment ADD ApprovedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'RejectedBy'
)
  ALTER TABLE dbo.NewPayment ADD RejectedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'RejectedAt'
)
  ALTER TABLE dbo.NewPayment ADD RejectedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'RejectionNote'
)
  ALTER TABLE dbo.NewPayment ADD RejectionNote NVARCHAR(500) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'UpdatedBy'
)
  ALTER TABLE dbo.NewPayment ADD UpdatedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'UpdatedAt'
)
  ALTER TABLE dbo.NewPayment ADD UpdatedAt DATETIME2 NULL;
GO

-- ─────────────────────────────────────────────────────────────
-- 4. GoodsReceiptNotes
--    Already has: Status
--    Missing:     ApprovedBy, ApprovedAt, RejectedBy, RejectedAt, RejectionNote
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'ApprovedBy'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD ApprovedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'ApprovedAt'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD ApprovedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'RejectedBy'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD RejectedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'RejectedAt'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD RejectedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'RejectionNote'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD RejectionNote NVARCHAR(500) NULL;
GO

-- ─────────────────────────────────────────────────────────────
-- 5. ExpenseBooking
--    Missing everything — Status + all approval columns
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'Status'
)
  ALTER TABLE dbo.ExpenseBooking ADD Status NVARCHAR(20) NOT NULL DEFAULT 'Draft';
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'ApprovedBy'
)
  ALTER TABLE dbo.ExpenseBooking ADD ApprovedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'ApprovedAt'
)
  ALTER TABLE dbo.ExpenseBooking ADD ApprovedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'RejectedBy'
)
  ALTER TABLE dbo.ExpenseBooking ADD RejectedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'RejectedAt'
)
  ALTER TABLE dbo.ExpenseBooking ADD RejectedAt DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'RejectionNote'
)
  ALTER TABLE dbo.ExpenseBooking ADD RejectionNote NVARCHAR(500) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'UpdatedBy'
)
  ALTER TABLE dbo.ExpenseBooking ADD UpdatedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'UpdatedAt'
)
  ALTER TABLE dbo.ExpenseBooking ADD UpdatedAt DATETIME2 NULL;
GO

-- ─────────────────────────────────────────────────────────────
-- VERIFY — Paste this output back to confirm all columns landed
-- ─────────────────────────────────────────────────────────────
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('PurchaseOrders','WorkOrderHeader','NewPayment','GoodsReceiptNotes','ExpenseBooking')
  AND COLUMN_NAME IN ('Status','ApprovedBy','ApprovedAt','RejectedBy','RejectedAt','RejectionNote','UpdatedBy','UpdatedAt')
ORDER BY TABLE_NAME, COLUMN_NAME;