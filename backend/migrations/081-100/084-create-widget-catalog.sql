IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'WidgetCatalog'
)
BEGIN
  CREATE TABLE dbo.WidgetCatalog (
    WidgetKey NVARCHAR(100) NOT NULL PRIMARY KEY,
    Label NVARCHAR(100) NOT NULL,
    IconKey NVARCHAR(50) NOT NULL,
    Category NVARCHAR(50) NOT NULL,
    Description NVARCHAR(255) NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_WidgetCatalog_SortOrder DEFAULT 0,
    IsActive BIT NOT NULL CONSTRAINT DF_WidgetCatalog_IsActive DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WidgetCatalog_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NULL
  );
END;

MERGE dbo.WidgetCatalog AS target
USING (VALUES
  ('Bar Chart', 'Bar Chart', 'bar-chart-2', 'Charts', 'System activity bar chart, last 7 days', 10),
  ('Line Chart', 'Line Chart', 'trending-up', 'Charts', 'Tasks vs activity trend line chart', 20),
  ('Pie Chart', 'Pie Chart', 'pie-chart', 'Charts', 'Task status breakdown pie chart', 30),
  ('Stat Card', 'Stat Card', 'hash', 'KPIs', 'Key metrics summary cards', 40),
  ('Data Table', 'Data Table', 'table-2', 'Data', 'Tabular data view with sorting', 50),
  ('Calendar', 'Calendar', 'calendar', 'Planning', 'Calendar view of tasks and events', 60),
  ('Notifications', 'Notifications', 'bell', 'Alerts', 'System alerts and notifications', 70),
  ('Activity Feed', 'Activity Feed', 'message-square', 'Activity', 'Live user activity stream', 80),
  ('Map View', 'Map View', 'map', 'Geo', 'Geographic site map view', 90),
  ('File Uploader', 'File Uploader', 'paperclip', 'Tools', 'Quick file upload widget', 100),
  ('Progress Ring', 'Progress Ring', 'refresh-cw', 'KPIs', 'Task completion progress rings', 110),
  ('Calculator', 'Calculator', 'calculator', 'Tools', 'Built-in calculator tool', 120)
) AS source (WidgetKey, Label, IconKey, Category, Description, SortOrder)
ON target.WidgetKey = source.WidgetKey
WHEN MATCHED THEN
  UPDATE SET
    Label = source.Label,
    IconKey = source.IconKey,
    Category = source.Category,
    Description = source.Description,
    SortOrder = source.SortOrder,
    IsActive = 1,
    UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive)
  VALUES (source.WidgetKey, source.Label, source.IconKey, source.Category, source.Description, source.SortOrder, 1);

PRINT 'WidgetCatalog created and seeded.';
