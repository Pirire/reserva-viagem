// ─────────────────────────────────────────────────────────────
// rm-events.js — bindEvents, init, modo Evento
// ─────────────────────────────────────────────────────────────
console.log("✅ rm-events.js VERSÃO 2026-07-02-RESERVA-FLEXIVEL carregado");

function bindEvents() {
    /* Hambúrguer */
    const hMenu = el('hamburgerMenu');
    els.btnMenu.addEventListener('click', e => { e.stopPropagation(); hMenu.classList.toggle('open'); });
    document.addEventListener('click', () => hMenu.classList.remove('open'));

    /* Dropdown do hambúrguer */
    els.btnActivity.addEventListener('click', () => { hMenu.classList.remove('open'); openPopup(els.activityPopup); });
    els.btnTripManager.addEventListener('click', () => { hMenu.classList.remove('open'); fillTripManager(); openPopup(els.tripManagerPopup); });
    els.btnContactos.addEventListener('click', () => { hMenu.classList.remove('open'); renderMeusContactos(); openPopup(el('meusContactosPopup')); });
    el('menuBtnViagensMapa')?.addEventListener('click',   () => { hMenu.classList.remove('open'); abrirViagensMapa(); });
    el('menuBtnEstatisticas')?.addEventListener('click', () => { hMenu.classList.remove('open'); abrirEstatisticas(); });
    el('menuBtnClassificacoes')?.addEventListener('click', () => { hMenu.classList.remove('open'); abrirClassificacoes(); });
    el('menuBtnSLA')?.addEventListener('click', () => { hMenu.classList.remove('open'); abrirSLA(); });

    /* Modos de viagem */
    els.btnSemPartilha.addEventListener('click', openTripPanel);
    els.btnPartilharAmigos.addEventListener('click', () => { openShareMode(); buildShareCards(17); });

    // Botão CRIAR EVENTO → agora "Reserva Flexível"
    const btnCriarEvento = el('btnCriarEvento');
    if (btnCriarEvento) {
      if (/CRIAR EVENTO/i.test(btnCriarEvento.textContent)) {
        btnCriarEvento.innerHTML = '📅 RESERVA FLEXÍVEL';
      }
      btnCriarEvento.addEventListener('click', abrirModoEvento);
    }

    // Botão CRIAR TICKET — visível para qualquer parceiro autenticado (hotel/alojamento)
    el('btnCriarTicket')?.addEventListener('click', openTicketMode);
    el('btnModoConvidado')?.addEventListener('click', () => {
      if (typeof abrirModoConvidado === 'function') abrirModoConvidado();
      else showToast('Módulo Convidado a carregar...', 2000);
    });

    /* Painel de reserva */
    els.btnCloseTrip.addEventListener('click', closeTripPanel);
    document.querySelectorAll('.cat-btn[data-category]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.category;
        previousCategory = selectedCategory;
        // Reset grupo select if another category is chosen
        const gSel = el('grupoSelect');
        if (gSel && cat !== 'grupo6' && cat !== 'grupo8' && cat !== 'grupo17') {
          gSel.value = ''; gSel.classList.remove('selected');
        }
        setSelectedCategory(cat);
      });
    });

    /* Grupo select — mudança de categoria via onchange (grupoReservaChanged) já ligado inline */
    /* Garantir estado visual correcto ao abrir o painel */
    const grupoSelInit = el('grupoSelect');
    if (grupoSelInit) grupoSelInit.value = '';
    els.btnPopupCancel.addEventListener('click', () => { closeCategoryPopup(); setSelectedCategory(previousCategory); });
    els.btnPopupConfirm.addEventListener('click', confirmCategoryPopup);
    els.categoryPopup.addEventListener('click', e => { if (e.target === els.categoryPopup) { closeCategoryPopup(); setSelectedCategory(previousCategory); } });
    els.btnPreferencia.addEventListener('click', () => {
      if (!preferenceMode) { togglePreferenceMode(true); return; }
      if (!selectedPreferenceTrip) { showToast('Selecione uma das últimas viagens.'); return; }
      if (!selectedTargetCardIndex) { showToast('Selecione o cartão alvo.'); return; }
      if (!applyPreferenceToSelectedCard(selectedPreferenceTrip)) return;
      togglePreferenceMode(false); clearTargetStyles();
      showToast(currentAssignedExists ? 'Substituição de preferência preparada.' : 'Preferência aplicada à reserva.');
    });
    els.btnReservar.addEventListener('click', reservarViagem);

    /* Partilha */
    els.btnEnviarConvites.addEventListener('click', enviarConvitesPartilha);
    els.shareDateTime.addEventListener('input', updateShareButtonsState);

    /* Autocomplete recolha */
    const shareRecolhaEl = el('shareRecolha');
    if (shareRecolhaEl) {
      shareRecolhaEl.addEventListener('focus', preencherRecolhaAuto);
      shareRecolhaEl.addEventListener('input', () => { updateShareButtonsState(); calcularPrecoPartilha(); });
    }
    els.shareDestino.addEventListener('input', () => { updateShareButtonsState(); calcularPrecoPartilha(); });
    bindShareCats();
    bindTargetSelection();

    /* Atividade */
    els.btnCloseActivity.addEventListener('click', () => closePopup(els.activityPopup));
    els.btnLostItem.addEventListener('click', () => { closePopup(els.activityPopup); openPopup(els.lostItemPopup); });
    els.btnSecurityProblem.addEventListener('click', () => { closePopup(els.activityPopup); openPopup(els.securityPopup); });
    els.btnInvoice.addEventListener('click', () => { closePopup(els.activityPopup); renderInvoiceList(); openPopup(els.invoicePopup); });
    els.btnLostCancel.addEventListener('click', () => closePopup(els.lostItemPopup));
    els.btnLostSend.addEventListener('click', sendLostItem);
    els.btnSecurityCancel.addEventListener('click', () => closePopup(els.securityPopup));
    els.btnSecuritySend.addEventListener('click', sendSecurityProblem);
    els.btnInvoiceCancel.addEventListener('click', () => closePopup(els.invoicePopup));
    els.btnInvoiceSend.addEventListener('click', sendInvoiceRequest);
    els.securityOptions.querySelectorAll('.option-pill').forEach(btn => {
      btn.addEventListener('click', () => { els.securityOptions.querySelectorAll('.option-pill').forEach(x => x.classList.remove('selected')); btn.classList.add('selected'); selectedSecurityType = btn.dataset.value || ''; });
    });

    /* Gestão + segurança */
    els.btnCloseTripManager.addEventListener('click', () => closePopup(els.tripManagerPopup));
    els.btnStartTripFlow.addEventListener('click', () => showToast('Viagem iniciada com sucesso.'));
    els.btnEndTripFlow.addEventListener('click',   () => showToast('Viagem finalizada com sucesso.'));
    els.btnSecurityPanel.addEventListener('click', () => { fillSecurityPanel(); openPopup(els.securityLivePopup); });
    els.btnCloseSecurityLive.addEventListener('click', () => closePopup(els.securityLivePopup));

    /* Política */
    el('btnPolitica').addEventListener('click', () => openPopup(el('politicaPopup')));
    el('btnFecharPolitica').addEventListener('click', () => closePopup(el('politicaPopup')));

    /* Meus contactos */
    el('btnFecharMeusContactos').addEventListener('click', () => closePopup(el('meusContactosPopup')));
    el('btnFecharEstatisticas')?.addEventListener('click',  () => { closePopup(el('estatisticasPopup')); destruirGrafico(); });
    el('btnFecharClassificacoes')?.addEventListener('click',() => closePopup(el('classificacoesPopup')));
    el('btnVerClassificacoes')?.addEventListener('click',   () => { closePopup(el('estatisticasPopup')); destruirGrafico(); abrirClassificacoes(); });
    el('btnAdicionarContacto').addEventListener('click', async () => {
      const nome = el('novoContactoNome').value.trim();
      const tel  = el('novoContactoTel').value.trim();
      if (!nome || !tel) { showToast('Preencha nome e contacto.'); return; }
      if (_cachedContactos.find(c => c.tel === tel)) { showToast('Este contacto já existe.'); return; }
      const btn = el('btnAdicionarContacto');
      btn.disabled = true;
      try {
        const data = await apiAdicionarContacto(nome, tel);
        el('novoContactoNome').value = ''; el('novoContactoTel').value = '';
        // Forçar refresh completo do backend
        _cachedContactos = [];
        await renderMeusContactos();
        showToast('✅ Contacto guardado.');
      } catch (err) {
        showToast('❌ ' + (err?.message || 'Erro ao guardar contacto.'));
      } finally {
        btn.disabled = false;
      }
    });

    /* Reserva ativa + cancelar viagem */
    el('btnReservaAtiva').addEventListener('click', () => showMotoristaOverlay(currentTripContext));
    el('btnCancelarViagemOverlay').addEventListener('click', async () => {
      if (!confirm('Tem a certeza que pretende cancelar esta viagem?')) return;
      try { await fetchJson(url('/reservas/reserva/cancelar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tripId: currentTripContext.tripId }) }); } catch (_) {}
      hideMotoristaOverlay(); setReservaAtiva(false); showToast('Viagem cancelada.'); carregarViagensPendentes();
    });

    /* Viagens pendentes */
    el('btnViagensPendentes').addEventListener('click', () => { renderViagensPendentes(); openPopup(el('viajensPendentesPopup')); });
    el('btnFecharViagensPendentes').addEventListener('click', () => closePopup(el('viajensPendentesPopup')));

    /* Convite SMS */
    els.btnInviteClose.addEventListener('click', () => closePopup(els.inviteVerifyPopup));
    els.btnInviteVerify.addEventListener('click', verifyInviteAccess);

    /* Fechar popups ao clicar fora */
    [
      els.categoryPopup, els.activityPopup, els.lostItemPopup,
      els.securityPopup, els.invoicePopup,  els.tripManagerPopup,
      els.securityLivePopup, els.inviteVerifyPopup,
      el('meusContactosPopup'), el('politicaPopup'), el('viajensPendentesPopup'),
      el('estatisticasPopup'), el('classificacoesPopup'), el('slaPopup')
    ].forEach(pop => pop?.addEventListener('click', e => { if (e.target === pop) closePopup(pop); }));

    /* ESC fecha tudo */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (els.categoryPopup.classList.contains('show')) { closeCategoryPopup(); setSelectedCategory(previousCategory); return; }
      [els.activityPopup, els.lostItemPopup, els.securityPopup, els.invoicePopup, els.tripManagerPopup, els.securityLivePopup, els.inviteVerifyPopup, el('meusContactosPopup'), el('politicaPopup'), el('viajensPendentesPopup'), el('estatisticasPopup'), el('classificacoesPopup'), el('slaPopup')]
        .forEach(pop => { if (pop?.classList.contains('show')) closePopup(pop); });
      if (!els.tripPanel.classList.contains('hidden')) closeTripPanel();
      if (shareMode) closeShareMode();
    });
  }

  /* ── INICIALIZAÇÃO ─────────────────────────────────────────── */
  async function init() {
    initMap();
    initAutocomplete();
    initTicketPanel();
    bindEvents();

    // Convidados (link de convite/evento, ?invite=...&shareId=...)
    // não têm sessão de parceiro/hotel — carregarUtilizador() falha
    // sempre para eles e REDIRECIONA para index.html (ver rm-core.js),
    // o que interrompe a página inteira antes de parseInviteParams()
    // (a função que mostra o popup do código) alguma vez correr.
    // Por isso, para convidados, salta directamente para aí — nada
    // do resto do init() (dados de conta, contactos, categoria por
    // defeito) faz sentido antes de o convite estar validado.
    if (window.__GUEST_INVITE_MODE__) {
      parseInviteParams();
      return;
    }

    /* Carrega nome real do titular a partir do backend */
    await carregarUtilizador();
    /* Pré-carrega contactos do utilizador para o cache in-memory */
    await fetchContactos();
    /* Defaults */
    setSelectedCategory('economica');
    updateCardActionStates();
    requestUserLocation();
    parseInviteParams();

  }

  /* ── RESERVAS DO HOTEL (área de gestão) ───────────────────── */


  /* ═══════════════════════════════════════════════════════════
     MODO EVENTO — mesmo local, destinos diferentes
  ═══════════════════════════════════════════════════════════ */
  const EVT_SHEETS = ['tripSheet','shareSheet','ticketSheet','eventoSheet'];
  let _evtPartidaGeo = null;
  let _evtDestSugerGeo = null;   // destino sugerido pelo concierge — opcional
  let _evtCategoria  = 'economica';
  let _evtNotifMethod = 'sms';
  let _evtPagador     = 'hospede';
  let _evtParticipantes = []; // [{nome, contacto}]

