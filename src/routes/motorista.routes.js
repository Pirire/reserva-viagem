console.log("✅ motorista.routes.js carregado");
import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Motorista from "../models/Motorista.js"; // Presumindo que o Motorista.js está em src/models
import Trip from "../models/Trip.js";
import Reserva from "../models/Reserva.js";
import Veiculo from "../models/Veiculo.js";
import { authMotorista } from "../middlewares/authMotorista.js";
import { signJwt } from "../config/jwt.js";
import { setCookieToken, clearCookieToken } from "../utils/authUtils.js";

// --- MULTER IMPORTS E CONFIGURAÇÃO ---
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// ==============================
// CONFIGURAÇÃO DO MULTER PARA UPLOAD DE DOCUMENTOS
// ==============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Ajuste o caminho para a pasta 'public/uploads' a partir de onde 'motorista.routes.js' está
// Ex: se motorista.routes.js está em 'src/routes/', e 'public/' na raiz do projeto,
// então é '../../public/uploads'. Verifique a sua estrutura de pastas!
const UPLOADS_DIR = path.join(__dirname, "..", "..", "public", "uploads"); 

// Log para verificar se o UPLOADS_DIR está correto
console.log(`📂 UPLOADS_DIR para motorista.routes: ${UPLOADS_DIR}`);

