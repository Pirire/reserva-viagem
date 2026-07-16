// models/Config.js
import mongoose from "mongoose";

const configSchema = new mongoose.Schema({
  tempoExtra: {
    type: Map,
    of: Number,
    default: {}
  }
});

const Config = mongoose.model("Config", configSchema);
export default Config;
