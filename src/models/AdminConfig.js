import mongoose from "mongoose";

const AdminConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    repeatDriverEnabled: {
      type: Boolean,
      default: true,
    },

    repeatDriverMaxDistanceKm: {
      type: Number,
      default: 5,
    },

    repeatDriverMaxMinutes: {
      type: Number,
      default: 60,
    },

    repeatDriverEmpresaPercent: {
      type: Number,
      default: 7.5,
    },

    repeatDriverMotoristaPercent: {
      type: Number,
      default: 92.5,
    },
  },
  {
    timestamps: true,
    collection: "adminconfigs",
  }
);

const AdminConfig =
  mongoose.models.AdminConfig ||
  mongoose.model("AdminConfig", AdminConfigSchema);

export default AdminConfig;