// Configuração de armazenamento do Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Garante que a pasta de upload exista antes de tentar salvar
    // fs.mkdirSync(UPLOADS_DIR, { recursive: true }); // Pode ser útil se a pasta não existir
    cb(null, UPLOADS_DIR); // Onde os arquivos serão salvos
  },
  filename: function (req, file, cb) {
    // Gerar um nome de arquivo único para evitar colisões
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // Combina o nome original do campo + sufixo único + extensão original do arquivo
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Configure o Multer para esperar os campos de upload especificados
// Os nomes dos campos ('bi', 'cartaConducao', 'fotoPerfil') devem corresponder
// aos atributos 'name' dos seus <input type="file"> no frontend.
const upload = multer({ storage: storage }).fields([
  { name: "bi", maxCount: 1 }, // Documento de Identificação (BI)
  { name: "cartaConducao", maxCount: 1 }, // Carta de Condução
  { name: "fotoPerfil", maxCount: 1 }, // Foto do Perfil do Motorista
  // Adicione outros campos de documentos aqui se houver mais
]);

// ==============================
// ROTA DE REGISTRO DE MOTORISTA - AGORA COM SUPORTE A UPLOAD DE DOCUMENTOS
// ==============================
router.post("/registar", upload, async (req, res) => { // O 'upload' é o middleware que processa os arquivos
  try {
    console.log("📥 BODY RECEBIDO (campos de texto):", req.body);
    console.log("📄 FILES RECEBIDOS (arquivos):", req.files); // Log para ver quais arquivos foram processados

    const { nome, email, telefone } = req.body || {}; // Campos de texto do formulário

    // Extrair os arquivos processados pelo Multer
    const uploadedBi = req.files && req.files.bi ? req.files.bi[0] : null;
    const uploadedCartaConducao = req.files && req.files.cartaConducao ? req.files.cartaConducao[0] : null;
    const uploadedFotoPerfil = req.files && req.files.fotoPerfil ? req.files.fotoPerfil[0] : null;

    // Validação básica dos campos obrigatórios (adapte conforme sua regra de negócio)
    // Se BI e Carta de Condução forem IMEDIATAMENTE obrigatórios no registro:
    if (!nome || !email || !telefone || !uploadedBi || !uploadedCartaConducao) {
      // Se a foto de perfil for opcional, não inclua no IF
      return res.status(400).json({
        success: false,
        message: "Nome, email, telefone, BI e Carta de Condução são obrigatórios",
      });
    }

    const emailNorm = String(email).toLowerCase().trim();

    const existe = await Motorista.findOne({ email: emailNorm });
    if (existe) {
      return res.status(400).json({
        success: false,
        message: "Motorista já existe com este email",
      });
    }

    // Preparar os dados dos documentos para serem salvos no MongoDB
    const documentosMotorista = {
        bi: uploadedBi ? {
            path: `/uploads/${uploadedBi.filename}`, // Caminho relativo para exibição
            originalName: uploadedBi.originalname,
            mimetype: uploadedBi.mimetype,
            size: uploadedBi.size,
            status: "pendente", // Status inicial padrão para validação manual
        } : null,
        cartaConducao: uploadedCartaConducao ? {
            path: `/uploads/${uploadedCartaConducao.filename}`,
            originalName: uploadedCartaConducao.originalname,
            mimetype: uploadedCartaConducao.mimetype,
            size: uploadedCartaConducao.size,
            status: "pendente",
        } : null,
        fotoPerfil: uploadedFotoPerfil ? {
            path: `/uploads/${uploadedFotoPerfil.filename}`,
            originalName: uploadedFotoPerfil.originalname,
            mimetype: uploadedFotoPerfil.mimetype,
            size: uploadedFotoPerfil.size,
            status: "pendente",
        } : null,
         // Adicione outros tipos de documentos aqui, seguindo o padrão
    };

    // Criar o novo motorista no MongoDB
    const novoMotorista = await Motorista.create({
      nome,
      email: emailNorm,
      telefone,
      // 'aprovacao' é o status geral do motorista (pendente, aprovado, rejeitado)
      aprovacao: "pendente",
      // 'documentos' é o objeto que armazena as referências e status de cada documento
      documentos: documentosMotorista,
      // O campo 'passwordHash' será definido posteriormente na rota '/motorista/definir-senha'
    });

    return res.status(201).json({ // Retorna 201 Created para sucesso no registro
      success: true,
      message: "Motorista registado e documentos enviados para validação",
      data: {
        _id: novoMotorista._id,
        email: novoMotorista.email,
        aprovacao: novoMotorista.aprovacao,
        // Inclua outros dados relevantes, mas evite senhas ou dados sensíveis que não sejam necessários
      },
    });
  } catch (err) {
    console.error("❌ Erro POST /motorista/registar:", err);
    // No caso de erro (ex: falha ao salvar arquivo), considere excluir os arquivos já carregados
    // (Esta lógica de rollback de arquivos não está incluída neste código para simplificar)
    return res.status(500).json({
      success: false,
      message: "Erro interno ao registar motorista. Tente novamente mais tarde.",
      error: err.message, // Incluir a mensagem de erro pode ser útil para depuração
    });
  }
});

// ==============================
// RESTO DAS SUAS ROTAS EXISTENTES (sem alterações)
// ==============================

/**
 * POST /api/motorista/definir-senha
 * body: { token, senha }
 */
router.post("/definir-senha", async (req, res) => {
  try {
    const { token, email, senha } = req.body || {};

    if (!token || !senha || String(senha).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Token e senha (mín. 6) são obrigatórios",
      });
    }

    // Email é OPCIONAL — só usado se for explicitamente enviado (ex:
    // motorista-primeiro-acesso.html, a página antiga, que pede o
    // email como confirmação extra). A página mais recente
    // (motorista-definir-senha.html), já ligada ao link de activação
    // por email, nunca envia este campo — o token já identifica o
    // motorista de forma inequívoca, por isso exigir email aqui
    // bloqueava SEMPRE essa página com "Email é obrigatório".
    const emailNorm = String(email || "").toLowerCase().trim();

    const tokenHash = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");

    // CORRIGIDO: o schema real de Motorista.js não tem nenhum campo
    // "convite" — usa setupToken/setupTokenHash/setupTokenExpires/
    // setupTokenUsadoEm (confirmado no ficheiro do modelo). A versão
    // anterior desta rota procurava "convite.tokenHash", um campo
    // que nunca existiu no schema; como o Mongoose ignora por defeito
    // (strict:true) qualquer campo não declarado ao construir o
    // documento, "motorista.convite" vinha sempre undefined, e
    // "motorista.convite.usadoEm = ..." rebentava com TypeError —
    // exactamente o erro 500 genérico "Erro ao definir senha".
    const motorista = await Motorista.findOne({
      setupTokenHash: tokenHash,
      setupTokenExpires: { $gt: new Date() },
      setupTokenUsadoEm: null,
    }).select("+passwordHash setupToken setupTokenHash setupTokenExpires setupTokenUsadoEm aprovacao email nome");

    if (!motorista) {
      return res.status(400).json({
        success: false,
        message: "Convite inválido ou expirado",
      });
    }

    if (motorista.aprovacao === "rejeitado") {
      return res.status(403).json({
        success: false,
        message: "Conta rejeitada. Contacte o suporte.",
      });
    }

    motorista.passwordHash = await bcrypt.hash(String(senha), 10);
    motorista.setupTokenUsadoEm = new Date();

    // Só substitui o email se foi mesmo enviado (motorista-primeiro-
    // -acesso.html antigo) — sem isto, motorista.email ficaria vazio
    // sempre que vier de motorista-definir-senha.html (que nunca
    // envia email).
    if (emailNorm) motorista.email = emailNorm;

    await motorista.save();

    return res.json({ success: true, message: "Senha definida com sucesso" });
  } catch (err) {
    console.error("Erro POST /motorista/definir-senha:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao definir senha" });
  }
});

