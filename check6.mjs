import dotenv from 'dotenv'; 
dotenv.config(); 
import mongoose from 'mongoose'; 
import { connectDB } from './src/config/db.js'; 
await connectDB(); 
const col = mongoose.connection.db.collection('conviteparceiros'); 
const r = await col.findOneAndUpdate({email:'realmetropoli@gmail.com'},{$push:{contactos:{nome:'Teste',tel:'111',criadoEm:new Date()}}},{returnDocument:'after',projection:{contactos:1}}); 
console.log(JSON.stringify(r,null,2)); 
process.exit(0); 
