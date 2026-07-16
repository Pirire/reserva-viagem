import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error("Nao encontrei a variavel de ligacao ao MongoDB no .env.");
  process.exit(1);
}

const VeiculoSchema = new mongoose.Schema({}, { strict: false });
const Veiculo = mongoose.models.Veiculo || mongoose.model("Veiculo", VeiculoSchema, "veiculos");

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Ligado ao MongoDB.");
  console.log("   Base de dados:", mongoose.connection.name);
  console.log("   Host:", mongoose.connection.host);
  console.log("   Pasta de onde correu (cwd):", process.cwd());
  console.log("");

  const matricula = "00-PP-00";
  const todosComEstaMatricula = await Veiculo.find({ matricula });
  console.log(`Documentos encontrados com matricula ${matricula}: ${todosComEstaMatricula.length}`);
  if (todosComEstaMatricula.length > 1) {
    console.log("ATENCAO: ha mais do que um documento com esta matricula!");
    todosComEstaMatricula.forEach((v, i) => {
      console.log(`   [${i}] _id=${v._id} marca="${v.marca}" modelo="${v.modelo}"`);
    });
  }

  const veiculo = await Veiculo.findOne({ matricula });

  if (!veiculo) {
    console.error(`Nenhum veiculo encontrado com matricula ${matricula}.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("Antes:", { marca: veiculo.marca, modelo: veiculo.modelo, _id: veiculo._id });

  veiculo.marca  = "Ford";
  veiculo.modelo = "Mustang Mach-E";

  try {
    const resultado = await veiculo.save();
    console.log("Resultado do save() - marca/modelo gravados:", { marca: resultado.marca, modelo: resultado.modelo });
  } catch (saveErr) {
    console.error("ERRO AO GRAVAR (save falhou):", saveErr);
    await mongoose.disconnect();
    process.exit(1);
  }

  const confirmacao = await Veiculo.findById(veiculo._id).lean();
  console.log("Confirmacao (relido da BD):", { marca: confirmacao.marca, modelo: confirmacao.modelo });

  console.log("Corrigido com sucesso.");

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
