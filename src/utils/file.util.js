import fs from "fs";
import path from "path";

export function mapFile(file, publicBaseUrl) {
  if (!file) return null;

  // file.path é absoluto no disco; queremos URL pública
  // Ex: /public/uploads/registos/<id>/<ficheiro>
  const normalized = file.path.split(path.sep).join("/");
  const idx = normalized.lastIndexOf("/public/");
  const publicPath = idx >= 0 ? normalized.slice(idx + "/public".length) : null;

  return {
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    url: publicPath ? `${publicBaseUrl}${publicPath}` : null, // opcional
    path: publicPath, // guardar isto é útil (relativo ao /public)
  };
}

export function safeUnlink(filePathAbs) {
  try {
    fs.unlinkSync(filePathAbs);
  } catch {
    // ignore
  }
}

export function cleanupUploadedFiles(req) {
  const files = req.files || {};
  Object.values(files).flat().forEach((f) => safeUnlink(f.path));
}
