const fs = require('fs');
const { globSync } = require('glob');

const statusMap = {
  'Draft': 'DRAFT',
  'Pending': 'PENDING',
  'Approved': 'APPROVED',
  'Rejected': 'REJECTED',
  'Cancelled': 'CANCELLED',
  'Active': 'ACTIVE',
  'Booked': 'BOOKED',
  'Paid': 'PAID',
  'Partially Paid': 'PARTIALLY_PAID',
  'Voided': 'VOIDED',
  'Refunded': 'REFUNDED',
  'FinancePending': 'FINANCE_PENDING',
  'Demanded': 'DEMANDED',
  'Clawback Required': 'CLAWBACK_REQUIRED',
  'Executed': 'EXECUTED',
  'Registered': 'REGISTERED',
  'PendingCustomerReview': 'PENDING_CUSTOMER_REVIEW',
  'Open': 'OPEN',
  'InProgress': 'IN_PROGRESS',
  'Resolved': 'RESOLVED',
  'Closed': 'CLOSED'
};

function processBackendFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  let original = content;
  
  for (const [str, enumKey] of Object.entries(statusMap)) {
    // Array includes e.g. ["Cancelled", "Rejected"]
    content = content.replace(new RegExp(`\\[\\s*(.*?)\\s*["']${str}["']\\s*(.*?)\\s*\\]`, 'g'), (match, p1, p2) => {
      return match.replace(new RegExp(`["']${str}["']`, 'g'), `CrmStatus.${enumKey}`);
    });
    
    // approvalTransition parameters
    content = content.replace(new RegExp(`approvalTransition\\(([^,]+),\\s*([^,]+),\\s*["']${str}["']`, 'g'), `approvalTransition($1, $2, CrmStatus.${enumKey}`);
    
    // syncApplicationOnBookingTerminal parameters
    content = content.replace(new RegExp(`syncApplicationOnBookingTerminal\\(([^,]+),\\s*([^,]+),\\s*["']${str}["']`, 'g'), `syncApplicationOnBookingTerminal($1, $2, CrmStatus.${enumKey}`);
    
    // logStatusChange parameters
    content = content.replace(new RegExp(`logStatusChange\\(([^,]+),\\s*([^,]+),\\s*["']${str}["']`, 'g'), `logStatusChange($1, $2, CrmStatus.${enumKey}`);
    content = content.replace(new RegExp(`logStatusChange\\(([^,]+),\\s*([^,]+),\\s*([^,]+),\\s*["']${str}["']`, 'g'), `logStatusChange($1, $2, $3, CrmStatus.${enumKey}`);
  }
  
  // Now handle SQL Strings where possible
  // Find backtick SQL strings and replace Status = 'Pending' with Status = '${CrmStatus.PENDING}'
  content = content.replace(/`([^`]+)`/g, (match) => {
    let newMatch = match;
    for (const [str, enumKey] of Object.entries(statusMap)) {
      newMatch = newMatch.replace(new RegExp(`Status\\s*=\\s*['"]${str}['"]`, 'g'), `Status = '\${CrmStatus.${enumKey}}'`);
      newMatch = newMatch.replace(new RegExp(`RPStatus\\s*=\\s*['"]${str}['"]`, 'g'), `RPStatus = '\${CrmStatus.${enumKey}}'`);
      newMatch = newMatch.replace(new RegExp(`ActionStatus\\s*=\\s*['"]${str}['"]`, 'g'), `ActionStatus = '\${CrmStatus.${enumKey}}'`);
      newMatch = newMatch.replace(new RegExp(`DemandStatus\\s*=\\s*['"]${str}['"]`, 'g'), `DemandStatus = '\${CrmStatus.${enumKey}}'`);
      
      // Status NOT IN ('Cancelled', 'Rejected') etc
      // This is trickier, we can replace ('Cancelled', 'Rejected') piece by piece
      // Let's just do a blanket replace of 'Pending' inside IN (...) if we can
      // Actually, since it's a backtick string, any 'Pending' that represents a status can be replaced if we are careful,
      // but it's safer to only target known patterns.
      newMatch = newMatch.replace(new RegExp(`IN\\s*\\([^)]*['"]${str}['"][^)]*\\)`, 'g'), (inMatch) => {
        return inMatch.replace(new RegExp(`['"]${str}['"]`, 'g'), `'\${CrmStatus.${enumKey}}'`);
      });
      newMatch = newMatch.replace(new RegExp(`NOT IN\\s*\\([^)]*['"]${str}['"][^)]*\\)`, 'g'), (inMatch) => {
        return inMatch.replace(new RegExp(`['"]${str}['"]`, 'g'), `'\${CrmStatus.${enumKey}}'`);
      });
      
      // CASE WHEN Status = 'Pending'
      newMatch = newMatch.replace(new RegExp(`WHEN\\s+Status\\s*=\\s*['"]${str}['"]`, 'g'), `WHEN Status = '\${CrmStatus.${enumKey}}'`);
      newMatch = newMatch.replace(new RegExp(`THEN\\s+['"]${str}['"]`, 'g'), `THEN '\${CrmStatus.${enumKey}}'`);
      newMatch = newMatch.replace(new RegExp(`ELSE\\s+['"]${str}['"]`, 'g'), `ELSE '\${CrmStatus.${enumKey}}'`);
    }
    return newMatch;
  });
  
  if (content !== original) {
    if (!content.includes('const { CrmStatus }')) {
      content = content.replace(/(const .* = require\(['"][^'"]+['"]\);)/, match => `${match}\nconst { CrmStatus } = require("../constants/crmStatuses");`);
    }
    fs.writeFileSync(path, content, 'utf8');
    console.log(`Updated ${path}`);
  }
}

const files = globSync('backend/routes/crm*.js');
files.forEach(processBackendFile);
