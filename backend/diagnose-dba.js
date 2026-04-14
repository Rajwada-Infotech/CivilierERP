const r = require('./routes/dba.js');
console.log('Type:', typeof r);
console.log('Constructor:', r.constructor ? r.constructor.name : 'no constructor');
console.log('Is Router function:', typeof r === 'function' && r.constructor.name === 'Router');
if (typeof r === 'object' && r !== null) {
  console.log('Keys if object:', Object.keys(r));
}
