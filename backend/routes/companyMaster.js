const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET all
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT * FROM dbo.CompanyMaster WHERE IsDeleted = 0 ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Code", sql.NVarChar(50), f.code || null)
      .input("Name", sql.NVarChar(255), f.name || null)
      .input("LegalName", sql.NVarChar(255), f.legalName || null)
      .input("ShortName", sql.NVarChar(100), f.shortName || null)
      .input("Type", sql.NVarChar(100), f.type || null)
      .input("Industry", sql.NVarChar(100), f.industry || null)
      .input("IncorporationDate", sql.Date, f.incorporationDate || null)
      .input("CIN", sql.NVarChar(50), f.cinNumber || null)
      .input("PAN", sql.NVarChar(20), f.panNumber || null)
      .input("TAN", sql.NVarChar(20), f.tanNumber || null)
      .input("GST", sql.NVarChar(20), f.gstNumber || null)
      .input("GSTType", sql.NVarChar(50), f.gstType || null)
      .input("GSTDate", sql.Date, f.gstDate || null)
      .input("TradeLicenseNo", sql.NVarChar(100), f.tradeLicenseNo || null)
      .input("TradeLicenseDate", sql.Date, f.tradeLicenseDate || null)
      .input(
        "RegisteredAddress",
        sql.NVarChar(500),
        f.registeredAddress || null,
      )
      .input("City", sql.NVarChar(100), f.city || null)
      .input("State", sql.NVarChar(100), f.state || null)
      .input("Country", sql.NVarChar(100), f.country || null)
      .input("Pincode", sql.NVarChar(10), f.pincode || null)
      .input("Phone", sql.NVarChar(30), f.phone || null)
      .input("Fax", sql.NVarChar(30), f.fax || null)
      .input("Email", sql.NVarChar(200), f.email || null)
      .input("Website", sql.NVarChar(255), f.website || null)
      .input(
        "AuthorizedCapital",
        sql.Decimal(18, 2),
        f.authorizedCapital || null,
      )
      .input("PaidUpCapital", sql.Decimal(18, 2), f.paidUpCapital || null)
      .input("Currency", sql.NVarChar(10), f.currency || "INR")
      .input("FiscalYearStart", sql.NVarChar(20), f.fiscalYearStart || null)
      .input("AuditorName", sql.NVarChar(200), f.auditorName || null)
      .input("IsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .input("Remarks", sql.NVarChar(500), f.remarks || null)
      .input("LogoUrl", sql.NVarChar(sql.MAX), f.logoUrl || null).query(`
        INSERT INTO dbo.CompanyMaster
          (Code,Name,LegalName,ShortName,Type,Industry,IncorporationDate,
           CIN,PAN,TAN,GST,GSTType,GSTDate,TradeLicenseNo,TradeLicenseDate,
           RegisteredAddress,City,State,Country,Pincode,Phone,Fax,Email,Website,
           AuthorizedCapital,PaidUpCapital,Currency,FiscalYearStart,AuditorName,
           IsActive,Remarks,LogoUrl,IsDeleted,CreatedAt)
        VALUES
          (@Code,@Name,@LegalName,@ShortName,@Type,@Industry,@IncorporationDate,
           @CIN,@PAN,@TAN,@GST,@GSTType,@GSTDate,@TradeLicenseNo,@TradeLicenseDate,
           @RegisteredAddress,@City,@State,@Country,@Pincode,@Phone,@Fax,@Email,@Website,
           @AuthorizedCapital,@PaidUpCapital,@Currency,@FiscalYearStart,@AuditorName,
           @IsActive,@Remarks,@LogoUrl,0,GETDATE())
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("Code", sql.NVarChar(50), f.code || null)
      .input("Name", sql.NVarChar(255), f.name || null)
      .input("LegalName", sql.NVarChar(255), f.legalName || null)
      .input("ShortName", sql.NVarChar(100), f.shortName || null)
      .input("Type", sql.NVarChar(100), f.type || null)
      .input("Industry", sql.NVarChar(100), f.industry || null)
      .input("IncorporationDate", sql.Date, f.incorporationDate || null)
      .input("CIN", sql.NVarChar(50), f.cinNumber || null)
      .input("PAN", sql.NVarChar(20), f.panNumber || null)
      .input("TAN", sql.NVarChar(20), f.tanNumber || null)
      .input("GST", sql.NVarChar(20), f.gstNumber || null)
      .input("GSTType", sql.NVarChar(50), f.gstType || null)
      .input("GSTDate", sql.Date, f.gstDate || null)
      .input("TradeLicenseNo", sql.NVarChar(100), f.tradeLicenseNo || null)
      .input("TradeLicenseDate", sql.Date, f.tradeLicenseDate || null)
      .input(
        "RegisteredAddress",
        sql.NVarChar(500),
        f.registeredAddress || null,
      )
      .input("City", sql.NVarChar(100), f.city || null)
      .input("State", sql.NVarChar(100), f.state || null)
      .input("Country", sql.NVarChar(100), f.country || null)
      .input("Pincode", sql.NVarChar(10), f.pincode || null)
      .input("Phone", sql.NVarChar(30), f.phone || null)
      .input("Fax", sql.NVarChar(30), f.fax || null)
      .input("Email", sql.NVarChar(200), f.email || null)
      .input("Website", sql.NVarChar(255), f.website || null)
      .input(
        "AuthorizedCapital",
        sql.Decimal(18, 2),
        f.authorizedCapital || null,
      )
      .input("PaidUpCapital", sql.Decimal(18, 2), f.paidUpCapital || null)
      .input("Currency", sql.NVarChar(10), f.currency || "INR")
      .input("FiscalYearStart", sql.NVarChar(20), f.fiscalYearStart || null)
      .input("AuditorName", sql.NVarChar(200), f.auditorName || null)
      .input("IsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .input("Remarks", sql.NVarChar(500), f.remarks || null)
      .input("LogoUrl", sql.NVarChar(sql.MAX), f.logoUrl || null).query(`
        UPDATE dbo.CompanyMaster SET
          Code=@Code, Name=@Name, LegalName=@LegalName, ShortName=@ShortName,
          Type=@Type, Industry=@Industry, IncorporationDate=@IncorporationDate,
          CIN=@CIN, PAN=@PAN, TAN=@TAN,
          GST=@GST, GSTType=@GSTType, GSTDate=@GSTDate,
          TradeLicenseNo=@TradeLicenseNo, TradeLicenseDate=@TradeLicenseDate,
          RegisteredAddress=@RegisteredAddress, City=@City, State=@State,
          Country=@Country, Pincode=@Pincode, Phone=@Phone, Fax=@Fax,
          Email=@Email, Website=@Website,
          AuthorizedCapital=@AuthorizedCapital, PaidUpCapital=@PaidUpCapital,
          Currency=@Currency, FiscalYearStart=@FiscalYearStart, AuditorName=@AuditorName,
          IsActive=@IsActive, Remarks=@Remarks, LogoUrl=@LogoUrl, UpdatedAt=GETDATE()
        WHERE Id=@Id AND IsDeleted=0
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE (soft)
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(
        "UPDATE dbo.CompanyMaster SET IsDeleted=1, UpdatedAt=GETDATE() WHERE Id=@Id",
      );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
