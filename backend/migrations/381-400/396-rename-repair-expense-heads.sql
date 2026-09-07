-- Renames the two repair expense heads seeded by migrations 394/395 to make
-- the direct/indirect split explicit in the name itself, per user request:
--   "Repair Expense A/c"      -> "Indirect Repair Expense A/c"
--   "Site Repair Expense A/c" -> "Direct Repair Expense A/c"
-- Groups/placement unchanged (Indirect Expenses / Construction Expenses).

UPDATE dbo.AccountHeadMaster
   SET LHeadName = 'Indirect Repair Expense A/c'
 WHERE LHeadName = 'Repair Expense A/c' AND LHeadType = 'GL';

UPDATE dbo.AccountHeadMaster
   SET LHeadName = 'Direct Repair Expense A/c'
 WHERE LHeadName = 'Site Repair Expense A/c' AND LHeadType = 'GL';

PRINT 'Renamed repair expense heads to Indirect/Direct Repair Expense A/c.';
