const fs = require('fs');
const filePath = 'src/routes/parceiroInvite.routes.js';
let c = fs.readFileSync(filePath, 'utf8');

console.log('Linhas actuais:', c.split('\n').length);
console.log('Tem export default:', c.includes('export default router'));
console.log('Tem login:', c.includes('/login'));
console.log('Tem sameSite:', c.includes('sameSite'));

// Mostrar últimas 20 linhas
const lines = c.split('\n');
console.log('\nÚltimas 20 linhas:');
console.log(lines.slice(-20).join('\n'));
