export function verifyJWT(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ success: false });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ success: false });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false });
    req.user = decoded;
    next();
  });
}
