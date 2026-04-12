const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { redisGet, redisSet, redisDel } = require("../redis");
const { blacklistToken } = require("../middleware/blacklist");
const authMiddleware = require("../middleware/auth");

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

// POST /api/users/login — public
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const lockKey = `login:lock:${email.toLowerCase()}`;
  const attemptsKey = `login:attempts:${email.toLowerCase()}`;

  try {
    // Check lockout
    const locked = await redisGet(lockKey);
    if (locked) {
      return res.status(429).json({
        error:
          "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.",
      });
    }

    const pool = getPool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(
        "SELECT id, name, email, role, password, discontinue FROM dbo.users WHERE email = @email",
      );
    const user = result.recordset[0];

    if (!user) {
      await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (user.discontinue)
      return res.status(403).json({ error: "User is inactive" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Success — clear failed attempt counters
    await redisDel(attemptsKey);
    await redisDel(lockKey);

    const { password: _pw, ...safeUser } = user;

    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    console.log(
      `User ${safeUser.email} logged in at ${new Date().toISOString()} from IP ${req.ip}`,
    );

    res.json({ success: true, token, user: safeUser });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function incrementLoginAttempts(attemptsKey, lockKey) {
  try {
    const attempts = parseInt((await redisGet(attemptsKey)) || "0") + 1;
    await redisSet(attemptsKey, String(attempts), LOCKOUT_SECONDS);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await redisSet(lockKey, "1", LOCKOUT_SECONDS);
      console.warn(
        `Account locked after ${attempts} failed attempts: ${attemptsKey}`,
      );
    }
  } catch {
    // Redis down — skip lockout silently
  }
}

// POST /api/users/logout — public (token required in body)
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    const token = req.token;
    const exp = req.user?.exp;
    if (token && exp) {
      await blacklistToken(token, exp);
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Logout failed" });
  }
});

// GET all users — Fix: was unprotected; any anonymous caller could list all users + roles
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query(
        "SELECT id, name, email, role, created_datetime, discontinue FROM dbo.users",
      );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — Fix: was unprotected; anyone could self-register as admin
router.post("/", authMiddleware, async (req, res) => {
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
        "INSERT INTO dbo.users (name, email, role, password, created_datetime, discontinue) VALUES (@name, @email, @role, @password, GETDATE(), 0)",
      );
    res.json({ message: "User added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — Fix: was unprotected; anyone could change any user's role
router.put("/:id", authMiddleware, async (req, res) => {
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
        "UPDATE dbo.users SET name=@name, email=@email, role=@role, discontinue=@discontinue WHERE id=@id",
      );
    res.json({ message: "User updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id — Fix: was unprotected; anyone could delete any user
router.delete("/:id", authMiddleware, async (req, res) => {
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
