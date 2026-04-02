const express = require("express")
const router = express.Router()
const { sql } = require("../db")

// GET all
router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query("SELECT * FROM dbo.enterprise")
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ADD
router.post("/", async (req, res) => {
  const {
    name, business_identity, business_type, b_sub_identity_type,
    belongs_to, logo, date_of_entry, date_of_establishment,
    currency, pan, cin, address, email, phone_number,
    tds_limit, description, gst_type, status, cr_code, discontinue
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("name", sql.NVarChar, name || null)
      .input("business_identity", sql.NVarChar, business_identity || null)
      .input("business_type", sql.NVarChar, business_type || null)
      .input("b_sub_identity_type", sql.NVarChar, b_sub_identity_type || null)
      .input("belongs_to", sql.Int, belongs_to || null)
      .input("logo", sql.NVarChar, logo || null)
      .input("date_of_entry", sql.Date, date_of_entry || null)
      .input("date_of_establishment", sql.Date, date_of_establishment || null)
      .input("currency", sql.NVarChar, currency || null)
      .input("pan", sql.NVarChar, pan || null)
      .input("cin", sql.NVarChar, cin || null)
      .input("address", sql.NVarChar, address || null)
      .input("email", sql.NVarChar, email || null)
      .input("phone_number", sql.NVarChar, phone_number || null)
      .input("tds_limit", sql.Decimal(18, 2), tds_limit || null)
      .input("description", sql.NVarChar, description || null)
      .input("gst_type", sql.NVarChar, gst_type || null)
      .input("status", sql.NVarChar, status || null)
      .input("cr_code", sql.NVarChar, cr_code || null)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0)
      .query(`
        INSERT INTO dbo.enterprise (
          name, business_identity, business_type, b_sub_identity_type,
          belongs_to, logo, date_of_entry, date_of_establishment,
          currency, pan, cin, address, email, phone_number,
          tds_limit, description, gst_type, status, cr_code, discontinue
        ) VALUES (
          @name, @business_identity, @business_type, @b_sub_identity_type,
          @belongs_to, @logo, @date_of_entry, @date_of_establishment,
          @currency, @pan, @cin, @address, @email, @phone_number,
          @tds_limit, @description, @gst_type, @status, @cr_code, @discontinue
        )
      `)
    res.json({ message: "Enterprise added successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const {
    name, business_identity, business_type, b_sub_identity_type,
    belongs_to, logo, date_of_entry, date_of_establishment,
    currency, pan, cin, address, email, phone_number,
    tds_limit, description, gst_type, status, cr_code, discontinue
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, name || null)
      .input("business_identity", sql.NVarChar, business_identity || null)
      .input("business_type", sql.NVarChar, business_type || null)
      .input("b_sub_identity_type", sql.NVarChar, b_sub_identity_type || null)
      .input("belongs_to", sql.Int, belongs_to || null)
      .input("logo", sql.NVarChar, logo || null)
      .input("date_of_entry", sql.Date, date_of_entry || null)
      .input("date_of_establishment", sql.Date, date_of_establishment || null)
      .input("currency", sql.NVarChar, currency || null)
      .input("pan", sql.NVarChar, pan || null)
      .input("cin", sql.NVarChar, cin || null)
      .input("address", sql.NVarChar, address || null)
      .input("email", sql.NVarChar, email || null)
      .input("phone_number", sql.NVarChar, phone_number || null)
      .input("tds_limit", sql.Decimal(18, 2), tds_limit || null)
      .input("description", sql.NVarChar, description || null)
      .input("gst_type", sql.NVarChar, gst_type || null)
      .input("status", sql.NVarChar, status || null)
      .input("cr_code", sql.NVarChar, cr_code || null)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0)
      .query(`
        UPDATE dbo.enterprise SET
          name=@name, business_identity=@business_identity,
          business_type=@business_type, b_sub_identity_type=@b_sub_identity_type,
          belongs_to=@belongs_to, logo=@logo,
          date_of_entry=@date_of_entry, date_of_establishment=@date_of_establishment,
          currency=@currency, pan=@pan, cin=@cin, address=@address,
          email=@email, phone_number=@phone_number, tds_limit=@tds_limit,
          description=@description, gst_type=@gst_type, status=@status,
          cr_code=@cr_code, discontinue=@discontinue
        WHERE id=@id
      `)
    res.json({ message: "Enterprise updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.enterprise WHERE id=@id")
    res.json({ message: "Enterprise deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router