#!/usr/bin/env node
// scripts/criar-motorista-teste.js
// ══════════════════════════════════════════════════════════════
// Cria um motorista de teste com veículo associado, ambos
// aprovados e prontos para receber viagens do dispatch.
//
// USO:
//   node scripts/criar-motorista-teste.js               → criar (dry-run desativado por padrão)
//   node scripts/criar-motorista-teste.js --apagar      → remover motorista + veículo de teste
//   node scripts/criar-motorista-teste.js --info        → mostrar credenciais/detalhes actuais
//
// IDEMPOTENTE:
//   Corre várias vezes sem duplicar — se já existir, ATUALIZA em vez
//   de criar. Se preferires começar limpo, corre com --apagar primeiro.
//
// CREDENCIAIS DE TESTE (default; podes mudar via .env ou flags):
//   Email:    teste-motorista@realmetropolis.pt
//   Password: teste123
//   Nome:     MOTORISTA DE TESTE
//   Contacto: +351928344782  (o teu, para receberes SMS de novas reservas)
//   Veículo:  Toyota Corolla · Preto · TT-00-01 · categoria "ECONOMICA"
// ══════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import Motorista from "../src/models/Motorista.js";
import Veiculo   from "../src/models/Veiculo.js";
dotenv.config();

// ── Configuração (podes personalizar aqui) ────────────────────
const CFG = {
  motorista: {
    nome:     "MOTORISTA DE TESTE",
    email:    "teste-motorista@realmetropolis.pt",
    contacto: "+351928344782",       // ← muda para o TEU número se quiseres SMS
    password: "teste123",
    nif:      "999999990",
    iban:     "PT50000000000000000000000",
    categoria: "ECONOMICA",           // corresponde a "economica" do dispatch
    categorias: ["ECONOMICA"],
    // Posição inicial: Lisboa (Marquês de Pombal). Assim que o
    // motorista abrir motorista.html e ativar GPS, o valor real
    // sobrescreve isto.
    lat: 38.7256, lng: -9.1502,
  },
  veiculo: {
    marca:      "Toyota",
    modelo:     "Corolla",
    matricula:  "TT-00-01",
    cor:        "Preto",
    ano:        2023,
    categoria:  "economica",           // lowercase — como o pricing/dispatch espera
    capacidade: 4,
  },
};

const APAGAR = process.argv.includes("--apagar");
const INFO   = process.argv.includes("--info");

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  MOTORISTA DE TESTE — REALMETROPOLIS");
  console.log("═══════════════════════════════════════════════════");

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log("✅ Ligação MongoDB estabelecida\n");

  if (INFO) return mostrarInfo();
  if (APAGAR) return apagar();
  return criarOuAtualizar();
}

