const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const SALT_ROUNDS = 12;

// POST /api/users/login — verify hashed password
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(
        "SELECT id, name, email, role, password, discontinue FROM dbo.users WHERE email = @email"
      );
    const user = result.recordset[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (user.discontinue) return res.status(403).json({ error: "User is inactive" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    // 🔐 REMOVE PASSWORD
    const { password: _pw, ...safeUser } = user;

    // 🔥 CREATE TOKEN (with better structure)
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

// Audit log
    console.log(`User ${safeUser.email} logged in at ${new Date().toISOString()} from IP ${req.ip}`);

    // ✅ RESPONSE
    res.json({
      success: true,
      token,
      user: safeUser
    });

  } catch (err) {
    console.error("Login Error:", err); // ✅ important for debugging
    res.status(500).json({ error: "Internal server error" });
  }
});

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

// POST /api/users — create user with hashed password
router.post("/", async (req, res) => {
  const { name, email, role, password } = req.body;
  if (!password) return res.status(400).json({ error: "Password is required" });
  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const pool = getPool();
    await pool
      .request()
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("role", sql.NVarChar, role || "user")
      .input("password", sql.NVarChar, hashedPassword)
      .query(
        "INSERT INTO dbo.users (name, email, role, password, created_datetime, discontinue) VALUES (@name, @email, @role, @password, GETDATE(), 0)"
      );
    res.json({ message: "User added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — update user (no password update here)
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, role, discontinue } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
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

// DELETE /api/users/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.users WHERE id=@id");
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
