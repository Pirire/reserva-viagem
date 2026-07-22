/* Contactos guardados: o parceiro (hotel) e o cliente final guardam-nos
   em sitios diferentes. Esta funcao devolve o caminho certo conforme
   quem esta na pagina — sem isto, no modo cliente a lista aparecia
   sempre vazia. */
function _rmBaseContactos() {
  return window.__RM_MODO_CLIENTE__
    ? '/api/clientes/me/contactos'
    : '/api/admin/parceiros/me/contactos';
}
// ─────────────────────────────────────────────────────────────
// rm-activity.js — Atividade, artigo perdido, segurança, fatura
//                  Contactos, Viagens Pendentes
// ─────────────────────────────────────────────────────────────

async function sendLostItem() {
    const titulo  = (els.lostItemTitle.value || '').trim();
    const descricao = (els.lostItemDescription.value || '').trim();
    if (!titulo || !descricao) { showToast('Preencha o item e a descrição.'); return; }
    try { await fetchJson(url('/atividade/artigo-perdido'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'artigo_perdido', utilizador: currentUser, viagem: currentTripContext, item: { titulo, descricao } }) }); } catch (_) {}
    closePopup(els.lostItemPopup); showToast('Pedido de artigo perdido enviado.');
    els.lostItemTitle.value = ''; els.lostItemDescription.value = '';
  }

  async function sendSecurityProblem() {
    const descricao = (els.securityDescription.value || '').trim();
    if (!selectedSecurityType) { showToast('Selecione o tipo de problema.'); return; }
    if (!descricao) { showToast('Descreva o problema.'); return; }
    try { await fetchJson(url('/seguranca/reportar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'problema_seguranca', problema: selectedSecurityType, descricao, utilizador: currentUser, viagem: { ...currentTripContext, contactoUtilizador: currentUser.contacto } }) }); } catch (_) {}
    closePopup(els.securityPopup); showToast('Mensagem enviada ao painel de segurança.');
    els.securityDescription.value = ''; selectedSecurityType = '';
    els.securityOptions.querySelectorAll('.option-pill').forEach(x => x.classList.remove('selected'));
  }

  async function sendInvoiceRequest() {
    if (!selectedInvoiceId) { showToast('Selecione uma fatura.'); return; }
    try { await fetchJson(url('/faturas/solicitar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, nomeCompleto: currentUser.nomeCompleto, email: currentUser.email, contacto: currentUser.contacto }) }); } catch (_) {}
    closePopup(els.invoicePopup); showToast('Pedido de fatura enviado.');
  }

  function renderInvoiceList() {
    els.invoiceList.innerHTML = ''; selectedInvoiceId = '';
    invoiceMockData.forEach(item => {
      const div = document.createElement('div');
      div.className = 'invoice-item'; div.textContent = item.label; div.dataset.id = item.id;
      div.addEventListener('click', () => { document.querySelectorAll('.invoice-item').forEach(x => x.classList.remove('selected')); div.classList.add('selected'); selectedInvoiceId = item.id; });
      els.invoiceList.appendChild(div);
    });
  }

  /* ── GESTÃO DE VIAGENS ─────────────────────────────────────── */
  function fillTripManager() {
    const partida  = (els.inputPartida.value || currentTripContext.partida || '').trim();
    const destino  = (els.inputDestino.value || currentTripContext.destino || '').trim();
    const datahora = (els.inputDateTime.value || '').trim();
    els.managerCurrentTrip.textContent = partida && destino
      ? `Partida: ${partida} | Destino: ${destino} | Data/Hora: ${datahora || 'por definir'} | Categoria: ${getCategoryLabel(getCategoryValue())}`
      : 'Sem viagem ativa.';
    els.managerPreferenceInfo.textContent = selectedPreferenceTrip
      ? `Motorista: ${selectedPreferenceTrip.motorista||'—'} | Veículo: ${selectedPreferenceTrip.veiculo||'—'} | Matrícula: ${selectedPreferenceTrip.matricula||'—'} | Cartão: ${selectedTargetCardIndex||'—'}`
      : 'Nenhuma preferência aplicada.';
  }

  function fillSecurityPanel() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { els.securityUserLocation.textContent = `Lat: ${pos.coords.latitude.toFixed(6)} | Lng: ${pos.coords.longitude.toFixed(6)} | Precisão: ${Math.round(pos.coords.accuracy)}m`; },
        ()  => { els.securityUserLocation.textContent = 'Geolocalização não autorizada.'; }
      );
    } else { els.securityUserLocation.textContent = 'Geolocalização não suportada.'; }
    els.securityDriverLocation.textContent = 'A posição do motorista é enviada pelo backend em tempo real.';
    els.securityTripState.textContent = `Motorista: ${currentTripContext.motoristaNome} | Veículo: ${currentTripContext.veiculo} | Matrícula: ${currentTripContext.matricula} | Estado: monitorização pronta.`;
  }

  /* ══════════════════════════════════════════════════════════════
     MEUS CONTACTOS — API backend parceiro (sem localStorage)
     GET    /api/admin/parceiros/me/contactos
     POST   /api/admin/parceiros/me/contactos   { nome, tel }
     DELETE /api/admin/parceiros/me/contactos/:id
  ══════════════════════════════════════════════════════════════ */

  let _cachedContactos = [];

async function fetchContactos() {
    try {
      const r = await fetch(_rmBaseContactos(), { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      _cachedContactos = r.ok && Array.isArray(data?.contactos) ? data.contactos : [];
    } catch { _cachedContactos = []; }
    return _cachedContactos;
  }

  async function apiAdicionarContacto(nome, tel) {
    const r = await fetch(_rmBaseContactos(), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nome.trim(), tel: tel.trim() })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
    if (Array.isArray(data?.contactos)) _cachedContactos = data.contactos;
    return data;
  }

  async function apiRemoverContacto(id) {
    const r = await fetch(`${_rmBaseContactos()}/${id}`, {
      method: 'DELETE', credentials: 'include'
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
    if (Array.isArray(data?.contactos)) _cachedContactos = data.contactos;
    return data;
  }

  /** Renderiza a lista de contactos — sempre busca do backend */
  async function renderMeusContactos() {
    const lista = el('meusContactosLista');
    lista.innerHTML = '<p style="color:var(--silver-2);font-size:13px;text-align:center;padding:16px 0;opacity:.7">A carregar…</p>';

    const contactos = await fetchContactos();

    if (!contactos.length) {
      lista.innerHTML = '<p style="color:var(--silver-2);font-size:13px;text-align:center;padding:16px 0">Sem contactos guardados.</p>';
      return;
    }

    lista.innerHTML = contactos.map(c =>
      `<div class="contacto-item">
        <div class="ci-info">
          <strong>${escapeHtml(c.nome)}</strong>
          <span>${escapeHtml(c.tel)}</span>
        </div>
        <button class="ci-del" data-id="${escapeHtml(c._id || c.id || '')}">✕</button>
      </div>`
    ).join('');

    lista.querySelectorAll('.ci-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
        btn.disabled = true;
        try {
          await apiRemoverContacto(id);
          await renderMeusContactos();
          showToast('Contacto removido.');
        } catch {
          btn.disabled = false;
          showToast('Erro ao remover contacto.');
        }
      });
    });
  }

  /* ── VIAGENS PENDENTES ─────────────────────────────────────── */
  async function carregarViagensPendentes() {
    try {
      const data = await fetchJson(url('/reservas/reservas/pendentes'));
      viagensPendentes = Array.isArray(data?.reservas) ? data.reservas : (Array.isArray(data) ? data : []);
    } catch (err) {
      viagensPendentes = [];
      // Não actualiza badge se endpoint não existe ainda
      if (err?.message?.includes('404') || err?.message?.includes('não encontrado')) {
        console.info('[RM] /reservas/pendentes não encontrado — endpoint em falta no backend.');
        return;
      }
    }
    const btn = el('btnViagensPendentes');
    const n = viagensPendentes.length;
    // O botão do cabeçalho foi removido — proteger contra null.
    if (btn) {
      if (n > 0) { btn.classList.add('tem-pendentes'); btn.dataset.count = n > 9 ? '9+' : String(n); }
      else { btn.classList.remove('tem-pendentes'); btn.removeAttribute('data-count'); }
    }
  }

  function renderViagensPendentes() {
    const lista = el('viajensPendentesLista');
    if (!viagensPendentes.length) { lista.innerHTML = '<p style="color:var(--silver-2);font-size:13px;text-align:center;padding:24px 0">Sem viagens pendentes.</p>'; return; }
    lista.innerHTML = viagensPendentes
      .sort((a, b) => new Date(a.datahora || 0) - new Date(b.datahora || 0))
      .map(v => {
        const dt = v.datahora ? new Date(v.datahora).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        return `<div class="viagem-pendente-item"><div class="vp-info"><strong>${escapeHtml(v.partida||'—')} → ${escapeHtml(v.destino||'—')}</strong><span>${dt} · ${escapeHtml(v.categoria||'—')}</span><span>Código: ${escapeHtml(v.codigo||v._id||'—')}</span></div><div class="vp-badge">PENDENTE</div></div>`;
      }).join('');
  }

  /* ── OVERLAY DO MOTORISTA ──────────────────────────────────── */