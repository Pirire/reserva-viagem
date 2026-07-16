import dotenv from 'dotenv'; 
dotenv.config(); 
import { connectDB } from './src/config/db.js'; 
import Reserva from './src/models/Reserva.js'; 
await connectDB(); 
const r = await Reserva.findById('69ef11f511e2b2731411e775').lean(); 
console.log(JSON.stringify(r, null, 2)); 
process.exit(0); 
