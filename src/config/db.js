import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    throw new Error("MONGODB_URI (ou MONGO_URI) não definido no .env");
  }

  await mongoose.connect(uri);

  console.log("✅ MongoDB conectado");
  console.log("📦 Database usada:", mongoose.connection.name);
  console.log("📚 Coleções visíveis:", Object.keys(mongoose.connection.collections));
}