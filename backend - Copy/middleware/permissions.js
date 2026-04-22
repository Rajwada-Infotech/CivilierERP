const { getPool, sql } = require("../db");

const checkPermission = (module, subModule, action = "CanView") => {
  return async (req, res, next) => {
    try {
      const roleId = req.user?.roleId;

      if (!roleId) {
        return res.status(401).json({ error: "Invalid token - missing roleId" });
      }

      const pool = getPool();

      if (process.env.DEBUG === "true") {
        console.log("CHECK PERMISSION:", {
          roleId,
          module,
          subModule,
          action,
        });
      }

      const result = await pool.request()
        .input("RoleId", sql.Int, roleId)
        .input("Module", sql.VarChar, module)
        .input("SubModule", sql.VarChar, subModule)
        .query(`
          SELECT CanView, CanAdd, CanEdit, CanDelete
          FROM RoleRights
          WHERE RoleId = @RoleId
            AND Module = @Module
            AND SubModule = @SubModule
        `);

      const permission = result.recordset[0];

      if (!permission) {
        console.log("❌ No permission row found");
        return res.status(403).json({ error: "Access denied (no permission)" });
      }

      if (Number(permission[action]) !== 1) {
        console.log("❌ Action not allowed:", action);
        return res.status(403).json({ error: "Access denied (action blocked)" });
      }

      next();
    } catch (err) {
      console.error("Permission check failed:", err);
      res.status(500).json({ error: "Permission check error" });
    }
  };
};

module.exports = { checkPermission };
