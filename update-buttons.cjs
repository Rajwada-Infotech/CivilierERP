const fs = require('fs');
const path = require('path');

const targetClass = "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500";

// Files using MasterPage that need the prop added
const masterPageFiles = [
  'src/pages/material/AccessCardMaster.tsx',
  'src/pages/material/T&CMaster.tsx',
  'src/pages/material/UnitOfMeasurementMaster.tsx',
  'src/pages/masters/ItemGroupMaster.tsx'
];

masterPageFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('<MasterPage') && !content.includes('saveButtonClass')) {
    content = content.replace(/<MasterPage/, `<MasterPage\n        saveButtonClass="${targetClass}"`);
    fs.writeFileSync(filePath, content);
    console.log(`Updated MasterPage prop in ${file}`);
  }
});

// Files with custom save buttons that need gradient-accent replaced
const customButtonFiles = [
  'src/pages/material/GRN.tsx',
  'src/pages/material/Issues.tsx',
  'src/pages/material/MaterialExpenseBooking.tsx',
  'src/pages/material/MaterialRequest.tsx',
  'src/pages/material/PurchaseOrderMaster.tsx',
  'src/pages/material/VehicleInOut.tsx',
  'src/pages/masters/ItemMaster.tsx',
  'src/pages/masters/SupplierMaster.tsx',
  'src/pages/admin/masters/GodownAdmin.tsx'
];

customButtonFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('gradient-accent')) {
    content = content.replace(/gradient-accent/g, targetClass);
    fs.writeFileSync(filePath, content);
    console.log(`Replaced gradient-accent in ${file}`);
  }
});
