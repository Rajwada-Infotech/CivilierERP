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

function processFrontendFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  let original = content;
  
  for (const [str, enumKey] of Object.entries(statusMap)) {
    // === "Status"
    content = content.replace(new RegExp(`(===|!==|==|!=)\\s*["']${str}["']`, 'g'), `$1 CrmStatus.${enumKey}`);
    
    // case "Status":
    content = content.replace(new RegExp(`case\\s+["']${str}["']\\s*:`, 'g'), `case CrmStatus.${enumKey}:`);
    
    // status: "Status" or Status: "Status"
    content = content.replace(new RegExp(`([Ss]tatus)\\s*:\\s*["']${str}["']`, 'g'), `$1: CrmStatus.${enumKey}`);
    
    // ["Status"]
    content = content.replace(new RegExp(`\\[["']${str}["']\\]`, 'g'), `[CrmStatus.${enumKey}]`);
    
    // status="Status" (React props) -> status={CrmStatus.STATUS}
    content = content.replace(new RegExp(`([Ss]tatus)=["']${str}["']`, 'g'), `$1={CrmStatus.${enumKey}}`);
  }
  
  if (content !== original) {
    if (!content.includes('import { CrmStatus }')) {
      const importStmt = `import { CrmStatus } from "@/constants/crmStatuses";\n`;
      const importRegex = /^(import.*(\r\n|\n))+/m;
      if (importRegex.test(content)) {
        content = content.replace(importRegex, match => `${match}${importStmt}`);
      } else {
        content = importStmt + content;
      }
    }
    fs.writeFileSync(path, content, 'utf8');
    console.log(`Updated ${path}`);
  }
}

const files = globSync('src/pages/CRM/**/*.tsx');
files.forEach(processFrontendFile);
