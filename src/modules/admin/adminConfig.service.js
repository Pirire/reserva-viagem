import AdminConfig from "../../models/AdminConfig.js";

export async function getAdminConfig() {
  let config = await AdminConfig.findOne({ key: "main" });

  if (!config) {
    config = await AdminConfig.create({
      key: "main",
      repeatDriverEnabled: true,
      repeatDriverMaxDistanceKm: 5,
      repeatDriverMaxMinutes: 60,
      repeatDriverEmpresaPercent: 7.5,
      repeatDriverMotoristaPercent: 92.5,
    });
  }

  return config;
}

export async function updateAdminConfig(data) {
  const config = await getAdminConfig();

  Object.assign(config, data);

  await config.save();

  return config;
}