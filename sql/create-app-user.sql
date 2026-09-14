/*
  Creates the restricted SQL Server principal used by the application at runtime.

  Run this once as a database administrator after replacing the SQLCMD variables:

    sqlcmd -S <server> -d CivilierERP -U sa -P <rotated-sa-password> ^
      -v AppLogin="civilier_app" AppPassword="<strong-random-password>" ^
      -i backend/sql/create-app-user.sql

  Keep migrations on a separate admin/migration identity. The app account should
  not be used for schema changes.
*/

:setvar AppLogin "civilier_app"
:setvar AppPassword "REPLACE_WITH_STRONG_RANDOM_PASSWORD"

IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'$(AppLogin)')
BEGIN
  DECLARE @createLogin nvarchar(max) =
    N'CREATE LOGIN ' + QUOTENAME(N'$(AppLogin)') +
    N' WITH PASSWORD = ' + QUOTENAME(N'$(AppPassword)', '''') + N', CHECK_POLICY = ON, CHECK_EXPIRATION = ON;';
  EXEC (@createLogin);
END;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AppLogin)')
BEGIN
  DECLARE @createUser nvarchar(max) =
    N'CREATE USER ' + QUOTENAME(N'$(AppLogin)') + N' FOR LOGIN ' + QUOTENAME(N'$(AppLogin)') + N';';
  EXEC (@createUser);
END;

ALTER ROLE db_datareader ADD MEMBER [$(AppLogin)];
ALTER ROLE db_datawriter ADD MEMBER [$(AppLogin)];
GRANT EXECUTE TO [$(AppLogin)];
