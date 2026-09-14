-- Payment Plan Master already scoped a plan by Company/Project/Block
-- (migration 182) but had no way to tie a plan to one specific Unit,
-- narrower than Block. Nullable, same convention as the other three scope
-- columns: NULL means "applies everywhere at this level".
ALTER TABLE dbo.CrmPaymentPlanTemplate ADD UnitId INT NULL;
