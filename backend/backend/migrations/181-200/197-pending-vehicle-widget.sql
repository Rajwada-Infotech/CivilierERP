-- Adds the "Pending Vehicle In/Out" widget to the catalog — surfaces POs
-- that still have goods outstanding after one or more partial Vehicle
-- In/Out lots, so a user can see at a glance how many vehicles are still
-- expected and jump straight to the last lot logged against that PO.
MERGE dbo.WidgetCatalog AS target
USING (VALUES
  ('Pending Vehicle In/Out', 'Pending Vehicle In/Out', 'truck', 'Alerts', 'POs with goods still outstanding after partial Vehicle In/Out deliveries', 75)
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

PRINT 'Pending Vehicle In/Out widget seeded.';
