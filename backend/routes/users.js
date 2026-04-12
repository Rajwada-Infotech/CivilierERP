const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { redisGet, redisSet, redisDel } = require("../redis");
const { blacklistToken } = require("../middleware/blacklist");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

const ADMIN_ROLES = ["admin", "super_admin"];
const adminOnly = allowRoles(...ADMIN_ROLES);

// ======================
//  LOGIN (Public)
// ======================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const lockKey = `login:lock:${email.toLowerCase()}`;
  const attemptsKey = `login:attempts:${email.toLowerCase()}`;

  try {
    // Check if account is locked
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

    if (user.discontinue) {
      return res.status(403).json({ error: "User is inactive" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Successful login - reset attempts
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

// Helper function
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
  } catch (e) {
    // Redis unavailable - fail silently
  }
}

// ======================
//  LOGOUT
// ======================
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

// ======================
//  ADMIN ONLY ROUTES
// ======================

// GET all users - Admin only
router.get("/", authMiddleware, adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query(
        "SELECT id, name, email, role, created_datetime, discontinue FROM dbo.users",
      );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE user - Admin only + role restrictions
router.post("/", authMiddleware, adminOnly, async (req, res) => {
  const { name, email, role, password } = req.body;

  if (!password) return res.status(400).json({ error: "Password is required" });

  const callerRole = req.user?.role;

  // Only super_admin can create super_admin
  if (role === "super_admin" && callerRole !== "super_admin") {
    return res
      .status(403)
      .json({ error: "Only super_admin can assign the super_admin role" });
  }

  const ALLOWED_ROLES = ["user", "admin", "super_admin", "dba"];
  const assignedRole = ALLOWED_ROLES.includes(role) ? role : "user";

  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const pool = getPool();

    await pool
      .request()
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("role", sql.NVarChar, assignedRole)
      .input("password", sql.NVarChar, hashedPassword)
      .query(
        "INSERT INTO dbo.users (name, email, role, password, created_datetime, discontinue) " +
          "VALUES (@name, @email, @role, @password, GETDATE(), 0)",
      );

    res.json({ message: "User created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE user - Admin only + strong role protection
router.put("/:id", authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, discontinue } = req.body;
  const callerRole = req.user?.role;

  try {
    const pool = getPool();

    // Get current target user role
    const existingResult = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT role FROM dbo.users WHERE id = @id");

    if (!existingResult.recordset.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const targetCurrentRole = existingResult.recordset[0].role;

    // Security checks
    if (targetCurrentRole === "super_admin" && callerRole !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Only super_admin can modify a super_admin account" });
    }

    if (role === "super_admin" && callerRole !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Only super_admin can assign the super_admin role" });
    }

    const ALLOWED_ROLES = ["user", "admin", "super_admin", "dba"];
    const assignedRole = ALLOWED_ROLES.includes(role)
      ? role
      : targetCurrentRole;

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("role", sql.NVarChar, assignedRole)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0)
      .query(
        "UPDATE dbo.users SET name=@name, email=@email, role=@role, discontinue=@discontinue WHERE id=@id",
      );

    res.json({ message: "User updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE user - Admin only
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;

  // Prevent self-deletion
  if (parseInt(id) === req.user?.userId) {
    return res
      .status(400)
      .json({ error: "You cannot delete your own account" });
  }

  try {
    const pool = getPool();

    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT role FROM dbo.users WHERE id = @id");

    if (!existing.recordset.length) {
      return res.status(404).json({ error: "User not found" });
    }

    if (
      existing.recordset[0].role === "super_admin" &&
      req.user?.role !== "super_admin"
    ) {
      return res
        .status(403)
        .json({ error: "Only super_admin can delete a super_admin account" });
    }

    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.users WHERE id = @id");

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
