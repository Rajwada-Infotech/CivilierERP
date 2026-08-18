const { sql } = require("../db");

/**
 * ensureCapitalStructure(pool, entityType)
 * Idempotent — creates AccountGroups and AccountHeadMaster entries
 * only if they don't already exist (checked by Name).
 *
 * Returns { groupsCreated: string[], headsCreated: string[] }
 */
async function ensureCapitalStructure(pool, entityType) {
  const groupsCreated = [];
  const headsCreated = [];

  const typeMap = {
    'Private Limited': 'PL',
    'Public Limited': 'PL',
    'OPC': 'PL',
    'Section 8': 'PL',
    'LLP': 'LLP',
    'Partnership': 'PART',
    'Proprietorship': 'PROP'
  };

  const et = typeMap[entityType];
  if (!et) return { groupsCreated, headsCreated };

  const LIABILITIES_ROOT = 1;

  async function createGroup(name, code, parentId) {
    const res = await pool.request()
      .input("code", sql.NVarChar(50), code)
      .query(`
        SELECT AGId FROM dbo.AccountGroup 
        WHERE Code = @code
      `);
    
    if (res.recordset.length > 0) {
      return res.recordset[0].AGId;
    }

    const insertRes = await pool.request()
      .input("name", sql.NVarChar(255), name)
      .input("code", sql.NVarChar(50), code)
      .input("parentId", sql.Int, parentId)
      .query(`
        INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
        OUTPUT inserted.AGId
        VALUES (@name, @code, @parentId, 1, 1, GETDATE())
      `);
    
    groupsCreated.push(name);
    return insertRes.recordset[0].AGId;
  }

  async function createHead(name, groupId) {
    const res = await pool.request()
      .input("name", sql.NVarChar(255), name)
      .input("groupId", sql.Int, groupId)
      .query(`
        SELECT LHeadId FROM dbo.AccountHeadMaster
        WHERE LHeadName = @name AND LBelongsTo = @groupId
      `);
    
    if (res.recordset.length > 0) {
      return res.recordset[0].LHeadId;
    }

    const insertRes = await pool.request()
      .input("name", sql.NVarChar(255), name)
      .input("groupId", sql.Int, groupId)
      .query(`
        INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadType, LBelongsTo, LHeadStatus, LHeadAddress, LHeadContactPerson, LHeadPhone, LHeadEmail, CreatedBy, CreatedAt)
        OUTPUT inserted.LHeadId
        VALUES (@name, 'GL', @groupId, 1, '', '', NULL, NULL, 1, GETDATE())
      `);
    
    headsCreated.push(name);
    return insertRes.recordset[0].LHeadId;
  }

  // Create Reserves & Surplus for all types
  const rsGroupId = await createGroup("Reserves & Surplus", "RS", LIABILITIES_ROOT);

  if (et === 'PL') {
    const scGroupId = await createGroup("Share Capital", "SC", LIABILITIES_ROOT);
    await createHead("Authorized Share Capital", scGroupId);
    await createHead("Issued & Subscribed Share Capital", scGroupId);
    await createHead("Paid-up Share Capital", scGroupId);
    
    await createHead("General Reserve", rsGroupId);
    await createHead("Securities Premium Reserve", rsGroupId);
    await createHead("Retained Earnings", rsGroupId);
  } else if (et === 'LLP') {
    const pcGroupId = await createGroup("Partners' Capital", "PC", LIABILITIES_ROOT);
    await createHead("Partners' Capital Contribution", pcGroupId);
    await createHead("Partners' Current Account", pcGroupId);

    await createHead("Retained Earnings", rsGroupId);
  } else if (et === 'PART') {
    const pcaGroupId = await createGroup("Partners' Capital Account", "PCA", LIABILITIES_ROOT);
    await createHead("Partners' Capital Account", pcaGroupId);

    await createHead("Retained Earnings", rsGroupId);
  } else if (et === 'PROP') {
    const prcGroupId = await createGroup("Proprietor's Capital", "PRC", LIABILITIES_ROOT);
    await createHead("Proprietor's Capital Account", prcGroupId);
    await createHead("Proprietor's Drawings Account", prcGroupId);

    await createHead("Retained Earnings", rsGroupId);
  }

  return { groupsCreated, headsCreated };
}

module.exports = { ensureCapitalStructure };
