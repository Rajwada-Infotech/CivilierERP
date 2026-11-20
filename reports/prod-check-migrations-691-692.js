// Production check for the part-plot resale (migration 691) and customer phone notifications (migration 692).
// Paste into Admin → Script Console. Read-only by default. Only if section 2 shows "NO", set APPLY=1 in Environment
// Variables and run again, then once more without APPLY to confirm.
const { connectDB, getPool, closeDB } = require("./db");
(async () => {
  await connectDB();
  const q = async (t) => (await getPool().request().query(t)).recordset;
  console.log("1. Migrations recorded");
  console.table(await q(`SELECT name, applied_at FROM dbo.__Migrations
    WHERE name LIKE '670-%' OR name LIKE '677-%' OR name LIKE '690-%' OR name LIKE '691-%' OR name LIKE '692-%' ORDER BY name`));
  console.log("2. What they changed");
  console.table(await q(`SELECT
    CASE WHEN COL_LENGTH('dbo.CrmUnitResale','PlotIds') IS NOT NULL THEN 'yes' ELSE 'NO' END AS [691 resale PlotIds],
    CASE WHEN COL_LENGTH('dbo.PushDeviceToken','PortalUserId') IS NOT NULL THEN 'yes' ELSE 'NO' END AS [692 PortalUserId],
    CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PushDeviceToken') AND name = 'UserId' AND is_nullable = 1) THEN 'yes' ELSE 'NO' END AS [692 UserId optional],
    CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PushDeviceToken_Owner') THEN 'yes' ELSE 'NO' END AS [692 one owner rule],
    CASE WHEN COL_LENGTH('dbo.CrmMilestoneMaster','DprGroupId') IS NULL THEN 'yes' ELSE 'NO' END AS [677 DPR link dropped]`));
  console.log("3. Phones registered (staff / customers)");
  console.table(await q(`IF COL_LENGTH('dbo.PushDeviceToken','PortalUserId') IS NOT NULL
      EXEC('SELECT SUM(CASE WHEN UserId IS NOT NULL THEN 1 ELSE 0 END) AS StaffPhones, SUM(CASE WHEN PortalUserId IS NOT NULL THEN 1 ELSE 0 END) AS CustomerPhones FROM dbo.PushDeviceToken')
    ELSE SELECT COUNT(*) AS StaffPhones, NULL AS CustomerPhones FROM dbo.PushDeviceToken`));
  if (process.env.APPLY === "1") {
    await q(`IF COL_LENGTH('dbo.CrmUnitResale','PlotIds') IS NULL ALTER TABLE dbo.CrmUnitResale ADD PlotIds NVARCHAR(400) NULL`);
    await q(`IF COL_LENGTH('dbo.PushDeviceToken','PortalUserId') IS NULL ALTER TABLE dbo.PushDeviceToken ADD PortalUserId INT NULL`);
    await q(`IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PushDeviceToken') AND name = 'UserId' AND is_nullable = 0)
             BEGIN
               IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_User' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
                 DROP INDEX IX_PushDeviceToken_User ON dbo.PushDeviceToken;
               ALTER TABLE dbo.PushDeviceToken ALTER COLUMN UserId INT NULL;
             END`);
    await q(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_User' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
               CREATE INDEX IX_PushDeviceToken_User ON dbo.PushDeviceToken (UserId)`);
    await q(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_PortalUser' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
               CREATE INDEX IX_PushDeviceToken_PortalUser ON dbo.PushDeviceToken (PortalUserId) WHERE PortalUserId IS NOT NULL`);
    await q(`IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PushDeviceToken_Owner')
               ALTER TABLE dbo.PushDeviceToken ADD CONSTRAINT CK_PushDeviceToken_Owner
                 CHECK ((UserId IS NOT NULL AND PortalUserId IS NULL) OR (UserId IS NULL AND PortalUserId IS NOT NULL))`);
    console.log("APPLIED: 691 / 692 changes ensured — now run again without APPLY to verify");
  } else console.log("Read-only run. Only if section 2 shows NO: set APPLY=1 and run again.");
  await closeDB?.();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
