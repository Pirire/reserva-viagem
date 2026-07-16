import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
const CATEGORIAS = ["economica","confort","executive","luxury","grupo6","grupo8","grupo17"];
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
const VehicleCategoryRuleSchema = new Schema({
  marca:       { type: String, required: true, trim: true },
  marcaLabel:  { type: String, required: true, trim: true },
  modelo:      { type: String, required: true, trim: true },
  modeloLabel: { type: String, required: true, trim: true },
  categorias:  { type: [String], enum: CATEGORIAS, default: [] },
}, { timestamps: true });
VehicleCategoryRuleSchema.index({ marca: 1, modelo: 1 }, { unique: true });
VehicleCategoryRuleSchema.pre("validate", function (next) {
  if (this.marcaLabel)  this.marca  = normalizar(this.marcaLabel);
  if (this.modeloLabel) this.modelo = normalizar(this.modeloLabel);
  next();
});
export { normalizar as normalizarMarcaModelo, CATEGORIAS as CATEGORIAS_VALIDAS };
export default models.VehicleCategoryRule || model("VehicleCategoryRule", VehicleCategoryRuleSchema);
