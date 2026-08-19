-- Migration 345: Blueprint Annotation Workflow — one row per (rung, room)
-- pair, so two activities in the same chain that reference the same room's
-- blueprint (e.g. Fixture Installation and Electrical Wiring) each carry
-- their own independent markup, never sharing or overwriting each other's.
--
-- RoomId points at the same dbo.RoomMaster row that already stores the
-- blueprint itself (BlueprintFileName/MimeType/FileData, see migration
-- 343/344) — no separate LocationBlueprints table needed, Room Master
-- already is the location's blueprint store.
--
-- DependencyMasterActivityId follows the exact same FK/CASCADE/UNIQUE
-- convention as dbo.DependencyActivityAssignment (migration 333's
-- FK_DependencyActivityAssignment_Rung) — a chain save always
-- delete+reinserts its DependencyMasterActivity rows (see
-- dependencyMaster.js's PUT /:id), so an annotation is tied to the current
-- rung row's lifetime the same way engineer/material assignments already
-- are; ON DELETE CASCADE cleans it up automatically when that happens.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ActivityBlueprintAnnotation' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ActivityBlueprintAnnotation (
    Id                          INT IDENTITY(1,1) PRIMARY KEY,
    DependencyMasterActivityId INT NOT NULL,
    RoomId                      INT NOT NULL,
    -- Serialized array of Konva shape objects (freehand/rect/arrow/ellipse/text).
    ShapesJson                  NVARCHAR(MAX) NULL,
    -- Flattened PNG snapshot (stage.toDataURL(), base64 without the data:
    -- prefix) for the "Marked" thumbnail preview — avoids re-rendering the
    -- full Konva stage just to show a small preview.
    ThumbnailBase64              NVARCHAR(MAX) NULL,
    -- Bumped on every save; the client sends back the version it loaded so
    -- a stale save (someone else annotated the same rung meanwhile) can be
    -- rejected with a conflict instead of silently overwriting.
    Version                     INT NOT NULL DEFAULT 1,
    UpdatedBy                   NVARCHAR(200) NULL,
    UpdatedAt                   DATETIME2(3) NULL,
    CONSTRAINT FK_ActivityBlueprintAnnotation_Rung
      FOREIGN KEY (DependencyMasterActivityId) REFERENCES dbo.DependencyMasterActivity(Id) ON DELETE CASCADE,
    CONSTRAINT FK_ActivityBlueprintAnnotation_Room
      FOREIGN KEY (RoomId) REFERENCES dbo.RoomMaster(Id),
    CONSTRAINT UX_ActivityBlueprintAnnotation_Rung_Room UNIQUE (DependencyMasterActivityId, RoomId)
  );
END
GO
