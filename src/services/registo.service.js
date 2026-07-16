import Motorista from "../models/Motorista.js";
import Veiculo from "../models/Veiculo.js"; // recomendado
import { mapFile } from "../utils/file.util.js";

function badRequest(msg) {
  const e = new Error(msg);
  e.statusCode = 400;
  e.publicMessage = msg;
  return e;
}

export const registoService = {
  async criarRegisto(req) {
    const body = req.body || {};

    // 🔒 validações mínimas (profissional, sem exagero)
    const nome = String(body.nome || "").trim();
    const contacto = String(body.contacto || "").trim();
    const email = String(body.email || "").trim();

    const matricula = String(body.matricula || "").trim().toUpperCase();
    const marca = String(body.marca || "").trim();
    const modelo = String(body.modelo || "").trim();

    if (!nome || !contacto) throw badRequest("nome e contacto são obrigatórios");
    if (!matricula) throw badRequest("matricula é obrigatória");

    // 📎 ficheiros
    const docCarta = mapFile(req.files?.doc_carta?.[0], "");
    const docCC = mapFile(req.files?.doc_cc?.[0], "");
    const docSeguro = mapFile(req.files?.doc_seguro?.[0], "");
    const docInspecao = mapFile(req.files?.doc_inspecao?.[0], "");
    const fotos = (req.files?.foto_veiculo || []).map((f) => mapFile(f, ""));

    // ✅ recomendado: Veiculo separado
    const veiculo = await Veiculo.create({
      matricula,
      marca,
      modelo,
      documentos: {
        seguro: docSeguro,
        inspecao: docInspecao,
      },
      fotos,
      estado: "pendente",
    });

    const motorista = await Motorista.create({
      nome,
      contacto,
      email,
      veiculoId: veiculo._id,
      documentos: {
        cartaConducao: docCarta,
        cc: docCC,
      },
      aprovacao: "pendente",
    });

    return { motoristaId: motorista._id, veiculoId: veiculo._id, registoId: req.registoId };
  },
};
