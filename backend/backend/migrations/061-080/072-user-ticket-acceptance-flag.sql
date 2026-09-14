IF COL_LENGTH('dbo.users', 'can_accept_tickets') IS NULL
BEGIN
  ALTER TABLE dbo.users
    ADD can_accept_tickets BIT NOT NULL
      CONSTRAINT DF_users_can_accept_tickets DEFAULT (0);
END;
