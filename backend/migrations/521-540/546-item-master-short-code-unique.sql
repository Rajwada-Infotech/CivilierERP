-- Migration 546: no two items share a short code (dbo.Item_Master_Group.M_code).
--
-- The Item Master routes now refuse a duplicate (case-insensitive, spaces ignored). This adds the same rule at the
-- database as a backstop: a unique index over ITEMS (Parent_Id IS NOT NULL — item groups share the table but are not
-- items) that have a short code. The column's collation is case-insensitive, so "cem" and "CEM" clash here too.
--
-- Items that already share a code from before this rule cannot be indexed. In that case NOTHING is changed: the
-- duplicates are listed below and the index is skipped, so an administrator can rename them and add the index
-- afterwards with the statement at the bottom of this file. The application check applies either way.

IF OBJECT_ID('dbo.Item_Master_Group', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ItemMaster_ShortCode' AND object_id = OBJECT_ID('dbo.Item_Master_Group'))
BEGIN
  IF EXISTS (
    SELECT 1 FROM dbo.Item_Master_Group
    WHERE Parent_Id IS NOT NULL AND M_code IS NOT NULL
    GROUP BY M_code HAVING COUNT(*) > 1
  )
  BEGIN
    PRINT 'Migration 546: SKIPPED the unique index — these item short codes are used by more than one item. Rename them, then create the index (see the end of this file):';
    SELECT M_code AS DuplicateShortCode, COUNT(*) AS Items
    FROM dbo.Item_Master_Group
    WHERE Parent_Id IS NOT NULL AND M_code IS NOT NULL
    GROUP BY M_code HAVING COUNT(*) > 1
    ORDER BY M_code;
  END
  ELSE
    EXEC('CREATE UNIQUE INDEX UX_ItemMaster_ShortCode ON dbo.Item_Master_Group(M_code) WHERE Parent_Id IS NOT NULL AND M_code IS NOT NULL');
END
GO

PRINT '546-item-master-short-code-unique applied successfully.';
GO

-- After renaming the duplicates:
--   CREATE UNIQUE INDEX UX_ItemMaster_ShortCode ON dbo.Item_Master_Group(M_code) WHERE Parent_Id IS NOT NULL AND M_code IS NOT NULL;
