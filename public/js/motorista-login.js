/* ================================================================
   public/js/motorista-login.js
   Login do motorista — httpOnly cookie, zero localStorage de tokens
================================================================ */
(() => {
  const btnLogin    = document.getElementById("btnLogin");
  const emailInput  = document.getElementById("email");
  const senhaInput  = document.getElementById("senha");
  const msgEl       = document.getElementById("msg");
  const togglePwd   = document.getElementById("togglePwd");
  const clearSess   = document.getElementById("clearSession");

  /* ── Mensagem ───────────────────────────────────────────── */
  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className   = type || "";
    msgEl.style.display = "block";
  }

  function clearMsg() {
    msgEl.textContent   = "";
    msgEl.style.display = "none";
  }

  /* ── Mostrar/ocultar senha ──────────────────────────────── */
  if (togglePwd) {
    togglePwd.onclick = () => {
      const show = senhaInput.type === "password";
      senhaInput.type     = show ? "text" : "password";
      togglePwd.textContent = show ? "ocultar senha" : "mostrar senha";
    };
  }

  /* ── Limpar sessão ──────────────────────────────────────── */
  if (clearSess) {
    clearSess.onclick = async () => {
      try { await fetch("/api/motorista/logout", { method: "POST", credentials: "include" }); } catch {}
      showMsg("Sessão terminada.", "ok");
    };
  }

  /* ── Login ──────────────────────────────────────────────── */
  async function login() {
    clearMsg();

    const email = (emailInput?.value || "").trim().toLowerCase();
    const senha = (senhaInput?.value || "");

    if (!email || !senha) {
      showMsg("Preencha o email e a senha.", "error");
      return;
    }

    btnLogin.disabled     = true;
    btnLogin.textContent  = "A entrar…";

    try {
      const res  = await fetch("/api/motorista/login", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ email, senha }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = String(data?.message || "");
        if (res.status === 403 || msg.toLowerCase().includes("aprovação")) {
          // Redirecionar para página de aguarda aprovação
          window.location.href = "/aguardando-aprovacao.html";
          return;
        }
        showMsg(data?.message || "Credenciais inválidas.", "error");
        return;
      }

      showMsg("Login efectuado!", "ok");
      // Redirecionar para o painel
      setTimeout(() => { window.location.href = "/motorista.html"; }, 600);

    } catch {
      showMsg("Erro de ligação ao servidor.", "error");
    } finally {
      btnLogin.disabled    = false;
      btnLogin.textContent = "Entrar";
    }
  }

  /* ── Eventos ────────────────────────────────────────────── */
  btnLogin?.addEventListener("click", login);

  // Enter nos campos
  [emailInput, senhaInput].forEach(el => {
    el?.addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  });

})();