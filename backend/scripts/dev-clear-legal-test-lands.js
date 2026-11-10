// ONE-TIME, DEV DATABASE ONLY: delete the Legal test lands / enquiries (LND-2026-00001, LND-2026-00002) and then
// the sample masters they used (migration 613). Do not run on live — live land numbers may be real lands.
// Run from backend/:  node scripts/dev-clear-legal-test-lands.js
const B=process.cwd(); require(B+"/config/env").loadEnv(); const sql=require(B+"/node_modules/mssql"); const fs=require("fs");
(async()=>{const pool=await sql.connect({server:process.env.DB_SERVER,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,port:+(process.env.DB_PORT||1433),options:{encrypt:false,trustServerCertificate:true}});
const tx=new sql.Transaction(pool); await tx.begin();
const batches=fs.readFileSync(require("path").join(__dirname,"dev-clear-legal-test-lands.sql"),"utf8").split(/^\s*GO\s*$/m).filter(b=>b.trim());
let k=0;for(const b of batches){k++;const r=new sql.Request(tx); r.on("info",i=>console.log(i.message)); try{await r.batch(b)}catch(e){process.env.ERRS="1";console.log("BATCH",k,"ERR",e.message, b.slice(0,80).replace(/\n/g," "))}}
const q=await new sql.Request(tx).query("SELECT (SELECT COUNT(*) FROM dbo.LegalLand) lands,(SELECT COUNT(*) FROM dbo.LegalLandEnquiry) enq,(SELECT COUNT(*) FROM dbo.LegalPerson WHERE Remarks LIKE N'%Demo%') demoPersons,(SELECT COUNT(*) FROM dbo.LegalRsPlot) plots,(SELECT COUNT(*) FROM dbo.LegalPerson) persons,(SELECT COUNT(*) FROM dbo.LegalMouza) mouzas,(SELECT COUNT(*) FROM dbo.LegalRegistrationOffice) offices");
if(process.env.ERRS){await tx.rollback();console.log("Nothing changed — a step failed (see above).");} else {await tx.commit();console.log("Done:",JSON.stringify(q.recordset[0]));} process.exit(0);})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