// ── CRIAR / ATUALIZAR ─────────────────────────────────────────
async function criarOuAtualizar() {
  const c = CFG.motorista;
  const v = CFG.veiculo;

  // 1) Motorista (upsert por email)
  const passwordHash = await bcrypt.hash(c.password, 10);

  let mot = await Motorista.findOne({ email: c.email });
  if (mot) {
    console.log(`ℹ️  Motorista já existia (${c.email}) — a atualizar campos operacionais.`);
  } else {
    console.log(`➕ A criar novo motorista: ${c.email}`);
    mot = new Motorista({
      nome:     c.nome,
      email:    c.email,
      contacto: c.contacto,
    });
  }

  // Aplicar/atualizar campos operacionais (idempotente)
  Object.assign(mot, {
    nome:       c.nome,
    contacto:   c.contacto,
    nif:        c.nif,
    iban:       c.iban,
    categoria:  c.categoria,
    categorias: c.categorias,
    status:     "Disponível",
    aprovacao:  "aprovado",              // bypass do fluxo de validação para teste
    disponivel: true,                    // livre para receber reservas
    passwordHash,
    lat: c.lat,
    lng: c.lng,
    rating: 5,
    validacao: {
      status:          "validado",
      observacoes:     "Motorista de teste — criado por script",
      checklist:       { teste: true },
      validadoEm:      new Date(),
      validadoPorNome: "Script de teste",
    },
    // Marcar documentos como aprovados (o dispatch pode filtrar por isto)
    documentos: {
      fotoRosto:          { status: "aprovado" },
      cc:                 { status: "aprovado" },
      cartaConducao:      { status: "aprovado" },
      tvde:               { status: "aprovado" },
      registoCriminal:    { status: "aprovado" },
    },
  });
  await mot.save();
  console.log(`✅ Motorista guardado. _id: ${mot._id}`);

  // 2) Veículo (upsert por matricula)
  let vei = await Veiculo.findOne({ matricula: v.matricula.toUpperCase() });
  if (vei) {
    console.log(`ℹ️  Veículo já existia (${v.matricula}) — a atualizar.`);
  } else {
    console.log(`➕ A criar novo veículo: ${v.matricula}`);
    vei = new Veiculo({
      marca:     v.marca,
      modelo:    v.modelo,
      matricula: v.matricula.toUpperCase(),
    });
  }

  Object.assign(vei, {
    marca:      v.marca,
    modelo:     v.modelo,
    matricula:  v.matricula.toUpperCase(),
    cor:        v.cor,
    ano:        v.ano,
    categoria:  v.categoria,
    capacidade: v.capacidade,
    motorista:  mot._id,
    disponivel: true,
    estado:     "aprovado",
    aprovacao:  "aprovado",
    validacao: {
      status:          "validado",
      observacoes:     "Veículo de teste — criado por script",
      checklist:       { teste: true },
    },
  });
  await vei.save();
  console.log(`✅ Veículo guardado. _id: ${vei._id}`);

  // 3) Ligar veículo ao motorista (referência inversa)
  mot.veiculoId = vei._id;
  await mot.save();
  console.log(`✅ Motorista.veiculoId → ${vei._id}\n`);

  // 4) Confirmação
  console.log("═══════════════════════════════════════════════════");
  console.log("  ✅ MOTORISTA DE TESTE PRONTO");
  console.log("═══════════════════════════════════════════════════");
  console.log("");
  console.log("  🚗 CREDENCIAIS DE ACESSO");
  console.log(`     Email:    ${c.email}`);
  console.log(`     Password: ${c.password}`);
  console.log("");
  console.log("  📱 CONTACTO (para receber SMS de novas reservas)");
  console.log(`     ${c.contacto}`);
  console.log("");
  console.log("  🚙 VEÍCULO");
  console.log(`     ${v.marca} ${v.modelo} · ${v.cor} · ${v.matricula.toUpperCase()}`);
  console.log(`     Categoria: ${v.categoria}`);
  console.log("");
  console.log("  📝 COMO USAR");
  console.log("     1) Abre motorista.html no browser");
  console.log(`     2) Faz login com ${c.email} / ${c.password}`);
  console.log("     3) Permite GPS quando o browser pedir");
  console.log("     4) Cria uma Reserva Flexível no dashboard hotel");
  console.log("     5) Motorista recebe pedido — aceita");
  console.log("     6) Vai ao ecrã do convidado — cartão + mapa em tempo real!");
  console.log("");

  await mongoose.disconnect();
}

// ── APAGAR ─────────────────────────────────────────────────────
async function apagar() {
  const c = CFG.motorista;
  const v = CFG.veiculo;

  const vei = await Veiculo.findOneAndDelete({ matricula: v.matricula.toUpperCase() });
  const mot = await Motorista.findOneAndDelete({ email: c.email });

  console.log(`🗑️  Veículo apagado: ${vei ? vei.matricula : "(nenhum)"}`);
  console.log(`🗑️  Motorista apagado: ${mot ? mot.email : "(nenhum)"}`);
  console.log("");
  console.log("✅ Limpeza concluída.");

  await mongoose.disconnect();
}

// ── MOSTRAR INFO ───────────────────────────────────────────────
async function mostrarInfo() {
  const c = CFG.motorista;
  const mot = await Motorista.findOne({ email: c.email }).lean();
  if (!mot) {
    console.log("ℹ️  Nenhum motorista de teste registado.");
    console.log("    Corre: node scripts/criar-motorista-teste.js");
    await mongoose.disconnect();
    return;
  }
  const vei = await Veiculo.findOne({ motorista: mot._id }).lean();

  console.log("📋 MOTORISTA DE TESTE ATUAL:");
  console.log(`   Nome:       ${mot.nome}`);
  console.log(`   Email:      ${mot.email}`);
  console.log(`   Password:   ${c.password}  (do script)`);
  console.log(`   Contacto:   ${mot.contacto}`);
  console.log(`   Aprovação:  ${mot.aprovacao}`);
  console.log(`   Disponível: ${mot.disponivel}`);
  console.log(`   Rating:     ${mot.rating}`);
  console.log(`   Posição:    ${mot.lat}, ${mot.lng}`);
  console.log("");
  if (vei) {
    console.log("🚙 VEÍCULO:");
    console.log(`   ${vei.marca} ${vei.modelo} · ${vei.cor}`);
    console.log(`   Matrícula:  ${vei.matricula}`);
    console.log(`   Categoria:  ${vei.categoria}`);
    console.log(`   Estado:     ${vei.estado} · Aprovação: ${vei.aprovacao}`);
    console.log(`   Disponível: ${vei.disponivel}`);
  } else {
    console.log("⚠️  Motorista sem veículo associado!");
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("❌ ERRO:", err);
  process.exit(1);
});
