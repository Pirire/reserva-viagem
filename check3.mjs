import dotenv from 'dotenv'; 
dotenv.config(); 
import { connectDB } from './src/config/db.js'; 
import ConviteParceiro from './src/models/convitesParceiros.js'; 
await connectDB(); 
const docs = await ConviteParceiro.find().select('email contactos').lean(); 
console.log(JSON.stringify(docs, null, 2)); 
process.exit(0); 
