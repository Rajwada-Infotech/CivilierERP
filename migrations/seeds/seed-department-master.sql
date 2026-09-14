-- Migration 270: Seed a starter set of departments into DepartmentMaster so
-- Task Master's Department dropdown isn't empty on first use.

INSERT INTO dbo.DepartmentMaster (DepartmentName, IsActive, CreatedAt)
SELECT v.DepartmentName, 1, SYSUTCDATETIME()
FROM (VALUES
  ('Accounts'),
  ('Administration'),
  ('CRM'),
  ('Engineering'),
  ('HR'),
  ('IT'),
  ('Legal'),
  ('Marketing'),
  ('Procurement'),
  ('Sales'),
  ('Site'),
  ('Stores')
) AS v(DepartmentName)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.DepartmentMaster d WHERE d.DepartmentName = v.DepartmentName
);
GO
