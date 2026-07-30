-- Migration 266: rename Task Master's priority codes to their full labels —
-- 'VVIP' -> 'Very Important', 'LI' -> 'Important', 'Normal' unchanged.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskMaster_Priority')
BEGIN
  ALTER TABLE dbo.TaskMaster DROP CONSTRAINT CK_TaskMaster_Priority;
END
GO

UPDATE dbo.TaskMaster SET Priority = 'Very Important' WHERE Priority = 'VVIP';
UPDATE dbo.TaskMaster SET Priority = 'Important' WHERE Priority = 'LI';
GO

ALTER TABLE dbo.TaskMaster
  ADD CONSTRAINT CK_TaskMaster_Priority CHECK (Priority IN ('Very Important','Important','Normal'));
GO
