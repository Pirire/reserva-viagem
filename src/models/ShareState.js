import mongoose from "mongoose";

const ShareStateSchema = new mongoose.Schema(
  {
    shareId: { type: String, required: true, unique: true, index: true },

    destino: {
      address: { type: String, default: "" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      setAt: { type: Number, default: null },
    },

    // ordem dos passageiros (contactos normalizados)
    order: { type: [String], default: [] },

    updatedAtMs: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ShareState", ShareStateSchema);
