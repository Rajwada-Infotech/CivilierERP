-- Migration 677: Employee Portal credentials are separate from the ERP login.
-- Until now an employee's portal login was a dbo.users row matched on the employee's e-mail, so an e-mail that already had an
-- ERP login (marketing_head, super_admin, ...) could not get a portal login. Now the portal login is its own credential:
--   * dbo.EmployeePortalLogin links an Employee Master record to ITS OWN dbo.users row (role "Employee Portal").
--   * That row's e-mail is a private placeholder (employee-<id>@portal.invalid), so it never collides with, or signs in as,
--     the ERP login that uses the real e-mail. The employee still types their real e-mail at the Employee Portal; the
--     server finds their portal credential through the link.
--   * The portal password and the ERP password are different rows: changing one never touches the other.
-- Portal logins that already exist are linked (matched on e-mail) and moved to the placeholder e-mail; their password stays.

IF OBJECT_ID('dbo.EmployeePortalLogin', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeePortalLogin (
    EmployeeId  INT NOT NULL CONSTRAINT PK_EmployeePortalLogin PRIMARY KEY,
    UserId      INT NOT NULL,
    CreatedAt   DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeePortalLogin_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_EmployeePortalLogin_User UNIQUE (UserId),
    CONSTRAINT FK_EmployeePortalLogin_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster (EmployeeId) ON DELETE CASCADE,
    CONSTRAINT FK_EmployeePortalLogin_User FOREIGN KEY (UserId) REFERENCES dbo.users (id) ON DELETE CASCADE
  );
END
GO

-- Link the portal logins that already exist (one active employee with that e-mail), then give them the placeholder e-mail.
INSERT INTO dbo.EmployeePortalLogin (EmployeeId, UserId)
SELECT e.EmployeeId, u.id
FROM dbo.users u
JOIN dbo.Role r ON r.RId = u.RoleId AND LOWER(r.RName) = N'employee portal'
JOIN dbo.EmployeeMaster e ON e.IsActive = 1 AND LOWER(LTRIM(RTRIM(e.Email))) = LOWER(LTRIM(RTRIM(u.email)))
WHERE NOT EXISTS (SELECT 1 FROM dbo.EmployeePortalLogin l WHERE l.UserId = u.id OR l.EmployeeId = e.EmployeeId)
  AND (SELECT COUNT(*) FROM dbo.EmployeeMaster e2 WHERE e2.IsActive = 1 AND LOWER(LTRIM(RTRIM(e2.Email))) = LOWER(LTRIM(RTRIM(u.email)))) = 1;
GO

UPDATE u SET u.email = CONCAT(N'employee-', l.EmployeeId, N'@portal.invalid')
FROM dbo.users u
JOIN dbo.EmployeePortalLogin l ON l.UserId = u.id
WHERE u.email <> CONCAT(N'employee-', l.EmployeeId, N'@portal.invalid');
GO

PRINT '677-employee-portal-own-credentials applied successfully.';
GO
