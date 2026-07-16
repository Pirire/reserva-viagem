import dotenv from 'dotenv'; 
dotenv.config(); 
import { connectDB } from './src/config/db.js'; 
import ConviteParceiro from './src/models/convitesParceiros.js'; 
await connectDB(); 
const r = await ConviteParceiro.findByIdAndUpdate('69ed86d4d9a374a6fb9d49ae', {$push:{contactos:{nome:'Teste',tel:'999'}}},{new:true}).select('contactos').lean(); 
console.log(JSON.stringify(r,null,2)); 
process.exit(0); 
