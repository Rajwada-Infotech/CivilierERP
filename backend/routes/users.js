const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all users
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      "SELECT id, name, email, role, created_datetime, discontinue FROM dbo.users"
    );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD user
router.post("/", async (req, res) => {
  const { name, email, role, password } = req.body;
  try {
    const pool = getPool();
    await pool.request()
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("role", sql.NVarChar, role || "user")
      .input("password", sql.NVarChar, password)
      .query(
        "INSERT INTO dbo.users (name, email, role, password, created_datetime, discontinue) VALUES (@name, @email, @role, @password, GETDATE(), 0)"
      );
    res.json({ message: "User added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE user
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, role, discontinue } = req.body;
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("role", sql.NVarChar, role)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0)
      .query(
        "UPDATE dbo.users SET name=@name, email=@email, role=@role, discontinue=@discontinue WHERE id=@id"
      );
    res.json({ message: "User updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE user
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.users WHERE id=@id");
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
