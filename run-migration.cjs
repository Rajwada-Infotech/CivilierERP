const { execSync } = require('child_process');
require("dotenv").config({path: "backend/.env"});
const { sql, connectDB, getPool } = require("./backend/db");
const fs = require("fs");

(async () => {
  try {
    await connectDB();
    const pool = getPool();
    
    // Read migration SQL
    const sqlContent = fs.readFileSync("backend/migrations/005-create-roles-table.sql", "utf8");
    
    console.log("Executing migration...");
    const result = await pool.request().query(sqlContent);
    console.log("Migration result:", result.output || "Success (PRINT statements)");
    
    // Check table
    const check = await pool.request().query("SELECT COUNT(*) as cnt FROM sys.tables WHERE name = 'Roles'");
    console.log("Roles table exists:", check.recordset[0].cnt > 0 ? "YES" : "NO");
    
    // Count rows
    const rowCount = await pool.request().query("SELECT COUNT(*) as cnt FROM Roles");
    console.log("Current rows in Roles:", rowCount.recordset[0].cnt);
    
    // Add sample if empty
    if (rowCount.recordset[0].cnt === 0) {
      const samples = await pool.request().query(`
        INSERT INTO Roles (RName, RCode, RDesc, RCreatedBy) VALUES
        ('Admin', 'ADM', 'System Administrator', 'system'),
        ('Super Admin', 'SA', 'Highest privilege user', 'system'),
        ('DBA', 'DBA', 'Database Administrator', 'system'),
        ('User', 'USR', 'Standard User', 'system')
        SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM Roles WHERE RName = 'Admin')
      `);
      console.log("Sample data inserted.");
    } else {
      console.log("Has data, skipping samples.");
    }
    
    // Test query
    const testRoles = await pool.request().query("SELECT TOP 5 * FROM Roles ORDER BY RId DESC");
    console.log("Test query - Roles:", testRoles.recordset);
    
    console.log("\n✅ Migration complete! Table ready for /api/roles");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  }
})();

