const sql = require('mssql'); try { const req = new sql.Request(); req.input('docId', sql.Int, NaN); } catch (e) { console.log(e.message); }
