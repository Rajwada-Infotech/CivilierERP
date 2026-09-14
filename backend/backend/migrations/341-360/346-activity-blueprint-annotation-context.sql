-- Migration 346: Part B of the Blueprint Annotation Workflow — a second,
-- independently-versioned markup layer for Work Reporting (field engineers)
-- on the same blueprint the Work Allocation markup (Part A) already uses.
--
-- Reuses dbo.ActivityBlueprintAnnotation rather than a new table — a
-- 'reporting' row and an 'allocation' row for the same (rung, room) are
-- just two rows now, distinguished by Context, each with its own Version
-- for optimistic-concurrency and neither able to overwrite the other.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ActivityBlueprintAnnotation') AND name = 'Context'
)
BEGIN
  ALTER TABLE dbo.ActivityBlueprintAnnotation ADD
    Context NVARCHAR(20) NOT NULL
      CONSTRAINT DF_ActivityBlueprintAnnotation_Context DEFAULT 'allocation'
      CONSTRAINT CK_ActivityBlueprintAnnotation_Context CHECK (Context IN ('allocation', 'reporting'));
END
GO

-- Widen the uniqueness guarantee from (rung, room) to (rung, room, context)
-- now that two rows can legitimately exist for the same (rung, room).
IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UX_ActivityBlueprintAnnotation_Rung_Room' AND parent_object_id = OBJECT_ID('dbo.ActivityBlueprintAnnotation')
)
BEGIN
  ALTER TABLE dbo.ActivityBlueprintAnnotation DROP CONSTRAINT UX_ActivityBlueprintAnnotation_Rung_Room;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UX_ActivityBlueprintAnnotation_Rung_Room_Context' AND parent_object_id = OBJECT_ID('dbo.ActivityBlueprintAnnotation')
)
BEGIN
  ALTER TABLE dbo.ActivityBlueprintAnnotation
    ADD CONSTRAINT UX_ActivityBlueprintAnnotation_Rung_Room_Context UNIQUE (DependencyMasterActivityId, RoomId, Context);
END
GO
