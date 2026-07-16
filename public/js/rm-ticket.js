// ─────────────────────────────────────────────────────────────
// rm-ticket.js — Criar Ticket para Hóspede
// ─────────────────────────────────────────────────────────────

let _tkNotifMethod = 'email';
let _tkPagador     = 'hospede';

function openTicketMode() {
    hideTripTypeButtons();
    el('btnCriarTicket')?.classList.add('active');
    els.tripPanel.classList.add('hidden');
    els.shareSheet.classList.add('hidden');
    el('ticketSheet')?.classList.remove('hidden');
    const inp = el('tkDatahora');
    if (inp && !inp.value) {
      const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      inp.value = now.toISOString().slice(0, 16);
    }
    _tkAutoGeo();
  }

  function closeTicketMode() {
    el('ticketSheet')?.classList.add('hidden');
    el('btnCriarTicket')?.classList.remove('active');
    showTripTypeButtons?.();
  }

  function resetTicketForm() {
    ['tkNome','tkEmail','tkTelefone','tkPartida','tkDestino'].forEach(id => {
      const e = el(id); if (e) e.value = '';
    });
    tkCategoria = ''; tkDestinoPlace = null; tkPartidaPlace = null; tkRouteCache = null;
    document.querySelectorAll('.tk-cat-btn').forEach(b => b.classList.remove('selected', 'sel'));
    const tkGrupoSel = el('tkGrupoSelect');
    if (tkGrupoSel) {
      tkGrupoSel.value = '';
      tkGrupoSel.classList.remove('selected');
      tkGrupoSel.options[1].text = 'ATÉ 6 PESSOAS';
      if (tkGrupoSel.options[2]) tkGrupoSel.options[2].text = 'ATÉ 8 PESSOAS';
      if (tkGrupoSel.options[3]) tkGrupoSel.options[3].text = 'ATÉ 17 PESSOAS';
    }
    ['economica','confort','executive','luxury','GRUPO6','GRUPO8','GRUPO17'].forEach(cat => {
      const e = el('tkp_' + cat); if (e) e.textContent = '—';
    });
    const r   = el('tkResultado');    if (r) r.style.display = 'none';
    const g   = el('btnTkGerar');     if (g) { g.style.display = ''; g.disabled = true; g.textContent = '🎫 GERAR TICKET'; }
    const m   = el('tkMsg');          if (m) m.style.display = 'none';
    const vu  = el('tkValidUntil');   if (vu) vu.value = '';
    _tkNotifMethod = 'email'; _tkPagador = 'hospede';
    document.querySelectorAll('.tk-notif').forEach(b => b.classList.toggle('selected', b.dataset.tknotif === 'email'));
    document.querySelectorAll('.tk-notif').forEach(b => b.classList.toggle('active', b.dataset.tknotif === 'email'));
    document.querySelectorAll('.tk-pagador').forEach(b => b.classList.toggle('selected', b.dataset.tkpagador === 'hospede'));
    document.querySelectorAll('.tk-pagador').forEach(b => b.classList.toggle('active', b.dataset.tkpagador === 'hospede'));
  }

  async function _tkAutoGeo() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lng } = pos.coords;
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt`
        );
        const d = await r.json().catch(() => ({}));
        const label = d?.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        const partida = el('tkPartida');
        if (partida && !partida.value) {
          partida.value = label;
          tkPartidaPlace = { lat, lng, label };
          if (tkDestinoPlace) _tkCalcAllPrices();
          checkTkForm();
        }
      } catch {}
    }, () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  async function _tkGetRoute() {
    if (tkRouteCache) return tkRouteCache;
    if (!tkPartidaPlace || !tkDestinoPlace) return null;
    try {
      const r = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${tkPartidaPlace.lng},${tkPartidaPlace.lat};${tkDestinoPlace.lng},${tkDestinoPlace.lat}?overview=false`
      );
      const d = await r.json();
      tkRouteCache = d?.routes?.[0] || null;
      return tkRouteCache;
    } catch { return null; }
  }

  async function _tkCalcAllPrices() {
    if (!tkPartidaPlace || !tkDestinoPlace) return;
    tkRouteCache = null;
    const route = await _tkGetRoute();
    if (!route) return;
    const km = route.distance / 1000;
    const tkCatMap = [
      { cat:'economica', spanId:'tkp_economica', label:'ECÓNOMICA' },
      { cat:'confort',   spanId:'tkp_confort',   label:'CONFORTO'  },
      { cat:'executive', spanId:'tkp_executive', label:'EXECUTIVA' },
      { cat:'luxury',    spanId:'tkp_luxury',    label:'LUXO'      },
      { cat:'grupo6',    spanId:'tkp_GRUPO6',    label:'ATÉ 6'    },
      { cat:'grupo8',    spanId:'tkp_GRUPO8',    label:'ATÉ 8'    },
      { cat:'grupo17',   spanId:'tkp_GRUPO17',   label:'ATÉ 17'   },
    ];
    await Promise.all(tkCatMap.map(async ({ cat, spanId, label }) => {
      try {
        const r = await fetch('/api/quotes/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoria: cat, distanciaKm: km })
        });
        const d = await r.json().catch(() => ({}));
        const span = el(spanId);
        if (span) {
          const total = Number(d.total || 0);
          span.textContent = total > 0 ? `${label} — €${total.toFixed(2)}` : label;
          span.dataset.valor = total > 0 ? String(total) : '0';
        }
        // Actualizar pill de categoria (ECÓNOMICA/CONFORTO/EXECUTIVA/LUXO)
        const pill = document.querySelector(`.tk-cat-btn[data-tkcat="${cat}"]`);
        if (pill) {
          const total = Number(d.total || 0);
          pill.textContent = total > 0 ? `${label} — €${total.toFixed(2)}` : label;
        }
        // Actualizar opção do select de grupo (tkGrupoSelect)
        const grupoOptMap = { grupo6: 1, grupo8: 2, grupo17: 3 };
        const grpIdx = grupoOptMap[cat];
        if (grpIdx != null) {
          const tkSel = el('tkGrupoSelect');
          const total = Number(d.total || 0);
          const grpLbl = { grupo6:'ATÉ 6 PESSOAS', grupo8:'ATÉ 8 PESSOAS', grupo17:'ATÉ 17 PESSOAS' }[cat];
          if (tkSel && tkSel.options[grpIdx]) {
            tkSel.options[grpIdx].text = total > 0 ? `${grpLbl} — €${total.toFixed(2)}` : grpLbl;
          }
        }
      } catch(e) { console.warn('[TK]', cat, e.message); }
    }));
    // Após calcular, atualizar _tkSelectedValor se já há categoria selecionada
    if (tkCategoria) {
      const _activeSpan = document.getElementById('tkp_' + tkCategoria);
      if (_activeSpan && _activeSpan.dataset.valor) {
        _tkSelectedValor = Number(_activeSpan.dataset.valor) || 0;
      }
    }
    checkTkForm();
  }

  function checkTkForm() {
    const nome    = el('tkNome')?.value?.trim();
    const email   = el('tkEmail')?.value?.trim();
    const partida = el('tkPartida')?.value?.trim();
    const destino = el('tkDestino')?.value?.trim();
    const dh      = el('tkDatahora')?.value;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
    const allOk   = nome && emailOk && partida && destino && dh && tkCategoria;
    const btn = el('btnTkGerar');
    if (btn) btn.disabled = !allOk;
  }

  async function gerarTicket() {
    const nome     = el('tkNome')?.value?.trim();
    const email    = el('tkEmail')?.value?.trim();
    const telefone = el('tkTelefone')?.value?.trim();
    const partida  = el('tkPartida')?.value?.trim();
    const destino  = el('tkDestino')?.value?.trim();
    const datahora = el('tkDatahora')?.value;
    // Ler preço directamente do DOM no momento de gerar (evita problema de timing)
    let _valorFinal = 0;
    if (tkCategoria) {
      const _tkSpanId = tkCategoria.startsWith('grupo') ? 'tkp_'+tkCategoria.toUpperCase().replace('GRUPO','GRUPO') : 'tkp_' + tkCategoria;
      const _priceSpan = document.getElementById('tkp_' + tkCategoria) || document.getElementById(_tkSpanId);
      if (_priceSpan && _priceSpan.dataset.valor) {
        _valorFinal = Number(_priceSpan.dataset.valor) || 0;
      }
      if (!_valorFinal && _priceSpan?.textContent) {
        const _match = _priceSpan.textContent.match(/[\d,.]+/);
        if (_match) _valorFinal = Number(_match[0].replace(',', '.')) || 0;
      }
    }
    const valorTxt = _valorFinal > 0 ? _valorFinal.toFixed(2) : '0';

    if (!nome || !email || !partida || !destino || !datahora || !tkCategoria) {
      showTkMsg('err', 'Preencha todos os campos obrigatórios.');
      return;
    }

    const btn = el('btnTkGerar');
    btn.disabled = true; btn.textContent = 'A gerar...';
    el('tkMsg').style.display = 'none';

    try {
      const tkValidUntilVal = el('tkValidUntil')?.value;
      const data = await fetchJsonParceiro('/api/tickets/ticket/criar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomeHospede: nome, emailHospede: email, telefoneHospede: telefone,
          categoria: tkCategoria, partida, destino,
          datahora: new Date(datahora).toISOString(),
          valor: Number(valorTxt) || null,
          validUntil: tkValidUntilVal ? new Date(tkValidUntilVal).toISOString() : null,
          notifMethod: _tkNotifMethod || 'email',
          pagador: _tkPagador || 'hospede',
          appUrl: window.location.origin
        })
      });

      el('tkLinkInfo').innerHTML = `
        <strong style="color:#fff">Hóspede:</strong> ${escapeHtml(nome)} — ${escapeHtml(email)}<br>
        <strong style="color:#fff">Viagem:</strong> ${escapeHtml(partida)} → ${escapeHtml(destino)}<br>
        <strong style="color:#fff">Data:</strong> ${new Date(datahora).toLocaleString('pt-PT')}<br>
        <strong style="color:#fff">Valor:</strong> ${Number(data.valor || data.ticket?.valor || 0).toFixed(2)} €<br>
        <div style="margin-top:10px;padding:10px 12px;background:rgba(255,255,255,.05);border-radius:10px;border:1px solid rgba(255,255,255,.1)">
          <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.1em;margin-bottom:6px">LINK DO TICKET</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="tkUrlInput" readonly value="${escapeHtml(data.ticketUrl && data.ticketUrl.startsWith('http') ? data.ticketUrl : (window.location.origin + '/ticket.html?t=' + (data.tokenTicket || '')))}"
              style="flex:1;background:#0d1014;border:1px solid rgba(255,255,255,.15);border-radius:8px;
                     padding:8px 10px;color:#c4c9d4;font-size:12px;outline:none;">
            <button onclick="navigator.clipboard.writeText(document.getElementById('tkUrlInput').value).then(()=>{this.textContent='✅';setTimeout(()=>this.textContent='📋',2000)})"
              style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);
                     background:rgba(255,255,255,.06);color:#d9dde3;font-size:12px;cursor:pointer">📋</button>
          </div>
        </div>`;

      el('btnTkEmail').dataset.token = data.tokenTicket || data.token || '';
      el('btnTkEmail').dataset.email = email;
      el('tkEmailMsg').style.display = 'none';
      el('tkResultado').style.display = 'block';
      btn.style.display = 'none';

    } catch (err) {
      showTkMsg('err', err.message || 'Erro ao gerar ticket.');
      btn.disabled = false; btn.textContent = '🎫 GERAR TICKET';
    }
  }

  function showTkMsg(tipo, txt) {
    const m = el('tkMsg');
    if (!m) return;
    m.style.display = 'block';
    m.style.background = tipo === 'err' ? 'rgba(255,80,80,.1)' : 'rgba(25,214,139,.1)';
    m.style.border = tipo === 'err' ? '1px solid rgba(255,80,80,.3)' : '1px solid rgba(25,214,139,.3)';
    m.style.color  = tipo === 'err' ? '#ff9999' : '#7fffc4';
    m.textContent  = txt;
  }

  function initTicketPanel() {
    el('btnCloseTicket')?.addEventListener('click', closeTicketMode);

    el('tkGeoBtn')?.addEventListener('click', _tkAutoGeo);

    // Botões de categoria (ECÓNOMICA / CONFORTO / EXECUTIVA / LUXO)
    document.querySelectorAll('.tk-cat-btn[data-tkcat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tk-cat-btn[data-tkcat]').forEach(b => b.classList.remove('selected'));
        const tkSel = el('tkGrupoSelect');
        if (tkSel) { tkSel.classList.remove('selected'); tkSel.value = ''; }
        btn.classList.add('selected');
        tkCategoria = btn.dataset.tkcat;
        if (tkPartidaPlace && tkDestinoPlace) _tkCalcAllPrices();
        checkTkForm();
      });
    });
    // tkGrupoSelect já tem onchange=tkGrupoChanged inline

    document.addEventListener('click', e => {
      const btn = e.target.closest('.tk-notif');
      if (!btn) return;
      document.querySelectorAll('.tk-notif').forEach(b => { b.classList.remove('active'); b.classList.remove('selected'); });
      btn.classList.add('active'); btn.classList.add('selected');
      _tkNotifMethod = btn.dataset.tknotif || 'email';
    });

    document.addEventListener('click', e => {
      const btn = e.target.closest('.tk-pagador');
      if (!btn) return;
      document.querySelectorAll('.tk-pagador').forEach(b => { b.classList.remove('active'); b.classList.remove('selected'); });
      btn.classList.add('active'); btn.classList.add('selected');
      _tkPagador = btn.dataset.tkpagador || 'hospede';
    });

    const tkPartidaEl = el('tkPartida');
    if (tkPartidaEl) {
      bindNmAutocomplete(tkPartidaEl, el('nmTkPartida'), place => {
        tkPartidaPlace = { lat: place.lat, lng: place.lng, label: tkPartidaEl.value };
        if (tkDestinoPlace) _tkCalcAllPrices();
        checkTkForm();
      });
    }

    const tkDestinoEl = el('tkDestino');
    if (tkDestinoEl) {
      bindNmAutocomplete(tkDestinoEl, el('nmTkDestino'), place => {
        tkDestinoPlace = { lat: place.lat, lng: place.lng, label: tkDestinoEl.value };
        if (tkPartidaPlace) _tkCalcAllPrices();
        checkTkForm();
      });
    }

    ['tkNome','tkEmail','tkDatahora'].forEach(id => {
      el(id)?.addEventListener('input', checkTkForm);
    });

    el('btnTkGerar')?.addEventListener('click', gerarTicket);

    el('btnTkEmail')?.addEventListener('click', async () => {
      const btn   = el('btnTkEmail');
      const msg   = el('tkEmailMsg');
      const token = btn.dataset.token;
      const email = btn.dataset.email;
      if (!token) return;
      btn.disabled = true; btn.textContent = 'A enviar...';
      msg.style.display = 'none';
      try {
        await fetchJsonParceiro(`/api/tickets/ticket/${token}/enviar-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        msg.style.cssText = 'display:block;padding:10px 14px;border-radius:12px;font-size:13px;font-weight:800;background:rgba(25,214,139,.1);border:1px solid rgba(25,214,139,.3);color:#7fffc4';
        msg.textContent = `✅ Ticket enviado para ${email}`;
        btn.textContent = '✅ EMAIL ENVIADO';
        setTimeout(() => { closeTicketMode(); resetTicketForm(); }, 2000);
      } catch (err) {
        msg.style.cssText = 'display:block;padding:10px 14px;border-radius:12px;font-size:13px;font-weight:800;background:rgba(255,80,80,.1);border:1px solid rgba(255,80,80,.3);color:#ff9999';
        msg.textContent = '❌ ' + (err.message || 'Erro ao enviar email.');
        btn.disabled = false;
        btn.textContent = '✉ ENVIAR TICKET POR EMAIL AO HÓSPEDE';
      }
    });

    el('btnTkNovo')?.addEventListener('click', resetTicketForm);
  }

  function detectarLocalizacaoUtilizador() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      _userLat = pos.coords.latitude;
      _userLng = pos.coords.longitude;
      map.setCenter({lat:_userLat,lng:_userLng}); map.setZoom(14);
      showToast('Geolocalização ativa.');
    }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // Cache para evitar pedidos duplicados
  const _nmCache = {};