/**
 * POST /api/motorista/login
 * body: { email, senha }
 */
router.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) {
      return res
        .status(400)
        .json({ success: false, message: "Email e senha obrigatórios" });
    }

    const emailNorm = String(email).toLowerCase().trim();

    const motorista = await Motorista.findOne({ email: emailNorm });

    if (!motorista || !motorista.passwordHash) {
      return res
        .status(401)
        .json({ success: false, message: "Credenciais inválidas" });
    }

    // ✅ só entra se aprovado
    if (motorista.aprovacao !== "aprovado") {
      return res.status(403).json({
        success: false,
        message: "Aguardando aprovação do admin master",
      });
    }

    const ok = await bcrypt.compare(String(senha), motorista.passwordHash);
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, message: "Credenciais inválidas" });
    }

    const tokenJwt = signJwt(
      {
        tipo: "motorista",
        id:    String(motorista._id),
        email: motorista.email,
        nome:  motorista.nome,
      },
      "7d"
    );

    // Cookie httpOnly — nunca exposto ao JavaScript do browser
    setCookieToken(res, "rm_motorista_token", tokenJwt, 7);

    return res.json({
      success: true,
      message: "Login efectuado com sucesso.",
      motorista: {
        id:    String(motorista._id),
        nome:  motorista.nome,
        email: motorista.email,
      }
    });
  } catch (err) {
    console.error("Erro POST /motorista/login:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro no login do motorista" });
  }
});

/**
 * POST /api/motorista/localizacao
 * body: { lat, lng, accuracy, speed, heading, ts }
 * protegido por authMotorista
 */
router.post("/localizacao", authMotorista, async (req, res) => {
  try {
    const { lat, lng, accuracy, speed, heading, ts } = req.body || {};

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res
        .status(400)
        .json({ success: false, message: "lat/lng inválidos" });
    }

    const serverUpdatedAt = new Date();
    const clientTs = Number.isFinite(Number(ts)) ? new Date(Number(ts)) : null;

    await Motorista.findByIdAndUpdate(
      req.motorista.id,
      {
        $set: {
          lat: latNum,
          lng: lngNum,
          location: {
            lat: latNum,
            lng: lngNum,
            updatedAt: serverUpdatedAt,
            clientTs,
            accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
            speed: Number.isFinite(Number(speed)) ? Number(speed) : null,
            heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
          },
        },
      },
      { new: false }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erro POST /motorista/localizacao:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao atualizar localização" });
  }
});
router.get("/pendentes", async (req, res) => {
  try {
    const pendentes = await Motorista.find({ aprovacao: "pendente" }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: pendentes,
    });
  } catch (err) {
    console.error("Erro GET /motorista/pendentes:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao listar motoristas pendentes",
    });
  }
});
router.post("/aprovar", async (req, res) => {
  try {
    const { id } = req.body || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID é obrigatório",
      });
    }

    await Motorista.findByIdAndUpdate(id, {
      aprovacao: "aprovado",
      "documentos.$[].status": "aprovado" // Aprova todos os documentos também
    });

    return res.json({
      success: true,
      message: "Motorista aprovado",
    });
  } catch (err) {
    console.error("Erro POST /motorista/aprovar:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao aprovar motorista",
    });
  }
});

