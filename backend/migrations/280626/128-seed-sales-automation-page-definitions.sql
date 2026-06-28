-- Migration 128: Seed page definitions for Sales Automation module - Phase 1
-- (Social Media Master, Campaign Master, Ad Master).
--
-- Safe to re-run: every insert is guarded by NOT EXISTS on PageKey + IsActive=1
-- (same pattern as migration 121).

DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  Module    NVARCHAR(100),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, Module, GroupName, Actions, SortOrder) VALUES
(''sa-social-media'', ''Social Media Master'', ''Sales Automation'', ''Sales Automation Masters'', ''view,create,edit,delete,print,export'', 400),
(''sa-campaigns'',    ''Campaign Master'',     ''Sales Automation'', ''Sales Automation Masters'', ''view,create,edit,delete,print,export'', 410),
(''sa-ads'',          ''Ad Master'',           ''Sales Automation'', ''Sales Automation Masters'', ''view,create,edit,delete,print,export'', 420)
;

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT
  p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, ''migration-128'', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT ''Migration 128 complete - Sales Automation Phase 1 page keys seeded'';

SELECT PageKey, Label, Module, GroupName, IsActive
FROM dbo.PageDefinitions
WHERE PageKey IN (''sa-social-media'', ''sa-campaigns'', ''sa-ads'')
ORDER BY SortOrder;
GO
