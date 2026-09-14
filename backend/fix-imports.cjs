const fs = require('fs');
const { globSync } = require('glob');

const files = globSync('src/pages/CRM/**/*.tsx');

files.forEach(path => {
  let content = fs.readFileSync(path, 'utf8');
  let original = content;
  
  // Clean up any weird nested imports
  // E.g. 
  // import {
  // import { CrmStatus } from "@/constants/crmStatuses";
  //   Search...
  
  // First, completely remove ALL occurrences of import { CrmStatus } from "@/constants/crmStatuses";
  content = content.replace(/import \{ CrmStatus \} from "@\/constants\/crmStatuses";\r?\n?/g, '');
  
  // Then, if the file uses CrmStatus, insert it at the very beginning of the file (before first import)
  if (content.includes('CrmStatus.')) {
    content = `import { CrmStatus } from "@/constants/crmStatuses";\n` + content;
  }
  
  if (content !== original) {
    fs.writeFileSync(path, content, 'utf8');
    console.log(`Fixed imports in ${path}`);
  }
});