router.post("/rejeitar", async (req, res) => {
  try {
    const { id, motivo } = req.body || {}; // Adicionado 'motivo' para rejeição mais detalhada

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID é obrigatório",
      });
    }

    // Se você tem um painel onde pode rejeitar documentos específicos,
    // a lógica abaixo pode ser mais complexa. Aqui, rejeita o motorista e marca os documentos como rejeitados
    await Motorista.findByIdAndUpdate(id, {
      aprovacao: "rejeitado",
      "documentos.$[].status": "rejeitado", // Marca todos os documentos como rejeitados
      "documentos.$[].motivoRejeicao": motivo || "Rejeitado pelo administrador", // Adiciona motivo, se fornecido
    });

    return res.json({
      success: true,
      message: "Motorista rejeitado",
    });
  } catch (err) {
    console.error("Erro POST /motorista/rejeitar:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao rejeitar motorista",
    });
  }
});


/* ================================================================
   POST /api/motorista/logout
   Limpa o cookie de sessão do motorista.
================================================================ */
router.post("/logout", authMotorista, (req, res) => {
  clearCookieToken(res, "rm_motorista_token");
  return res.json({ success: true, message: "Sessão terminada." });
});

/* ================================================================
   POST /api/motorista/disponibilidade
   O motorista alterna-se entre Online (disponível para receber
   viagens) e Offline — estilo Uber. Actualiza Motorista.disponivel,
   o mesmo campo já usado pelo motor de despacho (autoDispatch) para
   filtrar quem pode receber pedidos.
   body: { disponivel: true|false }
================================================================ */
router.post("/disponibilidade", authMotorista, async (req, res) => {
  try {
    const disponivel = !!req.body?.disponivel;
    const motorista = await Motorista.findByIdAndUpdate(
      req.motorista.id,
      { disponivel },
      { new: true }
    ).select("disponivel nome");
    if (!motorista) return res.status(404).json({ success: false, message: "Motorista não encontrado." });
    return res.json({ success: true, disponivel: motorista.disponivel });
  } catch (err) {
    console.error("Erro POST /motorista/disponibilidade:", err);
    return res.status(500).json({ success: false, message: "Erro ao actualizar disponibilidade." });
  }
});

/* ================================================================
   PATCH /api/motorista/categorias
   Ativa/desativa as categorias que este motorista quer receber
   pedidos — grava no VEÍCULO atribuído (categoriasAtivas), não no
   Motorista, porque a categoria é uma característica do carro, não
   da pessoa. É este mesmo campo que dispatch.auto.service.js lê
   para filtrar candidatos — mudar aqui tem efeito real e imediato
   no despacho, não é só visual.

   IMPORTANTE: o motorista só pode ligar categorias dentro de
   Veiculo.categoriasPermitidas — o teto fixo definido pelo admin
   (painel "Categorias Veículos", por Marca/Modelo). Antes, a
   validação era só contra o enum GLOBAL de 7 categorias, o que
   deixava o motorista ligar, por exemplo, "luxury" num carro
   económico que o admin nunca autorizou para esse serviço.
   Body: { categoriasAtivas: ["economica","grupo6",...] }
================================================================ */
router.patch("/categorias", authMotorista, async (req, res) => {
  try {
    const enviado = Array.isArray(req.body?.categoriasAtivas) ? req.body.categoriasAtivas : null;
    if (!enviado) {
      return res.status(400).json({ success: false, message: "categoriasAtivas deve ser uma lista." });
    }

    const veiculoAtual = await Veiculo.findOne({ motoristaId: req.motorista.id })
      .select("categoriasPermitidas");
    if (!veiculoAtual) {
      return res.status(404).json({ success: false, message: "Nenhum veículo atribuído a este motorista — selecione um veículo primeiro." });
    }

    const permitidas = veiculoAtual.categoriasPermitidas || [];
    if (!permitidas.length) {
      return res.status(400).json({
        success: false,
        message: "Este veículo ainda não tem categorias autorizadas pelo admin. Contacte o administrador.",
      });
    }

    // Filtra contra o TETO deste veículo específico, não contra o
    // enum global — é a diferença entre "categorias que existem no
    // sistema" e "categorias que este carro tem autorização a fazer".
    const categoriasAtivas = [...new Set(enviado.map(String))].filter(c => permitidas.includes(c));

    if (!categoriasAtivas.length) {
      return res.status(400).json({
        success: false,
        message: "Nenhuma categoria válida para este veículo.",
        permitidas,
      });
    }

    const veiculo = await Veiculo.findOneAndUpdate(
      { motoristaId: req.motorista.id },
      { categoriasAtivas },
      { new: true }
    ).select("categoriasAtivas categoriasPermitidas categoria matricula");

    return res.json({ success: true, categoriasAtivas: veiculo.categoriasAtivas, categoriasPermitidas: veiculo.categoriasPermitidas });
  } catch (err) {
    console.error("Erro PATCH /motorista/categorias:", err);
    return res.status(500).json({ success: false, message: "Erro ao atualizar categorias." });
  }
});

