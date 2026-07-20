// ─────────────────────────────────────────────────────────────
// rm-core.js — API, auth, estado global, notificações, popups
// ─────────────────────────────────────────────────────────────


  /* ── CONFIGURAÇÃO DA API ───────────────────────────────────── */
  const API_BASE   = location.origin.includes('10000') ? location.origin : 'http://localhost:10000';
  const API_PREFIX = '/api';

  function url(path) {
    return API_BASE.replace(/\/+$/, '') + API_PREFIX + (path.startsWith('/') ? path : '/' + path);
  }

  // ══ Localização para o autocomplete de endereços ═══════════════
  // Guarda { countryCode, lat, lng } para dar prioridade à zona do
  // utilizador e limitar ao país onde ele está.
  // 1) tenta geolocalização (GPS) → 2) se recusada, país pelo IP.
  let _rmGeo = { countryCode: null, lat: null, lng: null, pronto: false };

  async function _rmDetectarLocal() {
    if (_rmGeo.pronto) return _rmGeo;
    // 1) Geolocalização do browser
    const viaGps = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 6000, maximumAge: 600000 }
      );
    });
    if (viaGps) {
      _rmGeo.lat = viaGps.lat; _rmGeo.lng = viaGps.lng;
      // descobrir o país a partir das coordenadas (reverse)
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${viaGps.lat}&lon=${viaGps.lng}&format=json&accept-language=pt`, { headers: { 'User-Agent': 'RMReservaSimples/1.0' } });
        const j = await r.json();
        _rmGeo.countryCode = (j?.address?.country_code || '').toLowerCase() || null;
      } catch (_) {}
      _rmGeo.pronto = true;
      return _rmGeo;
    }
    // 2) País pelo IP (sem permissão) — usa um serviço gratuito
    try {
      const r = await fetch('https://ipapi.co/json/');
      const j = await r.json();
      if (j?.country_code) _rmGeo.countryCode = String(j.country_code).toLowerCase();
      if (j?.latitude && j?.longitude) { _rmGeo.lat = j.latitude; _rmGeo.lng = j.longitude; }
    } catch (_) {}
    _rmGeo.pronto = true;
    return _rmGeo;
  }

  // Constrói os parâmetros extra do Nominatim (país + viewbox à volta
  // do utilizador) a partir da localização detetada.
  function _rmNominatimExtra() {
    let extra = '';
    if (_rmGeo.countryCode) extra += `&countrycodes=${_rmGeo.countryCode}`;
    if (_rmGeo.lat != null && _rmGeo.lng != null) {
      const d = 0.6; // ~60km à volta, para priorizar a zona
      const left = _rmGeo.lng - d, right = _rmGeo.lng + d;
      const top = _rmGeo.lat + d, bottom = _rmGeo.lat - d;
      extra += `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
    }
    return extra;
  }

  // Disparar a deteção assim que a página carrega (não bloqueia nada)
  _rmDetectarLocal();

  function escapeHtml(text) {
    return String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  /* ── TOKEN DE SESSÃO ──────────────────────────────────────── */
  // Tokens em httpOnly cookies — não acessíveis via JS
  // credentials:"include" envia o cookie automaticamente

  // Tipo de parceiro cacheado via /me
  let _isHotelCache = null;
  async function isHotelAsync() {
    _isHotelCache = null; // verificar sempre sem cache
    try {
      const res  = await fetch('/api/admin/parceiros/me', { credentials: 'include' });
      if (!res.ok) { _isHotelCache = false; return false; }
      const data = await res.json().catch(() => ({}));
      _isHotelCache = !!(data?.parceiro || data?.empresa || data?.email);
    } catch { _isHotelCache = false; }
    return _isHotelCache;
  }
  function isHotel() { return _isHotelCache === true; }

  // fetchJson para parceiro — cookie httpOnly enviado automaticamente
  async function fetchJsonParceiro(u, opts = {}) {
    const res  = await fetch(u, { credentials: 'include', ...opts });
    const ct   = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  async function fetchJson(u, opts = {}) {
    // Cookie httpOnly enviado automaticamente via credentials:"include"
    const res = await fetch(u, { credentials: 'include', ...opts });
    const ct  = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Resposta não JSON (HTTP ${res.status}): ${txt.slice(0, 160)}`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }

  /* ── DADOS DO UTILIZADOR — carregados do backend no init() ── */
  const currentUser = { nomeCompleto: '', email: '', contacto: '' };

  // Botão encerrar sessão — fora da topbar, sobre o mapa
  const _btnSair = document.getElementById("btnEncerrarSessao");
  if (_btnSair) {
    _btnSair.onclick = async () => {
      await fetch("/api/clientes/logout",        { method:"POST", credentials:"include" }).catch(()=>{});
      await fetch("/api/admin/parceiros/logout", { method:"POST", credentials:"include" }).catch(()=>{});
      await fetch("/api/motorista/logout",       { method:"POST", credentials:"include" }).catch(()=>{});
      window.location.href = "./index.html";
    };
  }

  async function carregarUtilizador() {
    const nomeEl = el('nomeUtilizador');

    // Tentar até 3 vezes com delay — o cookie pode ainda não estar disponível
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        if (tentativa > 0) await new Promise(r => setTimeout(r, 600));
        const res  = await fetch('/api/admin/parceiros/me', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data?.parceiro) {
          const p = data.parceiro;
          currentUser.nomeCompleto = p.empresa || p.nome || p.email || '';
          currentUser.email        = p.email    || '';
          currentUser.contacto     = p.contacto || '';
          if (nomeEl) nomeEl.textContent = (currentUser.nomeCompleto || 'REALMETROPOLIS').toUpperCase();
          return;
        }
      } catch (_) {}
    }

    // Sem sessão após 3 tentativas — redirecionar
    window.location.href = '/index.html';
  }

  /* ── IMAGEM PLACEHOLDER (sem dependência externa) ─────────── */
  const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Crect width=%27120%27 height=%27120%27 fill=%27%23181a1f%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 dominant-baseline=%27middle%27 text-anchor=%27middle%27 font-size=%2736%27 fill=%27%23444%27%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E";

  const currentTripContext = {
    tripId:        'RM-TRIP-001',
    motoristaNome: 'Carlos Mendes',
    veiculo:       'Mercedes Classe E',
    matricula:     '22-AA-33',
    partida:       'Lisboa',
    destino:       'Cascais',
    datahora:      new Date().toISOString()
  };

  const invoiceMockData = [
    { id: 'INV-001', label: 'Viagem RM-001 — 18.50€ — 05/03/2026' },
    { id: 'INV-002', label: 'Viagem RM-002 — 24.00€ — 07/03/2026' },
    { id: 'INV-003', label: 'Viagem RM-003 — 41.20€ — 09/03/2026' }
  ];

  /* ── REFERÊNCIAS DOM ──────────────────────────────────────── */
  const el = id => document.getElementById(id);

  // ─── ELEMENTO SEGURO (nunca null) ──────────────────────────────
  // Se o elemento não existir na página, devolve um objecto noop
  // que absorve qualquer chamada sem crashar.
  function safeEl(id) {
    const node = document.getElementById(id);
    if (node) return node;
    // Noop proxy — absorve classList, addEventListener, textContent, etc.
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'classList')
          return { add:()=>{}, remove:()=>{}, toggle:()=>{}, contains:()=>false };
        if (prop === 'style')
          return new Proxy({}, { set:()=>true, get:()=>undefined });
        if (typeof prop === 'string')
          return (...args) => {};  // qualquer método → noop
        return undefined;
      },
      set() { return true; }
    });
  }

  const els = {
    tripTypeWrap:          safeEl('tripTypeWrap'),
    btnSemPartilha:        safeEl('btnSemPartilha'),
    btnPartilharAmigos:    safeEl('btnPartilharAmigos'),
    tripPanel:             safeEl('tripPanel'),
    btnCloseTrip:          safeEl('btnCloseTrip'),
    inputPartida:          safeEl('inputPartida'),
    inputDestino:          safeEl('inputDestino'),
    inputDateTime:         safeEl('inputDateTime'),
    btnPreferencia:        safeEl('btnPreferencia'),
    btnReservar:           safeEl('btnReservar'),
    preferencePanel:       safeEl('preferencePanel'),
    lastTripCard1:         safeEl('lastTripCard1'),
    lastTripCard2:         safeEl('lastTripCard2'),
    shareBanner:           safeEl('shareBanner'),
    toast:                 safeEl('toast'),
    inviteBar:             safeEl('inviteBar'),
    shareSheet:            safeEl('shareSheet'),
    shareDestino:          safeEl('shareDestino'),
    shareDateTime:         safeEl('shareDateTime'),
    btnEnviarConvites:     safeEl('btnEnviarConvites'),
    shareStackWrap:        safeEl('shareStackWrap'),
    categoryPopup:         safeEl('categoryPopup'),
    categoryPopupTitle:    safeEl('categoryPopupTitle'),
    categoryPopupText:     safeEl('categoryPopupText'),
    categoryPopupInput:    safeEl('categoryPopupInput'),
    categoryPopupHint:     safeEl('categoryPopupHint'),
    btnPopupCancel:        safeEl('btnPopupCancel'),
    btnPopupConfirm:       safeEl('btnPopupConfirm'),
    inviteVerifyPopup:     safeEl('inviteVerifyPopup'),
    inviteOtpInput:        safeEl('inviteOtpInput'),
    btnInviteClose:        safeEl('btnInviteClose'),
    btnInviteVerify:       safeEl('btnInviteVerify'),
    btnMenu:               safeEl('btnMenu'),
    btnActivity:           safeEl('menuBtnActivity'),
    btnTripManager:        safeEl('menuBtnTripManager'),
    btnContactos:          safeEl('menuBtnContactos'),
    activityPopup:         safeEl('activityPopup'),
    btnCloseActivity:      safeEl('btnCloseActivity'),
    btnLostItem:           safeEl('btnLostItem'),
    btnSecurityProblem:    safeEl('btnSecurityProblem'),
    btnInvoice:            safeEl('btnInvoice'),
    lostItemPopup:         safeEl('lostItemPopup'),
    lostItemTitle:         safeEl('lostItemTitle'),
    lostItemDescription:   safeEl('lostItemDescription'),
    btnLostCancel:         safeEl('btnLostCancel'),
    btnLostSend:           safeEl('btnLostSend'),
    securityPopup:         safeEl('securityPopup'),
    securityOptions:       safeEl('securityOptions'),
    securityDescription:   safeEl('securityDescription'),
    btnSecurityCancel:     safeEl('btnSecurityCancel'),
    btnSecuritySend:       safeEl('btnSecuritySend'),
    invoicePopup:          safeEl('invoicePopup'),
    invoiceList:           safeEl('invoiceList'),
    btnInvoiceCancel:      safeEl('btnInvoiceCancel'),
    btnInvoiceSend:        safeEl('btnInvoiceSend'),
    tripManagerPopup:      safeEl('tripManagerPopup'),
    btnCloseTripManager:   safeEl('btnCloseTripManager'),
    btnStartTripFlow:      safeEl('btnStartTripFlow'),
    btnEndTripFlow:        safeEl('btnEndTripFlow'),
    managerCurrentTrip:    safeEl('managerCurrentTrip'),
    managerPreferenceInfo: safeEl('managerPreferenceInfo'),
    securityLivePopup:     safeEl('securityLivePopup'),
    btnCloseSecurityLive:  safeEl('btnCloseSecurityLive'),
    securityUserLocation:  safeEl('securityUserLocation'),
    securityDriverLocation:safeEl('securityDriverLocation'),
    securityTripState:     safeEl('securityTripState'),
    btnSecurityPanel:      safeEl('btnSecurityPanel'),
  };;

  /* ── ESTADO GLOBAL ─────────────────────────────────────────── */
  let map, ovMap = null, ovMarker = null;
  let selectedCategory    = 'economica';
  let _kmCalculado        = 0;   // distância calculada entre partida e destino
  let _precosCalculados   = {};  // { economica: 12.50, confort: 15.20, ... }
  let _portagensMap       = {};  // { economica: 2.10, confort: 2.10, ... }
  let luxoSeats           = 4;
  let grupoSeats          = 6;
  let preferenceMode      = false;
  let selectedPreferenceTrip   = null;
  let selectedTargetCardIndex  = null;
  let currentAssignedExists    = false;
  let shareMode           = false;
  let shareDestinoPlace   = null;
  let shareId             = null;
  let sharePartilhada     = false;
  let selectedShareCategory    = '';
  let pollingTimer        = null;
  let participantes       = [];
  let lastTripsData       = [];
  let pendingCategorySelection = null;
  let previousCategory    = 'economica';
  let selectedSecurityType     = '';
  let selectedInvoiceId        = '';
  let inviteToken         = '';
  let inviteShareId       = '';
  let shareSessionToken   = '';
  let locationTimer       = null;
  let currentShareCardIndex    = 1;
  let viagensPendentes    = [];

  /* ── NOTIFICAÇÕES ──────────────────────────────────────────── */
  function showToast(msg, ms = 2800) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  function showShareBanner(msg, ms = 5000) {
    els.shareBanner.textContent = msg;
    els.shareBanner.classList.add('show');
    clearTimeout(showShareBanner._t);
    showShareBanner._t = setTimeout(() => els.shareBanner.classList.remove('show'), ms);
  }
  function showInviteBar(msg, ms = 5200) {
    els.inviteBar.textContent = msg;
    els.inviteBar.classList.add('show');
    clearTimeout(showInviteBar._t);
    showInviteBar._t = setTimeout(() => els.inviteBar.classList.remove('show'), ms);
  }

  /* ── POPUPS ────────────────────────────────────────────────── */
  function openPopup(el)  { el.classList.add('show'); }
  function closePopup(el) { el.classList.remove('show'); }

  /* ── MODO DE VIAGEM ────────────────────────────────────────── */
  function hideTripTypeButtons() { els.tripTypeWrap.classList.add('hidden'); }
  function showTripTypeButtons() { els.tripTypeWrap.classList.remove('hidden'); }

  function setActiveTripType(mode) {
    els.btnSemPartilha.classList.toggle('active', mode === 'sem_partilha');
    els.btnPartilharAmigos.classList.toggle('active', mode === 'partilhar');
    el('btnCriarTicket')?.classList.toggle('active', mode === 'ticket');
  }

  function openTripPanel() {
    hideTripTypeButtons();
    setActiveTripType('sem_partilha');
    els.tripPanel.classList.remove('hidden');
    els.shareSheet.classList.add('hidden');
    el('ticketSheet')?.classList.add('hidden');
    shareMode = false;
    // Geolocalização automática na partida ao abrir
    if (!els.inputPartida.value.trim()) rmAutoGeo('inputPartida', 'reservar');
  }

  function closeTripPanel() {
    els.tripPanel.classList.add('hidden');
    showTripTypeButtons();
    resetPreferenceSelection();
  }

  function openShareMode() {
    hideTripTypeButtons();
    setActiveTripType('partilhar');
    els.tripPanel.classList.add('hidden');
    els.shareSheet.classList.remove('hidden');
    el('ticketSheet')?.classList.add('hidden');
    shareMode = true;
    sharePartilhada = false;
    selectedShareCategory = '';
    document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(b => b.classList.remove('selected'));
    if (!els.shareDateTime.value) {
      const future = new Date(Date.now() + 90 * 60 * 1000);
      els.shareDateTime.value = future.toISOString().slice(0, 16);
    }

  }

  function closeShareMode() {
    els.shareSheet.classList.add('hidden');
    el('ticketSheet')?.classList.add('hidden');
    showTripTypeButtons();
    shareMode = false;
    sharePartilhada = false;
    selectedShareCategory = '';
    stopPolling();
    shareId = null;
    shareDestinoPlace = null;
    participantes = [];
    currentShareCardIndex = 1;
    els.shareStackWrap.innerHTML = '';
    els.shareDestino.value = '';
    els.shareDateTime.value = '';
    document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(b => b.classList.remove('selected'));
    fecharAguardaOverlay();
    fecharRotaOverlay();
    const painel = el('sharePrecoPanel');
    if (painel) painel.classList.remove('show', 'a-calcular');
    if (els.btnEnviarConvites) {
      els.btnEnviarConvites.textContent = 'PARTILHAR';
      els.btnEnviarConvites.style.cssText = '';
      els.btnEnviarConvites.disabled = true;
    }
  }

  /* ── CATEGORIAS ────────────────────────────────────────────── */
  function getCategoryValue() {
    // grupo6/8/17 — seleccionado via select
    if (selectedCategory === 'grupo6')  return 'grupo6';
    if (selectedCategory === 'grupo8')  return 'grupo8';
    if (selectedCategory === 'grupo17') return 'grupo17';
    // 'grupo' legacy — usar grupoSeats
    if (selectedCategory === 'grupo') {
      return grupoSeats >= 17 ? 'grupo17' : grupoSeats >= 8 ? 'grupo8' : 'grupo6';
    }
    if (selectedCategory === 'luxo') return 'luxury';
    return selectedCategory;
  }

  function getCategoryLabel(cat) {
    if (String(cat).startsWith('GRUPO')) return `GRUPO ${String(cat).replace('GRUPO', '')} PASSAGEIROS`;
    const labels = { economica: 'ECONÓMICA', confort: 'CONFORTO', executive: 'EXECUTIVA', luxo: `LUXO ${luxoSeats} LUGARES` };
    return labels[cat] || String(cat || '').toUpperCase();
  }

  function setSelectedCategory(cat) {
    selectedCategory = cat;
    const isGrupo = cat === 'grupo' || cat === 'grupo6' || cat === 'grupo8' || cat === 'grupo17';
    // Botões cat-btn: todos desligados se for grupo, senão liga o correcto
    document.querySelectorAll('.cat-btn[data-category]').forEach(btn =>
      btn.classList.toggle('selected', !isGrupo && btn.dataset.category === cat)
    );
    // Select de grupo: marcar como selected e escolher a opção certa
    // Restore select state for grupoSelect
    const grupoSel = el('grupoSelect');
    if (grupoSel) {
      if (isGrupo) {
        grupoSel.classList.add('selected');
        if (cat === 'grupo6')       grupoSel.value = 'grupo6';
        else if (cat === 'grupo8')  grupoSel.value = 'grupo8';
        else if (cat === 'grupo17') grupoSel.value = 'grupo17';
      } else {
        grupoSel.classList.remove('selected');
        grupoSel.value = '';
      }
    }
    const label = getCategoryLabel(getCategoryValue());
    document.querySelectorAll('.driver-card .driver-top span').forEach(s => s.textContent = `Categoria atual: ${label}`);
  }

  function openCategoryPopup(type) {
    pendingCategorySelection = type;
    els.categoryPopupInput.value = '';
    const cfg = {
      luxo:         { title: 'CATEGORIA LUXO',   text: 'Indique o número de lugares pretendido.',    hint: 'LIMITE DE 1 A 4 LUGARES' },
      grupo:        { title: 'CATEGORIA GRUPO',  text: 'Indique o número de passageiros pretendido.',hint: 'LIMITE DE 6 A 17 LUGARES' },
      share_people: { title: 'PARTILHAR',         text: 'Indique o número de pessoas da partilha.',   hint: 'LIMITE DE 1 A 17 PESSOAS' }
    };
    const c = cfg[type] || {};
    els.categoryPopupTitle.textContent = c.title || '';
    els.categoryPopupText.textContent  = c.text  || '';
    els.categoryPopupHint.textContent  = c.hint  || '';
    els.categoryPopupInput.type        = 'number';
    els.categoryPopupInput.placeholder = c.hint || '';
    openPopup(els.categoryPopup);
    setTimeout(() => els.categoryPopupInput.focus(), 30);
  }

  function closeCategoryPopup() {
    closePopup(els.categoryPopup);
    pendingCategorySelection = null;
  }

  function confirmCategoryPopup() {
    const v = Number(els.categoryPopupInput.value || 0);
    if (pendingCategorySelection === 'luxo') {
      if (!Number.isInteger(v) || v < 1 || v > 4) { showToast('Luxo permite entre 1 e 4 lugares.'); return; }
      luxoSeats = v; setSelectedCategory('luxo'); closeCategoryPopup(); showToast('Categoria configurada.');
    } else if (pendingCategorySelection === 'grupo') {
      if (!Number.isInteger(v) || v < 6 || v > 17) { showToast('Grupo permite entre 6 e 17 lugares.'); return; }
      grupoSeats = v; setSelectedCategory('grupo'); closeCategoryPopup(); showToast('Categoria configurada.');
    }
  }

  /* ── PREFERÊNCIA ───────────────────────────────────────────── */
  function resetPreferenceSelection() {
    preferenceMode = false; selectedPreferenceTrip = null; selectedTargetCardIndex = null;
    els.preferencePanel.classList.remove('show');
    els.btnPreferencia.classList.remove('active');
    els.btnPreferencia.textContent = 'ADICIONAR PREFERÊNCIA';
    document.querySelectorAll('.driver-card').forEach(c => c.classList.remove('oscilar', 'selected-target'));
    document.querySelectorAll('.pref-action-btn').forEach(b => b.classList.remove('selected-add', 'selected-replace'));
  }

  function togglePreferenceMode(force = null) {
    preferenceMode = typeof force === 'boolean' ? force : !preferenceMode;
    els.preferencePanel.classList.toggle('show', preferenceMode);
    els.btnPreferencia.classList.toggle('active', preferenceMode);
    if (preferenceMode) {
      els.btnPreferencia.textContent = 'APLICAR PREFERÊNCIA';
      document.querySelectorAll('.driver-card').forEach(c => c.classList.add('oscilar'));
      loadLastTripsPreference();
    } else {
      els.btnPreferencia.textContent = 'ADICIONAR PREFERÊNCIA';
      document.querySelectorAll('.driver-card').forEach(c => c.classList.remove('oscilar'));
    }
  }

  function updateCardActionStates() {
    document.querySelectorAll('.driver-card').forEach(card => {
      const btn = card.querySelector('.pref-action-btn');
      if (!btn) return;
      btn.textContent = currentAssignedExists ? 'SUBSTITUIR' : 'ADICIONAR';
      btn.classList.toggle('replace', currentAssignedExists);
    });
  }

  function clearTargetStyles() {
    document.querySelectorAll('.driver-card').forEach(c => c.classList.remove('selected-target'));
    document.querySelectorAll('.pref-action-btn').forEach(b => b.classList.remove('selected-add', 'selected-replace'));
  }

  function bindTargetSelection() {
    document.querySelectorAll('.driver-card').forEach(card => {
      const btn = card.querySelector('.pref-action-btn');
      if (!btn) return;
      btn.addEventListener('click', () => {
        clearTargetStyles();
        card.classList.add('selected-target');
        selectedTargetCardIndex = Number(card.dataset.cardIndex || 0);
        currentAssignedExists = btn.textContent.trim() === 'SUBSTITUIR';
        updateCardActionStates();
        btn.classList.add(currentAssignedExists ? 'selected-replace' : 'selected-add');
        showToast(currentAssignedExists ? 'Cartão selecionado para substituição.' : 'Cartão selecionado para nova atribuição.');
      });
    });
  }

  function renderLastTrips(list) {
    lastTripsData = Array.isArray(list) ? list.slice(0, 2) : [];
    [els.lastTripCard1, els.lastTripCard2].forEach((card, idx) => {
      const item = lastTripsData[idx];
      card.classList.remove('selected');
      if (!item) {
        card.innerHTML = `<img src="${PLACEHOLDER_IMG}" alt="sem registo"><div><strong>Sem registo</strong><span>Assim que existir histórico, aparecerá aqui.</span></div>`;
        card.onclick = null;
        return;
      }
      card.innerHTML = `<img src="${item.foto || PLACEHOLDER_IMG}" alt="${item.motorista||'Motorista'}"><div><strong>${item.motorista||'Motorista'}</strong><span>${item.veiculo||'—'}</span><span>Matrícula: ${item.matricula||'—'}</span><span>Categoria: ${getCategoryLabel(item.categoria||'')}</span></div>`;
      card.onclick = () => {
        selectedPreferenceTrip = item;
        els.lastTripCard1.classList.remove('selected');
        els.lastTripCard2.classList.remove('selected');
        card.classList.add('selected');
        showToast('Preferência selecionada.');
      };
    });
  }

  async function loadLastTripsPreference() {
    try {
      const data = await fetchJson(url('/user/preferences/last-trips?limit=2'));
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length) { renderLastTrips(items); return; }
    } catch (_) {}
    renderLastTrips([
      { id: 'mock-1', motoristaId: 'drv-001', motorista: 'Carlos Mendes', foto: PLACEHOLDER_IMG, matricula: '22-AA-33', veiculo: 'Mercedes Classe E', categoria: 'executive', tipoVeiculo: 'Sedan Premium' },
      { id: 'mock-2', motoristaId: 'drv-002', motorista: 'Ricardo Lopes',  foto: PLACEHOLDER_IMG, matricula: '44-BB-55', veiculo: 'BMW Série 5',        categoria: 'confort',   tipoVeiculo: 'Sedan' }
    ]);
  }

  async function applyPreferenceToSelectedCard(pref) {
    if (!pref || !selectedTargetCardIndex) { showToast('Selecione primeiro o cartão alvo.'); return false; }
    const card = document.querySelector(`.driver-card[data-card-index="${selectedTargetCardIndex}"]`);
    if (!card) return false;

    // ID do motorista (não da viagem) — é isto que o dispatch precisa
    // para, em viagens futuras, verificar se este motorista está
    // próximo e disponível. O backend deve devolver motoristaId em
    // cada item de /user/preferences/last-trips; mantém-se o id da
    // viagem (tripId) só como referência secundária, nunca como
    // identificador do motorista.
    const motoristaId = pref.motoristaId || pref.driverId || null;
    if (!motoristaId) {
      showToast('Não foi possível identificar o motorista. Tente novamente.');
      return false;
    }

    // Persistir no servidor — isto é um REGISTO permanente do
    // utilizador (não algo ligado a uma reserva específica). Em
    // qualquer viagem futura, o sistema de dispatch consulta este
    // grupo de motoristas preferidos e, se algum estiver próximo e
    // disponível, é-lhe atribuída a viagem automaticamente.
    try {
      const resp = await fetchJson(url('/user/preferences/motoristas'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: selectedTargetCardIndex,
          motoristaId,
        })
      });
      if (!resp?.ok && !resp?.success) throw new Error(resp?.message || 'Erro ao gravar preferência.');
    } catch (err) {
      showToast(err.message || 'Erro ao gravar preferência no servidor.');
      return false;
    }

    // Só depois de confirmado no servidor é que o cartão é actualizado
    // visualmente — evita mostrar um slot "preenchido" que na
    // realidade não foi guardado.
    const img    = card.querySelector('img');
    const strong = card.querySelector('.driver-top strong');
    const sub    = card.querySelector('.driver-top span');
    const meta   = card.querySelectorAll('.driver-meta span');
    const chip   = card.querySelector('.mini-chip');
    const action = card.querySelector('.pref-action-btn');
    if (img)    img.src = pref.foto || PLACEHOLDER_IMG;
    if (strong) strong.textContent = pref.motorista || `Slot ${selectedTargetCardIndex}`;
    if (sub)    sub.textContent = `Categoria atual: ${getCategoryLabel(getCategoryValue())}`;
    if (meta[0]) meta[0].innerHTML = `<b>Veículo:</b> ${pref.veiculo||'—'}`;
    if (meta[1]) meta[1].innerHTML = `<b>Matrícula:</b> ${pref.matricula||'—'}`;
    if (meta[2]) meta[2].innerHTML = `<b>Tipo:</b> ${pref.tipoVeiculo||'Premium'}`;
    if (chip)   chip.textContent = 'No grupo de preferência';
    card.dataset.motoristaId = motoristaId;
    card.classList.add('selected-target');
    currentAssignedExists = true;
    updateCardActionStates();
    if (action) action.classList.remove('selected-add', 'selected-replace');
    return true;
  }

  /* ── RESERVA PRIVADA ───────────────────────────────────────── */
  // Calcular distância via OSRM e preços para todas as categorias
  async function tentarCalcularPrecos() {
    const pLat = els.inputPartida.dataset.lat;
    const pLng = els.inputPartida.dataset.lng;
    const dLat = els.inputDestino.dataset.lat;
    const dLng = els.inputDestino.dataset.lng;

    // Se faltam coordenadas, geocodificar os textos escritos
    if (!pLat || !pLng) {
      const txt = els.inputPartida.value.trim();
      if (!txt) return;
      const geo = await nominatimSearch(txt);
      if (!geo.length) return;
      els.inputPartida.dataset.lat = geo[0].lat;
      els.inputPartida.dataset.lng = geo[0].lon;
    }
    if (!dLat || !dLng) {
      const txt = els.inputDestino.value.trim();
      if (!txt) return;
      const geo = await nominatimSearch(txt);
      if (!geo.length) return;
      els.inputDestino.dataset.lat = geo[0].lat;
      els.inputDestino.dataset.lng = geo[0].lon;
    }

    // Indicar que está a calcular (só o preço, sem apagar ícone/tempo/distância)
    document.querySelectorAll('.cat-btn[data-category]').forEach(b => {
      const priceEl = b.querySelector('.cat-price');
      if (priceEl) priceEl.textContent = '...';
    });
    const grupoPrecoEl0 = el('catGrupoPreco');
    if (grupoPrecoEl0) grupoPrecoEl0.textContent = '...';

    try {
      // 1. Calcular distância via OSRM
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${dLng},${dLat}?overview=false`;
      const osrmRes  = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();
      if (osrmData.code !== 'Ok' || !osrmData.routes?.length) throw new Error('Rota não encontrada');
      const km = Number((osrmData.routes[0].distance / 1000).toFixed(2));
      _kmCalculado = km;
      const durSeg = osrmData.routes[0].duration;
      const durH = Math.floor(durSeg / 3600);
      const durM = Math.round((durSeg % 3600) / 60);
      const durLabel = durH > 0 ? `${durH}h ${durM}min` : `${durM} min`;
      const kmLabel = `${km.toFixed(1)} km`;

      // Mostrar já tempo/distância nos botões e no grupo (preço continua "...")
      document.querySelectorAll('.cat-btn[data-category]').forEach(btn => {
        const dur = btn.querySelector('.cat-meta-dur');
        const kmEl = btn.querySelector('.cat-meta-km');
        if (dur) dur.textContent = durLabel;
        if (kmEl) kmEl.textContent = kmLabel;
      });
      const grupoDurEl = el('catGrupoDur');
      const grupoKmEl  = el('catGrupoKm');
      if (grupoDurEl) grupoDurEl.textContent = durLabel;
      if (grupoKmEl)  grupoKmEl.textContent  = kmLabel;

      // 2. Pedir preços para todas as categorias
      const categorias = [
        { key: 'economica', label: 'ECONÓMICA' },
        { key: 'confort',   label: 'CONFORTO'  },
        { key: 'executive', label: 'EXECUTIVA' },
        { key: 'luxo',      label: 'LUXO'      },
        { key: 'grupo6',    label: 'GRUPO 6'   },
        { key: 'grupo8',    label: 'GRUPO 8'   },
        { key: 'grupo17',   label: 'GRUPO 17'  },
      ];

      const catBackendMap = {
        economica: 'economica',
        confort:   'confort',
        executive: 'executive',
        luxo:      'luxury',
        grupo6:    'grupo6',
        grupo8:    'grupo8',
        grupo17:   'grupo17',
      };

      const precos    = {};
      const portagens = {};
      await Promise.all(categorias.map(async ({ key }) => {
        try {
          const resp = await fetchJson(url('/quotes/quote'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              categoria: catBackendMap[key],
              distanciaKm: km,
              // Sem isto, nem o mínimo do aeroporto nem as zonas
              // especiais (estádios, arenas, aeroporto de madrugada)
              // alguma vez tinham como aplicar aqui — o "contexto"
              // nunca era enviado nesta chamada específica.
              contexto: {
                origemTexto:  els.inputPartida?.value  || '',
                destinoTexto: els.inputDestino?.value  || '',
                datahora:     els.inputDateTime?.value || null,
              },
            })
          });
          if (resp?.ok && resp?.total != null) {
            precos[key]    = Number(resp.total);
            portagens[key] = Number(resp.portagens || resp.tollTotal || 0);
          } else if (!resp?.ok) {
            console.warn('[QUOTE] Falhou para', key, ':', resp?.message);
          }
        } catch (_) {}
      }));

      _precosCalculados = precos;
      _portagensMap     = portagens;

      // 3. Actualizar texto dos botões (e opções do select de grupo)
      categorias.forEach(({ key, label }) => {
        if (key === 'grupo6' || key === 'grupo8' || key === 'grupo17') {
          const sel = el('grupoSelect');
          if (!sel) return;
          const optMap = { grupo6: 1, grupo8: 2, grupo17: 3 };
          const lblMap = { grupo6: 'ATÉ 6 PESSOAS', grupo8: 'ATÉ 8 PESSOAS', grupo17: 'ATÉ 17 PESSOAS' };
          const optIdx = optMap[key];
          const optLbl = lblMap[key];
          if (sel.options[optIdx]) {
            const v = precos[key];
            sel.options[optIdx].text = v ? `${optLbl} — €${Number(v).toFixed(2)}` : optLbl;
          }
          return;
        }
        const btn = document.querySelector(`.cat-btn[data-category="${key}"]`);
        if (!btn) return;
        const valor = precos[key];
        const priceEl = btn.querySelector('.cat-price');
        if (priceEl) priceEl.textContent = valor ? `€${Number(valor).toFixed(2)}` : '—';
      });

    } catch (err) {
      console.error('[RESERVAR] Erro ao calcular preços:', err.message);
      document.querySelectorAll('.cat-btn[data-category]').forEach(b => {
        const priceEl = b.querySelector('.cat-price');
        if (priceEl) priceEl.textContent = '—';
      });
      const sel = el('grupoSelect');
      if (sel) {
        sel.options[1].text = 'ATÉ 6 PESSOAS';
        if (sel.options[2]) sel.options[2].text = 'ATÉ 8 PESSOAS';
        if (sel.options[3]) sel.options[3].text = 'ATÉ 17 PESSOAS';
      }
    }
  }

  /* ── "+ Convidar mais pessoas" — opcional. Cada participante
     extra tem o seu próprio nome/contacto/email/destino. Sem usar
     isto, o RESERVAR continua exactamente como sempre foi. ── */
  let _rmParticipantesExtraCount = 0;

  // ── Janela de validade (botões +1h..+4h). Default 2h. ──
  let _rmValidadeHoras = 2;
  (function _initValidadeBtns(){
    const btns = document.querySelectorAll('.rm-validade-btn');
    if (!btns.length) return;
    function marcar(horas){
      _rmValidadeHoras = horas;
      btns.forEach(b => b.classList.toggle('rm-validade-ativo', Number(b.dataset.horas) === horas));
    }
    btns.forEach(b => b.addEventListener('click', () => marcar(Number(b.dataset.horas))));
    marcar(2); // por omissão +2h
  })();

  // Calcula o validUntil (ISO) = hora da reserva + horas escolhidas,
  // limitado a máx 4h e ao fim do dia. Devolve null se não houver data.
  function _rmCalcValidUntil(dateTimeStr){
    if (!dateTimeStr) return null;
    const base = new Date(dateTimeStr);
    if (isNaN(base.getTime())) return null;
    const horas = Math.min(Math.max(_rmValidadeHoras || 2, 1), 4); // 1..4
    const vu = new Date(base.getTime() + horas * 60 * 60 * 1000);
    // não passar do fim do mesmo dia
    const fimDia = new Date(base); fimDia.setHours(23, 59, 0, 0);
    if (vu > fimDia) return fimDia.toISOString();
    return vu.toISOString();
  }

  function adicionarParticipanteExtra() {
    const wrap = document.getElementById('rmParticipantesExtra');
    if (!wrap) return;
    wrap.style.display = 'flex';

    // Caixa "Todos no mesmo veículo" — criada uma única vez, aparece
    // assim que há pelo menos um convidado. Marcada = uma só viagem
    // partilhada; desmarcada = cada participante o seu próprio carro.
    if (!document.getElementById('rmMesmoVeiculoWrap')) {
      const mv = document.createElement('label');
      mv.id = 'rmMesmoVeiculoWrap';
      mv.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;border:1px solid rgba(196,201,212,.15);cursor:pointer;font-size:13px;color:var(--silver-2)';
      mv.innerHTML = `
        <input type="checkbox" id="rmMesmoVeiculo" style="width:18px;height:18px;cursor:pointer;accent-color:#c4c9d4">
        <span>Todos no mesmo veículo (viagem partilhada)</span>
      `;
      wrap.parentNode.insertBefore(mv, wrap);
    }

    const idx = _rmParticipantesExtraCount++;
    const linha = document.createElement('div');
    linha.className = 'rm-hospede-row rm-participante-extra';
    linha.dataset.idx = idx;
    linha.dataset.numFixo = idx + 2;   // Nº fixo por ordem de criação (organizador=1)
    linha.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;border:1px solid rgba(196,201,212,.15);position:relative';
    linha.innerHTML = `
      <div class="rm-participante-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px">
        <span class="rm-num-badge-forte" style="font-size:12px;font-weight:900;letter-spacing:.04em;color:#c4c9d4">Nº —</span>
        <button type="button" class="rm-participante-remover" style="background:transparent;border:none;color:#ff5a5a;font-size:11px;font-weight:800;cursor:pointer;padding:2px 4px">✕ fechar</button>
      </div>
      <input class="field rm-hospede-field" placeholder="Nome do participante" data-campo="nome">
      <input class="field rm-hospede-field" type="tel" placeholder="Contacto" data-campo="contacto">
      <input class="field rm-hospede-field" type="email" placeholder="Email (opcional)" data-campo="email">
      <div class="nm-wrap" style="position:relative">
        <input class="field rm-hospede-field" placeholder="Destino sugestivo" data-campo="destinoTexto" autocomplete="off">
        <div class="nm-dropdown" data-campo="destinoDropdown"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--silver-2);cursor:pointer;margin-top:2px">
        <input type="checkbox" class="rm-eupago-check" style="width:16px;height:16px;cursor:pointer;accent-color:#c4c9d4">
        <span>Eu pago (escolher quem)</span>
      </label>
      <div class="rm-eupago-lista" style="display:none;flex-wrap:wrap;gap:6px;padding:8px 0 2px"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--silver-2);cursor:pointer;margin-top:2px">
        <input type="checkbox" class="rm-bloquear-check" style="width:16px;height:16px;cursor:pointer;accent-color:#c4c9d4">
        <span>Bloquear viagem (destino fixo)</span>
      </label>
    `;
    // Inserir na posição ORDENADA por número (Nº crescente: 2,3,4...).
    // O número é fixo (numFixo), mas a posição na lista segue a ordem.
    const meuNum = idx + 2;
    const existentes = Array.from(wrap.querySelectorAll('.rm-participante-extra'));
    const posterior = existentes.find(l => (Number(l.dataset.numFixo) || 999) > meuNum);
    if (posterior) wrap.insertBefore(linha, posterior);
    else wrap.appendChild(linha);

    linha.querySelector('.rm-participante-remover').addEventListener('click', () => linha.remove());

    // Cursor automático no campo do nome (pronto a escrever) + Enter salta de campo.
    const _campos = Array.from(linha.querySelectorAll('input.rm-hospede-field'));
    const _nome = linha.querySelector('input[data-campo="nome"]') || _campos[0];
    if (_nome) setTimeout(() => _nome.focus(), 60);
    _campos.forEach((campo, ci) => {
      campo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const prox = _campos[ci + 1];
          if (prox) prox.focus();
          else campo.blur();
        }
      });
    });

    // Autocomplete geográfico — mesma função já usada no destino do
    // evento, com IDs únicos por linha (não tem id fixo, por isso
    // liga-se directamente aos elementos, não por getElementById).
    const inputDestino = linha.querySelector('[data-campo="destinoTexto"]');
    // Ligar o efeito visual de bloqueio no campo de destino do convidado
    const _chkBloq = linha.querySelector('.rm-bloquear-check');
    const _wrapBloq = inputDestino ? inputDestino.closest('.nm-wrap') : null;
    if (_chkBloq && _wrapBloq) {
      _chkBloq.addEventListener('change', () => {
        const _inpBloq = _wrapBloq.querySelector('input');
        if (_chkBloq.checked) {
          _wrapBloq.classList.add('rm-campo-bloqueado');
          if (_inpBloq) {
            _inpBloq.style.setProperty('border', '1.5px solid #ef9f27', 'important');
            _inpBloq.style.setProperty('border-radius', '12px', 'important');
            _inpBloq.style.setProperty('color', '#ef9f27', 'important');
            _inpBloq.style.setProperty('background', 'rgba(239,159,39,.06)', 'important');
            _inpBloq.style.setProperty('font-weight', '600', 'important');
            _inpBloq.style.setProperty('padding-right', '70px', 'important');
          }
        } else {
          _wrapBloq.classList.remove('rm-campo-bloqueado');
          if (_inpBloq) {
            ['border','border-radius','color','background','font-weight','padding-right'].forEach(p => _inpBloq.style.removeProperty(p));
          }
        }
      });
    }
    const dropDestino = linha.querySelector('[data-campo="destinoDropdown"]');
    let timerBusca;
    inputDestino.addEventListener('input', () => {
      clearTimeout(timerBusca);
      const q = inputDestino.value.trim();
      if (q.length < 3) { dropDestino.style.display = 'none'; return; }
      timerBusca = setTimeout(async () => {
        try {
          await _rmDetectarLocal();
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=pt${_rmNominatimExtra()}`, { headers: { 'User-Agent': 'RMReservaSimples/1.0' } });
          const items = await r.json();
          dropDestino.innerHTML = '';
          items.forEach(it => {
            const d = document.createElement('div');
            d.className = 'nm-item';
            d.textContent = it.display_name;
            d.addEventListener('click', () => {
              inputDestino.value = it.display_name;
              inputDestino.dataset.lat = it.lat;
              inputDestino.dataset.lng = it.lon;
              dropDestino.style.display = 'none';
            });
            dropDestino.appendChild(d);
          });
          dropDestino.style.display = items.length ? 'block' : 'none';
        } catch (_) {}
      }, 350);
    });
    inputDestino.addEventListener('blur', () => setTimeout(() => { dropDestino.style.display = 'none'; }, 200));
  }

  // ══ FEATURE "EU PAGO" ═══════════════════════════════════════
  // Renumera todos os participantes e reconstrói as listas "Eu pago"
  // aplicando a regra anti-conflito: cada participante só pode ser
  // pago por UM pagador (o primeiro a marcá-lo). Chamada sempre que
  // se adiciona/remove um participante ou se mexe numa caixa.
  // Pagadores no ecrã: principal (nº1) + convidados extra.
  function _rmPagadores() {
    const out = [];
    const chkP = document.getElementById('rmEuPagoPrincipal');
    if (chkP) out.push({ num: 1, chk: chkP, listaEl: document.querySelector('.rm-eupago-lista-principal'), linhaEl: null });
    const linhas = Array.from(document.querySelectorAll('#rmParticipantesExtra .rm-participante-extra'));
    linhas.forEach((linha) => {
      // Nº por ORDEM DE CRIAÇÃO (fixo), não pela posição na tela.
      const nFixo = Number(linha.dataset.numFixo) || (Number(linha.dataset.idx) + 2);
      linha.dataset.num = nFixo;
      out.push({ num: nFixo, chk: linha.querySelector('.rm-eupago-check'), listaEl: linha.querySelector('.rm-eupago-lista'), linhaEl: linha });
    });
    return out;
  }

  function _rmAtualizarEuPago() {
    const pagadoresUI = _rmPagadores();
    const todos = pagadoresUI.map(p => ({ num: p.num }));

    // Badges nos convidados extra
    pagadoresUI.forEach(p => {
      if (!p.linhaEl) return;
      // Atualizar o número no header forte (novo formato)
      const badgeForte = p.linhaEl.querySelector('.rm-num-badge-forte');
      if (badgeForte) badgeForte.textContent = `N\u00ba ${p.num}`;
    });

    // Anti-conflito
    const assumidoPor = {};
    pagadoresUI.forEach(p => {
      if (!p.chk || !p.chk.checked || !p.listaEl) return;
      const sel = new Set();
      p.listaEl.querySelectorAll('.rm-eupago-opt:checked').forEach(o => sel.add(Number(o.value)));
      sel.add(p.num);
      sel.forEach(n => { if (assumidoPor[n] == null) assumidoPor[n] = p.num; });
    });

    // Reconstruir listas
    pagadoresUI.forEach(p => {
      if (!p.chk || !p.listaEl) return;
      if (!p.chk.checked) { p.listaEl.style.display = 'none'; p.listaEl.innerHTML = ''; return; }
      p.listaEl.style.display = 'flex';
      const jaSel = new Set();
      p.listaEl.querySelectorAll('.rm-eupago-opt:checked').forEach(o => jaSel.add(Number(o.value)));
      p.listaEl.innerHTML = '';
      todos.forEach(t => {
        if (t.num === p.num) return;
        const dono = assumidoPor[t.num];
        const bloqueado = dono != null && dono !== p.num;
        const wrap = document.createElement('label');
        wrap.style.cssText = `display:flex;align-items:center;gap:5px;font-size:11px;padding:4px 8px;border-radius:8px;border:1px solid rgba(196,201,212,.15);cursor:${bloqueado?'not-allowed':'pointer'};opacity:${bloqueado?'.4':'1'}`;
        wrap.innerHTML = `<input type="checkbox" class="rm-eupago-opt" value="${t.num}" ${jaSel.has(t.num)?'checked':''} ${bloqueado?'disabled':''} style="cursor:inherit;accent-color:#c4c9d4"><span>Nº ${t.num} ${bloqueado?'(já assumido)':''}</span>`;
        wrap.querySelector('input').addEventListener('change', _rmAtualizarEuPago);
        p.listaEl.appendChild(wrap);
      });
    });

    // ── DESTAQUE VERDE no input do nome de quem é BENEFICIÁRIO ──
    // assumidoPor[num] != null significa que alguém paga por esse participante.
    // Aplica-se ao input do nome (principal ou convidado).
    pagadoresUI.forEach(p => {
      let inputNome = null;
      if (p.num === 1) {
        inputNome = document.getElementById('inputNomeHospede');
      } else if (p.linhaEl) {
        inputNome = p.linhaEl.querySelector('input[data-campo="nome"]') || p.linhaEl.querySelector('.rm-hospede-field');
      }
      if (!inputNome) return;
      const ehBeneficiario = assumidoPor[p.num] != null;
      if (ehBeneficiario) {
        inputNome.style.setProperty('border-color', '#1cd68e', 'important');
        inputNome.style.setProperty('box-shadow', '0 0 0 2px rgba(28,214,142,.25)', 'important');
        inputNome.style.setProperty('background', 'rgba(28,214,142,.06)', 'important');
      } else {
        inputNome.style.removeProperty('border-color');
        inputNome.style.removeProperty('box-shadow');
        inputNome.style.removeProperty('background');
      }
    });
  }

  document.getElementById('rmEuPagoPrincipal')?.addEventListener('change', _rmAtualizarEuPago);



  // ── Efeito visual "bloqueado" (laranja) no campo de destino ──
  function _rmAplicarBloqueio(chk, campoWrap){
    if (!chk || !campoWrap) return;
    const inp = campoWrap.querySelector('input');
    if (chk.checked) {
      campoWrap.classList.add('rm-campo-bloqueado');
      if (inp) {
        inp.style.setProperty('border', '1.5px solid #ef9f27', 'important');
        inp.style.setProperty('border-radius', '12px', 'important');
        inp.style.setProperty('color', '#ef9f27', 'important');
        inp.style.setProperty('background', 'rgba(239,159,39,.06)', 'important');
        inp.style.setProperty('font-weight', '600', 'important');
        inp.style.setProperty('padding-right', '70px', 'important');
      }
    } else {
      campoWrap.classList.remove('rm-campo-bloqueado');
      if (inp) {
        inp.style.removeProperty('border');
        inp.style.removeProperty('border-radius');
        inp.style.removeProperty('color');
        inp.style.removeProperty('background');
        inp.style.removeProperty('font-weight');
        inp.style.removeProperty('padding-right');
      }
    }
  }
  // Principal: caixa rmBloquearPrincipal -> wrapper do inputDestino
  (function(){
    const chk = document.getElementById('rmBloquearPrincipal');
    const dest = document.getElementById('inputDestino');
    const wrap = dest ? dest.closest('.nm-wrap') : null;
    if (chk && wrap) {
      chk.addEventListener('change', () => _rmAplicarBloqueio(chk, wrap));
    }
  })();

  document.getElementById('btnConvidarMaisPessoas')?.addEventListener('click', () => {
    adicionarParticipanteExtra();
    // Ligar a nova caixa "Eu pago" ao atualizador e renumerar
    const ultima = document.querySelector('#rmParticipantesExtra .rm-participante-extra:last-child .rm-eupago-check');
    if (ultima) ultima.addEventListener('change', _rmAtualizarEuPago);
    _rmAtualizarEuPago();
  });

  /* Lê todas as linhas de participante extra do DOM, já com
     coordenadas — devolve só as que têm destino escolhido da lista
     (sem coordenadas não dá para calcular preço nem despachar). */
  function lerParticipantesExtra() {
    const linhas = document.querySelectorAll('#rmParticipantesExtra .rm-participante-extra');
    const out = [];
    linhas.forEach(linha => {
      const nome = linha.querySelector('[data-campo="nome"]')?.value.trim();
      const contacto = linha.querySelector('[data-campo="contacto"]')?.value.trim();
      const email = linha.querySelector('[data-campo="email"]')?.value.trim();
      const destinoInput = linha.querySelector('[data-campo="destinoTexto"]');
      if (!nome || !contacto || !destinoInput?.dataset.lat) return; // linha incompleta, ignora
      const bloqueado = !!linha.querySelector('.rm-bloquear-check')?.checked;
      out.push({
        nome, contacto, email, bloqueado,
        destino: { address: destinoInput.value.trim(), lat: Number(destinoInput.dataset.lat), lng: Number(destinoInput.dataset.lng) },
      });
    });
    return out;
  }

  async function reservarViagem() {
    const partida  = els.inputPartida.value.trim();
    const destino  = els.inputDestino.value.trim();
    const datahora = els.inputDateTime.value.trim();

    if (!partida || !destino || !datahora) {
      showToast('Preencha local de partida, destino e data/hora.');
      return;
    }
    if (!currentUser.email) {
      showToast('Sessão expirada. Por favor recarregue a página.');
      return;
    }

    // Nome e contacto do HÓSPEDE — sem isto, o SMS/email de
    // confirmação (e o link "Estou Pronto") iam sempre para o
    // contacto de quem tem sessão iniciada no hotel (currentUser),
    // nunca para o hóspede a viajar. Contacto é obrigatório (é para
    // lá que vai o SMS); nome cai no do hotel se ficar em branco.
    const nomeHospede     = document.getElementById('inputNomeHospede')?.value.trim() || '';
    const contactoHospede = document.getElementById('inputContactoHospede')?.value.trim() || '';
    const emailHospede    = document.getElementById('inputEmailHospede')?.value.trim() || '';
    if (!contactoHospede) {
      showToast('Indique o contacto do hóspede — é para lá que vai o SMS de confirmação.');
      return;
    }

    const cat = getCategoryValue();

    // Garantir coordenadas — geocodificar se o utilizador escreveu sem seleccionar da lista
    if (!els.inputPartida.dataset.lat && partida) {
      const g = await nominatimSearch(partida);
      if (g.length) { els.inputPartida.dataset.lat = g[0].lat; els.inputPartida.dataset.lng = g[0].lon; }
    }
    if (!els.inputDestino.dataset.lat && destino) {
      const g = await nominatimSearch(destino);
      if (g.length) { els.inputDestino.dataset.lat = g[0].lat; els.inputDestino.dataset.lng = g[0].lon; }
    }

    // Calcular preços se ainda não foram calculados
    if (!_precosCalculados[selectedCategory] || _kmCalculado === 0) {
      if (!els.inputPartida.dataset.lat || !els.inputDestino.dataset.lat) {
        showToast('Não foi possível localizar os endereços. Selecione da lista.');
        return;
      }
      els.btnReservar.textContent = 'A calcular…';
      await tentarCalcularPrecos();
    }

    const valor     = _precosCalculados[selectedCategory] || 0;
    const portagens = _portagensMap[selectedCategory]     || 0;

    if (!valor || _kmCalculado === 0) {
      showToast('Não foi possível calcular o preço. Verifique os endereços.');
      return;
    }

    // Coordenadas finais para o payload
    const pLat = els.inputPartida.dataset.lat || null;
    const pLng = els.inputPartida.dataset.lng || null;
    const dLat = els.inputDestino.dataset.lat || null;
    const dLng = els.inputDestino.dataset.lng || null;

    // Participantes extra (se "+ Convidar mais pessoas" foi usado)
    // — cada um com o seu próprio destino, por isso precisa do seu
    // próprio preço, calculado da mesma forma que o principal
    // (OSRM para a distância, /api/quotes/quote para o valor).
    const extras = lerParticipantesExtra();
    let participantesPayload = null;
    if (extras.length) {
      els.btnReservar.textContent = 'A calcular preços…';
      const comPreco = [];
      for (const p of extras) {
        try {
          const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${p.destino.lng},${p.destino.lat}?overview=false`);
          const osrmData = await osrmRes.json();
          const kmP = osrmData.routes?.[0] ? Number((osrmData.routes[0].distance / 1000).toFixed(2)) : 0;
          const q = await fetchJson(url('/quotes/quote'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              categoria: cat, distanciaKm: kmP,
              contexto: { origemTexto: partida, destinoTexto: p.destino.address, datahora },
            }),
          });
          comPreco.push({ ...p, valor: q?.ok !== false && q?.total != null ? Number(q.total) : 0 });
        } catch (_) {
          comPreco.push({ ...p, valor: 0 });
        }
      }
      // Participante principal + extras, todos no mesmo formato
      participantesPayload = [
        { nome: nomeHospede || currentUser.nomeCompleto, contacto: contactoHospede, email: emailHospede || currentUser.email, destino: { address: destino, lat: Number(dLat), lng: Number(dLng) }, valor, requisitosEspeciais: null, bloqueado: !!document.getElementById('rmBloquearPrincipal')?.checked },
        ...comPreco,
      ];
    }

    els.btnReservar.disabled = true;
    els.btnReservar.textContent = 'A criar reserva…';
    try {
      // "RESERVAR" passa a chamar a rota nova — por baixo, cria uma
      // Reserva Flexível (modo Evento) com 1 participante só, com
      // partida e destino já definidos (não à espera que o hóspede
      // escolha nada) e sem OTP a validar. Substitui POST
      // /reservas/reserva — parte da consolidação combinada hoje:
      // um sistema só, não vários a resolver o mesmo problema.
      const requisitosEspeciaisLidos = (() => {
        // Recalcula a partir do DOM no momento do envio — mesma
        // lógica de sempre, só reposta depois de a ter perdido
        // ao trocar de rota.
        const out = {};
        document.querySelectorAll('.req-esp-btn').forEach(btn => {
          const sel = btn.classList.contains('sel') || btn.classList.contains('selected');
          if (!sel) return;
          const key = btn.dataset.req;
          if (!key) return;
          const qtyEl = btn.querySelector('.req-esp-qty');
          out[key] = qtyEl ? (parseInt(qtyEl.textContent, 10) || 1) : 1;
        });
        window.requisitosEspeciais = out;
        return Object.keys(out).length ? out : null;
      })();
      if (participantesPayload) participantesPayload[0].requisitosEspeciais = requisitosEspeciaisLidos;

      const resp = await fetchJson(url('/partilha/reserva-simples/criar'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomeHospede: nomeHospede || currentUser.nomeCompleto,
          contactoHospede,
          emailHospede: emailHospede || currentUser.email,
          categoria: cat,
          partida: pLat ? { lat: Number(pLat), lng: Number(pLng), address: partida } : null,
          destino: dLat ? { lat: Number(dLat), lng: Number(dLng), address: destino } : null,
          datahora: new Date(datahora).toISOString(),
          valor,
          requisitosEspeciais: requisitosEspeciaisLidos,
          // Só vai preenchido quando "+ Convidado" foi usado — nesse
          // caso, o backend ignora os campos soltos acima e usa esta
          // lista completa em vez disso.
          participantes: participantesPayload,
          // Todos no mesmo veículo (viagem partilhada) vs cada um o seu.
          mesmoVeiculo: !!document.getElementById('rmMesmoVeiculo')?.checked,
          // Janela de validade escolhida (ISO). Backend valida o limite de 4h.
          validUntil: _rmCalcValidUntil(new Date(datahora).toISOString()),
        })
      });
      if (!resp.ok) throw new Error(resp.message || 'Erro ao criar reserva.');
      closeTripPanel();
      // Limpa TODOS os campos do formulário — sem isto, a próxima
      // reserva abria já com os dados da anterior (partida, destino,
      // hora, e os campos do hóspede), obrigando a apagar tudo à
      // mão antes de poder reservar para outro hóspede.
      els.inputPartida.value = '';
      els.inputDestino.value = '';
      els.inputDateTime.value = '';
      delete els.inputPartida.dataset.lat; delete els.inputPartida.dataset.lng;
      delete els.inputDestino.dataset.lat; delete els.inputDestino.dataset.lng;
      const _campoNome = document.getElementById('inputNomeHospede');
      const _campoContacto = document.getElementById('inputContactoHospede');
      const _campoEmail = document.getElementById('inputEmailHospede');
      if (_campoNome) _campoNome.value = '';
      if (_campoContacto) _campoContacto.value = '';
      if (_campoEmail) _campoEmail.value = '';
      // Limpa também os participantes extra — nova reserva começa
      // sempre limpa, como já acontecia com o hóspede principal.
      const _wrapExtra = document.getElementById('rmParticipantesExtra');
      if (_wrapExtra) { _wrapExtra.innerHTML = ''; _wrapExtra.style.display = 'none'; }
      const _mvWrap = document.getElementById('rmMesmoVeiculoWrap');
      if (_mvWrap) _mvWrap.remove();
      _rmParticipantesExtraCount = 0;

      // Vários participantes — cada um já recebeu o próprio link de
      // pagamento por SMS/email (o backend trata disso). Não há
      // nenhum pagamento único a fazer aqui no ecrã do hotel.
      if (resp.participantes) {
        showToast(`✅ Reserva criada para ${resp.participantes.length} pessoas — cada uma vai receber o link de pagamento por SMS/email.`, 6000);
        return;
      }

      // Gancho já existente (usado pelo Convite-Evento) — corre
      // depois do Stripe/PayPal aprovar, e chama
      // /evento/confirmar-pagamento em vez do caminho antigo
      // baseado em Reserva. Sem isto, o pagamento passava mas a
      // viagem nunca avançava.
      window._rmEvtOnPaymentOk = async (provider, ref) => {
        try {
          await fetchJson(url('/partilha/evento/confirmar-pagamento'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resp.token, inviteId: resp.inviteId, provider, ref })
          });
          showToast('✅ Pagamento confirmado. O hóspede vai receber um SMS/email — despachamos o motorista quando estiver pronto.', 6000);
        } catch (err) {
          showToast('Pagamento cobrado mas confirmação falhou: ' + (err.message || ''));
        }
      };

      _rmPag.abrir({
        codigo:          resp.codigo,
        nome:            nomeHospede || currentUser.nomeCompleto,
        emailPassageiro: emailHospede || currentUser.email,
        partida,         destino, datahora,
        categoria:       getCategoryLabel(cat),
        km:              _kmCalculado,
        portagens,
        valor,
      });
    } catch (err) {
      showToast(err.message || 'Erro ao reservar viagem.');
    } finally {
      els.btnReservar.disabled = false;
      els.btnReservar.textContent = 'RESERVAR VIAGEM';
    }
  }

  /* ── CARTÕES DE PARTICIPANTE (PARTILHA) ────────────────────── */