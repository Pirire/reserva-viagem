import mongoose from "mongoose";
import dotenv from "dotenv";
import Admin from "./models/Admin.js";

dotenv.config();

const mongoURI = process.env.MONGODB_URI;

const createAdmin = async () => {
  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    const admin = new Admin({ username: "admin", password: "1234" });
    await admin.save();
    console.log("✅ Admin criado com sucesso!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro ao criar admin:", err);
    process.exit(1);
  }
};

 } 
};

createAdmin();