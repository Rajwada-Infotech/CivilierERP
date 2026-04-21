const { execSync } = require('child_process');
require("dotenv").config({path: "backend/.env"});
const { sql
const fs = require("fs");

(async () => {
  try {
    await connectDB();
    const pool = getPool();
    
    // Read 011 TaskComments migration
    const sqlContent = fs.readFileSync("backend/migrations/011-create-taskcomments.sql", "utf8");
    
    console.log("Executing TaskComments migration...");
    const result = await pool.request().query(sqlContent);
    console.log("Migration result:", result.output || "Success");
    
    // Verify tables
    const tasksCheck = await pool.request().query("SELECT COUNT(*) as cnt FROM sys.tables WHERE name = 'Tasks'");
    const commentsCheck = await pool.request().query("SELECT COUNT(*) as cnt FROM sys.tables WHERE name = 'TaskComments'");
    console.log("Tasks table exists:", tasksCheck.recordset[0].cnt > 0 ? "✅ YES" : "❌ NO");
    console.log("TaskComments table exists:", commentsCheck.recordset[0].cnt > 0 ? "✅ YES" : "❌ NO");
    
    // Test Tasks query (no comments first)
    if (tasksCheck.recordset[0].cnt > 0) {
      const tasksTest = await pool.request().query("SELECT COUNT(*) as cnt FROM dbo.Tasks");
      console.log("Tasks table row count:", tasksTest.recordset[0].cnt);
    }
    
    // Test full API query
    console.log("\n🧪 Testing /api/tasks query structure...");
    const apiTest = await pool.request().query(`
      SELECT COUNT(*) as cnt FROM dbo.Tasks t 
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
      LEFT JOIN dbo.users ru ON ru.id = t.ReviewedBy
    `);
    console.log("API Tasks query valid:", apiTest.recordset[0].cnt >= 0 ? "✅ YES" : "❌ NO");
    
    // Test comments query
    if (commentsCheck.recordset[0].cnt > 0) {
      const commentsTest = await pool.request().query(`
        SELECT TOP 1 * FROM dbo.TaskComments tc 
        LEFT JOIN dbo.users u ON u.id = tc.UserId
      `);
      console.log("Comments query test:", commentsTest.recordset.length > 0 ? "✅ Data exists" : "✅ Table empty (OK)");
    }
    
    console.log("\n✅ Tasks module migration COMPLETE! Ready for /api/tasks");
    console.log("Next: npm start && curl http://localhost:5000/api/tasks");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  }
})();

