require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI não definida!");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
let reservasCollection;

async function connectDB() {
  try {
    await client.connect();
    reservasCollection = client.db("reservasDB").collection("reservas");
    console.log("✅ MongoDB conectado!");
  } catch (err) { console.error(err); }
}
connectDB();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// Criar checkout Stripe
app.post("/checkout", async (req, res) => {
  try {
    const { valor, nome, email } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [{
        price_data: { currency: "eur", product_data: { name: `Reserva de viagem - ${nome}` }, unit_amount: Math.round(valor*100) },
        quantity: 1,
      }],
      success_url: process.env.SUCCESS_URL || "http://localhost:4000/sucesso",
      cancel_url: process.env.CANCEL_URL || "http://localhost:4000/cancelado",
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Registrar reserva
app.post("/reserva", async (req, res) => {
  try {
    const { nome, email, partida, destino, data } = req.body;
    const reserva = { nome, email, partida, destino, data, createdAt: new Date() };
    await reservasCollection.insertOne(reserva);
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Confirmação da Reserva",
      text: `Olá ${nome}, sua reserva de ${partida} para ${destino} em ${data} foi confirmada!`,
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancelar reserva
app.post("/cancelar-reserva", async (req, res) => {
  try {
    const { codigo } = req.body;
    const result = await reservasCollection.deleteOne({ _id: codigo }); // ajuste se usar outro campo
    if(result.deletedCount>0) res.json({ success:true });
    else res.json({ success:false, message:"Reserva não encontrada" });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>console.log(`🚀 Servidor rodando na porta ${PORT}`));
