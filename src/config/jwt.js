import jwt from "jsonwebtoken";

export function signJwt(payload, expiresIn) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não definido no .env");
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyJwt(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não definido no .env");
  return jwt.verify(token, secret);
}
