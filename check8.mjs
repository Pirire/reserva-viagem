import dotenv from 'dotenv'; 
dotenv.config(); 
import mongoose from 'mongoose'; 
import { connectDB } from './src/config/db.js'; 
await connectDB(); 
const col = mongoose.connection.db.collection('conviteparceiros'); 
const r = await col.findOne({email:'realmetropoli@gmail.com'},{projection:{status:1,passwordHash:1,email:1}}); 
console.log(JSON.stringify(r)); 
process.exit(0); 
