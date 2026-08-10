-- Migration 304: allow multiple dbo.HSN rows to share the same HCode.
--
-- Bug: dbo.HSN was keyed by HCode alone (its primary key), so a second row
-- with an already-used code — e.g. HCode='3506' with HShortDescription=
-- 'CPVC SOLUTION' when '3506'/'UPVC SOLVENT' already existed — silently
-- failed to insert (PK violation) or appeared to do nothing. Real HSN
-- classifications routinely cover multiple product descriptions under one
-- code, so this needs to be legal.
--
-- Fix: add a surrogate identity PK (HId) and drop the uniqueness
-- constraint on HCode, keeping a plain (non-unique) index on HCode for
-- lookup performance. routes/hsn.js's PUT/DELETE now key off HId instead
-- of HCode.

-- ALTER TABLE ... ADD col IDENTITY automatically backfills every existing
-- row with a sequential number in one pass — no separate backfill needed
-- (and identity columns can't be UPDATEd directly without IDENTITY_INSERT).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HSN') AND name = 'HId')
BEGIN
  ALTER TABLE dbo.HSN ADD HId INT IDENTITY(1,1) NOT NULL;
END
GO

-- Drop whatever primary key currently sits on HCode (name varies by how the
-- table was originally created), then rebuild it on HId.
DECLARE @pkName NVARCHAR(200) = (
  SELECT kc.name
  FROM sys.key_constraints kc
  WHERE kc.parent_object_id = OBJECT_ID('dbo.HSN') AND kc.type = 'PK'
);
IF @pkName IS NOT NULL
BEGIN
  DECLARE @sql NVARCHAR(400) = N'ALTER TABLE dbo.HSN DROP CONSTRAINT ' + QUOTENAME(@pkName);
  EXEC sp_executesql @sql;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('dbo.HSN') AND type = 'PK'
)
BEGIN
  ALTER TABLE dbo.HSN ADD CONSTRAINT PK_HSN_HId PRIMARY KEY (HId);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_HSN_HCode' AND object_id = OBJECT_ID('dbo.HSN')
)
BEGIN
  CREATE INDEX IX_HSN_HCode ON dbo.HSN(HCode);
END
GO

PRINT '304-hsn-allow-duplicate-codes applied successfully.';
GO
