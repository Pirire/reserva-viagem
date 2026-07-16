// ─────────────────────────────────────────────────────────────
// rm-payment.js — Modal de Pagamento (Stripe + PayPal)
// ─────────────────────────────────────────────────────────────


/* ══════════════════════════════════════════════════════════════
   _rmPag — módulo de pagamento REALMETROPOLIS
   Stripe + PayPal + polling de motorista após pagamento
══════════════════════════════════════════════════════════════ */
const _rmPag = (() => {
  const API = location.origin.includes('10000') ? location.origin : location.origin;
  let stripeInst=null, stripeEls=null, stripeCard=null;
  let ppReady=false;
  let _codigo='', _valor=0, _emailPassageiro='';

  /* Abrir modal */
  function abrir({ codigo, nome, emailPassageiro, partida, destino, datahora, categoria, km, portagens, valor }) {
    _codigo = codigo; _valor = Number(valor) || 0; _emailPassageiro = emailPassageiro || '';
    document.getElementById('rmCodigo').textContent = codigo;

    // Formatar data/hora para pt-PT
    let dtFormatada = '—';
    if (datahora) {
      try {
        dtFormatada = new Date(datahora).toLocaleString('pt-PT', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      } catch(_) {}
    }

    const reqLabels = { ovo: 'Ovo', cadeirinha: 'Cadeirinha', elevacao: 'Elevação' };
    const reqLido = {};
    document.querySelectorAll('.req-esp-btn').forEach(btn => {
      const sel = btn.classList.contains('sel') || btn.classList.contains('selected');
      if (!sel) return;
      const key = btn.dataset.req;
      if (!key) return;
      const qtyEl = btn.querySelector('.req-esp-qty');
      reqLido[key] = qtyEl ? (parseInt(qtyEl.textContent, 10) || 1) : 1;
    });
    window.requisitosEspeciais = reqLido;
    const reqAtivos = Object.entries(reqLido).filter(([, q]) => Number(q) > 0);
    const reqRow = reqAtivos.length
      ? `<div class="rmpag-row"><span>Requisitos especiais</span><b>${_esc(reqAtivos.map(([k, q]) => `${reqLabels[k] || k} ×${q}`).join(', '))}</b></div>`
      : '';

    document.getElementById('rmResumo').innerHTML = `
      <div class="rmpag-row"><span>Nome</span><b>${_esc(nome)}</b></div>
      <div class="rmpag-row"><span>Recolha</span><b>${_esc(partida.split(',')[0])}</b></div>
      <div class="rmpag-row"><span>Destino</span><b>${_esc(destino.split(',')[0])}</b></div>
      <div class="rmpag-row"><span>Data e Hora</span><b>${dtFormatada}</b></div>
      <div class="rmpag-row"><span>Categoria</span><b>${_esc(categoria)}</b></div>
      <div class="rmpag-row"><span>Distância</span><b>${Number(km).toFixed(1)} km</b></div>
      <div class="rmpag-row"><span>Portagens</span><b>€${Number(portagens).toFixed(2)}</b></div>
      ${reqRow}
      <div class="rmpag-row total"><span>TOTAL A PAGAR</span><b>€${Number(valor).toFixed(2)}</b></div>
    `;
    document.getElementById('rmPagOverlay').classList.add('show');
    tab('card');
    _initStripe();
  }

  /* Fechar modal */
  function fechar() {
    document.getElementById('rmPagOverlay').classList.remove('show');
    document.getElementById('rmPPBtns').innerHTML = '';
    document.getElementById('rmStripeErr').textContent = '';
    ppReady = false;
    if (stripeCard) stripeCard.clear();
  }

  /* Trocar tab */
  function tab(t) {
    document.getElementById('rmTabCard').classList.toggle('active', t==='card');
    document.getElementById('rmTabPP').classList.toggle('active', t==='pp');
    document.getElementById('rmPaneCard').style.display = t==='card' ? '' : 'none';
    document.getElementById('rmPanePP').style.display   = t==='pp'   ? '' : 'none';
    if (t==='pp') _initPaypal();
  }

  /* Pós-pagamento */
  function _onOk() {
    fechar();
    // Toast de sucesso
    document.getElementById('rmStCodigo').textContent = _codigo;
    const toast = document.getElementById('rmSuccessToast');
    toast.classList.add('show');
    // NOTA: já não esconde sozinho ao fim de 5.5s — o botão "Estou
    // Pronto" precisa de ficar disponível até o hóspede o usar,
    // que pode ser bem mais tarde (é a mesma janela flexível que já
    // existe na Reserva Flexível, aplicada agora à reserva normal).
    // Fecha-se ao clicar fora, ou depois de "Estou Pronto" resultar.

    // Ligar o botão "Estou Pronto" a esta reserva específica —
    // reatribuído a cada pagamento novo, porque _codigo muda.
    const btnPronto = document.getElementById('rmBtnEstouPronto');
    const msgPronto  = document.getElementById('rmEstouProntoMsg');
    if (btnPronto) {
      btnPronto.disabled = false;
      btnPronto.textContent = 'ESTOU PRONTO — CHAMAR MOTORISTA';
      msgPronto.textContent = '';
      btnPronto.onclick = async () => {
        btnPronto.disabled = true;
        btnPronto.textContent = 'A CHAMAR MOTORISTA…';
        msgPronto.style.color = '#8b95a2';
        msgPronto.textContent = '';
        try {
          const d = await fetch(`${API}/api/reservas/reservas/estou-pronto`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: _codigo }),
          }).then(r => r.json());
          if (d?.ok) {
            btnPronto.textContent = 'MOTORISTA A CAMINHO';
            msgPronto.style.color = '#7fffc4';
            msgPronto.textContent = 'A procurar o motorista mais próximo…';
            _poll(_codigo, 0);
          } else {
            btnPronto.disabled = false;
            btnPronto.textContent = 'ESTOU PRONTO — CHAMAR MOTORISTA';
            msgPronto.style.color = '#ff8888';
            msgPronto.textContent = d?.message || 'Não foi possível chamar o motorista. Tente novamente.';
          }
        } catch (err) {
          btnPronto.disabled = false;
          btnPronto.textContent = 'ESTOU PRONTO — CHAMAR MOTORISTA';
          msgPronto.style.color = '#ff8888';
          msgPronto.textContent = 'Erro de rede. Tente novamente.';
        }
      };
    }

    // Enviar email ticket ao passageiro + marcar pagamento
    _enviarEmailConfirmacao(_codigo, _emailPassageiro);
    // Poll motorista
    _poll(_codigo, 0);

    // Hook opcional — usado pelo fluxo Convite-Evento para chamar
    // /partilha/evento/confirmar-pagamento após o Stripe/PayPal
    // ter aprovado. Sem este hook, o pagamento passava mas a
    // reserva não avançava do estado "aguarda pagamento".
    // Passamos "stripe" ou "paypal" e a referência atual (o Stripe
    // guardou em `_stripeLastRef`, o PayPal usa o próprio orderId).
    try {
      if (typeof window._rmEvtOnPaymentOk === 'function') {
        const provider = window._rmLastProvider || 'stripe';
        const ref = window._rmLastRef || _codigo;
        const hook = window._rmEvtOnPaymentOk;
        window._rmEvtOnPaymentOk = null;   // Consumido — não dispara outra vez
        hook(provider, ref);
      }
    } catch (e) { console.warn('[rmPag] hook _rmEvtOnPaymentOk falhou:', e); }
  }

  async function _enviarEmailConfirmacao(codigo, emailPassageiro) {
    try {
      await fetch(`${API}/api/reservas/reservas/enviar-confirmacao`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ codigo, emailPassageiro })
      });
    } catch(_) { /* silencioso */ }
  }

  async function _poll(codigo, n) {
    if (n > 12) return;
    try {
      const d = await fetch(`${API}/api/reservas/reservas/motorista-atribuido?codigo=${encodeURIComponent(codigo)}`, { credentials: 'include' }).then(r => r.json());
      if (d?.atribuido && d.motorista) {
        if (typeof showMotoristaOverlay === 'function') showMotoristaOverlay(d.motorista);
        return;
      }
    } catch(_) {}
    setTimeout(() => _poll(codigo, n + 1), 5000);
  }

  /* Stripe */
  async function _initStripe() {
    if (stripeInst) return;
    try {
      const { publicKey } = await fetch(`${API}/api/reservas/stripe/public-key`, { credentials: 'include' }).then(r => r.json());
      if (!publicKey) throw new Error('Chave Stripe indisponível.');
      stripeInst = Stripe(publicKey);
      stripeEls  = stripeInst.elements();
      stripeCard = stripeEls.create('card', {
        style: {
          base: { color: '#e8eaed', fontSize: '14px', '::placeholder': { color: '#555a64' }, iconColor: '#8891a0' },
          invalid: { color: '#ff6b6b' }
        }
      });
      stripeCard.mount('#rmStripeEl');
      stripeCard.on('change', e => { document.getElementById('rmStripeErr').textContent = e.error?.message || ''; });
    } catch(err) {
      document.getElementById('rmStripeErr').textContent = 'Stripe: ' + err.message;
    }
  }

  /* PayPal */
  async function _initPaypal() {
    if (ppReady || document.getElementById('rmPPBtns').innerHTML) return;
    try {
      const { clientId } = await fetch(`${API}/api/reservas/paypal-client-id`, { credentials: 'include' }).then(r => r.json());
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR`;
        s.onload = () => { ppReady = true; res(); };
        s.onerror = () => rej(new Error('PayPal SDK falhou.'));
        document.head.appendChild(s);
      });
      paypal.Buttons({
        createOrder: (d, a) => a.order.create({ purchase_units: [{ amount: { value: _valor.toFixed(2) }, description: `Reserva ${_codigo} REALMETROPOLIS` }] }),
        onApprove:   (d, a) => a.order.capture().then(r => {
          window._rmLastProvider = 'paypal';
          window._rmLastRef = (r?.id || d?.orderID || _codigo);
          _onOk();
        }),
        onError:     ()     => { document.getElementById('rmPPBtns').innerHTML = '<p style="color:#ff6b6b;font-size:12px;text-align:center;padding:10px">Erro no PayPal. Tente com cartão.</p>'; }
      }).render('#rmPPBtns');
    } catch(err) {
      document.getElementById('rmPPBtns').innerHTML = `<p style="color:#ff6b6b;font-size:12px;text-align:center;padding:10px">Erro PayPal: ${err.message}</p>`;
    }
  }

  function _esc(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* Eventos */
  document.getElementById('rmBtnStripe').onclick = async () => {
    const btn = document.getElementById('rmBtnStripe');
    btn.disabled = true; btn.textContent = 'A processar…';
    document.getElementById('rmStripeErr').textContent = '';
    try {
      const { clientSecret } = await fetch(`${API}/api/reservas/stripe/criar-intent`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: _valor, descricao: `Reserva ${_codigo} REALMETROPOLIS` })
      }).then(r => r.json());
      const { error, paymentIntent } = await stripeInst.confirmCardPayment(clientSecret, { payment_method: { card: stripeCard } });
      if (error) { document.getElementById('rmStripeErr').textContent = error.message; return; }
      if (paymentIntent.status === 'succeeded') {
        window._rmLastProvider = 'stripe';
        window._rmLastRef = paymentIntent.id || _codigo;
        _onOk();
      }
    } catch(err) {
      document.getElementById('rmStripeErr').textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'PAGAR COM CARTÃO';
    }
  };

  document.getElementById('rmBtnFechar').onclick  = fechar;
  document.getElementById('rmBtnFechar2').onclick = fechar;

  // Fechar toast ao clicar fora do botão "Estou Pronto" — sem esta
  // exclusão, clicar no botão também fechava o toast imediatamente.
  document.getElementById('rmSuccessToast').addEventListener('click', (ev) => {
    if (ev.target.closest('#rmBtnEstouPronto')) return;
    document.getElementById('rmSuccessToast').classList.remove('show');
  });

  return { abrir, fechar, tab };
})();