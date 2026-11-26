-- Migration 130: Rename "Inside Work" module to "Civil Work DPR"
--
-- Renames the PageDefinitions rows seeded by migrations 122/123/124:
--   insidework-dashboard -> civilworkdpr-dashboard
--   insidework-activity  -> civilworkdpr-activity
--   dependency-master     -> unchanged pageKey, just relabeled Module/GroupName
--
-- Safe to confirm before relying on it: as of this migration, no
-- RoleRights or UserPageRightsJson rows reference these pageKeys yet, so
-- this is a straight rename with nothing else to migrate.

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  UPDATE dbo.PageDefinitions
    SET PageKey = 'civilworkdpr-dashboard', Module = 'Civil Work DPR', GroupName = 'Civil Work DPR'
  WHERE PageKey = 'insidework-dashboard';

  UPDATE dbo.PageDefinitions
    SET PageKey = 'civilworkdpr-activity', Module = 'Civil Work DPR', GroupName = 'Civil Work DPR'
  WHERE PageKey = 'insidework-activity';

  UPDATE dbo.PageDefinitions
    SET Module = 'Civil Work DPR'
  WHERE PageKey = 'dependency-master' AND Module = 'Inside Work';

  PRINT 'Renamed Inside Work page definitions to Civil Work DPR';
END

-- RoleRights stores the pageKey in its SubModule column for some modules —
-- rename there too, defensively, in case any rows exist by the time this runs.
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RoleRights'
)
BEGIN
  UPDATE dbo.RoleRights SET SubModule = 'civilworkdpr-dashboard' WHERE SubModule = 'insidework-dashboard';
  UPDATE dbo.RoleRights SET SubModule = 'civilworkdpr-activity' WHERE SubModule = 'insidework-activity';
  UPDATE dbo.RoleRights SET Module = 'Civil Work DPR' WHERE Module = 'Inside Work';
END

-- UserPageRightsJson stores pageKeys inside a JSON array (RightsJson column,
-- e.g. {"page":"insidework-dashboard",...}) — string-replace the literal
-- quoted key. Safe here because we're replacing a quoted string VALUE with
-- another quoted string value of the same shape, not touching JSON
-- structure/delimiters.
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserPageRightsJson'
)
BEGIN
  UPDATE dbo.UserPageRightsJson
    SET RightsJson = REPLACE(RightsJson, '"page":"insidework-dashboard"', '"page":"civilworkdpr-dashboard"')
  WHERE RightsJson LIKE '%"page":"insidework-dashboard"%';

  UPDATE dbo.UserPageRightsJson
    SET RightsJson = REPLACE(RightsJson, '"page":"insidework-activity"', '"page":"civilworkdpr-activity"')
  WHERE RightsJson LIKE '%"page":"insidework-activity"%';
END

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Civil Work DPR'
ORDER BY SortOrder;