/* ================================================================
   GET /api/motorista/me
   Devolve dados do motorista autenticado + veículo atual.

   IMPORTANTE: o veículo atual NÃO vem de Motorista.veiculoId (campo
   estático, atribuição fixa — modelo antigo). Vem de uma consulta
   dinâmica a Veiculo.motoristaId, a MESMA fonte de verdade única
   usada por todo o fluxo de seleção de veículo (POST
   /veiculo/selecionar/:id, GET /veiculo/atual, GET /frota-disponivel
   em motoristaVeiculos.routes.js). Isto evita ter dois campos
   diferentes (Motorista.veiculoId vs Veiculo.motoristaId) a poderem
   discordar um do outro — só existe um sítio onde a associação
   motorista↔veículo é gravada.

   O resultado é devolvido como "motorista.veiculoId" para não obrigar
   a mudar todo o código do frontend que já lê esse campo — só a
   FONTE dos dados mudou, a forma como chega ao cliente é a mesma.
================================================================ */
router.get("/me", authMotorista, async (req, res) => {
  try {
    const motorista = await Motorista.findById(req.motorista.id)
      .select("-passwordHash")
      .lean();
    if (!motorista) return res.status(404).json({ success: false, message: "Motorista não encontrado." });

    const veiculoAtual = await Veiculo.findOne({ motoristaId: req.motorista.id })
      .select("marca modelo matricula cor categoria categoriasAtivas categoriasPermitidas capacidade aprovacao estado")
      .lean();

    motorista.veiculoId = veiculoAtual || null;

    return res.json({ success: true, motorista });
  } catch (err) {
    console.error("Erro GET /motorista/me:", err);
    return res.status(500).json({ success: false, message: "Erro ao obter dados." });
  }
});

