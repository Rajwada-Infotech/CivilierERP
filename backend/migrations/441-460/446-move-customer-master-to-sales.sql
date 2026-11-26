-- Migration 446: move Customer Master from Finance to Sales in Menu Rights.
--
-- A Customer is who a Sale Order/Invoice is raised against — belongs with
-- the pages that actually use it, not under Finance. Matches the same move
-- in the TopNavbar's own Setup dropdown (customer-master moved from
-- financeSetupItems to a new salesSetupItems array).
--
-- Cosmetic only — PageDefinitions.Module/GroupName only drive the Menu
-- Rights UI's grouping, not access control (that's RoleRights.Module/
-- SubModule, a separate table), so this doesn't touch any existing grant.

UPDATE dbo.PageDefinitions SET Module = 'Sales' WHERE PageKey = 'customer-master';

PRINT 'Moved customer-master from Finance to Sales';
GO
