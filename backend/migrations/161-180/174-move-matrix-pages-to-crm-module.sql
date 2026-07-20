-- Unit Matrix / Parking Matrix moved from the Follow-Up module into the CRM
-- module (own sidebar menu "Matrix" with Unit Matrix / Parking Matrix
-- submenus). Re-key the existing PageDefinitions rows so Menu Rights/admin
-- tooling reflects the new home, and so marketing_head (who is scoped to
-- crm-*/sa-* pages, not followup-*) can see them like every other CRM page.
UPDATE dbo.PageDefinitions
SET PageKey = 'crm-unit-matrix', Module = 'CRM', GroupName = 'CRM'
WHERE PageKey = 'followup-unit-matrix';

UPDATE dbo.PageDefinitions
SET PageKey = 'crm-parking-matrix', Module = 'CRM', GroupName = 'CRM'
WHERE PageKey = 'followup-parking-matrix';
GO
