require("dotenv").config({path: "backend/.env"});
const { sql, connectDB, getPool } = require("./backend/db");
const fs = require("fs");

(async () => {
  try {
    await connectDB();
    const pool = getPool();
    
    // Read migration SQL
    const sqlContent = fs.readFileSync("backend/migrations/005-create-roles-table.sql", "utf8");
    
    // Execute
    const result = await pool.request().query(sqlContent);
    console.log("Migration executed:", result);
    
    // Check table
    const check = await pool.request().query("SELECT COUNT(*) as cnt FROM sys.tables WHERE name = 'Roles'");
    console.log("Roles table exists:", check.recordset[0].cnt > 0);
    
    // Sample data if empty
    const count = await pool.request().query("SELECT COUNT(*) as cnt FROM Roles");
    if (count.recordset[0].cnt === 0) {
      const samples = await pool.request()
        .query(`
          INSERT INTO Roles (RName, RCode, RDesc, RCreatedBy) VALUES
          ('Admin', 'ADM', 'System Administrator', 'system'),
          ('Super Admin', 'SA', 'Highest privilege user', 'system'),
          ('DBA', 'DBA', 'Database Administrator', 'system')
        `);
      console.log("Sample data inserted:", samples);
    } else {
      console.log("Table has data, skipping samples");
    }
    
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
})();

