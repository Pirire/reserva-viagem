const fs = require('fs');
const filePath = 'src/routes/parceiroInvite.routes.js';
let c = fs.readFileSync(filePath, 'utf8');

// Mostrar o que está nas rotas de contactos
const idx = c.indexOf('router.get("/me/contactos"');
if (idx === -1) { console.log('❌ rota GET /me/contactos não encontrada'); process.exit(1); }
console.log('Código actual (primeiras 200 chars):\n', c.slice(idx, idx+200));
