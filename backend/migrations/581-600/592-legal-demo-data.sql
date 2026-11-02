-- 592 · Legal module sample data: two or three demo records in every section, so each screen can be tried.
-- Disabled: this migration used to insert Legal sample (demo) records for trying the screens. Sample data must
-- never reach a live database, so it now does nothing. The file stays so the migration list keeps its numbers;
-- databases that already ran it had the samples removed by 606 / 611 / 613.
SET NOCOUNT ON;
GO
