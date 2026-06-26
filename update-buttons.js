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
  
  // We need to carefully replace gradient-accent only on the save buttons.
  // Actually, let's just replace all occurrences of gradient-accent in these specific files with targetClass,
  // EXCEPT for UnitOfMeasurementMaster (already handled above, the other one is Import CSV, not save button).
  // Wait, in GodownAdmin, "Create Godown" is the save button.
  // Let's check if any of these files have other gradient-accent buttons.
  
  // In GRN, Issues, MaterialExpenseBooking, MaterialRequest, PurchaseOrderMaster, VehicleInOut:
  // gradient-accent is ONLY used for the Save button!
  
  // Let's just do a string replace for 'gradient-accent' -> targetClass
  if (content.includes('gradient-accent')) {
    content = content.replace(/gradient-accent/g, targetClass);
    fs.writeFileSync(filePath, content);
    console.log(`Replaced gradient-accent in ${file}`);
  }
});
