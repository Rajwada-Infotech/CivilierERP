const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

router.get("/", cache("cheque-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query("SELECT * FROM dbo.ChequeMaster");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const {
    CompanyId,
    BankId,
    AccountNumber,
    IFSCCode,
    ChequeLotNumber,
    ChequeStartNumber,
    ChequeEndNumber,
    Remarks,
    Status,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("BankId", sql.Int, BankId || null)
      .input("AccountNumber", sql.NVarChar, AccountNumber || null)
      .input("IFSCCode", sql.NVarChar, IFSCCode || null)
      .input("ChequeLotNumber", sql.NVarChar, ChequeLotNumber || null)
      .input("ChequeStartNumber", sql.BigInt, ChequeStartNumber || null)
      .input("ChequeEndNumber", sql.BigInt, ChequeEndNumber || null)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("CreatedBy", sql.Int, 1)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.ChequeMaster (
          CompanyId, BankId, AccountNumber, IFSCCode, ChequeLotNumber,
          ChequeStartNumber, ChequeEndNumber, Remarks,
          Status, CreatedBy, CreatedAt
        ) VALUES (
          @CompanyId, @BankId, @AccountNumber, @IFSCCode, @ChequeLotNumber,
          @ChequeStartNumber, @ChequeEndNumber, @Remarks,
          @Status, @CreatedBy, @CreatedAt
        )
      `);
    await bumpCacheVersion("cheque-master");
    res.json({ message: "Cheque lot added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  const {
    CompanyId,
    BankId,
    AccountNumber,
    IFSCCode,
    ChequeLotNumber,
    ChequeStartNumber,
    ChequeEndNumber,
    Remarks,
    Status,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("CId", sql.Int, req.params.id)
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("BankId", sql.Int, BankId || null)
      .input("AccountNumber", sql.NVarChar, AccountNumber || null)
      .input("IFSCCode", sql.NVarChar, IFSCCode || null)
      .input("ChequeLotNumber", sql.NVarChar, ChequeLotNumber || null)
      .input("ChequeStartNumber", sql.BigInt, ChequeStartNumber || null)
      .input("ChequeEndNumber", sql.BigInt, ChequeEndNumber || null)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("UpdatedBy", sql.Int, 1)
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.ChequeMaster SET
          CompanyId=@CompanyId, BankId=@BankId, AccountNumber=@AccountNumber,
          IFSCCode=@IFSCCode, ChequeLotNumber=@ChequeLotNumber,
          ChequeStartNumber=@ChequeStartNumber, ChequeEndNumber=@ChequeEndNumber,
          Remarks=@Remarks, Status=@Status,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE CId=@CId
      `);
    await bumpCacheVersion("cheque-master");
    res.json({ message: "Cheque lot updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("CId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.ChequeMaster WHERE CId=@CId");
    await bumpCacheVersion("cheque-master");
    res.json({ message: "Cheque lot deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
