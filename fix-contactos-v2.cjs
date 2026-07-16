const fs = require('fs');
const filePath = 'src/routes/parceiroInvite.routes.js';
let c = fs.readFileSync(filePath, 'utf8');

// Adicionar import mongoose se não existir
if (!c.includes('import mongoose')) {
  c = c.replace(
    'import ConviteParceiro',
    'import mongoose from "mongoose";\nimport ConviteParceiro'
  );
  console.log('✅ import mongoose adicionado');
}

// Rotas de contactos a adicionar
const rotasContactos = `
/* ================================================================
   CONTACTOS do parceiro (agenda)
   GET    /api/admin/parceiros/me/contactos
   POST   /api/admin/parceiros/me/contactos   { nome, tel }
   DELETE /api/admin/parceiros/me/contactos/:id
================================================================ */
router.get("/me/contactos", requireParceiro, async (req, res) => {
  try {
    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);
    const doc = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    return res.json({ ok: true, contactos: doc?.contactos || [] });
  } catch (err) {
    console.error("GET /me/contactos erro:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar contactos." });
  }
});

router.post("/me/contactos", requireParceiro, async (req, res) => {
  try {
    const nome = String(req.body?.nome || "").trim();
    const tel  = String(req.body?.tel  || "").trim();
    if (!nome || !tel) return res.status(400).json({ ok: false, message: "Nome e contacto são obrigatórios." });
    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);
    const existe = await col.findOne({ _id: oid, "contactos.tel": tel });
    if (existe) return res.status(409).json({ ok: false, message: "Este contacto já existe." });
    const novoContacto = { _id: new mongoose.Types.ObjectId(), nome, tel, criadoEm: new Date() };
    await col.updateOne({ _id: oid }, { $push: { contactos: novoContacto } });
    const updated = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    console.log("contacto guardado:", nome, "| total:", updated?.contactos?.length);
    return res.json({ ok: true, contactos: updated?.contactos || [] });
  } catch (err) {
    console.error("POST /me/contactos erro:", err);
    return res.status(500).json({ ok: false, message: "Erro ao guardar contacto." });
  }
});

router.delete("/me/contactos/:id", requireParceiro, async (req, res) => {
  try {
    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);
    let deleteId;
    try { deleteId = new mongoose.Types.ObjectId(req.params.id); } catch { deleteId = req.params.id; }
    await col.updateOne({ _id: oid }, { $pull: { contactos: { _id: deleteId } } });
    const updated = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    return res.json({ ok: true, contactos: updated?.contactos || [] });
  } catch (err) {
    console.error("DELETE /me/contactos erro:", err);
    return res.status(500).json({ ok: false, message: "Erro ao remover contacto." });
  }
});
`;

// Verificar se já tem as rotas
if (c.includes('/me/contactos')) {
  console.log('⚠️  Rotas de contactos já existem — a remover versão antiga...');
  // Remover bloco antigo
  const start = c.indexOf('\nrouter.get("/me/contactos"');
  if (start === -1) {
    console.log('❌ Não encontrou o início das rotas');
    process.exit(1);
  }
  // Encontrar o fim (próximo bloco de comentários ou export)
  const afterStart = c.slice(start);
  const endMatch = afterStart.match(/\n\/\* ={3,}|^export default/m);
  const end = endMatch ? start + endMatch.index : c.length;
  c = c.slice(0, start) + c.slice(end);
  console.log('✅ Rotas antigas removidas');
}

// Adicionar antes do export default
if (c.includes('export default router;')) {
  c = c.replace('export default router;', rotasContactos + '\nexport default router;');
  console.log('✅ Rotas de contactos adicionadas antes do export');
} else {
  c += rotasContactos;
  console.log('✅ Rotas de contactos adicionadas no fim');
}

fs.writeFileSync(filePath, c);
console.log('✅ Ficheiro guardado! Reinicie o servidor.');
