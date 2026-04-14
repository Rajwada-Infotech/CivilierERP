const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { redisGet, redisSet, redisDel } = require("../redis");
const { blacklistToken } = require("../middleware/blacklist");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

// ======================
// LOGIN
// ======================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const lockKey = `login:lock:${email.toLowerCase()}`;
  const attemptsKey = `login:attempts:${email.toLowerCase()}`;

  try {
    const locked = await redisGet(lockKey);
    if (locked) {
      return res.status(429).json({
        error: "Too many attempts. Try again later.",
      });
    }

    const pool = getPool();
    const result = await pool.request().input("email", sql.NVarChar, email)
      .query(`
        SELECT u.id, u.name, u.email, u.RoleId, u.password, u.discontinue,
               r.RName AS roleName
        FROM dbo.users u
        LEFT JOIN dbo.Role r ON u.RoleId = r.RId
        WHERE u.email = @email
      `);

    const user = result.recordset[0];

    if (!user) {
      await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.discontinue) {
      return res.status(403).json({ error: "User inactive" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await incrementLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await redisDel(attemptsKey);
    await redisDel(lockKey);

    const token = jwt.sign(
      {
        userId: user.id,
        roleId: user.RoleId,
        role: user.roleName.toLowerCase().replace(/\s+/g, "_"),
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: user.RoleId,
        role: user.roleName.toLowerCase().replace(/\s+/g, "_"),
      },
    });
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
    }
  } catch {}
}

// ======================
// LOGOUT
// ======================
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    if (req.token && req.user?.exp) {
      await blacklistToken(req.token, req.user.exp);
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Logout failed" });
  }
});

// ======================
// USERS CRUD (RBAC FIXED)
// ======================

// GET USERS
router.get(
  "/",
  authMiddleware,
  checkPermission("Users", "List", "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT u.id, u.name, u.email, u.RoleId,
               r.RName AS roleName,
               u.created_datetime, u.discontinue
        FROM dbo.users u
        LEFT JOIN dbo.Role r ON u.RoleId = r.RId
      `);

      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// CREATE USER
router.post(
  "/",
  authMiddleware,
  checkPermission("Users", "List", "CanAdd"),
  async (req, res) => {
    const { name, email, RoleId, roleId, password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password required" });
    }

    const assignedRoleId = Number(RoleId ?? roleId);

    try {
      const hashed = await bcrypt.hash(password, SALT_ROUNDS);
      const pool = getPool();

      await pool
        .request()
        .input("name", sql.NVarChar, name)
        .input("email", sql.NVarChar, email)
        .input("RoleId", sql.Int, assignedRoleId)
        .input("password", sql.NVarChar, hashed).query(`
          INSERT INTO dbo.users (name, email, password, RoleId, created_datetime, discontinue)
          VALUES (@name, @email, @password, @RoleId, GETDATE(), 0)
        `);

      res.json({ message: "User created" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// UPDATE USER
router.put(
  "/:id",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const { name, email, RoleId, roleId, discontinue } = req.body;

    try {
      const pool = getPool();

      const assignedRoleId = Number(RoleId ?? roleId);

      await pool
        .request()
        .input("id", sql.Int, id)
        .input("name", sql.NVarChar, name)
        .input("email", sql.NVarChar, email)
        .input("RoleId", sql.Int, assignedRoleId)
        .input("discontinue", sql.Bit, discontinue ? 1 : 0).query(`
          UPDATE dbo.users
          SET name=@name, email=@email, RoleId=@RoleId, discontinue=@discontinue
          WHERE id=@id
        `);

      res.json({ message: "User updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// DELETE USER
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("Users", "List", "CanDelete"),
  async (req, res) => {
    const { id } = req.params;

    if (parseInt(id) === req.user?.userId) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }

    try {
      const pool = getPool();

      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.users WHERE id=@id");

      res.json({ message: "User deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
