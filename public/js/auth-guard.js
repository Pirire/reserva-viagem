// auth-guard.js
// Guard simples para páginas estáticas (front-only).
// Valida: token existe, formato JWT, expiração e role/aprovacao.
// NOTA: isto é proteção "UX/client-side". Segurança real exige o backend validar token em cada API.

(function () {
  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function base64UrlDecode(str) {
    try {
      str = str.replace(/-/g, "+").replace(/_/g, "/");
      const pad = str.length % 4;
      if (pad) str += "=".repeat(4 - pad);
      const decoded = atob(str);
      return decodeURIComponent(Array.prototype.map.call(decoded, c =>
        "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
      ).join(""));
    } catch {
      return null;
    }
  }

  function decodeJwt(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = base64UrlDecode(parts[1]);
    if (!payload) return null;
    return safeJsonParse(payload);
  }

  function isExpired(payload) {
    // exp em segundos
    if (!payload || typeof payload.exp !== "number") return false; // se não houver exp, não bloqueia
    const now = Math.floor(Date.now() / 1000);
    return payload.exp <= now;
  }

  function getTokens() {
    return {
      cliente: localStorage.getItem("token_cliente") || localStorage.getItem("auth_token"),
      colaborador: localStorage.getItem("token_colaborador"),
      motorista: localStorage.getItem("motorista_token"), // ✅ motorista
    };
  }

  function clearAllTokens() {
    localStorage.removeItem("token_cliente");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("token_colaborador");
    localStorage.removeItem("motorista_token"); // ✅ motorista
  }

  function go(url) {
    window.location.href = url;
  }

  // ---------- regras ----------
  // area: "cliente" | "colaborador" | "motorista" | "admin"
  // tipoEmpresa: "frota" | "hotel" | "alojamento" (para colaborador)
  function requireAccess({ area, tipoEmpresa, onFail = "./index.html" } = {}) {
    const t = getTokens();

    // 1) escolher token correto
    let token = null;
    if (area === "cliente") token = t.cliente;
    if (area === "colaborador") token = t.colaborador;
    if (area === "motorista") token = t.motorista; // ✅
    if (area === "admin") token = localStorage.getItem("token_admin"); // opcional/futuro

    if (!token) {
      go(onFail);
      return;
    }

    // 2) validar JWT básico + expiração
    const payload = decodeJwt(token);
    if (!payload) {
      clearAllTokens();
      go(onFail);
      return;
    }

    if (isExpired(payload)) {
      clearAllTokens();
      go(onFail);
      return;
    }

    // 3) validar role/tipo/aprovacao
    const role = (payload.role || payload.tipo || payload.perfil || "").toLowerCase();
    const tipo = (payload.tipoEmpresa || payload.tipo_empresa || payload.empresaTipo || payload.colabTipo || "").toLowerCase();

    if (area === "cliente") {
      if (role && role !== "cliente") {
        go(onFail);
        return;
      }
    }

    if (area === "colaborador") {
      if (role && role !== "colaborador") {
        go(onFail);
        return;
      }
      if (tipoEmpresa) {
        if (!tipo || tipo !== tipoEmpresa.toLowerCase()) {
          go(onFail);
          return;
        }
      }
    }

    // ✅ motorista só entra se aprovado
    if (area === "motorista") {
      if (role && role !== "motorista") {
        go(onFail);
        return;
      }

      const aprovacao = (payload.aprovacao || "").toLowerCase();
      if (aprovacao !== "aprovado") {
        go("/aguardando-aprovacao.html");
        return;
      }
    }

    // se passou, ok
  }

  window.AuthGuard = {
    require: requireAccess,
    decodeJwt,
    clearAllTokens,
    getTokens,
  };
})();
