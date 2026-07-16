// public/js/auth-guard.js
(() => {
  const TOKEN_KEY = "motorista_token";

  // Páginas públicas (não devem ser bloqueadas)
  const PUBLIC_PATHS = [
    "/",
    "/index.html",
    "/motorista-login.html",
    "/motorista-primeiro-acesso.html",
    "/motorista-definir-senha.html",
    "/aguardando-aprovacao.html",
  ];

  const path = window.location.pathname;

  // Se estamos numa página pública, não faz nada
  if (PUBLIC_PATHS.includes(path)) return;

  // Só protege páginas do motorista (ajusta se tiveres mais páginas)
  const isMotoristaArea = path === "/motorista.html";
  if (!isMotoristaArea) return;

  const token = localStorage.getItem(TOKEN_KEY);

  // Sem token → manda para login
  if (!token) {
    window.location.href = "/motorista-login.html";
    return;
  }

  // ✅ Se existe token, não redireciona para aguardando aqui.
  // A aprovação já é garantida no backend no endpoint /api/motorista/login.
  // Qualquer endpoint protegido deve validar o JWT (authMotorista).
})();
