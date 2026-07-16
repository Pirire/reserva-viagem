const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'routes', 'parceiroInvite.routes.js');
let c = fs.readFileSync(filePath, 'utf8');

// 1. Adicionar import mongoose se não existir
if (!c.includes("import mongoose from")) {
  c = c.replace(
    'import ConviteParceiro',
    'import mongoose from "mongoose";\nimport ConviteParceiro'
  );
  console.log('✅ import mongoose adicionado');
}

// 2. Substituir GET /me/contactos
const getOld = /router\.get\("\/me\/contactos"[\s\S]*?router\.post\("\/me\/contactos"/m;
const getNew = `router.get("/me/contactos", requireParceiro, async (req, res) => {
  try {
    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);
    const doc = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    return res.json({ ok: true, contactos: doc?.contactos || [] });
  } catch (err) {
    console.error("❌ GET /me/contactos:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar contactos." });
  }
});

router.post("/me/contactos"`;

c = c.replace(getOld, getNew);
console.log('✅ GET /me/contactos substituído');

// 3. Substituir POST /me/contactos
const postOld = /router\.post\("\/me\/contactos"[\s\S]*?router\.delete\("\/me\/contactos/m;
const postNew = `router.post("/me/contactos", requireParceiro, async (req, res) => {
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
    console.log("✅ contacto guardado:", novoContacto.nome, "| total:", updated?.contactos?.length);
    return res.json({ ok: true, contactos: updated?.contactos || [] });
  } catch (err) {
    console.error("❌ POST /me/contactos:", err);
    return res.status(500).json({ ok: false, message: "Erro ao guardar contacto." });
  }
});

router.delete("/me/contactos`;

c = c.replace(postOld, postNew);
console.log('✅ POST /me/contactos substituído');

// 4. Substituir DELETE /me/contactos
const delOld = /router\.delete\("\/me\/contactos\/:id"[\s\S]*?\}\);(\s*\/\*|$)/m;
const match = c.match(delOld);
if (match) {
  const delNew = `router.delete("/me/contactos/:id", requireParceiro, async (req, res) => {
  try {
    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);
    let deleteId;
    try { deleteId = new mongoose.Types.ObjectId(req.params.id); } catch { deleteId = req.params.id; }
    await col.updateOne({ _id: oid }, { $pull: { contactos: { _id: deleteId } } });
    const updated = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    return res.json({ ok: true, contactos: updated?.contactos || [] });
  } catch (err) {
    console.error("❌ DELETE /me/contactos/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao remover contacto." });
  }
});${match[1]}`;
  c = c.replace(delOld, delNew);
  console.log('✅ DELETE /me/contactos/:id substituído');
}

fs.writeFileSync(filePath, c);
console.log('✅ Ficheiro guardado. Reinicie o servidor.');
