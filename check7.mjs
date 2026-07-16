import dotenv from 'dotenv'; 
dotenv.config(); 
import { connectDB } from './src/config/db.js'; 
import ConviteParceiro from './src/models/convitesParceiros.js'; 
await connectDB(); 
const r = await ConviteParceiro.findOne({email:'realmetropoli@gmail.com'}).select('status passwordHash').lean(); 
process.exit(0); 
