-- Migration 543: tidy the Civil Work DPR page definitions found in the page-key audit.
--
-- 1. civilworkdpr-room-master had two PageDefinitions rows: the live one (group "Setup") and a retired
--    duplicate (group "Civil Work DPR Setup", IsActive = 0). Nothing references PageDefinitions by id, so the
--    retired row is simply removed.
-- 2. One role grant for Room Master was saved as Module "Civil Work DPR" / SubModule "civilworkdpr-room-master";
--    Role Master writes every other Civil Work DPR grant as "civilworkdpr room master" for both columns. Both
--    resolve to the same page key, but the legacy spelling is rewritten so the data is uniform (merged into an
--    existing row if the role already has one).
-- 3. Unique, stable Rights-admin order for the module's pages (several shared 14 and 16). Same order as the
--    module's sidebar.

-- 1 ───────────────────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PageDefinitions' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  DELETE FROM dbo.PageDefinitions
  WHERE PageKey = 'civilworkdpr-room-master'
    AND IsActive = 0
    AND EXISTS (SELECT 1 FROM dbo.PageDefinitions a WHERE a.PageKey = 'civilworkdpr-room-master' AND a.IsActive = 1);
END
GO

-- 2 ───────────────────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RoleRights' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  -- Roles that already have the canonical row: fold the legacy row's flags into it, then drop the legacy row.
  UPDATE c
  SET CanView = CASE WHEN c.CanView = 1 OR l.CanView = 1 THEN 1 ELSE 0 END,
      CanAdd = CASE WHEN c.CanAdd = 1 OR l.CanAdd = 1 THEN 1 ELSE 0 END,
      CanEdit = CASE WHEN c.CanEdit = 1 OR l.CanEdit = 1 THEN 1 ELSE 0 END,
      CanDelete = CASE WHEN c.CanDelete = 1 OR l.CanDelete = 1 THEN 1 ELSE 0 END,
      CanPrint = CASE WHEN c.CanPrint = 1 OR l.CanPrint = 1 THEN 1 ELSE 0 END,
      CanExport = CASE WHEN c.CanExport = 1 OR l.CanExport = 1 THEN 1 ELSE 0 END,
      CanPostApproval = CASE WHEN c.CanPostApproval = 1 OR l.CanPostApproval = 1 THEN 1 ELSE 0 END
  FROM dbo.RoleRights c
  JOIN dbo.RoleRights l ON l.RoleId = c.RoleId
  WHERE c.Module = 'civilworkdpr room master' AND c.SubModule = 'civilworkdpr room master'
    AND l.Module = 'Civil Work DPR' AND l.SubModule = 'civilworkdpr-room-master';

  DELETE l
  FROM dbo.RoleRights l
  WHERE l.Module = 'Civil Work DPR' AND l.SubModule = 'civilworkdpr-room-master'
    AND EXISTS (SELECT 1 FROM dbo.RoleRights c WHERE c.RoleId = l.RoleId
                AND c.Module = 'civilworkdpr room master' AND c.SubModule = 'civilworkdpr room master');

  -- Roles with only the legacy row: rewrite it in place.
  UPDATE dbo.RoleRights
  SET Module = 'civilworkdpr room master', SubModule = 'civilworkdpr room master'
  WHERE Module = 'Civil Work DPR' AND SubModule = 'civilworkdpr-room-master';
END
GO

-- 3 ───────────────────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PageDefinitions' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  UPDATE dbo.PageDefinitions SET SortOrder = v.so
  FROM dbo.PageDefinitions pd
  JOIN (VALUES
    ('civilworkdpr-work-done', 11),
    ('civilworkdpr-work-transfer', 12),
    ('civilworkdpr-activity-reporting', 13),
    ('civilworkdpr-quality-check', 14),
    ('civilworkdpr-dependency', 15),
    ('civilworkdpr-worker-attendance', 16),
    ('civilworkdpr-amendment', 17),
    ('civilworkdpr-daily-labour', 18)
  ) AS v(pk, so) ON v.pk = pd.PageKey
  WHERE pd.IsActive = 1 AND pd.SortOrder <> v.so;
END
GO

PRINT '543-civilworkdpr-page-defs-tidy applied successfully.';
GO
