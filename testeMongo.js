<<<<<<< HEAD
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function testarMongo() {
  try {
    await client.connect();
    console.log('✅ Conectado ao MongoDB com sucesso!');

    const db = client.db(); // usa o banco definido na URI
    const colecoes = await db.listCollections().toArray();
    console.log('Coleções existentes:', colecoes.map(c => c.name));
    
    await client.close();
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB:', err);
  }
}

testarMongo();
=======
// Script de teste do MongoDB
require('dotenv').config();
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);

async function test() {
  try {
    await client.connect();
    console.log("✅ Conectado ao MongoDB!");
    const db = client.db();
    const collection = db.collection("reservas");
    const count = await collection.countDocuments();
    console.log(`Total de reservas: ${count}`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

test();
>>>>>>> 117cbf1 (Commit inicial do projeto reserva-backend)
