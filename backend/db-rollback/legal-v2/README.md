# Legal V2 / V2.1 rollback scripts

Run by hand (SSMS / sqlcmd), newest first, only to undo migrations 715–719. They are kept out of `backend/migrations`
on purpose: the migration runner applies every `.sql` under that folder.

1. Take a database backup first.
2. Run in this order: `719-down.sql`, `718-down.sql`, `717-down.sql`, `716-down.sql`, `715-down.sql` (stop where you want to land).
3. Remove the matching rows from the migration log (`SequelizeMeta` / the Umzug table) so `migrate.js up` can re-apply them later.
4. Deploy the code version that matches the schema you rolled back to.

`715-down.sql` and `716-down.sql` **delete all legal verification data** (workspaces, activities, entries, history).
`719-down.sql` keeps every LegalMutation row; conversions (Kind = 'Conversion') are kept but become plain rows — delete them first if they must go.
