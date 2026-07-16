const fs = require('fs');
const filePath = 'src/routes/parceiroInvite.routes.js';
let c = fs.readFileSync(filePath, 'utf8');

// Encontrar onde o login devolve o token e adicionar o cookie
// Padrão típico: return res.json({ ok: true, token, ...
const loginPatterns = [
  // Padrão com token JWT devolvido
  /return res\.json\(\{\s*ok:\s*true,\s*token[^}]*\}\);/g,
  /res\.json\(\{\s*ok:\s*true,[\s\S]*?token[\s\S]*?\}\);/g,
];

console.log('A procurar endpoint de login...');

// Encontrar o bloco de login
const loginIdx = c.indexOf('router.post("/login"');
if (loginIdx === -1) {
  console.log('❌ Endpoint /login não encontrado');
  // Mostrar rotas existentes
  const routes = c.match(/router\.(get|post|put|patch|delete)\("[^"]+"/g);
  console.log('Rotas encontradas:', routes);
  process.exit(1);
}

console.log('✅ Endpoint /login encontrado');

// Extrair o bloco do login
const loginBlock = c.slice(loginIdx, loginIdx + 2000);
console.log('Primeiros 500 chars do login:\n', loginBlock.slice(0, 500));

// Verificar se já tem cookie
if (loginBlock.includes('res.cookie')) {
  console.log('✅ Cookie já existe no login');
  process.exit(0);
}

// Adicionar cookie antes do return res.json no bloco de login
// Procurar o return final do login
const returnMatch = loginBlock.match(/return res\.json\(\{[\s\S]*?\}\);/);
if (!returnMatch) {
  console.log('❌ Return do login não encontrado');
  process.exit(1);
}

const returnStr = returnMatch[0];
const cookieCode = `  res.cookie("rm_parceiro_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  `;

// Substituir apenas dentro do bloco de login
const loginBlockNew = loginBlock.replace(returnStr, cookieCode + returnStr);
c = c.slice(0, loginIdx) + loginBlockNew + c.slice(loginIdx + loginBlock.length);

fs.writeFileSync(filePath, c);
console.log('✅ Cookie adicionado ao login! Reinicie o servidor.');