/* ================================================================
   GET /api/motorista/viagens
   Devolve as viagens atribuídas a este motorista — pendentes, em
   curso, e as concluídas nos últimos 7 dias (para o histórico ficar
   consultável). O frontend (motorista.html → carregarViagens) espera
   os campos: partida, destino, datahora, status, valor, categoria.
   Mapeamos os campos canónicos do Trip (pickup/dropoff/when/quote)
   para os nomes esperados, e caímos nos campos legacy quando
   necessário (viagens antigas ainda gravadas com origem/destino).
================================================================ */
router.get("/viagens", authMotorista, async (req, res) => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.motorista.id);
    const setedias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const viagensRaw = await Trip.find({
      "driver.driverId": driverId,
      $or: [
        { status: { $in: ["pendente", "confirmada", "assigned", "in_progress"] } },
        { status: "concluida", when: { $gte: setedias } },
      ],
    })
      .sort({ when: 1 })
      .lean();

    const viagens = viagensRaw.map(v => ({
      _id:       String(v._id),
      origem:    "trip",
      partida:   v.pickup   || v.origem  || v.from || "—",
      destino:   v.dropoff  || v.destino || v.to   || "—",
      datahora:  v.when     || v.createdAt,
      status:    v.status   || "pendente",
      valor:     v.quote?.total ?? v.valor ?? 0,
      categoria: v.quote?.categoria || v.categoria || "",
      cliente:   v.customer?.nome  || "",
      contacto:  v.customer?.contacto || "",
    }));

    // ── Reservas atribuídas via dispatch.service.js (Reserva) ──────
    // Sistema paralelo ao Trip, usado pelo fluxo real de reserva do
    // site (reservas.routes.js → despacharReserva). Sem isto, uma
    // reserva atribuída ao motorista nunca aparecia aqui — o
    // polling só olhava para Trip, nunca para Reserva. Reservas
    // deste sistema já chegam "atribuida" directamente (não há
    // passo de aceitar/recusar como no Trip), por isso entram já
    // prontas para o motorista iniciar a viagem.
    const reservasRaw = await Reserva.find({
      motoristaId: driverId,
      $or: [
        { status: { $in: ["atribuida", "em_viagem"] } },
        { status: "concluida", datahora: { $gte: setedias } },
      ],
    })
      .sort({ datahora: 1 })
      .lean();

    const viagensReserva = reservasRaw.map(r => ({
      _id:       String(r._id),
      origem:    "reserva",
      partida:   r.partida || "—",
      destino:   r.destino || "—",
      datahora:  r.datahora,
      status:    r.status  || "atribuida",
      valor:     r.valor ?? 0,
      categoria: r.categoria || "",
      cliente:   r.nome     || "",
      contacto:  r.contacto || "",
    }));

    const todas = [...viagens, ...viagensReserva].sort(
      (a, b) => new Date(a.datahora || 0) - new Date(b.datahora || 0)
    );

    return res.json({ success: true, viagens: todas });
  } catch (err) {
    console.error("Erro GET /motorista/viagens:", err);
    return res.status(500).json({ success: false, message: "Erro ao carregar viagens." });
  }
});

/* ================================================================
   GET /api/motorista/ganhos
   Totais de faturação do motorista — agregado directamente sobre
   Trip (status "concluida"), sem tabela paralela a manter em
   sincronia. ASSUNÇÃO: comissão fixa de 85% para o motorista — se
   existir uma taxa por motorista/gestor no schema, esta rota deve
   passar a usar esse valor em vez do fixo abaixo.
================================================================ */
const COMISSAO_MOTORISTA = 0.85;

router.get("/ganhos", authMotorista, async (req, res) => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.motorista.id);

    const [totais] = await Trip.aggregate([
      { $match: { "driver.driverId": driverId, status: "concluida" } },
      { $group: {
          _id: null,
          totalBruto: { $sum: { $ifNull: ["$quote.total", "$valor"] } },
          viagensConcluidas: { $sum: 1 },
        } },
    ]);

    const totalBruto = totais?.totalBruto || 0;
    const viagensConcluidas = totais?.viagensConcluidas || 0;
    const totalMotorista = Math.round(totalBruto * COMISSAO_MOTORISTA * 100) / 100;

    // Últimas 8 semanas ISO, mais recente primeiro
    const semanasAgg = await Trip.aggregate([
      { $match: { "driver.driverId": driverId, status: "concluida", when: { $ne: null } } },
      { $group: {
          _id: { year: { $isoWeekYear: "$when" }, week: { $isoWeek: "$when" } },
          totalBruto: { $sum: { $ifNull: ["$quote.total", "$valor"] } },
          viagensConcluidas: { $sum: 1 },
        } },
      { $sort: { "_id.year": -1, "_id.week": -1 } },
      { $limit: 8 },
    ]);

    const semanas = semanasAgg.map(s => ({
      year: s._id.year,
      weekNumber: s._id.week,
      totalBruto: s.totalBruto,
      viagensConcluidas: s.viagensConcluidas,
    }));

    return res.json({ success: true, totalBruto, totalMotorista, viagensConcluidas, semanas });
  } catch (err) {
    console.error("Erro GET /motorista/ganhos:", err);
    return res.status(500).json({ success: false, message: "Erro ao calcular ganhos." });
  }
});

