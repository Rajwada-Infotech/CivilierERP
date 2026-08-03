-- =============================================================================
-- Hotfix: RoleRights — add CanPrint and CanExport columns
-- =============================================================================
-- Context:  Migration 173-seed-rights-widgets-baseline.sql referenced
--           CanPrint and CanExport but no earlier migration had added them,
--           causing the seed to fail on fresh deployments.
-- Applied:  Manually executed on 2026-07-26 (prod).
-- This file exists for documentation and to be idempotent on fresh deploys.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoleRights') AND name = 'CanPrint'
)
BEGIN
  ALTER TABLE dbo.RoleRights ADD CanPrint bit NOT NULL DEFAULT 0;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoleRights') AND name = 'CanExport'
)
BEGIN
  ALTER TABLE dbo.RoleRights ADD CanExport bit NOT NULL DEFAULT 0;
END;