function abrirModoEvento() {
    hideTripTypeButtons();
    el('btnCriarEvento')?.classList.add('active');
    el('tripPanel')?.classList.add('hidden');
    el('shareSheet')?.classList.add('hidden');
    el('ticketSheet')?.classList.add('hidden');
    el('eventoSheet')?.classList.remove('hidden');
    if (!_evtParticipantes.length) adicionarEvtParticipante();
    // ORDEM IMPORTA:
    // 1. Criar campos que não vêm no HTML (injetados via JS)
    // 2. Só depois ligar autocomplete (senão liga a inputs que não existem)
    _evtInjetarCampoDestSugerido();
    _evtAtualizarRotulosReservaFlexivel();
    _evtLigarInfoValidade();
    iniciarNmEvtPartida();
    iniciarNmEvtDestSuger();
  }

  // ── Popup de informação para "Data de validade do bilhete" ──
  // Ao clicar no ⓘ ao lado do label, mostra o que é a validade e
  // como funcionam os avisos automáticos de 60 e 15 minutos.
  function _evtLigarInfoValidade() {
    const btn = el('evtValidInfoBtn');
    if (!btn || btn._evtBound) return;
    btn._evtBound = true;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _evtMostrarPopupInfoValidade();
    });
  }

  function _evtMostrarPopupInfoValidade() {
    let ov = document.getElementById('evtValidInfoPopup');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'evtValidInfoPopup';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,Arial,system-ui,sans-serif';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div style="background:linear-gradient(180deg,rgba(22,25,31,.99),rgba(10,11,14,1));border:1px solid rgba(196,201,212,.25);border-radius:18px;padding:22px 24px;width:min(440px,94vw);color:#fff;box-shadow:0 30px 70px rgba(0,0,0,.7)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:22px">🎫</span>
          <div style="font-size:15px;font-weight:900;letter-spacing:.02em">Data de validade do bilhete</div>
        </div>
        <div style="font-size:12.5px;color:#c9cdd4;line-height:1.55;margin-bottom:14px">
          A validade é o <b>prazo máximo</b> que o convidado tem para <b>confirmar e pagar</b> a viagem. É a grande vantagem do bilhete flexível: em vez de uma hora fixa, damos-lhe uma janela alargada — chama o carro quando estiver pronto, sem sobretaxas por atraso.
        </div>

        <div style="background:rgba(28,214,142,.06);border:1px solid rgba(28,214,142,.22);border-radius:10px;padding:12px 14px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:800;color:#1cd68e;letter-spacing:.06em;margin-bottom:6px;text-transform:uppercase">Avisos automáticos</div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#e5e8ed;line-height:1.5">
            <div><b>60 min antes da validade</b><br>SMS/email: "Nos próximos 60 minutos deve confirmar a sua viagem."</div>
            <div><b>15 min antes da validade</b><br>SMS/email: "Último aviso — tem apenas 15 minutos para confirmar a sua viagem ou a mesma será cancelada."</div>
          </div>
        </div>

        <div style="background:rgba(255,80,80,.05);border:1px solid rgba(255,80,80,.2);border-radius:10px;padding:12px 14px;margin-bottom:16px">
          <div style="font-size:11.5px;color:#ffc9c9;line-height:1.5">
            ⚠️ Se o convidado <b>não confirmar até à validade</b>, o bilhete é <b>cancelado automaticamente</b>. Se já tinha sido pago, é reembolsado.
          </div>
        </div>

        <div style="font-size:11.5px;color:#8b95a2;line-height:1.5;margin-bottom:16px">
          <b style="color:#c9cdd4">Exemplo prático:</b> hóspede aterra às 22h no aeroporto. Não sabe se demora 20 ou 90 minutos até sair. O concierge define validade até <b>02h00</b> — o hóspede confirma quando estiver despachado, sem stress.
        </div>

        <button id="evtValidInfoOk" type="button"
          style="width:100%;padding:12px;border-radius:10px;border:none;background:#c4c9d4;color:#04140e;font-weight:900;font-size:12.5px;letter-spacing:.04em;cursor:pointer;font-family:inherit">PERCEBI</button>
      </div>
    `;
    ov.style.display = 'flex';
    document.getElementById('evtValidInfoOk').addEventListener('click', () => { ov.style.display = 'none'; });
    ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.style.display = 'none'; });
  }

  // Substitui rótulos "Evento" por "Reserva Flexível" no painel e no
  // botão principal. Feito por código para o painel funcionar sem
  // editar hotel-dashboard.html — se um dia o HTML for atualizado
  // com os nomes novos, esta função continua a funcionar (é
  // idempotente).
  function _evtAtualizarRotulosReservaFlexivel() {
    const btn = el('btnCriarEvento');
    if (btn && /CRIAR EVENTO/i.test(btn.textContent)) {
      btn.innerHTML = '📅 RESERVA FLEXÍVEL';
    }
    // Título do painel
    document.querySelectorAll('#eventoSheet div').forEach(d => {
      if (/Criar Evento — Destinos Múltiplos/i.test(d.textContent) && d.children.length === 0) {
        d.innerHTML = '📅 Reserva Flexível';
      }
    });
    // Placeholder do input partida — "Local do evento" fica esquisito
    const partida = el('evtPartida');
    if (partida && /local do evento/i.test(partida.placeholder || '')) {
      partida.placeholder = 'Local de recolha (embarque)';
    }
    // Botão de enviar
    const btnEnv = el('btnEnviarEvento');
    if (btnEnv && /ENVIAR CONVITES/i.test(btnEnv.textContent)) {
      btnEnv.innerHTML = '📅 CRIAR RESERVA FLEXÍVEL';
    }
  }

  function fecharModoEvento() {
    el('eventoSheet')?.classList.add('hidden');
    el('btnCriarEvento')?.classList.remove('active');
    showTripTypeButtons();
  }

  // Injeta dinamicamente o input "Nosso endereço" (destino sugerido)
  // logo abaixo do input de partida. Injeta uma vez só. Feito por
  // código para o painel funcionar sem editar hotel-dashboard.html —
  // se um dia o HTML for atualizado, esta função ainda funciona
  // (verifica se já existe antes de criar).
  function _evtInjetarCampoDestSugerido() {
    if (el('evtDestSuger')) return;
    const partidaWrap = el('evtPartida')?.closest('.field') || el('evtPartida')?.parentElement;
    if (!partidaWrap) return;
    const bloco = document.createElement('div');
    bloco.className = partidaWrap.className || 'field';
    bloco.style.marginTop = '10px';
    bloco.style.position = 'relative';
    bloco.innerHTML = `
      <label style="display:block;font-size:10px;color:var(--silver-3,#8b95a2);font-weight:800;letter-spacing:.08em;margin-bottom:4px;text-transform:uppercase">
        Nosso endereço <span style="color:var(--silver-4,#5f6874);font-weight:600;text-transform:none;letter-spacing:0">(destino sugerido, opcional)</span>
      </label>
      <input id="evtDestSuger" type="text" autocomplete="off"
        placeholder="Endereço provável do hóspede (ex: local do evento)"
        style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#fff;font-size:13px;outline:none" />
      <div id="nmEvtDestSuger" class="nm-dropdown" style="position:absolute;top:100%;left:0;right:0;margin-top:4px;z-index:100"></div>
      <div style="font-size:11px;color:var(--silver-3,#8b95a2);margin-top:6px;line-height:1.4">
        O hóspede vê este endereço como sugestão. Se aceitar, poupa passos. Se não, escolhe outro.
      </div>
    `;
    partidaWrap.insertAdjacentElement('afterend', bloco);
  }
  // sugerido) do painel do Evento. Reutilizado em cada input novo.
  // O callback recebe a geolocalização escolhida.
  function _evtBindAutocomplete(inputId, dropdownId, onPick) {
    const inp  = el(inputId);
    const drop = el(dropdownId);
    if (!inp || !drop || drop._evtInit) return;
    drop._evtInit = true;
    let timer;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 3) { drop.style.display = 'none'; return; }
      timer = setTimeout(async () => {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=pt`, { headers: { 'User-Agent': 'RMEvento/1.0' } });
          const items = await r.json();
          drop.innerHTML = '';
          items.forEach(it => {
            const d = document.createElement('div');
            d.className = 'nm-item';
            d.textContent = it.display_name;
            d.addEventListener('click', () => {
              inp.value = it.display_name;
              onPick({ address: it.display_name, lat: Number(it.lat), lng: Number(it.lon) });
              drop.style.display = 'none';
            });
            drop.appendChild(d);
          });
          drop.style.display = items.length ? 'block' : 'none';
        } catch(_) {}
      }, 350);
    });
    inp.addEventListener('blur', () => setTimeout(() => { drop.style.display = 'none'; }, 200));
  }

  // Autocomplete da partida do evento
  function iniciarNmEvtPartida() {
    _evtBindAutocomplete('evtPartida', 'nmEvtPartida', geo => {
      _evtPartidaGeo = geo;
      validarEvtForm();
    });
  }

  // Autocomplete do "Nosso endereço" (destino sugerido — opcional).
  // Se o input não existir na página, retorna sem fazer nada; assim o
  // painel funciona para HTMLs antigos que ainda não têm o campo.
  function iniciarNmEvtDestSuger() {
    _evtBindAutocomplete('evtDestSuger', 'nmEvtDestSuger', geo => {
      _evtDestSugerGeo = geo;
    });
  }

  // Categoria do evento
  document.addEventListener('click', e => {
    const btn = e.target.closest('.evt-cat');
    if (!btn) return;
    document.querySelectorAll('.evt-cat').forEach(b => {
      b.classList.remove('active');
      b.classList.remove('selected');
    });
    // Reset grupo select when another category is chosen
    const egSel = el('evtGrupoSelect');
    if (egSel) { egSel.value = ''; egSel.classList.remove('selected'); }
    btn.classList.add('active');
    btn.classList.add('selected');
    _evtCategoria = btn.dataset.evtcat || 'economica';
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('.evt-notif');
    if (!btn) return;
    document.querySelectorAll('.evt-notif').forEach(b => { b.classList.remove('active'); b.classList.remove('selected'); });
    btn.classList.add('active'); btn.classList.add('selected');
    _evtNotifMethod = btn.dataset.evtnotif || 'sms';
    validarEvtForm();
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('.evt-pagador');
    if (!btn) return;
    document.querySelectorAll('.evt-pagador').forEach(b => { b.classList.remove('active'); b.classList.remove('selected'); });
    btn.classList.add('active'); btn.classList.add('selected');
    _evtPagador = btn.dataset.evtpagador || 'hospede';
  });

  // Adicionar participante
  function adicionarEvtParticipante() {
    _evtParticipantes.push({ nome: '', contacto: '', email: '' });
    renderEvtParticipantes();
  }

  function removerEvtParticipante(idx) {
    _evtParticipantes.splice(idx, 1);
    renderEvtParticipantes();
  }

  // Validação por participante consoante o canal escolhido no topo
  // do formulário — SMS precisa de contacto, EMAIL precisa de email,
  // AMBOS aceita QUALQUER um dos dois (fica ao critério de quem
  // envia; o backend envia por SMS a quem tem contacto e por email a
  // quem tem email, ignorando canais que ficaram em branco).
  function participanteValidoParaCanal(p, canal) {
    const temContacto = String(p.contacto || '').trim().length >= 9;
    const temEmail    = /.+@.+\..+/.test(String(p.email || '').trim());
    if (canal === 'sms')   return temContacto;
    if (canal === 'email') return temEmail;
    // ambos
    return temContacto || temEmail;
  }

  function renderEvtParticipantes() {
    const container = el('evtParticipantes');
    if (!container) return;
    container.innerHTML = '';
    _evtParticipantes.forEach((p, i) => {
      const div = document.createElement('div');
      div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 32px;gap:6px;align-items:center';
      div.innerHTML = `
        <input class="field" placeholder="Nome" value="${(p.nome||'').replace(/"/g,'&quot;')}" oninput="_evtParticipantes[${i}].nome=this.value;validarEvtForm()" style="font-size:12px;padding:9px 12px"/>
        <input class="field" placeholder="Telemóvel (+351...)" value="${(p.contacto||'').replace(/"/g,'&quot;')}" oninput="_evtParticipantes[${i}].contacto=this.value;validarEvtForm()" style="font-size:12px;padding:9px 12px" type="tel" autocomplete="off"/>
        <input class="field" placeholder="Email" value="${(p.email||'').replace(/"/g,'&quot;')}" oninput="_evtParticipantes[${i}].email=this.value;validarEvtForm()" style="font-size:12px;padding:9px 12px" type="email" autocomplete="off"/>
        <button onclick="removerEvtParticipante(${i})" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,80,80,.3);background:rgba(255,80,80,.08);color:#ff9999;cursor:pointer;font-size:14px">✕</button>
      `;
      container.appendChild(div);
    });
    validarEvtForm();
  }

  function validarEvtForm() {
    const btn = el('btnEnviarEvento');
    if (!btn) return;
    const temPartida = !!_evtPartidaGeo || !!(el('evtPartida')?.value?.trim());
    const temData    = !!(el('evtDateTime')?.value);
    const temPart    = _evtParticipantes.some(p => participanteValidoParaCanal(p, _evtNotifMethod));
    btn.disabled = !(temPartida && temData && temPart);
  }

  // Enviar convites do evento
  async function enviarEventoConvites() {
    const btn = el('btnEnviarEvento');
    const msg = el('evtMsg');
    const _evtPartidaTexto = el('evtPartida')?.value?.trim();
    if (!_evtPartidaGeo && !_evtPartidaTexto) { mostrarEvtMsg('err', 'Preencha o local de partida.'); return; }
    // Se não há coordenadas, geocodificar agora via Nominatim
    if (!_evtPartidaGeo || !_evtPartidaGeo.lat) {
      mostrarEvtMsg('info', 'A geocodificar endereço…');
      try {
        const _geo = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(_evtPartidaTexto)}&format=json&limit=1&accept-language=pt`, { headers: { 'User-Agent': 'RealMetropolis/1.0' } });
        const _geoData = await _geo.json();
        if (_geoData?.length) {
          _evtPartidaGeo = { address: _evtPartidaTexto, lat: Number(_geoData[0].lat), lng: Number(_geoData[0].lon) };
        } else { mostrarEvtMsg('err', 'Endereço não encontrado. Selecione da lista.'); btn.disabled = false; btn.textContent = '🎉 ENVIAR CONVITES'; return; }
      } catch { mostrarEvtMsg('err', 'Erro ao geocodificar endereço.'); btn.disabled = false; btn.textContent = '🎉 ENVIAR CONVITES'; return; }
    }
    const dateTime = el('evtDateTime')?.value;
    if (!dateTime) { mostrarEvtMsg('err', 'Selecione a data e hora.'); return; }

    const validos = _evtParticipantes.filter(p => participanteValidoParaCanal(p, _evtNotifMethod));
    if (!validos.length) {
      const msgFalta = _evtNotifMethod === 'sms'   ? 'Adicione pelo menos 1 contacto válido.'
                     : _evtNotifMethod === 'email' ? 'Adicione pelo menos 1 email válido.'
                     : 'Adicione pelo menos 1 contacto ou email válido.';
      mostrarEvtMsg('err', msgFalta);
      return;
    }

    // Mapeamos só os campos necessários — mantém o payload limpo e
    // envia sempre email como string (mesmo vazio), para o backend
    // não ter de distinguir undefined de "".
    const participantesPayload = validos.map(p => ({
      nome:     String(p.nome || '').trim(),
      contacto: String(p.contacto || '').trim(),
      email:    String(p.email || '').trim().toLowerCase(),
    }));

    btn.disabled = true;
    btn.textContent = 'A enviar…';
    const canalTxtAcao = _evtNotifMethod === 'email' ? 'email'
      : _evtNotifMethod === 'ambos' ? 'SMS/email' : 'SMS';
    mostrarEvtMsg('info', `A enviar convites por ${canalTxtAcao}…`);

    try {
      const evtValidUntilVal = el('evtValidUntil')?.value;
      const r = await fetchJson(url('/partilha/evento/criar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partida:        _evtPartidaGeo,
          destinoSugerido: _evtDestSugerGeo,   // opcional; null se não preenchido
          participantes:  participantesPayload,
          categoria:      _evtCategoria,
          dateTime:       new Date(dateTime).toISOString(),
          mesmoVeiculo:   el('evtMesmoVeiculo')?.checked || false,
          validUntil:     evtValidUntilVal ? new Date(evtValidUntilVal).toISOString() : null,
          notifMethod:    _evtNotifMethod || 'sms',
          pagador:        _evtPagador || 'hospede',
          nomeOrganizador:  (typeof currentUser !== 'undefined' && currentUser?.nomeCompleto) || '',
          emailOrganizador: (typeof currentUser !== 'undefined' && currentUser?.email) || '',
        })
      });

      if (r.ok) {
        const enviados = Number(r.totalEnviados ?? (r.participantes?.length || validos.length));
        const falharam = Number(r.totalFalharam ?? 0);

        let texto;
        if (falharam === 0) {
          // Descrição do canal usado — reflete o que o organizador escolheu
          const canalTxt = _evtNotifMethod === "email" ? "email"
            : _evtNotifMethod === "ambos" ? "SMS + email"
            : "SMS";
          texto = `✅ ${enviados} convite(s) enviado(s) por ${canalTxt} com sucesso!`;
        } else {
          texto = `⚠️ ${enviados} enviado(s), ${falharam} não conseguiram ser entregue(s). Verifique os contactos/emails desses participantes.`;
        }
        mostrarEvtMsg(falharam === 0 ? 'ok' : 'err', texto);
        btn.textContent = falharam === 0 ? '✅ ENVIADO' : '⚠️ ENVIADO PARCIALMENTE';
        // Limpar após 3s
        setTimeout(() => {
          _evtPartidaGeo = null;
          _evtDestSugerGeo = null;
          _evtParticipantes = [];
          if (el('evtPartida')) el('evtPartida').value = '';
          if (el('evtDestSuger')) el('evtDestSuger').value = '';
          if (el('evtDateTime')) el('evtDateTime').value = '';
          renderEvtParticipantes();
          btn.textContent = '🎉 ENVIAR CONVITES';
          btn.disabled = true;
          mostrarEvtMsg('', '');
        }, 4000);
      } else {
        // O backend pode devolver r.motivos com os motivos específicos
        // por canal (ex: "Twilio não configurado", "SMTP sem SMTP_HOST"),
        // muito mais úteis para diagnosticar do que a mensagem genérica.
        const motivosTxt = Array.isArray(r.motivos) && r.motivos.length
          ? ' — Motivos: ' + r.motivos.join(' | ')
          : '';
        mostrarEvtMsg('err', (r.message || 'Erro ao enviar convites.') + motivosTxt);
        btn.disabled = false;
        btn.textContent = '🎉 ENVIAR CONVITES';
      }
    } catch(e) {
      mostrarEvtMsg('err', 'Erro de ligação. Tente novamente.');
      btn.disabled = false;
      btn.textContent = '🎉 ENVIAR CONVITES';
    }
  }

  function mostrarEvtMsg(tipo, texto) {
    const el2 = el('evtMsg');
    if (!el2) return;
    el2.style.display = texto ? 'block' : 'none';
    el2.style.color   = tipo === 'ok' ? '#7fffc4' : tipo === 'err' ? '#ff9999' : '#8b95a2';
    el2.textContent   = texto;
  }

  window.adicionarEvtParticipante    = adicionarEvtParticipante;
  window.removerEvtParticipante      = removerEvtParticipante;
  /* Grupo Evento */
  function evtGrupoToggle(e) {
    e.stopPropagation();
    const m = el('evtGrupoMenu');
    if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }
  function evtGrupoSel(n, cat) {
    _evtCategoria = cat;
    document.querySelectorAll('.evt-cat').forEach(b => { b.classList.remove('active'); b.classList.remove('selected'); });
    const btn = el('evtGrupoBtn');
    if (btn) { btn.classList.add('active'); btn.classList.add('selected'); btn.textContent = 'GRUPO ATÉ ' + n; }
    const m = el('evtGrupoMenu'); if (m) m.style.display = 'none';
    validarEvtForm();
  }
  document.addEventListener('click', function(e2) {
    if (el('evtGrupoWrap') && !el('evtGrupoWrap').contains(e2.target)) {
      const m = el('evtGrupoMenu'); if (m) m.style.display = 'none';
    }
  });
  window.evtGrupoToggle = evtGrupoToggle;
  window.evtGrupoSel    = evtGrupoSel;

  window.abrirModoEvento             = abrirModoEvento;

  // Ligar botões do painel
  document.addEventListener('DOMContentLoaded', () => {
    const btnClose  = el('btnCloseEvento');
    const btnEnviar = el('btnEnviarEvento');
    const btnAdd    = el('btnAddEvtParticipante');
    if (btnClose)  btnClose.addEventListener('click', fecharModoEvento);
    if (btnEnviar) btnEnviar.addEventListener('click', enviarEventoConvites);
    if (btnAdd)    btnAdd.addEventListener('click', adicionarEvtParticipante);
  });

  
  /* ─── rmAutoGeo: preenche campo com localização real ─── */
  async function rmAutoGeo(inputId, ctx) {
    if (!navigator.geolocation) return;
    const inp = el(inputId);
    if (!inp) return;
    const prev = inp.placeholder;
    inp.placeholder = 'A obter localização…';
    inp.style.color = 'rgba(217,221,227,.5)';
    const btn = inp.parentNode.querySelector('button[id*="Geo"], button[title*="localiza"]');
    if (btn) btn.style.opacity = '1';
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        _userLat = lat; _userLng = lng;
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt&zoom=18`,
            { headers: { 'User-Agent': 'RealMetropolis/1.0' } }
          );
          const d = await r.json().catch(() => ({}));
          const a = d?.address || {};
          // Formatar endereço de forma compacta
          const rua  = a.road || a.pedestrian || a.suburb || '';
          const num  = a.house_number ? ` ${a.house_number}` : '';
          const loc  = a.city || a.town || a.village || a.municipality || '';
          const addr = rua ? `${rua}${num}${loc ? ', ' + loc : ''}` : (d?.display_name?.split(',').slice(0,2).join(', ').trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          inp.value = addr;
          inp.dataset.lat = lat;
          inp.dataset.lng = lng;
          inp.placeholder = prev;
          inp.style.color = '';
          if (btn) btn.style.opacity = '.55';
          // Disparar cálculo conforme contexto
          if (ctx === 'reservar') { map.setCenter({lat:lat,lng:lng}); map.setZoom(15); tentarCalcularPrecos(); }
          else if (ctx === 'share') { el('shareRecolha').dataset.lat = lat; el('shareRecolha').dataset.lng = lng; updateShareButtonsState(); calcularPrecoPartilha(); }
          else if (ctx === 'evt')  { _evtPartidaGeo = { address: addr, lat, lng }; validarEvtForm?.(); }
          else if (ctx === 'tk')   { tkPartidaPlace = { lat, lng, label: addr }; if (tkDestinoPlace) _tkCalcAllPrices(); checkTkForm(); }
        } catch { inp.placeholder = prev; inp.style.color = ''; }
      },
      () => { inp.placeholder = prev; inp.style.color = ''; if (btn) btn.style.opacity = '.55'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }
  window.rmAutoGeo = rmAutoGeo;

  /* ── GRUPO TICKET ─── */
  function tkGrupoChanged(sel) {
    const v = sel.value;
    // Desseleccionar botões de categoria
    document.querySelectorAll('.tk-cat-btn[data-tkcat]').forEach(b => b.classList.remove('selected'));
    if (!v) {
      sel.classList.remove('selected');
      tkCategoria = '';
    } else {
      sel.classList.add('selected');
      tkCategoria = v; // 'grupo6' | 'grupo8' | 'grupo17'
    }
    if (tkPartidaPlace && tkDestinoPlace) _tkCalcAllPrices();
    checkTkForm();
  }
  window.tkGrupoChanged = tkGrupoChanged;

  /* ── GRUPO RESERVA PRIVADA ─── */
  function grupoReservaChanged(sel) {
    const v = sel.value;
    if (!v) {
      sel.classList.remove('selected');
      if (selectedCategory === 'grupo6' || selectedCategory === 'grupo8' || selectedCategory === 'grupo17') {
        setSelectedCategory(previousCategory || 'economica');
      }
      return;
    }
    previousCategory = selectedCategory;
    if (v === 'grupo6')       grupoSeats = 6;
    else if (v === 'grupo8')  grupoSeats = 8;
    else if (v === 'grupo17') grupoSeats = 17;
    setSelectedCategory(v);
    tentarCalcularPrecos();
  }
  window.grupoReservaChanged = grupoReservaChanged;

  /* ── GRUPO EVENTO ─── */
  function evtGrupoChanged(sel) {
    const v = sel.value;
    // Desseleccionar botões cat evt
    document.querySelectorAll('.evt-cat').forEach(b => {
      b.classList.remove('active', 'selected');
    });
    if (!v) {
      sel.classList.remove('selected');
      _evtCategoria = 'economica';
      // Reactivar ECONÓMICA por defeito
      const eco = document.querySelector('.evt-cat[data-evtcat="economica"]');
      if (eco) { eco.classList.add('active', 'selected'); }
    } else {
      sel.classList.add('selected');
      _evtCategoria = v; // e.g. 'grupo6', 'grupo8', 'grupo17'
    }
    validarEvtForm();
  }
  window.evtGrupoChanged = evtGrupoChanged;

  function shareGrupoChanged(sel) {
    const v = sel.value;
    // Desseleccionar todos os pills de categoria
    document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(b => b.classList.remove('selected'));
    if (!v) {
      selectedShareCategory = '';
      sel.classList.remove('selected');
    } else {
      selectedShareCategory = v;
      sel.classList.add('selected');
      if (v === 'grupo6')  grupoSeats = 6;
      else if (v === 'grupo8')  grupoSeats = 8;
      else if (v === 'grupo17') grupoSeats = 17;
    }
    updateShareButtonsState();
    calcularPrecoPartilha();
  }
  window.shareGrupoChanged = shareGrupoChanged;


  /* ══════════════════════════════════════════════════════════════
     ESTATÍSTICAS E CLASSIFICAÇÕES — RealMetropolis
  ══════════════════════════════════════════════════════════════ */

  let _statsChart = null;
  let _statsPeriod = 'ano';

  /* ── Dados mock — substituir por API real ─────────────────── */
  const STATS_DATA = {
    ano:    { labels:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'], fin:[42,38,55,61,74,89,102,97,83,71,58,44], can:[5,4,7,6,9,11,13,12,10,8,7,5], fat:[1890,1710,2475,2745,3330,4005,4590,4365,3735,3195,2610,1980], kpi:{fin:714,can:97,fat:32630} },
    mes:    { labels:['S1','S2','S3','S4'],                                                    fin:[18,22,19,24],                           can:[2,3,2,4],                     fat:[810,990,855,1080],                                                                                         kpi:{fin:83,can:11,fat:3735} },
    semana: { labels:['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'],                              fin:[9,11,8,13,16,19,7],                     can:[1,1,1,2,2,3,1],               fat:[405,495,360,585,720,855,315],                                                                              kpi:{fin:83,can:11,fat:3735} },
    dia:    { labels:['00h','03h','06h','09h','12h','15h','18h','21h'],                        fin:[1,0,2,5,4,6,8,3],                       can:[0,0,0,1,1,1,2,0],             fat:[45,0,90,225,180,270,360,135],                                                                              kpi:{fin:29,can:5,fat:1305} }
  };

  /* ══════════════════════════════════════════════════════════════
     CLASSIFICAÇÕES — abrirClassificacoes() nunca tinha sido escrita
     (o botão e o popup já existiam no HTML, mas ficavam sem fazer
     nada — clicar dava erro "not defined"). Dados reais, vindos de
     GET /api/reservas/classificacoes (ver reservas.routes.js).
  ══════════════════════════════════════════════════════════════ */
  let _classifPeriodo = 'all';
  let _classifOrdem   = 'recente';
  let _classifSkip    = 0;
  const CLASSIF_LIMIT  = 20;

  function abrirClassificacoes() {
    _classifPeriodo = 'all';
    _classifOrdem   = 'recente';
    _classifSkip    = 0;
    document.querySelectorAll('#classifPeriodRow .cat-btn').forEach(b =>
      b.classList.toggle('selected', b.dataset.cperiod === 'all')
    );
    const ordemEl = el('classifOrdem');
    if (ordemEl) ordemEl.value = 'recente';
    el('ratingsList').innerHTML = '';
    el('classifErro').style.display = 'none';
    openPopup(el('classificacoesPopup'));
    carregarClassificacoes(true);
  }
  window.abrirClassificacoes = abrirClassificacoes;

  async function carregarClassificacoes(reset) {
    if (reset) _classifSkip = 0;
    const wrapMedia = el('ratingsAvgWrap');
    const lista     = el('ratingsList');
    const erroEl    = el('classifErro');
    const maisWrap  = el('classifLoadMoreWrap');
    erroEl.style.display = 'none';

    if (reset) wrapMedia.innerHTML = '<div style="color:var(--silver-3);font-size:11px;padding:8px 0">A carregar avaliações...</div>';

    try {
      const qs = new URLSearchParams({
        periodo: _classifPeriodo, ordem: _classifOrdem,
        skip: String(_classifSkip), limit: String(CLASSIF_LIMIT),
      });
      const data = await fetchJson(url(`/reservas/classificacoes?${qs}`));
      if (!data?.ok) throw new Error(data?.message || 'Erro ao carregar.');

      renderMediaClassificacoes(data.media, data.total, data.distribuicao);

      if (reset) lista.innerHTML = '';
      if (!data.avaliacoes.length && reset) {
        lista.innerHTML = '<div style="padding:24px;text-align:center;color:var(--silver-3);font-size:11px">Ainda não há avaliações neste período.</div>';
      } else {
        lista.insertAdjacentHTML('beforeend', data.avaliacoes.map(renderCartaoAvaliacao).join(''));
      }

      _classifSkip += data.avaliacoes.length;
      maisWrap.style.display = data.temMais ? 'block' : 'none';
    } catch (err) {
      erroEl.textContent = err.message || 'Erro ao carregar classificações.';
      erroEl.style.display = 'block';
      if (reset) wrapMedia.innerHTML = '';
    }
  }

  function renderMediaClassificacoes(media, total, distribuicao) {
    const wrap = el('ratingsAvgWrap');
    if (!total) {
      wrap.innerHTML = '<div style="color:var(--silver-3);font-size:11px;padding:8px 0">Sem avaliações neste período.</div>';
      return;
    }
    const maxContagem = Math.max(1, ...Object.values(distribuicao));
    const barras = [5, 4, 3, 2, 1].map(estrela => {
      const n = distribuicao[estrela] || 0;
      const pct = Math.round((n / maxContagem) * 100);
      return `
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--silver-3)">
          <span style="width:14px;text-align:right">${estrela}★</span>
          <div style="flex:1;height:6px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden">
            <div style="width:${pct}%;height:100%;background:#f4c56b;border-radius:999px"></div>
          </div>
          <span style="width:26px;text-align:right">${n}</span>
        </div>`;
    }).join('');

    wrap.innerHTML = `
      <div style="display:flex;gap:20px;align-items:center;padding:12px 0">
        <div style="text-align:center;flex:0 0 auto">
          <div style="font-size:32px;font-weight:900;color:#fff;line-height:1">${media != null ? media.toFixed(1) : '—'}</div>
          <div style="color:#f4c56b;font-size:14px;letter-spacing:1px">${'★'.repeat(Math.round(media || 0))}${'☆'.repeat(5 - Math.round(media || 0))}</div>
          <div style="font-size:10px;color:var(--silver-3);margin-top:2px">${total} avaliaç${total === 1 ? 'ão' : 'ões'}</div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:5px">${barras}</div>
      </div>`;
  }

  function renderCartaoAvaliacao(a) {
    const estrelas = '★'.repeat(a.rating || 0) + '☆'.repeat(5 - (a.rating || 0));
    const data = a.avaliadoEm ? new Date(a.avaliadoEm).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    return `
      <div style="padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid var(--line);margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;font-weight:700;color:#fff">${escapeHtml(a.nome || 'Hóspede')}</span>
          <span style="color:#f4c56b;font-size:13px;letter-spacing:1px">${estrelas}</span>
        </div>
        <div style="font-size:10px;color:var(--silver-3);margin-bottom:${a.comentario ? '6px' : '0'}">${escapeHtml(a.destino || '')} · ${data} · ${escapeHtml((a.categoria || '').toUpperCase())}</div>
        ${a.comentario ? `<div style="font-size:12px;color:var(--silver-2);line-height:1.5;font-style:italic">"${escapeHtml(a.comentario)}"</div>` : ''}
      </div>`;
  }

  // Filtros de período — reaproveita as mesmas .cat-btn já usadas
  // noutros filtros do painel, com o mesmo comportamento visual.
  document.querySelectorAll('#classifPeriodRow .cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#classifPeriodRow .cat-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _classifPeriodo = btn.dataset.cperiod;
      carregarClassificacoes(true);
    });
  });
  el('classifOrdem')?.addEventListener('change', (e) => {
    _classifOrdem = e.target.value;
    carregarClassificacoes(true);
  });
  el('btnClassifLoadMore')?.addEventListener('click', () => carregarClassificacoes(false));