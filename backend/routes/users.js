const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { redisGet, redisSet, redisDel } = require("../redis");
const { blacklistToken } = require("../middleware/blacklist");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const allowRoles = require("../middleware/role");
const { requireValidId, checkRowsAffected } = require("../utils/routeHelpers");

// Privileged roles that can always list users (Password Reset, User Management)
const PRIVILEGED_ROLES = ["super_admin", "admin", "dba"];

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

// ======================
// ROLE NORMALIZER - Root Cause Fix
// ======================
const normalizeRole = (role) => {
  if (!role || typeof role !== "string") return "user";

  const r = role.trim().toLowerCase();

  const roleMap = {
    // super_admin variants
    sa: "super_admin",
    "super admin": "super_admin",
    superadmin: "super_admin",
    super_admin: "super_admin",
    "super administrator": "super_admin",

    // dba variants
    dba: "dba",
    "db admin": "dba",
    "database admin": "dba",
    "database administrator": "dba",
    db_admin: "dba",
    "db administrator": "dba",

    // admin variants
    admin: "admin",
    administrator: "admin",
    "system admin": "admin",
    "system administrator": "admin",

    // branch_manager variants
    "branch manager": "branch_manager",
    "branch admin": "branch_manager",
    branch_manager: "branch_manager",

    // finance_manager variants
    "finance manager": "finance_manager",
    finance: "finance_manager",
    finance_manager: "finance_manager",
    accountant: "finance_manager",

    // store_manager variants
    "store manager": "store_manager",
    "material manager": "store_manager",
    store_manager: "store_manager",

    // user variants
    user: "user",
    "standard user": "user",
    employee: "user",
    staff: "user",
  };

  const mapped = roleMap[r];
  if (!mapped) {
    console.warn(
      `[normalizeRole] Unrecognised role string: "${role}" — defaulting to "user"`,
    );
  }
  return mapped || "user";
};

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
    // Redis may be unavailable — never let a cache check block login
    try {
      const locked = await redisGet(lockKey);
      if (locked) {
        return res.status(429).json({
          error: "Too many attempts. Try again later.",
        });
      }
    } catch {
      // Redis down — skip lockout check, proceed to DB auth
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

    try {
      await redisDel(attemptsKey);
      await redisDel(lockKey);
    } catch {}

    // FIXED: Normalize role
    const normalizedRole = normalizeRole(user.roleName);

    const token = jwt.sign(
      {
        userId: user.id,
        roleId: user.RoleId,
        role: normalizedRole,
        email: user.email,
        name: user.name,
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
        role: normalizedRole,
        roleId: user.RoleId,
        pagePermissions: null,
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
// GET USERS
// ======================
// Open to any privileged role (super_admin / admin / dba) so that the
// Password Reset and User Management pages always load, regardless of
// whether a RoleRights row exists for "Users / List" in the DB.
router.get(
  "/",
  authMiddleware,
  allowRoles(...PRIVILEGED_ROLES),
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

      // Normalize roles for frontend
      const normalizedUsers = result.recordset.map((user) => ({
        ...user,
        role: normalizeRole(user.roleName),
        roleName: user.roleName,
      }));

      res.json(normalizedUsers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// CREATE USER
// ======================
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
      // SQL Server unique constraint violation (error number 2627 or 2601)
      if (
        err.number === 2627 ||
        err.number === 2601 ||
        (err.message && err.message.includes("duplicate key"))
      ) {
        return res
          .status(409)
          .json({ error: "A user with this email address already exists." });
      }
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// UPDATE USER
// ======================
router.put(
  "/:id",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const id = requireValidId(req, res);
    if (!id) return;
    const { name, email, RoleId, roleId, discontinue } = req.body;
    try {
      const pool = getPool();

      // If only `discontinue` was sent (toggle active/inactive), skip updating
      // name/email/RoleId so we don't accidentally NULL them out.
      const isToggleOnly =
        discontinue !== undefined &&
        name === undefined &&
        email === undefined &&
        RoleId === undefined &&
        roleId === undefined;

      if (isToggleOnly) {
        const result = await pool
          .request()
          .input("id", sql.Int, id)
          .input("discontinue", sql.Bit, discontinue ? 1 : 0)
          .query(`UPDATE dbo.users SET discontinue=@discontinue WHERE id=@id`);
        if (!checkRowsAffected(result, res, "User")) return;
      } else {
        const assignedRoleId = Number(RoleId ?? roleId);
        const result = await pool
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
        if (!checkRowsAffected(result, res, "User")) return;
      }

      res.json({ message: "User updated" });
    } catch (err) {
      if (
        err.number === 2627 ||
        err.number === 2601 ||
        (err.message && err.message.includes("duplicate key"))
      ) {
        return res
          .status(409)
          .json({ error: "A user with this email address already exists." });
      }
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// DELETE USER
// ======================
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("Users", "List", "CanDelete"),
  async (req, res) => {
    const id = requireValidId(req, res);
    if (!id) return;
    if (id === req.user?.userId) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }
    try {
      const pool = getPool();
      const result = await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.users WHERE id=@id");
      if (!checkRowsAffected(result, res, "User")) return;
      res.json({ message: "User deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// PATCH USER PAGE PERMISSIONS
// Called by AuthContext.updateUserPagePermissions()
// Stores the permissions JSON in dbo.users.page_permissions
// ======================
router.patch(
  "/:id/permissions",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const id = requireValidId(req, res);
    if (!id) return;
    const { pagePermissions } = req.body;

    if (!Array.isArray(pagePermissions)) {
      return res
        .status(400)
        .json({ error: "pagePermissions must be an array" });
    }

    try {
      const pool = getPool();
      const jsonStr = JSON.stringify(pagePermissions);

      await pool
        .request()
        .input("id", sql.Int, id)
        .input("perms", sql.NVarChar(sql.MAX), jsonStr)
        .query("UPDATE dbo.users SET page_permissions = @perms WHERE id = @id").catch(() => null); // column may not exist

      res.json({ message: "Permissions updated" });
    } catch (err) {
      console.error("PATCH /users/:id/permissions error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ======================
// RESET USER PASSWORD (admin action — no current password required)
// ======================
router.patch(
  "/:id/reset-password",
  authMiddleware,
  checkPermission("Users", "List", "CanEdit"),
  async (req, res) => {
    const id = requireValidId(req, res);
    if (!id) return;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    try {
      const pool = getPool();
      const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);
      const result = await pool
        .request()
        .input("id", sql.Int, id)
        .input("password", sql.NVarChar, hashed)
        .query("UPDATE dbo.users SET password = @password WHERE id = @id");
      if (!checkRowsAffected(result, res, "User")) return;

      res.json({ message: "Password reset successfully" });
    } catch (err) {
      console.error("PATCH /users/:id/reset-password error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