/* ================================================================
   GET /api/motorista/ganhos/historico?periodo=dia|semana
   Faturação por dia (hoje) ou por semana (Seg-Dom da semana
   actual, dia a dia) — usado pelo gráfico DIA/SEMANA no
   motorista.html. Agregação directa sobre Trip.when (data/hora da
   viagem) — NOTA: Trip.js não tem um campo "concluidaEm" próprio;
   se vier a existir, esta agregação deve passar a usar esse campo
   em vez de "when", para refletir quando a viagem foi de facto
   fechada e não apenas a hora marcada para a recolha.
================================================================ */
router.get("/ganhos/historico", authMotorista, async (req, res) => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.motorista.id);
    const periodo  = req.query.periodo === "dia" ? "dia" : "semana";
    const TZ = "Europe/Lisbon";

    if (periodo === "dia") {
      const agora = new Date();
      const inicioDia = new Date(agora); inicioDia.setHours(0, 0, 0, 0);
      const fimDia    = new Date(agora); fimDia.setHours(23, 59, 59, 999);

      const [r] = await Trip.aggregate([
        { $match: {
            "driver.driverId": driverId, status: "concluida",
            when: { $gte: inicioDia, $lte: fimDia },
          } },
        { $group: { _id: null, valor: { $sum: { $ifNull: ["$quote.total", "$valor"] } } } },
      ]);

      return res.json({
        success: true,
        data:  inicioDia.toISOString(),
        label: "Hoje",
        valor: r?.valor || 0,
      });
    }

    // SEMANA — Segunda a Domingo da semana actual
    const agora = new Date();
    const diaSemana = (agora.getDay() + 6) % 7; // 0 = Segunda
    const segunda = new Date(agora); segunda.setDate(agora.getDate() - diaSemana); segunda.setHours(0, 0, 0, 0);
    const domingo  = new Date(segunda); domingo.setDate(segunda.getDate() + 6); domingo.setHours(23, 59, 59, 999);

    const porDia = await Trip.aggregate([
      { $match: {
          "driver.driverId": driverId, status: "concluida",
          when: { $gte: segunda, $lte: domingo },
        } },
      { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$when", timezone: TZ } },
          valor: { $sum: { $ifNull: ["$quote.total", "$valor"] } },
        } },
    ]);

    const mapaValores = new Map(porDia.map(d => [d._id, d.valor]));
    const nomes = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(segunda); d.setDate(segunda.getDate() + i);
      const chave = d.toISOString().slice(0, 10);
      dias.push({ data: d.toISOString(), label: nomes[i], valor: mapaValores.get(chave) || 0 });
    }
    const total = dias.reduce((s, d) => s + d.valor, 0);

    return res.json({
      success: true,
      dataInicio: segunda.toISOString(),
      dataFim:    domingo.toISOString(),
      dias,
      total,
    });
  } catch (err) {
    console.error("Erro GET /motorista/ganhos/historico:", err);
    return res.status(500).json({ success: false, message: "Erro ao calcular histórico de ganhos." });
  }
});

/* ================================================================
   DESCONTINUADO — GET /api/motorista/veiculos-disponiveis
   POST /api/motorista/selecionar-veiculo

   Estas duas rotas formavam um segundo sistema de seleção de
   veículo (paralelo ao de motoristaVeiculos.routes.js), sem
   proteção contra condições de corrida e com semântica inconsistente
   do campo Veiculo.disponivel. Podiam desassociar silenciosamente um
   veículo de um motorista em serviço activo.

   Consolidado num único sistema — usar:
     GET  /api/motorista/frota-disponivel     (lista + estado)
     POST /api/motorista/veiculo/selecionar/:id
   (ambas em motoristaVeiculos.routes.js)

   Mantidas aqui como stubs 410 Gone, em vez de removidas por
   completo, para que qualquer chamador antigo (outra página, app
   mobile futura) receba um erro claro e acionável em vez de um 404
   silencioso difícil de diagnosticar.
================================================================ */
router.get("/veiculos-disponiveis", authMotorista, (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Rota descontinuada. Usar GET /api/motorista/frota-disponivel.",
  });
});

router.post("/selecionar-veiculo", authMotorista, (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Rota descontinuada. Usar POST /api/motorista/veiculo/selecionar/:id.",
  });
});


export default router;