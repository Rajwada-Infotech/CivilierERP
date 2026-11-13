-- Migration 664: wastage % on BOQ item lines. Amount = Qty x (1 + WastagePct / 100) x Rate (routes/boq.js).
-- Existing lines stay at 0 (no wastage), so their amounts don't change.
IF COL_LENGTH('dbo.BoqItems', 'WastagePct') IS NULL
  ALTER TABLE dbo.BoqItems ADD WastagePct DECIMAL(5,2) NOT NULL CONSTRAINT DF_BoqItems_WastagePct DEFAULT 0;
GO
