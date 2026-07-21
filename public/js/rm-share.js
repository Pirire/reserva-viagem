// rm-share.js — Partilha de viagem, polling, rota ao vivo
// ─────────────────────────────────────────────────────────────
console.log("✅ rm-share.js VERSÃO 2026-07-02-EVT-V21-FASE2 carregado");

// Ligação Socket.io dedicada aos eventos em tempo real da partilha
// (pagamento falhado, recálculo, cancelamento, finalização). Criada
// aqui porque, ao contrário do tracking do motorista, ainda não
// havia nenhuma ligação socket activa nas páginas que usam partilha.
const _shareSocket = (typeof io === 'function') ? io() : null;

function entrarSalaPartilha(shareId) {
  _rotaOverlayFechadoManualmente = false;
  if (_shareSocket && shareId) _shareSocket.emit('share_join', { shareId });
}

if (_shareSocket) {
  // Pagamento de um participante falhou/foi cancelado — perguntar
  // ao organizador se quer recalcular com os restantes ou cancelar
  // tudo.
  _shareSocket.on('pagamento_falhou', (d) => {
    const nome = d?.nome || 'um participante';
    const modal = document.getElementById('falhaPagamentoModal');
    const texto = document.getElementById('falhaPagamentoTexto');
    if (texto) texto.textContent = `Falha no pagamento de ${nome}. Deseja continuar e refazer um novo cálculo?`;
    if (modal) modal.style.display = 'flex';
    modal?.setAttribute('data-share-id', d?.shareId || shareId || '');
  });

  _shareSocket.on('partilha_recalculada', () => {
    showToast('Valores recalculados e participantes avisados.');
  });

  _shareSocket.on('partilha_cancelada', () => {
    showToast('Partilha cancelada. Reembolsos processados.');
    fecharAguardaOverlay();
  });

  _shareSocket.on('partilha_finalizada', (d) => {
    const msg = d?.motoristaEncontrado
      ? `✅ Todos pagaram! Reserva ${d?.codigo || ''} criada e despachada a um motorista.`
      : `✅ Todos pagaram! Reserva ${d?.codigo || ''} criada — a aguardar atribuição manual de motorista (nenhum disponível agora).`;
    showToast(msg, 5500);
    fecharAguardaOverlay();
  });
}

document.getElementById('btnFalhaPagamentoSim')?.addEventListener('click', async () => {
  const modal = document.getElementById('falhaPagamentoModal');
  const shareIdAtual = modal?.getAttribute('data-share-id') || shareId;
  modal.style.display = 'none';
  try {
    await fetchJson(url('/partilha/organizador/recalcular'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId: shareIdAtual })
    });
  } catch (err) { showToast(err.message || 'Erro ao recalcular.'); }
});

document.getElementById('btnFalhaPagamentoNao')?.addEventListener('click', async () => {
  const modal = document.getElementById('falhaPagamentoModal');
  const shareIdAtual = modal?.getAttribute('data-share-id') || shareId;
  modal.style.display = 'none';
  try {
    await fetchJson(url('/partilha/organizador/cancelar-tudo'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId: shareIdAtual })
    });
  } catch (err) { showToast(err.message || 'Erro ao cancelar.'); }
});

/* ══════════════════════════════════════════════════════════════
   PARTILHAS ACTIVAS — lista de todas as partilhas do organizador,
   para suportar várias em simultâneo (em vez de uma única no
   rodapé). Acedida pelo botão "🤝 PARTILHAS" no menu hambúrguer.
══════════════════════════════════════════════════════════════ */
let _partilhasAtivasTimer = null;

async function abrirPartilhasAtivas() {
  document.getElementById('partilhasAtivasPopup')?.classList.add('show');
  await carregarPartilhasAtivas();
  _partilhasAtivasTimer = setInterval(carregarPartilhasAtivas, 10000);
}

function fecharPartilhasAtivas() {
  document.getElementById('partilhasAtivasPopup')?.classList.remove('show');
  if (_partilhasAtivasTimer) { clearInterval(_partilhasAtivasTimer); _partilhasAtivasTimer = null; }
}
window.fecharPartilhasAtivas = fecharPartilhasAtivas;

async function carregarPartilhasAtivas() {
  const lista = document.getElementById('partilhasAtivasLista');
  const contador = document.getElementById('partilhasAtivasContador');
  if (!lista) return;
  try {
    const email = (typeof currentUser !== 'undefined' && currentUser?.email) || '';
    const [dataPartilha, dataConvidado] = await Promise.all([
      fetchJson(url(`/partilha/minhas-ativas?email=${encodeURIComponent(email)}`)).catch(() => ({ partilhas: [] })),
      fetchJson(url(`/convidado/grupos-ativos`)).catch(() => ({ grupos: [] })),
    ]);

    // Cartões de partilha normal/evento (já vêm com modoEvento no
    // próprio objecto, marcado pelo backend).
    const cartoesPartilha = (dataPartilha?.partilhas || []).map(p => ({ tipo: p.modoEvento ? 'evento' : 'partilha', dados: p }));
    // Cartões de Convidado — um por grupoId, agrupando os passageiros
    // dessa chamada (mesma partida/destino para todos).
    const cartoesConvidado = (dataConvidado?.grupos || []).map(g => ({ tipo: 'convidado', dados: g }));

    const todos = [...cartoesPartilha, ...cartoesConvidado];
    if (contador) contador.textContent = todos.length;

    if (!todos.length) {
      lista.innerHTML = '<div style="padding:32px;text-align:center;color:var(--silver-3);font-size:11px">Sem partilhas, eventos ou convidados activos.</div>';
      return;
    }

    const TIPO_BADGE = {
      partilha:  { label: '🤝 PARTILHA', cor: 'var(--silver-2,#cdd2da)' },
      evento:    { label: '🎉 EVENTO',   cor: '#efab51' },
      convidado: { label: '🎟️ CONVIDADO', cor: '#4a8ef0' },
    };

    lista.innerHTML = `<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px">` +
      todos.map(({ tipo, dados: p }) => {
        const badge = TIPO_BADGE[tipo];
        let destinoTxt, recolhaTxt, dataHora, statusTxt, statusColor, idAttr;

        if (tipo === 'convidado') {
          const pagos = p.participantes.filter(x => x.status === 'pago' || x.pagoPeloRemetente).length;
          const totalP = p.participantes.length;
          destinoTxt = (p.destino || 'Destino').split(',')[0];
          recolhaTxt = (p.partida || '—').split(',')[0];
          dataHora = p.datahora ? new Date(p.datahora).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
          statusTxt = `${pagos}/${totalP} PAGOS`;
          statusColor = pagos === totalP ? 'var(--ok)' : 'var(--warn)';
          idAttr = `data-grupo-id="${p.grupoId}"`;
        } else {
          destinoTxt = tipo === 'evento' ? 'Vários destinos' : (p.destino || 'Destino').split(',')[0];
          recolhaTxt = (p.recolha || '—').split(',')[0];
          dataHora = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
          statusTxt = p.status === 'despachada' ? '🚗 DESPACHADA' : `${p.pagos}/${p.totalParticipantes} PAGOS`;
          statusColor = p.status === 'despachada' ? 'var(--ok)' : (p.pagos === p.totalParticipantes && p.totalParticipantes > 0 ? 'var(--ok)' : 'var(--warn)');
          idAttr = `data-share-id="${p.shareId}"`;
        }

        return `<div class="viagem-ativa-card" data-tipo="${tipo}" ${idAttr} style="flex:0 0 220px;padding:13px 15px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.025);cursor:pointer;transition:.15s ease" onmouseover="this.style.background='rgba(255,255,255,.05)'" onmouseout="this.style.background='rgba(255,255,255,.025)'">
          <div style="font-size:9px;font-weight:800;letter-spacing:.06em;color:${badge.cor};margin-bottom:6px">${badge.label}</div>
          <div style="font-size:13px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">${escapeHtml(destinoTxt)}</div>
          <div style="font-size:9px;font-weight:700;letter-spacing:.08em;color:${statusColor};margin-bottom:6px">${statusTxt}</div>
          <div style="font-size:10px;color:var(--silver-3)">📍 ${escapeHtml(recolhaTxt)}</div>
          <div style="font-size:10px;color:var(--silver-3)">🕐 ${dataHora} · ${escapeHtml((p.categoria||'').toUpperCase())}</div>
          <div style="margin-top:6px;font-size:9px;color:rgba(255,255,255,.3)">Ver detalhe →</div>
        </div>`;
      }).join('') + `</div>`;

    lista.querySelectorAll('.viagem-ativa-card').forEach(card => {
      const tipo = card.dataset.tipo;
      if (tipo === 'convidado') {
        const grupo = (dataConvidado?.grupos || []).find(g => g.grupoId === card.dataset.grupoId);
        card.addEventListener('click', () => abrirMapaGrupoConvidado(grupo));
      } else {
        card.addEventListener('click', () => abrirMapaGrupoPartilha(card.dataset.shareId));
      }
    });
  } catch (err) {
    if (!lista.querySelector('.viagem-ativa-card'))
      lista.innerHTML = '<div style="padding:24px;text-align:center;color:var(--bad);font-size:11px">Erro ao carregar partilhas</div>';
  }
}

/* ── MAPA DO GRUPO — todas as rotas dos participantes ────────── */
let _mapaGrupoMap = null;
let _mapaGrupoElementos = [];

// ── MAPA DO GRUPO — Leaflet/OpenStreetMap, não Google Maps. A
// versão anterior (Google) tinha problemas conhecidos de
// renderização (mapa vetorial ficava preto, dependia de chave/
// faturação) — o resto do sistema já usa Leaflet em todo o lado,
// por ser mais simples e mais fiável. Simplificado a pedido: só
// rota + partida + destino(s), sem posição ao vivo por participante
// (a viagem ainda não começou nestas partilhas, não há nada para
// seguir em tempo real). ──────────────────────────────────────────
async function abrirMapaGrupoPartilha(shareId) {
  const overlay = document.getElementById('mapaGrupoOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.getElementById('mapaGrupoTitulo').textContent = 'A carregar grupo…';
  document.getElementById('mapaGrupoLista').innerHTML = '';

  // Espera um ciclo de pintura completo antes de criar o mapa —
  // Leaflet também precisa do contentor já com tamanho real, não
  // 0×0, ou o mapa fica com a posição/zoom errados.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const data = await fetchJson(url(`/partilha/grupo/${encodeURIComponent(shareId)}`));
    const g = data?.grupo;
    if (!g) { showToast('Não foi possível carregar este grupo.'); return; }

    document.getElementById('mapaGrupoTitulo').textContent =
      `${g.nomeOrganizador ? g.nomeOrganizador + ' — ' : ''}${g.modoEvento ? 'Evento (vários destinos)' : (g.destino?.address || 'Destino').split(',')[0]}`;

    // Recriar sempre uma instância nova — Leaflet não aceita
    // reinicializar o mesmo contentor sem o destruir primeiro.
    if (_mapaGrupoMap) { _mapaGrupoMap.remove(); _mapaGrupoMap = null; }
    _mapaGrupoElementos = [];
    const mapaDivEl = document.getElementById('mapaGrupoDiv');
    mapaDivEl.innerHTML = '';

    _mapaGrupoMap = L.map(mapaDivEl, { zoomControl: false, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(_mapaGrupoMap);

    const cores = ['#1cd68e', '#4a8ef0', '#efab51', '#ff6b6b', '#b8965a', '#9b59b6', '#e91e63'];
    const bounds = [];

    function pinGrupo(cor, tamanho) {
      const t = tamanho || 13;
      return L.divIcon({
        html: `<div style="width:${t}px;height:${t}px;border-radius:50%;background:${cor};border:2.5px solid rgba(255,255,255,.85);box-shadow:0 0 0 4px ${cor}33"></div>`,
        className: '', iconSize: [t, t], iconAnchor: [t / 2, t / 2],
      });
    }

    // Rota REAL via OSRM (a mesma técnica já usada em todo o resto
    // do sistema) — em vez de uma linha reta, como o Google Maps
    // fazia antes. Só a rota, sem seguimento — desenhada uma vez.
    async function tracarRotaGrupo(origem, destino, cor) {
      try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`);
        const d = await r.json();
        if (d.routes?.[0]) {
          const coords = d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          const linha = L.polyline(coords, { color: cor, weight: 3, opacity: 0.7 }).addTo(_mapaGrupoMap);
          _mapaGrupoElementos.push(linha);
        }
      } catch (_e) { /* sem rota, sem problema — os pins continuam visíveis */ }
    }

    const listaHtml = [];

    if (!g.modoEvento) {
      // ── PARTILHA NORMAL: destino comum a todos. ──────────────
      if (g.destino?.lat) {
        const m = L.marker([g.destino.lat, g.destino.lng], { icon: pinGrupo('#ffffff', 15) })
          .addTo(_mapaGrupoMap).bindPopup('<b>🏁 Destino</b>');
        _mapaGrupoElementos.push(m);
        bounds.push([g.destino.lat, g.destino.lng]);
      }

      for (let idx = 0; idx < g.participantes.length; idx++) {
        const p = g.participantes[idx];
        const cor = cores[idx % cores.length];
        const statusLabel = { pendente: 'Aguarda confirmação', aceitou: 'Aguarda pagamento', pagou: '✅ Viagem paga', falhou: '❌ Falhou pagamento (3x)', cancelado: '✗ Rejeitou', recusou: '✗ Rejeitou' }[p.status] || p.status;
        const posicao = g.recolha?.lat ? { lat: g.recolha.lat, lng: g.recolha.lng } : null;

        if (posicao) {
          const m = L.marker([posicao.lat, posicao.lng], { icon: pinGrupo(cor) })
            .addTo(_mapaGrupoMap).bindPopup(`<b>${escapeHtml(p.nome)}</b>`);
          _mapaGrupoElementos.push(m);
          bounds.push([posicao.lat, posicao.lng]);
          if (g.destino?.lat) await tracarRotaGrupo(posicao, { lat: g.destino.lat, lng: g.destino.lng }, cor);
        }

        listaHtml.push(`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${cor};flex-shrink:0"></span>
          <span style="flex:1;font-size:12px;color:#fff;font-weight:700">${escapeHtml(p.nome)}</span>
          <span style="font-size:10px;color:var(--silver-3)">${statusLabel}</span>
          ${p.amountDue ? `<span style="font-size:11px;color:var(--ok);font-weight:700">€${Number(p.amountDue).toFixed(2)}</span>` : ''}
        </div>`);
      }
      document.getElementById('mapaGrupoLista').innerHTML = listaHtml.join('');

    } else {
      // ── MODO EVENTO: partida comum, destino próprio por
      //    participante — uma rota por participante. ────────────
      if (g.recolha?.lat) {
        const m = L.marker([g.recolha.lat, g.recolha.lng], { icon: pinGrupo('#ffffff', 15) })
          .addTo(_mapaGrupoMap).bindPopup('<b>🚩 Partida</b>');
        _mapaGrupoElementos.push(m);
        bounds.push([g.recolha.lat, g.recolha.lng]);
      }

      for (let idx = 0; idx < g.participantes.length; idx++) {
        const p = g.participantes[idx];
        const cor = cores[idx % cores.length];
        const statusLabel = { pendente: 'A definir destino', destino_definido: 'Destino definido', pagou: '✅ Pago', falhou: '❌ Falhou', cancelado: 'Cancelado' }[p.status] || p.status;

        if (p.destino?.lat && g.recolha?.lat) {
          const m = L.marker([p.destino.lat, p.destino.lng], { icon: pinGrupo(cor) })
            .addTo(_mapaGrupoMap).bindPopup(`<b>${escapeHtml(p.nome)} — destino</b>`);
          _mapaGrupoElementos.push(m);
          bounds.push([p.destino.lat, p.destino.lng]);
          await tracarRotaGrupo({ lat: g.recolha.lat, lng: g.recolha.lng }, { lat: p.destino.lat, lng: p.destino.lng }, cor);
        }

        listaHtml.push(`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${cor};flex-shrink:0"></span>
          <span style="flex:1;font-size:12px;color:#fff;font-weight:700">${escapeHtml(p.nome)}</span>
          <span style="font-size:10px;color:var(--silver-3)">${statusLabel}</span>
          ${p.amountDue ? `<span style="font-size:11px;color:var(--ok);font-weight:700">€${Number(p.amountDue).toFixed(2)}</span>` : ''}
        </div>`);
      }
      document.getElementById('mapaGrupoLista').innerHTML = listaHtml.join('');
    }

    setTimeout(() => {
      _mapaGrupoMap.invalidateSize();
      if (bounds.length) _mapaGrupoMap.fitBounds(bounds, { padding: [40, 40] });
      else _mapaGrupoMap.setView([38.7169, -9.139], 11);
    }, 80);
  } catch (err) {
    showToast('Erro ao carregar o mapa do grupo.');
  }
}
window.abrirMapaGrupoPartilha = abrirMapaGrupoPartilha;

// ── MAPA DO GRUPO — modo Convidado (uma rota partilhada por todos,
//    só muda quem pagou e quem ainda não) ──────────────────────────
async function abrirMapaGrupoConvidado(g) {
  const overlay = document.getElementById('mapaGrupoOverlay');
  if (!overlay || !g) { showToast('Não foi possível abrir este grupo.'); return; }
  overlay.style.display = 'flex';
  document.getElementById('mapaGrupoTitulo').textContent = `🎟️ Convidados — ${(g.destino || 'Destino').split(',')[0]}`;

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  if (_mapaGrupoMap) { _mapaGrupoMap.remove(); _mapaGrupoMap = null; }
  _mapaGrupoElementos = [];

  const mapaDivEl = document.getElementById('mapaGrupoDiv');
  mapaDivEl.innerHTML = '';

  _mapaGrupoMap = L.map(mapaDivEl, { zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(_mapaGrupoMap);

  const bounds = [];

  if (g.origemGeo?.lat && g.destinoGeo?.lat) {
    const pinOrigem = L.divIcon({
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#1cd68e;border:2.5px solid rgba(255,255,255,.85);box-shadow:0 0 0 4px rgba(28,214,142,.2)"></div>`,
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    });
    const pinDestino = L.divIcon({
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#ffffff;border:2.5px solid rgba(0,0,0,.6)"></div>`,
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    });
    const origemMarker = L.marker([g.origemGeo.lat, g.origemGeo.lng], { icon: pinOrigem }).addTo(_mapaGrupoMap).bindPopup('<b>Partida</b>');
    const destMarker = L.marker([g.destinoGeo.lat, g.destinoGeo.lng], { icon: pinDestino }).addTo(_mapaGrupoMap).bindPopup('<b>Destino</b>');
    _mapaGrupoElementos.push(origemMarker, destMarker);
    bounds.push([g.origemGeo.lat, g.origemGeo.lng], [g.destinoGeo.lat, g.destinoGeo.lng]);

    // Rota real via OSRM, não uma linha reta.
    try {
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${g.origemGeo.lng},${g.origemGeo.lat};${g.destinoGeo.lng},${g.destinoGeo.lat}?overview=full&geometries=geojson`);
      const d = await r.json();
      if (d.routes?.[0]) {
        const coords = d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        const linha = L.polyline(coords, { color: '#4a8ef0', weight: 4, opacity: 0.75 }).addTo(_mapaGrupoMap);
        _mapaGrupoElementos.push(linha);
      }
    } catch (_e) { /* sem rota, os pins continuam visíveis */ }
  }

  setTimeout(() => {
    _mapaGrupoMap.invalidateSize();
    if (bounds.length) _mapaGrupoMap.fitBounds(bounds, { padding: [40, 40] });
    else _mapaGrupoMap.setView([38.7169, -9.139], 11);
  }, 80);

  document.getElementById('mapaGrupoLista').innerHTML = g.participantes.map(p => {
    const pago = p.status === 'pago' || p.pagoPeloRemetente;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px">
      <span style="width:10px;height:10px;border-radius:50%;background:${pago ? '#1cd68e' : '#efab51'};flex-shrink:0"></span>
      <span style="flex:1;font-size:12px;color:#fff;font-weight:700">${escapeHtml(p.nome)}</span>
      <span style="font-size:10px;color:var(--silver-3)">${pago ? '✅ Pago' : '⏳ Pendente'}</span>
      ${p.valor ? `<span style="font-size:11px;color:var(--ok);font-weight:700">€${Number(p.valor).toFixed(2)}</span>` : ''}
    </div>`;
  }).join('');
}
window.abrirMapaGrupoConvidado = abrirMapaGrupoConvidado;

function fecharMapaGrupo() {
  document.getElementById('mapaGrupoOverlay').style.display = 'none';
}
window.fecharMapaGrupo = fecharMapaGrupo;

// Abre o acompanhamento ao vivo de uma partilha específica da lista
// — reaproveita o overlay/polling já existentes, só muda o shareId
// activo para o da partilha escolhida.
function abrirPartilhaEspecifica(idEscolhido) {
  if (!idEscolhido) return;
  shareId = idEscolhido;
  entrarSalaPartilha(shareId);
  fecharPartilhasAtivas();
  mostrarAguardaOverlay();
  startPolling();
}
window.abrirPartilhaEspecifica = abrirPartilhaEspecifica;

document.getElementById('menuBtnPartilhas')?.addEventListener('click', () => {
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  abrirPartilhasAtivas();
});

// Manter o contador do menu actualizado mesmo sem o popup aberto
async function actualizarContadorPartilhas() {
  try {
    const email = (typeof currentUser !== 'undefined' && currentUser?.email) || '';
    if (!email) return;
    const data = await fetchJson(url(`/partilha/minhas-ativas?email=${encodeURIComponent(email)}`));
    const el2 = document.getElementById('partilhasAtivasContador');
    if (el2) el2.textContent = (data?.partilhas || []).length;
  } catch (_) {}
}
setInterval(actualizarContadorPartilhas, 30000);
actualizarContadorPartilhas();


function setActiveShareCard(idx) {
    currentShareCardIndex = idx;
    document.querySelectorAll('.share-card').forEach(c =>
      c.classList.toggle('active', Number(c.dataset.idx) === idx)
    );
    const input = el(`contact_${idx}`);
    if (input) setTimeout(() => input.focus(), 120);
  }

  function goToNextShareCard(idx) {
    if (idx + 1 > 17) { showToast('Máximo de 17 participantes.'); return; }
    setActiveShareCard(idx + 1);
  }
  function goToPrevShareCard(idx) {
    if (idx - 1 < 1) { showToast('Já está no primeiro participante.'); return; }
    setActiveShareCard(idx - 1);
  }

  function buildShareCards(n) {
    participantes = Array.from({ length: n }, (_, i) => ({
      idx: i + 1, contacto: '', nome: '', ok: false, status: 'vazio', valor: 0, paymentUrl: ''
    }));
    currentShareCardIndex = 1;
    els.shareStackWrap.innerHTML = '';
    els.shareStackWrap.classList.remove('share-stack-list-mode');

    participantes.forEach(p => {
      const card = document.createElement('article');
      card.className = 'share-card';
      card.id = `shareCard_${p.idx}`;
      card.dataset.idx = p.idx;
      card.innerHTML = `
        <div class="share-count" id="shareCount_${p.idx}">${p.idx}/17</div>
        <label>Participante ${p.idx} — Contacto</label>
        <div class="share-row">
          <input type="text" id="contact_${p.idx}" placeholder="+351..." inputmode="tel" autocomplete="off">
          <button type="button" id="confirm_${p.idx}">INSERIR</button>
          <button type="button" class="share-next-btn" id="next_${p.idx}">PRÓXIMO</button>
          <div style="position:relative">
            <button type="button" class="share-contacts-btn" id="ctcBtn_${p.idx}" title="Contactos guardados">👥</button>
            <div class="share-contacts-drop" id="ctcDrop_${p.idx}"></div>
          </div>
        </div>
        <div class="share-result" id="result_${p.idx}"><span class="share-warn">Aguardando contacto…</span></div>
        <div class="share-card-actions">
          ${p.idx > 1 ? `<button type="button" class="share-card-btn" id="prev_${p.idx}">← ANTERIOR</button>` : ''}
          <button type="button" class="share-card-btn cancelar-partilha" id="cancelCard_${p.idx}">CANCELAR PARTILHA</button>
        </div>`;
      els.shareStackWrap.appendChild(card);
      card.querySelector(`#confirm_${p.idx}`).addEventListener('click', () => confirmarContacto(p.idx));
      card.querySelector(`#next_${p.idx}`).addEventListener('click', () => goToNextShareCard(p.idx));
      card.querySelector(`#prev_${p.idx}`)?.addEventListener('click', () => goToPrevShareCard(p.idx));
      card.querySelector(`#cancelCard_${p.idx}`).addEventListener('click', () => cancelarPartilhaAtual());

      // Botão CONTACTOS — abre dropdown com contactos guardados
      const ctcBtn  = card.querySelector(`#ctcBtn_${p.idx}`);
      const ctcDrop = card.querySelector(`#ctcDrop_${p.idx}`);
      const input   = card.querySelector(`#contact_${p.idx}`);

      ctcBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          _abrirOverlayContactos(p.idx);
        });

    // Clicar fora fecha todos os dropdowns
    document.addEventListener('click', () => {
      document.querySelectorAll('.share-contacts-drop').forEach(d => d.classList.remove('open'));
    });

    setActiveShareCard(1);
    updateShareButtonsState();
  });
  }

  function updateShareButtonsState() {
    const confirmed    = participantes.filter(p => p.ok).length;
    const destinoReady = !!(shareDestinoPlace?.lat) || !!(els.shareDestino?.value?.trim());
    const dateReady    = !!els.shareDateTime?.value?.trim();
    const catReady     = !!selectedShareCategory;
    const recolhaReady = !!(el('shareRecolha')?.value?.trim());
    const allReady     = confirmed >= 1 && destinoReady && dateReady && catReady && recolhaReady;
    document.querySelectorAll('[id^="shareCount_"]').forEach(e => {
      e.textContent = e.id.replace('shareCount_', '') + '/17';
    });
    if (els.btnEnviarConvites) els.btnEnviarConvites.disabled = !allReady || sharePartilhada;
  }

  function applyStatusFromBackend(list) {
    for (const item of list) {
      const p = participantes.find(x => x.contacto === item.contacto);
      if (!p) continue;
      p.status = item.status || p.status;
      p.valor  = Number(item.valor || p.valor || 0);
      p.nome   = item.nome || p.nome;
      p.paymentUrl = item.paymentUrl || p.paymentUrl || '';
    }
    renderStatusText();
  }

  function renderStatusText() {
    participantes.forEach(p => {
      const result = el(`result_${p.idx}`);
      const card   = el(`shareCard_${p.idx}`);
      if (!result || !card) return;
      card.classList.remove('paid', 'refused');
      const base = p.ok
        ? `<span class="share-ok">Confirmado:</span> ${p.nome} — ${p.contacto}`
        : `<span class="share-warn">Aguardando contacto…</span>`;
      const map = {
        vazio:      `<span class="share-warn">Aguardando contacto…</span>`,
        confirmado: `${base}<br><span class="share-warn">Pronto para convite.</span>`,
        pendente:   `${base}<br><span class="share-warn">Convite enviado. Aguardando resposta.</span>`,
        localizado: `${base}<br><span class="share-warn">Participante localizado.</span>`,
        aceitou:    `${base}<br><span class="share-warn">Aceitou. Valor: €${(p.valor||0).toFixed(2)}</span>`,
        pagou:      (card.classList.add('paid'), `${base}<br><span class="share-ok">PAGO ✅</span> (€${(p.valor||0).toFixed(2)})`),
        recusou:    (card.classList.add('refused'), `${base}<br><span class="share-err">RECUSOU ❌</span>`),
        cancelado:  `${base}<br><span class="share-err">CANCELADO</span>`
      };
      result.innerHTML = map[p.status] ?? `${base}<br><span class="share-warn">Estado: ${p.status}</span>`;
    });
  }

  async function confirmarContacto(i) {
    const input   = el(`contact_${i}`);
    const result  = el(`result_${i}`);
    const card    = el(`shareCard_${i}`);
    const contacto = (input?.value || '').trim();
    if (!contacto) { result.innerHTML = '<span class="share-err">Digite um contacto.</span>'; return; }
    const dup = participantes.find((p, idx) => idx !== i - 1 && p.ok && p.contacto === contacto);
    if (dup) { result.innerHTML = `<span class="share-err">Contacto já adicionado (Participante ${dup.idx}).</span>`; return; }
    result.textContent = 'A confirmar...';
    try {
      const data = await fetchJson(url('/partilha/confirmar-contacto'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contacto }) });
      const p = participantes[i - 1];
      p.contacto = data?.contacto || contacto;
      p.nome     = data?.nome || 'Convidado';
      p.ok       = true; p.status = 'confirmado';
      const isReg = !!(data?.nome && data.nome !== 'Convidado');
      card.classList.remove('paid', 'refused');
      result.innerHTML = `<span class="${isReg ? 'share-ok' : 'share-warn'}">${isReg ? '✅ Registado:' : '👤 Convidado:'}</span><strong style="color:#fff;margin-left:6px">${escapeHtml(p.nome)}</strong> — ${escapeHtml(p.contacto)}`;
      updateShareButtonsState();
    } catch (err) {
      result.innerHTML = `<span class="share-err">${err.message || 'Contacto inválido.'}</span>`;
      participantes[i - 1].ok = false; participantes[i - 1].status = 'vazio';
      updateShareButtonsState();
    }
  }

  /* ── ENVIAR / CANCELAR PARTILHA ────────────────────────────── */
  async function enviarConvitesPartilha() {
    if (sharePartilhada) { showToast('Partilha já ativa.'); return; }

    const dateTime = els.shareDateTime.value.trim();
    if (!dateTime) { showToast('Defina data e hora.'); return; }
    const recolha = el('shareRecolha')?.value?.trim() || '';
    if (!recolha) { showToast('Defina o local de recolha.'); return; }

    // Geocodificar como reserva — se o utilizador escreveu o
    // endereço sem clicar numa sugestão do autocomplete, ficava sem
    // coordenadas, e o mapa de "Partilhas" nunca conseguia desenhar
    // a rota (precisa de lat/lng, não só de texto).
    const recolhaInp = el('shareRecolha');
    if (!recolhaInp.dataset.lat && typeof nominatimSearch === 'function') {
      const r = await nominatimSearch(recolha);
      if (r?.[0]) { recolhaInp.dataset.lat = r[0].lat; recolhaInp.dataset.lng = r[0].lon; }
    }
    if (!shareDestinoPlace && els.shareDestino?.value?.trim() && typeof nominatimSearch === 'function') {
      const r = await nominatimSearch(els.shareDestino.value.trim());
      if (r?.[0]) shareDestinoPlace = { address: els.shareDestino.value.trim(), lat: Number(r[0].lat), lng: Number(r[0].lon) };
    }

    els.btnEnviarConvites.disabled = true;
    els.btnEnviarConvites.textContent = 'A ENVIAR...';
    try {
      const payload = {
        recolha,
        recolhaLat: el('shareRecolha')?.dataset?.lat || null,
        recolhaLng: el('shareRecolha')?.dataset?.lng || null,
        destino:    shareDestinoPlace || { address: els.shareDestino?.value?.trim() },
        participantes: participantes.filter(p => p.ok).map(p => ({ contacto: p.contacto, nome: p.nome })),
        totalPessoas:  participantes.filter(p => p.ok).length,
        categoria:     selectedShareCategory || getCategoryValue(),
        dateTime:      new Date(dateTime).toISOString(),
        // Página onde o link do convite deve abrir — sem isto, o
        // backend assumia sempre minha-conta.html, mesmo quando a
        // partilha era criada a partir do hotel-dashboard.html.
        origemPagina:  location.pathname.split('/').pop() || 'minha-conta.html',
        // Nome de quem está a solicitar a partilha — currentUser já
        // existe no mesmo âmbito de script (definido em rm-core.js
        // ou no próprio minha-conta.html), por isso não precisa de
        // ser pedido de novo aqui.
        nomeOrganizador: (typeof currentUser !== 'undefined' && currentUser?.nomeCompleto) || '',
        emailOrganizador: (typeof currentUser !== 'undefined' && currentUser?.email) || '',
      };
      const resp = await fetchJson(url('/partilha/criar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!resp?.ok || !resp?.shareId) throw new Error(resp?.message || 'Falha ao criar partilha.');

      shareId = resp.shareId;
      sharePartilhada = true;
      entrarSalaPartilha(shareId);

      // Esconder a folha de partilha (formulário), mas NÃO o
      // seletor de tipo de viagem (RESERVAR/PARTILHAR/etc.) — sem
      // isto, ficava impossível iniciar qualquer outra reserva
      // enquanto esta partilha estivesse a decorrer.
      els.shareSheet.classList.add('hidden');
      mostrarAguardaOverlay();

      if (Array.isArray(resp.participantes)) applyStatusFromBackend(resp.participantes);
      startPolling();
      showToast(`Convites enviados. A aguardar resposta.`, 3600);
    } catch (err) {
      showToast(err.message || 'Erro ao criar partilha.');
      els.btnEnviarConvites.disabled = false;
      els.btnEnviarConvites.textContent = 'PARTILHAR';
    } finally { updateShareButtonsState(); }
  }

  async function cancelarPartilhaAtual() {
    if (!shareId) { fecharAguardaOverlay(); fecharRotaOverlay(); closeShareMode(); return; }
    try {
      await fetchJson(url('/partilha/cancelar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shareId }) });
      stopPolling();
      participantes.forEach(p => { if (p.ok) p.status = 'cancelado'; });
      renderStatusText();
      shareId = null; sharePartilhada = false;
      fecharAguardaOverlay();
      fecharRotaOverlay();
      showToast('Partilha cancelada.');
      closeShareMode();
    } catch (err) { showToast(err.message || 'Erro ao cancelar partilha.'); }
  }

  // Cancelar a viagem DEPOIS de já despachada (todos pagaram e a Trip
  // foi criada) — diferente de cancelarPartilhaAtual(), que só
  // funciona antes da finalização (sem Trip criada ainda).
  document.getElementById('btnCancelarViagemDespachada')?.addEventListener('click', async () => {
    if (!shareId) return;
    const confirmado = window.confirm(
      'Cancelar esta viagem partilhada?\n\nOs participantes que já pagaram serão reembolsados automaticamente.\n\nEsta ação não pode ser revertida.'
    );
    if (!confirmado) return;
    try {
      const resp = await fetchJson(url('/partilha/organizador/cancelar-viagem-despachada'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId })
      });
      const n = Array.isArray(resp?.reembolsos) ? resp.reembolsos.length : 0;
      showToast(n ? `Viagem cancelada. ${n} reembolso(s) processado(s).` : 'Viagem cancelada.', 4500);
      fecharRotaOverlay();
      stopPolling();
      shareId = null; sharePartilhada = false;
      closeShareMode();
    } catch (err) {
      showToast(err.message || 'Erro ao cancelar a viagem.');
    }
  });

  /* ── POLLING ───────────────────────────────────────────────── */
  function startPolling() {
    stopPolling();
    pollingTimer = setInterval(async () => {
      if (!shareId) return;
      try {
        const st = await fetchJson(url(`/partilha/status?shareId=${encodeURIComponent(shareId)}`));
        if (st?.ok && Array.isArray(st.participantes)) {
          applyStatusFromBackend(st.participantes);
          atualizarAguardaOverlay();
          // Atualizar marcadores no mapa se tiver localização
          atualizarMarcadoresParticipantes(st.participantes);
          // Verificar se todos aceitaram → mostrar rota completa
          const todos = participantes.filter(p => p.ok);
          const aceitaram = todos.filter(p => ['aceitou','pagou'].includes(p.status));
          if (todos.length > 0 && aceitaram.length === todos.length) {
            mostrarRotaCompleta();
          }
        }
      } catch (_) {}
    }, 3000);
  }
  function stopPolling() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  }

  /* ── OVERLAY DE ESPERA ──────────────────────────────────────── */
  function mostrarAguardaOverlay() {
    const overlay = el('shareAguardaOverlay');
    if (!overlay) return;
    atualizarAguardaOverlay();
    overlay.classList.add('show');
    el('aguardaBtnCancelar').onclick = () => cancelarPartilhaAtual();
    const btnFechar = el('btnFecharAguardaOverlay');
    if (btnFechar) btnFechar.onclick = () => fecharAguardaOverlay();
  }

  function fecharAguardaOverlay() {
    el('shareAguardaOverlay')?.classList.remove('show');
  }

  function atualizarAguardaOverlay() {
    const lista = el('aguardaParticipantes');
    if (!lista) return;
    const ativos = participantes.filter(p => p.ok);
    if (!ativos.length) return;

    const labelStatus = {
      confirmado: { txt: 'AGUARDANDO', cls: 'pendente' },
      pendente:   { txt: 'CONVITE ENVIADO', cls: 'pendente' },
      localizado: { txt: 'LOCALIZADO', cls: 'pendente' },
      aceitou:    { txt: 'AGUARDA PAGAMENTO', cls: 'aceitou' },
      pagou:      { txt: 'VIAGEM PAGA ✅', cls: 'pagou' },
      falhou:     { txt: 'FALHOU PAGAMENTO (3x)', cls: 'recusou' },
      recusou:    { txt: 'REJEITOU ✗', cls: 'recusou' },
      cancelado:  { txt: 'REJEITOU ✗', cls: 'recusou' },
    };

    lista.innerHTML = ativos.map(p => {
      const s = labelStatus[p.status] || { txt: p.status.toUpperCase(), cls: 'pendente' };
      return `<div class="aguarda-part-item">
        <span class="aguarda-part-nome">${escapeHtml(p.nome || p.contacto)}</span>
        <span class="aguarda-part-status ${s.cls}">${s.txt}</span>
      </div>`;
    }).join('');

    const aceites  = ativos.filter(p => ['aceitou','pagou'].includes(p.status)).length;
    const sub = el('aguardaSub');
    if (sub) sub.textContent = `${aceites} de ${ativos.length} participante(s) confirmado(s).`;
  }

  /* ── MARCADORES DOS PARTICIPANTES NO MAPA ───────────────────── */
  const marcadoresPartilha = {}; // contacto → marker Leaflet
  const CORES_PART = ['#19d68b','#ff9f43','#5cc8ff','#d68bff','#ff6b6b','#ffe066'];

  function atualizarMarcadoresParticipantes(lista) {
    lista.forEach((item, idx) => {
      if (!item.lat || !item.lng) return;
      const cor = CORES_PART[idx % CORES_PART.length];
      const nome = item.nome || item.contacto || `P${idx+1}`;

      if (marcadoresPartilha[item.contacto]) {
        marcadoresPartilha[item.contacto].setPosition({lat:item.lat,lng:item.lng});
      } else {
        const m = new google.maps.Marker({position:{lat:item.lat,lng:item.lng},map,title:nome,icon:{path:google.maps.SymbolPath.CIRCLE,scale:7,fillColor:cor,fillOpacity:1,strokeColor:'#fff',strokeWeight:2}}); marcadoresPartilha[item.contacto] = m;
      }
    });
  }

  function limparMarcadoresPartilha() {
    Object.values(marcadoresPartilha).forEach(m => m.setMap(null));
    Object.keys(marcadoresPartilha).forEach(k => delete marcadoresPartilha[k]);
  }

  /* ── ROTA COMPLETA AO VIVO ──────────────────────────────────── */
  let rotaPolyline = null;

  let _rotaOverlayFechadoManualmente = false;

  function mostrarRotaCompleta() {
    fecharAguardaOverlay();
    // Sem isto, o polling (a cada 3s) reabria sempre este painel,
    // mesmo depois do operador o ter fechado de propósito — agora,
    // uma vez fechado manualmente, só volta a aparecer se for uma
    // partilha diferente (ver entrarSalaPartilha/abrirPartilhaEspecifica,
    // que reiniciam esta flag).
    if (_rotaOverlayFechadoManualmente) return;

    const rotaOverlay  = el('shareRotaOverlay');
    const destinoTexto = shareDestinoPlace?.address || els.shareDestino?.value || '—';

    const rotaDest = el('rotaDestinoTexto');
    if (rotaDest) rotaDest.textContent = destinoTexto;

    const rotaParts = el('rotaParticipantes');
    if (rotaParts) {
      const ativos = participantes.filter(p => p.ok && ['aceitou','pagou'].includes(p.status));
      rotaParts.innerHTML = ativos.map((p, idx) => {
        const cor = CORES_PART[idx % CORES_PART.length];
        return `<div class="rota-part-item">
          <div class="rota-part-dot" style="background:${cor};color:${cor}"></div>
          <span class="rota-part-nome">${escapeHtml(p.nome || p.contacto)}</span>
          <span class="rota-part-dist" id="rotaDist_${p.idx}">A localizar...</span>
        </div>`;
      }).join('');
    }

    rotaOverlay?.classList.add('show');
  const btnFecharRota = document.getElementById('btnFecharRotaOverlay');
  if (btnFecharRota) btnFecharRota.onclick = () => fecharRotaOverlay();

    // Desenhar rota no Leaflet usando geometria OSRM (GeoJSON)
    if (shareRotaData?.geometry) {
      if (rotaPolyline) { try{rotaPolyline.setMap(null);}catch(_){} rotaPolyline=null; }

      // GeoJSON OSRM: coordenadas em [lng, lat] — Leaflet quer [lat, lng]
      const pontos = shareRotaData.geometry.coordinates.map(c => ({lat:c[1],lng:c[0]}));

      rotaPolyline = new google.maps.Polyline({path:pontos,map,strokeColor:'#19d68b',strokeWeight:5,strokeOpacity:.9});

      // Marcador de origem
      
      new google.maps.Marker({position:shareRotaData.origemLatLng,map,icon:{path:google.maps.SymbolPath.CIRCLE,scale:7,fillColor:'#fff',fillOpacity:1,strokeColor:'#19d68b',strokeWeight:3}});

      // Marcador de destino
      
      new google.maps.Marker({position:shareRotaData.destinoLatLng,map,icon:{path:google.maps.SymbolPath.CIRCLE,scale:7,fillColor:'#19d68b',fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});

      (function(){const _b=new google.maps.LatLngBounds();rotaPolyline.getPath().forEach(p=>_b.extend(p));map.fitBounds(_b);})();
    }
  }

  function fecharRotaOverlay() {
    _rotaOverlayFechadoManualmente = true;
    el('shareRotaOverlay')?.classList.remove('show');
    if (rotaPolyline) { try{rotaPolyline.setMap(null);}catch(_){} rotaPolyline=null; }
    limparMarcadoresPartilha();
    // Nunca devem ficar escondidos — só no modo convidado (CSS própria).
    document.querySelector('.trip-type-wrap')?.classList.remove('hidden');
  }

  /* ── CATEGORIAS DA PARTILHA ────────────────────────────────── */
  function bindShareCats() {
    document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(b => b.classList.remove('selected'));
        // Reset grupo select when another category is chosen
        const sgSel = el('shareGrupoSelect');
        if (sgSel) { sgSel.value = ''; sgSel.classList.remove('selected'); }
        btn.classList.add('selected');
        selectedShareCategory = btn.dataset.sharecat;
        // LUXO na partilha NÃO pergunta número de lugares — ao contrário
        // da reserva privada normal, aqui os participantes já são
        // definidos pelos cartões de contacto; o popup de lugares não
        // se aplica e só criava um passo extra desnecessário.
        if (selectedShareCategory === 'grupo') openCategoryPopup('grupo');
        updateShareButtonsState();
        calcularPrecoPartilha();
      });
    });
  }

  /* ── CÁLCULO DE PREÇO DA PARTILHA ──────────────────────────── */

  // Mapa de categoria frontend → backend (pricing.service.js)
  function categoriaParaBackend(cat, grupoN) {
    const mapa = {
      economica: 'economica',
      confort:   'confort',
      executive: 'executive',
      luxo:      'luxury',           // frontend "luxo" → backend "luxury"
      grupo6: 'grupo6', grupo8: 'grupo8', grupo17: 'grupo17',
      grupo:  grupoN >= 17 ? 'grupo17' : grupoN >= 8 ? 'grupo8' : 'grupo6'
    };
    return mapa[cat] || 'confort';
  }

  let precoTimer = null; // debounce
  let shareRotaData = null; // guarda dados da rota para desenhar no mapa

  async function calcularPrecoPartilha() {
    const painel  = el('sharePrecoPanel');
    const kmEl    = el('sharePrecoKm');
    const tempoEl = el('sharePrecoTempo');
    const valorEl = el('sharePrecoValor');
    const portEl  = el('sharePrecoPortagens');
    const recolha = el('shareRecolha');
    const destino = els.shareDestino;

    if (!recolha?.value?.trim() || !destino?.value?.trim()) {
      painel?.classList.remove('show'); return;
    }

    // Mostrar 'a calcular...' nos pills
    const labelMap = { economica:'ECÓNOMICA', confort:'CONFORTO', executive:'EXECUTIVA', luxo:'LUXO' };
    document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(b => {
      const lbl = labelMap[b.dataset.sharecat] || b.dataset.sharecat.toUpperCase();
      b.textContent = lbl + ' — ...';
    });

    if (painel) { painel.classList.add('show', 'a-calcular'); }
    if (kmEl)    kmEl.textContent    = 'A calcular...';
    if (tempoEl) tempoEl.textContent = '';
    if (valorEl) { valorEl.textContent = '—'; valorEl.className = 'share-preco-total-valor'; }
    if (portEl)  portEl.classList.remove('show');

    clearTimeout(precoTimer);
    precoTimer = setTimeout(async () => {
      try {
        // 1) Rota via OSRM
        const rotaInfo = await obterInfoRota(
          recolha.value.trim(), destino.value.trim(),
          recolha.dataset.lat ? { lat: Number(recolha.dataset.lat), lng: Number(recolha.dataset.lng) } : null,
          shareDestinoPlace   ? { lat: shareDestinoPlace.lat, lng: shareDestinoPlace.lng } : null
        );
        shareRotaData = rotaInfo;
        const km = rotaInfo.km;

        // 2) Calcular preços para TODAS as categorias em paralelo
        const todasCats = [
          { sharecat: 'economica', backend: 'economica', label: 'ECÓNOMICA' },
          { sharecat: 'confort',   backend: 'confort',   label: 'CONFORTO'  },
          { sharecat: 'executive', backend: 'executive', label: 'EXECUTIVA' },
          { sharecat: 'luxo',      backend: 'luxury',    label: 'LUXO'      },
        ];

        const precos = {};
        await Promise.all(todasCats.map(async ({ sharecat, backend }) => {
          try {
            const r = await fetch(url('/quotes/quote'), {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoria: backend, distanciaKm: km })
            });
            const d = await r.json().catch(() => ({}));
            if (d?.ok && d?.total != null) precos[sharecat] = Number(d.total);
          } catch {}
        }));

        // 3) Actualizar texto dos pills com CATEGORIA — €VALOR
        todasCats.forEach(({ sharecat, label }) => {
          const btn = document.querySelector(`.share-cat-pill[data-sharecat="${sharecat}"]`);
          if (!btn) return;
          const v = precos[sharecat];
          btn.textContent = v != null ? `${label} — €${v.toFixed(2)}` : label;
        });

        // 4) Actualizar select GRUPO com preços grupo6/8/17
        const grupoConfigs = [
          { value: 'grupo6',  backend: 'grupo6',  label: 'GRUPO 6',  optIdx: 1 },
          { value: 'grupo8',  backend: 'grupo8',  label: 'GRUPO 8',  optIdx: 2 },
          { value: 'grupo17', backend: 'grupo17', label: 'GRUPO 17', optIdx: 3 },
        ];
        const selGrupo = el('shareGrupoSelect');
        if (selGrupo) {
          await Promise.all(grupoConfigs.map(async ({ value, backend, label, optIdx }) => {
            try {
              const r = await fetch(url('/quotes/quote'), {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoria: backend, distanciaKm: km })
              });
              const d = await r.json().catch(() => ({}));
              if (d?.ok && d?.total != null) {
                precos[value] = Number(d.total);
                if (selGrupo.options[optIdx]) selGrupo.options[optIdx].text = `${label} — €${Number(d.total).toFixed(2)}`;
              }
            } catch {}
          }));
        }

        // 5) Painel de preço da categoria seleccionada
        const catActual = selectedShareCategory;
        let totalActual = 0, portagensActual = 0;
        if (catActual && precos[catActual] != null) {
          totalActual = precos[catActual];
        } else if (catActual) {
          // Recalcular para a categoria seleccionada (grupo ou luxo com popup)
          const backendCat = categoriaParaBackend(catActual, grupoSeats);
          try {
            const r = await fetch(url('/quotes/quote'), {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoria: backendCat, distanciaKm: km })
            });
            const d = await r.json().catch(() => ({}));
            if (d?.ok) { totalActual = Number(d.total||0); portagensActual = Number(d.portagens||0); }
          } catch {}
        }

        if (kmEl)    kmEl.textContent    = `${km.toFixed(1)} km`;
        if (tempoEl) tempoEl.textContent = rotaInfo.duracaoTexto || '';
        if (valorEl) {
          valorEl.textContent = totalActual > 0 ? `€${totalActual.toFixed(2)}` : '—';
          valorEl.className   = 'share-preco-total-valor';
        }
        if (portEl) {
          if (portagensActual > 0) { portEl.textContent = `⚠️ Portagens: ${portagensActual.toFixed(2)}€`; portEl.classList.add('show'); }
          else portEl.classList.remove('show');
        }
        if (painel) painel.classList.remove('a-calcular');
        if (!catActual && painel) painel.classList.remove('show');

      } catch (err) {
        // Repor labels originais se falhar
        const labelMap2 = { economica:'ECÓNOMICA', confort:'CONFORTO', executive:'EXECUTIVA', luxo:'LUXO' };
        document.querySelectorAll('.share-cat-pill[data-sharecat]').forEach(b => {
          b.textContent = labelMap2[b.dataset.sharecat] || b.dataset.sharecat.toUpperCase();
        });
        if (kmEl)    kmEl.textContent    = err.message || 'Erro ao calcular.';
        if (tempoEl) tempoEl.textContent = '';
        if (valorEl) { valorEl.textContent = 'Erro'; valorEl.className = 'share-preco-total-valor erro'; }
        if (painel)  painel.classList.remove('a-calcular');
      }
    }, 600);
  }

  /* ================================================================
     OSRM — Open Source Routing Machine (OpenStreetMap)
     Calcula distância, duração e geometria da rota. Gratuito.
  ================================================================ */

  async function obterInfoRota(origemStr, destinoStr, origemLatLng, destinoLatLng) {
    // Garante coordenadas — usa as já disponíveis ou geocodifica
    let oLat, oLng, dLat, dLng;

    if (origemLatLng) {
      oLat = origemLatLng.lat; oLng = origemLatLng.lng;
    } else {
      const r = await nominatimSearch(origemStr);
      if (!r.length) throw new Error(`Local de recolha não encontrado: "${origemStr}"`);
      oLat = Number(r[0].lat); oLng = Number(r[0].lon);
    }

    if (destinoLatLng) {
      dLat = destinoLatLng.lat; dLng = destinoLatLng.lng;
    } else {
      const r = await nominatimSearch(destinoStr);
      if (!r.length) throw new Error(`Destino não encontrado: "${destinoStr}"`);
      dLat = Number(r[0].lat); dLng = Number(r[0].lon);
    }

    const apiUrl = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=false`;
    const res  = await fetch(apiUrl);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error('OSRM: rota não encontrada entre os dois pontos.');
    }

    const rota     = data.routes[0];
    const km       = rota.distance / 1000;
    const durSeg   = rota.duration;
    const horas    = Math.floor(durSeg / 3600);
    const minutos  = Math.round((durSeg % 3600) / 60);
    const durTexto = horas > 0 ? `${horas}h ${minutos}min` : `${minutos} min`;


    return {
      km,
      duracaoSeg:   durSeg,
      duracaoTexto: durTexto,
      geometry:     rota.geometry,       // GeoJSON para desenhar no Leaflet
      origemLatLng: { lat: oLat, lng: oLng },
      destinoLatLng:{ lat: dLat, lng: dLng },
      origemStr, destinoStr
    };
  }

  /* ── GEOLOCALIZAÇÃO RECOLHA ────────────────────────────────── */
  function preencherRecolhaAuto() {
    const inp = el('shareRecolha');
    if (!inp || inp.value.trim() || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
        .then(r => r.json())
        .then(data => {
          inp.value = data?.display_name || `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
          inp.dataset.lat = pos.coords.latitude; inp.dataset.lng = pos.coords.longitude;
          updateShareButtonsState();
        })
        .catch(() => {
          inp.value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
          inp.dataset.lat = pos.coords.latitude; inp.dataset.lng = pos.coords.longitude;
          updateShareButtonsState();
        });
    }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
  }

  /* ── CONVITE SMS ───────────────────────────────────────────── */
  function parseInviteParams() {
    const params = new URLSearchParams(location.search);
    inviteToken   = (params.get('invite') || '').trim();
    inviteShareId = (params.get('shareId') || '').trim();
    // Modo Evento — o link do email/SMS do Evento traz &evt=1.
    // Nesse caso, a rota de validação OTP e as seguintes são as
    // do fluxo Evento (que sabem que a partida é fixada pelo
    // organizador e cada convidado tem destino próprio) em vez
    // das do fluxo Partilha (destino comum).
    window._rmModoEvento = (params.get('evt') === '1');
    window._rmModoProto  = (params.get('pronto') === '1');   // Fase pós-pagamento — só ecrã ESTOU PRONTO
    if (window._rmModoEvento) {
      // Modo restrito: esconde a topbar (RESERVAR/PARTILHAR/etc.),
      // hambúrguer, e todos os botões flutuantes do dashboard.
      // O CSS abaixo é injectado uma só vez.
      _injectarCssModoEvento();
      document.body.classList.add('rm-modo-evento');
      // Ajustar texto do popup do código — depende do modo:
      //  pronto=1 → convidado veio confirmar embarque (pagou já)
      //  evt=1    → convidado vai definir destino + pagar
      const popup = document.getElementById('inviteVerifyPopup');
      if (popup) {
        const h3 = popup.querySelector('h3');
        const p  = popup.querySelector('.popup-head p');
        if (window._rmModoProto) {
          if (h3) h3.textContent = 'RESERVA FLEXÍVEL';
          if (p)  p.textContent  = 'Introduza o código para confirmarmos a sua Reserva Flexível e chamarmos o seu motorista.';
        } else {
          if (h3) h3.textContent = 'ACESSO À SUA VIAGEM';
          if (p)  p.textContent  = 'Introduza o código recebido para validar o seu bilhete.';
        }
      }
    } else if (inviteToken && inviteShareId) {
      // Partilha SMS simples (não é o fluxo de evento/hotel) — o
      // HTML por defeito do popup passou a ter texto de "chamar
      // motorista" (para o caso comum, o de evento); aqui repõe-se
      // explicitamente o texto original desta funcionalidade.
      const popup = document.getElementById('inviteVerifyPopup');
      if (popup) {
        const h3 = popup.querySelector('h3');
        const p  = popup.querySelector('.popup-head p');
        if (h3) h3.textContent = 'ACESSO À PARTILHA';
        if (p)  p.textContent  = 'Introduza o código recebido por SMS para entrar na partilha.';
      }
    }
    if (inviteToken && inviteShareId) {
      const legenda = window._rmModoProto
        ? `Introduza o código para confirmar o embarque.`
        : (window._rmModoEvento
            ? `Este é o seu bilhete do evento. Introduza o código recebido para validar.`
            : `Convite de partilha: ${inviteShareId}. Introduza o código SMS para entrar.`);
      showInviteBar(legenda);
      openPopup(els.inviteVerifyPopup);
    }
  }

  function _injectarCssModoEvento() {
    if (document.getElementById('rmModoEventoCss')) return;
    const st = document.createElement('style');
    st.id = 'rmModoEventoCss';
    st.textContent = `
      /* Modo Evento — convidado vê APENAS mapa + botão SAIR.
         Tudo o resto (topbar, botões RESERVAR/PARTILHAR/etc.,
         hambúrguer, painéis, etc.) escondido. Regra explícita
         em vez de "esconder tudo": queremos manter o header
         estruturalmente visível para o botão SAIR continuar lá,
         mas os IRMÃOS do botão SAIR ficam ocultos. */
      body.rm-modo-evento header > *,
      body.rm-modo-evento .header-actions > *,
      body.rm-modo-evento .header-buttons > *,
      body.rm-modo-evento header button:not(#btnEncerrarSessao),
      body.rm-modo-evento .trip-type-wrap,
      body.rm-modo-evento #tripPanel,
      body.rm-modo-evento #shareSheet,
      body.rm-modo-evento #ticketSheet,
      body.rm-modo-evento #eventoSheet,
      body.rm-modo-evento #cvdOverlay,
      body.rm-modo-evento #hamburgerMenu,
      body.rm-modo-evento #tripBar,
      body.rm-modo-evento #btnReservaAtiva,
      body.rm-modo-evento #btnInstalarApp,
      body.rm-modo-evento .brand,
      body.rm-modo-evento .logo { display: none !important; }
      /* Garantir que o SAIR fica visível */
      body.rm-modo-evento #btnEncerrarSessao { display: inline-flex !important; }
      /* Reposicionar SAIR no topo direito, sem topbar por trás */
      body.rm-modo-evento header {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        position: absolute; top: 12px; right: 12px; left: auto;
        width: auto; z-index: 4900;
      }
      /* Popup do código bem centrado quando ativo — sem !important
         no display, senão o closePopup nunca consegue esconder. */
      body.rm-modo-evento #inviteVerifyPopup.show {
        position: fixed !important;
        inset: 0 !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 5500 !important;
      }
      body.rm-modo-evento #inviteVerifyPopup .popup-card {
        margin: auto !important;
      }
      /* Luz prata a percorrer o nome do motorista (como o botão ficar online) */
      .evt-nome-luz { position: relative; display: inline-block; }
      .evt-nome-luz::after {
        content: ''; position: absolute; bottom: -5px; left: 0;
        width: 22px; height: 2px; border-radius: 2px;
        background: linear-gradient(90deg, transparent, #ffffff, #c4c9d4, transparent);
        animation: evtLuzNome 1.8s ease-in-out infinite;
      }
      @keyframes evtLuzNome {
        0%   { left: 0; opacity: .4; }
        50%  { left: calc(100% - 22px); opacity: 1; }
        100% { left: 0; opacity: .4; }
      }
      /* Foto ampliada — estado ativo (queda diagonal + fade) */
      #evtFotoBackdrop.on { background: rgba(0,0,0,.82) !important; }
      #evtFotoBackdrop.on #evtFotoGrande { transform: translate(0,0) scale(1) rotate(0deg) !important; opacity: 1 !important; }
      #evtFotoBackdrop.on #evtFotoHint { opacity: 1 !important; }
    `;
    document.head.appendChild(st);
  }

  async function verifyInviteAccess() {
    const otp = (els.inviteOtpInput.value || '').trim();
    if (!inviteToken || !inviteShareId) { showToast('Convite inválido.'); return; }
    if (!otp) { showToast('Introduza o código SMS.'); return; }
    // Modo PRONTO (pós-pagamento): o código que o utilizador introduz
    // é o "código de chamar motorista" (prontoOtp), validado pelo
    // /evento/estou-pronto — NÃO pelo confirmar-otp (o bilhete já foi
    // pago, logo já tem usedAt preenchido, e o confirmar-otp devolvia
    // 409 "já utilizado"). Guardamos o código e vamos direto ao ecrã
    // ESTOU PRONTO, que o envia no momento certo.
    if (window._rmModoProto) {
      _evtCodigoPronto = otp;
      // Precisamos do inviteId/eventoId para o estou-pronto. Vêm do
      // token do link (o backend também os lê de lá como fallback).
      if (!_evtInviteInfo) {
        _evtInviteInfo = { token: inviteToken, inviteId: null, eventoId: inviteShareId };
      }
      closePopup(els.inviteVerifyPopup);
      el('inviteBar')?.classList.remove('show');
      _evtMostrarEcraProto();
      return;
    }
    // Modo Evento chama rota própria (o backend distingue-os pelo
    // typ do JWT — se cruzarmos, devolve "Tipo de convite inválido").
    if (window._rmModoEvento) return verifyEventoInviteAccess(otp);
    try {
      const data = await fetchJson(url('/partilha/invite/verify'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite: inviteToken, otp })
      });
      shareSessionToken = (data?.sessionToken || '').trim();
      shareId = (data?.shareId || inviteShareId).trim();
      closePopup(els.inviteVerifyPopup);

      const v = data?.viagem;
      _conviteDestinoGeo = v?.destinoGeo || null;
      _conviteRecolhaGeo = v?.recolhaGeo || null;
      el('inviteBar')?.classList.remove('show');
      startInviteLocationUpdates();

      // ── ORDEM EXACTA PEDIDA ──────────────────────────────────
      // 1) Código já validado → mostrar primeiro a rota no mapa,
      //    sozinha, sem nenhum popup por cima a distrair.
      showToast('Acesso validado. A desenhar a rota...', 2500);
      const rotaInfo = await mostrarRotaConvidado();

      // Pausa mínima, garantida — antes disto, se a rede fosse rápida
      // (OSRM normalmente responde em <1s), o cartão aparecia quase
      // ao mesmo tempo que a rota, sem dar tempo a ver o mapa sozinho.
      // Promise.all garante que se espera o maior dos dois tempos
      // (cálculo do valor OU esta pausa), nunca menos do que 2.5s.
      const PAUSA_MINIMA_MS = 2500;
      const [valorInfo] = await Promise.all([
        fetchJson(url('/partilha/invite/calcular-meu-valor'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken: shareSessionToken })
        }).catch(() => null),
        new Promise(resolve => setTimeout(resolve, PAUSA_MINIMA_MS)),
      ]);

      const overlay = el('conviteOverlay');
      if (v && overlay) {
        const dataHora = v.scheduledAt
          ? new Date(v.scheduledAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '—';
        const deEl  = el('conviteDe');
        const dstEl = el('conviteDestino');
        const dtEl  = el('conviteDataHora');
        const kmEl  = el('conviteKm');
        const tempoEl = el('conviteTempo');
        if (deEl)  deEl.textContent  = v.nomeOrganizador ? `De ${v.nomeOrganizador}` : 'Convite de partilha';
        if (dstEl) dstEl.textContent = v.destino || '—';
        if (dtEl)  dtEl.textContent  = dataHora;
        if (kmEl)    kmEl.textContent    = rotaInfo ? `${rotaInfo.km} km` : (valorInfo?.distanciaKm ? `${valorInfo.distanciaKm} km` : '—');
        if (tempoEl) tempoEl.textContent = rotaInfo ? `~${rotaInfo.min} min` : '—';
        const catEl = el('conviteCategoria');
        if (catEl && v.categoria) {
          catEl.textContent = v.categoria.toUpperCase();
          catEl.style.display = 'inline-block';
        }

        // 3) Bloco "A sua parte" com CANCELAR/PAGAR — já com o valor
        //    certo, não com placeholder.
        const pagarWrap = el('convitePagarWrap');
        const valorEl   = el('convitePagarValor');
        if (pagarWrap && valorEl) {
          pagarWrap.style.display = 'block';
          if (valorInfo?.amountDue) {
            _valorConvidadoAtual = Number(valorInfo.amountDue);
            valorEl.textContent = `€${_valorConvidadoAtual.toFixed(2)}`;
            el('btnConvitePagar')?.removeAttribute('disabled');
          } else {
            valorEl.textContent = 'A calcular…';
          }
        }

        overlay.style.display = 'block';
      }

      // Continuar a actualizar o valor em segundo plano (ex: se o
      // organizador recalcular por uma falha de pagamento de outro
      // participante) — o cartão já está visível, por isso não há
      // necessidade de nenhuma flag de atraso aqui.
      _podeMostrarPagamentoConvidado = true;
      startPolling();
      if (_valorConvidadoTimer) clearInterval(_valorConvidadoTimer);
      _valorConvidadoTimer = setInterval(consultarValorConvidado, 8000);
    } catch (err) { showToast(err.message || 'Falha ao validar convite.'); }
  }

  /* ═══════════════════════════════════════════════════════════════
     MODO EVENTO — reutiliza o overlay #conviteOverlay e o fluxo
     visual da Partilha. Única diferença: a partida vem definida
     pelo organizador (não pelo convidado); o convidado só insere
     o destino. As rotas de backend são as do Evento (o JWT tem
     typ:"evento_invite", que só o /evento/confirmar-otp aceita).
  ═══════════════════════════════════════════════════════════════ */
  let _evtInviteInfo = null; // { inviteId, eventoId, nome, partida, scheduledAt, token }
  let _evtCodigoPronto = null; // código "chamar motorista" (modo pronto=1), enviado no estou-pronto

  async function verifyEventoInviteAccess(otp) {
    try {
      const data = await fetchJson(url('/partilha/evento/confirmar-otp'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, otp })
      });
      _evtInviteInfo = {
        inviteId:    data.inviteId,
        eventoId:    data.eventoId,
        nome:        data.nome,
        partida:     data.partida,      // { address, lat, lng }
        scheduledAt: data.scheduledAt,
        categoria:   data.categoria,    // tipo de viagem, fixado pelo remetente
        destinoSugerido: data.destinoSugerido || null,  // opcional; convidado pode aceitar ou escrever outro
        token:       data.token || inviteToken,
      };
      closePopup(els.inviteVerifyPopup);
      el('inviteBar')?.classList.remove('show');

      // Se veio de link "pronto=1" (pós-pagamento), salta o resto
      // do fluxo (definir destino, ver rota, pagar) — vai direto ao
      // ecrã ESTOU PRONTO. O destino e pagamento já foram feitos.
      if (window._rmModoProto) {
        _evtMostrarEcraProto();
        return;
      }

      showToast('Código validado. Indique o seu destino.', 3000);

      // Centrar mapa na partida do evento — protegido por try/catch:
      // se o Google Maps não estiver disponível ou tiver algum erro
      // interno, o fluxo NÃO deve parar. A barra de destino tem de
      // aparecer sempre para o convidado poder continuar.
      try {
        if (typeof map !== 'undefined' && map && data.partida?.lat) {
          if (typeof map.setCenter === 'function') {
            map.setCenter({ lat: data.partida.lat, lng: data.partida.lng });
          }
          if (typeof map.setZoom === 'function') {
            map.setZoom(15);
          }
          if (typeof google !== 'undefined' && google.maps?.Marker) {
            try {
              new google.maps.Marker({
                position: { lat: data.partida.lat, lng: data.partida.lng },
                map, title: 'Local de embarque',
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#c4c9d4', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
              });
            } catch (_) {}
          }
        }
      } catch (errMapa) {
        console.warn('[evt] mapa falhou ao centrar (ignorado):', errMapa?.message);
      }

      _mostrarBarraDestinoEvento();
    } catch (err) {
      showToast(err.message || 'Código inválido.');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     MODO PRONTO (Reserva Flexível)
     Fluxo pós-pagamento: o convidado já pagou, recebeu SMS/email
     com link "chamar o meu motorista", e clicou.

     IDEMPOTÊNCIA: se o convidado fechar o browser e voltar mais
     tarde ao link, ao entrar aqui verificamos primeiro se o
     motorista já foi despachado. Se sim, saltamos o botão ESTOU
     PRONTO e mostramos direto o cartão do motorista + mapa.
  ═══════════════════════════════════════════════════════════════ */
  async function _evtMostrarEcraProto() {
    // Antes de mostrar o botão, verificamos se o motorista já foi
    // atribuído. Se sim, o convidado está a voltar ao link após ter
    // clicado ESTOU PRONTO — vai direto ao mapa.
    try {
      const params = new URLSearchParams({ token: _evtInviteInfo.token });
      // Só enviar inviteId se existir — senão o URLSearchParams envia a
      // string "null", e o servidor procura um bilhete "null" (404).
      // Em falta, o servidor usa o inviteId que está dentro do token.
      if (_evtInviteInfo.inviteId) params.set('inviteId', _evtInviteInfo.inviteId);
      const data = await fetchJson(url('/partilha/evento/motorista-atribuido?' + params.toString()));
      if (data?.atribuido && data.motorista) {
        _evtTripId = data.tripId;
        _evtMostrarBaseProntoOverlay();
        _evtMostrarMotorista(data.motorista);
        return;
      }
      // Se aguarda: "motorista" ou "trip-nao-existe" — já foi
      // despachado mas ainda sem motorista. Mostra spinner direto.
      if (data?.aguarda === 'motorista' || data?.aguarda === 'trip-nao-existe') {
        _evtMostrarBaseProntoOverlay();
        _evtMostrarEcraProcurandoMotorista({ tripId: null });
        return;
      }
    } catch (_) {
      // Falha de rede — segue fluxo normal, mostra botão ESTOU PRONTO
    }
    _evtMostrarBotaoProto();
  }

  function _evtMostrarBaseProntoOverlay() {
    let ov = document.getElementById('evtProntoOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'evtProntoOverlay';
      ov.style.cssText = `
        position:fixed;inset:0;z-index:9800;
        background:linear-gradient(180deg,#050507 0%,#0a0b0d 100%);
        display:flex;align-items:center;justify-content:center;
        padding:24px;font-family:Inter,Arial,system-ui,sans-serif;
      `;
      document.body.appendChild(ov);
    }
    ov.style.display = 'flex';
  }

  function _evtMostrarBotaoProto() {
    _evtMostrarBaseProntoOverlay();
    const ov = document.getElementById('evtProntoOverlay');
    if (!ov) return;
    ov.innerHTML = `
      <div style="width:min(420px,100%);text-align:center">
        <!-- Logo/badge -->
        <div style="font-size:11px;font-weight:900;letter-spacing:.32em;color:#c4c9d4;margin-bottom:36px;opacity:.85">
          REALMETROPOLIS
        </div>

        <!-- Mensagem principal -->
        <div style="font-size:22px;font-weight:900;color:#f4f6f8;line-height:1.32;letter-spacing:.02em;margin-bottom:12px">
          Confirme agora e enviaremos<br>o seu motorista
        </div>
        <div style="font-size:12.5px;color:#8b95a2;line-height:1.5;margin-bottom:44px">
          Ao tocar no botão abaixo, um motorista da REALMETROPOLIS será atribuído e enviado ao seu ponto de recolha.
        </div>

        <!-- Botão ESTOU PRONTO -->
        <button id="btnEstouPronto" type="button" style="
          width:100%;padding:18px;
          background:#050507;color:#c4c9d4;
          font-family:inherit;font-weight:900;font-size:14px;letter-spacing:.14em;
          border:1.5px solid #c4c9d4;border-radius:12px;
          cursor:pointer;transition:.15s ease;
          box-shadow:0 8px 24px rgba(196,201,212,.08);
        " onmouseover="this.style.background='#c4c9d4';this.style.color='#050507'"
          onmouseout="this.style.background='#050507';this.style.color='#c4c9d4'">
          ESTOU PRONTO
        </button>

        <!-- Rodapé pequeno -->
        <div style="margin-top:22px;font-size:10.5px;color:#5f6874;letter-spacing:.06em">
          Disponível 24h. Motoristas verificados.
        </div>
      </div>
    `;
    ov.style.display = 'flex';

    document.getElementById('btnEstouPronto').addEventListener('click', _evtDispararEstouPronto);
  }

  // Idempotência: se o utilizador clicar duas vezes muito rápido,
  // ou se a rede for lenta e ele clicar de novo, só uma chamada é
  // feita ao backend. `_evtProntoEmAndamento` bloqueia repetições.
  let _evtProntoEmAndamento = false;

  async function _evtDispararEstouPronto() {
    if (_evtProntoEmAndamento) return;
    _evtProntoEmAndamento = true;

    const btn = document.getElementById('btnEstouPronto');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A REQUISITAR...';
      btn.style.opacity = '.7';
      btn.style.cursor = 'wait';
    }

    try {
      const _corpo = {
        token:    _evtInviteInfo.token,
        inviteId: _evtInviteInfo.inviteId,
      };
      // Modo pronto=1: incluir o código de "chamar motorista" que o
      // utilizador introduziu — o backend exige-o para despachar.
      if (_evtCodigoPronto) _corpo.codigo = _evtCodigoPronto;
      const data = await fetchJson(url('/partilha/evento/estou-pronto'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_corpo)
      });
      // Sucesso — passar para ecrã "A procurar motorista"
      _evtMostrarEcraProcurandoMotorista(data);
    } catch (err) {
      _evtProntoEmAndamento = false;
      showToast(err.message || 'Não foi possível requisitar o motorista.', 5000);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'ESTOU PRONTO';
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      }
    }
  }

  // Estado interno da Fase 2 (cartão do motorista + mapa em tempo real)
  let _evtPollTimer      = null;   // timer do setTimeout do polling
  let _evtPollTentativas = 0;
  const EVT_POLL_INTERVAL_MS = 3_000;   // 3s entre polls — não sobrecarrega backend
  const EVT_POLL_MAX_TENTATIVAS = 60;   // 60 × 3s = 3 minutos
  let _evtLeafletMap    = null;
  let _evtLeafletMarker = null;
  let _evtSocket        = null;
  let _evtTripId        = null;    // ObjectId da Trip devolvido pelo backend

  // Iniciada quando o convidado clica ESTOU PRONTO. Mostra spinner
  // e começa polling ao backend a cada 3s. Ao encontrar motorista
  // atribuído, chama _evtMostrarMotorista(motorista) que substitui
  // o spinner pelo cartão + mapa e liga o socket.
  function _evtMostrarEcraProcurandoMotorista(dataDispatch) {
    const ov = document.getElementById('evtProntoOverlay');
    if (!ov) return;
    _evtTripId = dataDispatch?.tripId || null;

    ov.innerHTML = `
      <div id="evtProcurandoBox" style="width:min(420px,100%);text-align:center">
        <div style="font-size:11px;font-weight:900;letter-spacing:.32em;color:#c4c9d4;margin-bottom:36px;opacity:.85">
          REALMETROPOLIS
        </div>
        <div style="width:64px;height:64px;margin:0 auto 24px;position:relative">
          <div style="position:absolute;inset:0;border:3px solid rgba(196,201,212,.15);border-top-color:#c4c9d4;border-radius:50%;animation:evtSpin 1s linear infinite"></div>
        </div>
        <div id="evtProcurandoTitulo" style="font-size:18px;font-weight:900;color:#f4f6f8;line-height:1.3;margin-bottom:10px">
          A procurar motorista...
        </div>
        <div id="evtProcurandoSubtitulo" style="font-size:12.5px;color:#8b95a2;line-height:1.5">
          Estamos a atribuir o motorista mais próximo de si.<br>
          Receberá os dados assim que estiver a caminho.
        </div>
      </div>
      <style>
        @keyframes evtSpin { to { transform: rotate(360deg); } }
      </style>
    `;

    // Começa polling imediatamente e depois a cada 3s
    _evtPollTentativas = 0;
    _evtPollMotorista();
  }

  async function _evtPollMotorista() {
    _evtPollTentativas++;

    try {
      const params = new URLSearchParams({ token: _evtInviteInfo.token });
      // Só enviar inviteId se existir — senão o URLSearchParams envia a
      // string "null", e o servidor procura um bilhete "null" (404).
      // Em falta, o servidor usa o inviteId que está dentro do token.
      if (_evtInviteInfo.inviteId) params.set('inviteId', _evtInviteInfo.inviteId);
      const data = await fetchJson(url('/partilha/evento/motorista-atribuido?' + params.toString()));

      if (data?.atribuido && data.motorista) {
        _evtTripId = data.tripId || _evtTripId;
        _evtMostrarMotorista(data.motorista);
        return;   // não faz mais polling — a partir daqui é socket
      }
    } catch (err) {
      console.warn('[evt/poll] erro (vai tentar de novo):', err?.message);
      // Continua polling — não pára o utilizador por um erro pontual de rede
    }

    if (_evtPollTentativas >= EVT_POLL_MAX_TENTATIVAS) {
      _evtMostrarFalhaMotorista();
      return;
    }

    // Ajustar mensagem gradualmente para dar noção de progresso e
    // não parecer que o sistema "morreu" (padrão UX profissional).
    if (_evtPollTentativas === 20) {   // ~1 min
      const sub = document.getElementById('evtProcurandoSubtitulo');
      if (sub) sub.innerHTML = 'Continuamos a mobilizar o motorista ideal para si.<br>Aguarde só mais um pouco.';
    } else if (_evtPollTentativas === 40) {   // ~2 min
      const sub = document.getElementById('evtProcurandoSubtitulo');
      if (sub) sub.innerHTML = 'Estamos a alocar recursos adicionais.<br>Obrigado pela sua paciência.';
    }

    _evtPollTimer = setTimeout(_evtPollMotorista, EVT_POLL_INTERVAL_MS);
  }

  // Após 3 minutos sem motorista, mostra ecrã de fallback profissional
  // com número de telefone para o utilizador se sentir apoiado.
  function _evtMostrarFalhaMotorista() {
    const ov = document.getElementById('evtProntoOverlay');
    if (!ov) return;
    ov.innerHTML = `
      <div style="width:min(420px,100%);text-align:center">
        <div style="font-size:11px;font-weight:900;letter-spacing:.32em;color:#c4c9d4;margin-bottom:36px;opacity:.85">
          REALMETROPOLIS
        </div>
        <div style="font-size:34px;margin-bottom:20px">⏱️</div>
        <div style="font-size:18px;font-weight:900;color:#f4f6f8;line-height:1.3;margin-bottom:14px">
          A demorar mais do que o habitual
        </div>
        <div style="font-size:13px;color:#8b95a2;line-height:1.55;margin-bottom:28px">
          Estamos a mobilizar um motorista da nossa rede.<br>
          Se preferir, contacte-nos diretamente:
        </div>
        <a href="tel:+351938070495" style="display:inline-block;padding:14px 28px;background:#050507;color:#c4c9d4;font-weight:900;font-size:13px;border-radius:10px;text-decoration:none;letter-spacing:.06em;border:1px solid #c4c9d4">☎ +351 938 070 495</a>
        <div style="margin-top:24px">
          <button id="evtBtnTentarNovamente" type="button"
            style="background:transparent;border:none;color:#8b95a2;font-family:inherit;font-size:11.5px;text-decoration:underline;cursor:pointer;letter-spacing:.05em">Voltar a procurar motorista</button>
        </div>
      </div>
    `;
    document.getElementById('evtBtnTentarNovamente')?.addEventListener('click', () => {
      _evtPollTentativas = 0;
      _evtMostrarEcraProcurandoMotorista({ tripId: _evtTripId });
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // CARTÃO DO MOTORISTA + MAPA EM TEMPO REAL
  // Reutiliza o padrão do minha-conta.html: cartão superior + mapa
  // Leaflet abaixo com pin do motorista que se move em tempo real.
  // Auto-contido — não depende de nada do dashboard principal.
  // ═════════════════════════════════════════════════════════════════
  function _evtMostrarMotorista(m) {
    // Cancelar polling — a partir daqui é tudo tempo real via socket
    if (_evtPollTimer) { clearTimeout(_evtPollTimer); _evtPollTimer = null; }

    const ov = document.getElementById('evtProntoOverlay');
    if (!ov) return;

    // Comentários (por agora exemplos; virão da BD numa fase seguinte)
    const _coment = Array.isArray(m.comentarios) && m.comentarios.length
      ? m.comentarios
      : [
          { estrelas: 5, texto: 'Muito pontual e simpático. Carro impecável.', autor: 'Maria S.' },
          { estrelas: 5, texto: 'Condução segura, recomendo bastante.', autor: 'João P.' },
        ];
    const _nomeCompleto = escapeHtml(m.nome || 'Motorista');
    const _rating = (Number(m.rating) || 5).toFixed(1);
    const _fotoBg = m.foto ? `url('${escapeHtml(m.foto)}') center/cover no-repeat` : '#141414';

    ov.style.padding = '0';
    ov.style.alignItems = 'stretch';
    ov.style.justifyContent = 'stretch';

    ov.innerHTML = `
      <div id="evtMotoristaWrap" style="display:flex;flex-direction:column;width:100%;height:100%;background:#000">

        <!-- CARTÃO -->
        <div id="evtMotoristaCard" style="background:#000;padding:16px 18px;display:flex;flex-direction:column;border-bottom:1px solid #333;color:#fff;box-sizing:border-box">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div style="font-size:10px;font-weight:900;letter-spacing:.28em;color:#c0c0c0">REALMETROPOLIS</div>
            <div id="evtMotoristaEta" style="font-size:10px;font-weight:900;letter-spacing:.08em;color:#000;background:#c0c0c0;border-radius:999px;padding:5px 12px">A caminho</div>
          </div>

          <!-- Estado FECHADO: foto + dados empilhados -->
          <div id="evtBlocoFechado">
            <div style="display:flex;gap:14px;align-items:flex-start">
              <div style="flex-shrink:0">
                <div id="evtFotoPequena" style="width:64px;height:64px;border-radius:50%;background:${_fotoBg};border:1px solid #666;display:flex;align-items:center;justify-content:center;color:#808080;cursor:pointer;position:relative">
                  ${m.foto ? '' : '<i class="ti ti-user" style="font-size:30px"></i>'}
                  <div style="position:absolute;bottom:-2px;right:-2px;width:20px;height:20px;border-radius:50%;background:#000;border:1px solid #c0c0c0;display:flex;align-items:center;justify-content:center;color:#c0c0c0"><i class="ti ti-zoom-in" style="font-size:11px"></i></div>
                </div>
              </div>
              <div style="flex:1;min-width:0;padding-top:2px;display:flex;flex-direction:column;gap:10px">
                <div>
                  <div style="font-size:8.5px;color:#808080;letter-spacing:.14em;margin-bottom:2px">CARRO</div>
                  <div style="font-size:14px;font-weight:900;color:#f4f4f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.veiculo || '—')}</div>
                </div>
                <div>
                  <div style="font-size:8.5px;color:#808080;letter-spacing:.14em;margin-bottom:2px">COR</div>
                  <div style="font-size:14px;font-weight:900;color:#f4f4f4">${escapeHtml(m.cor || '—')}</div>
                </div>
                <div>
                  <div style="font-size:8.5px;color:#808080;letter-spacing:.14em;margin-bottom:2px">MATRÍCULA</div>
                  <div style="font-size:15px;font-weight:900;color:#f4f4f4;letter-spacing:.08em">${escapeHtml(m.matricula || '—')}</div>
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:11px;border-top:1px solid #222">
              <div class="evt-nome-luz" style="font-size:14px;font-weight:900;color:#f4f4f4;white-space:nowrap">${_nomeCompleto}</div>
              <div id="evtAbrirComentarios" style="font-size:12px;color:#c0c0c0;cursor:pointer;white-space:nowrap">${_rating} <span style="color:#e8e8e8">★</span></div>
            </div>
          </div>

          <!-- Estado ABERTO: foto + nome + fechar, dados horizontais, comentários -->
          <div id="evtBlocoAberto" style="display:none">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
              <div id="evtFotoPequena2" style="width:52px;height:52px;border-radius:50%;background:${_fotoBg};border:1px solid #666;display:flex;align-items:center;justify-content:center;color:#808080;flex-shrink:0;cursor:pointer">${m.foto ? '' : '<i class="ti ti-user" style="font-size:24px"></i>'}</div>
              <div class="evt-nome-luz" style="font-size:14px;font-weight:900;color:#f4f4f4;white-space:nowrap;flex-shrink:0">${_nomeCompleto}</div>
              <button id="evtFecharComentarios" type="button" style="flex:1;padding:7px 8px;background:#141414;border:1px solid #333;color:#a0a0a0;font-family:inherit;font-weight:900;font-size:9.5px;letter-spacing:.03em;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap"><i class="ti ti-x" style="font-size:12px"></i>FECHAR</button>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:11px">
              <div style="min-width:0">
                <div style="font-size:8px;color:#808080;letter-spacing:.1em">CARRO</div>
                <div style="font-size:12px;font-weight:900;color:#f4f4f4;white-space:nowrap">${escapeHtml(m.veiculo || '—')}</div>
              </div>
              <div>
                <div style="font-size:8px;color:#808080;letter-spacing:.1em">COR</div>
                <div style="font-size:12px;font-weight:900;color:#f4f4f4">${escapeHtml(m.cor || '—')}</div>
              </div>
              <div>
                <div style="font-size:8px;color:#808080;letter-spacing:.1em">MATRÍCULA</div>
                <div style="font-size:12px;font-weight:900;color:#f4f4f4;letter-spacing:.05em;white-space:nowrap">${escapeHtml(m.matricula || '—')}</div>
              </div>
            </div>
            <div style="border-top:1px solid #222;padding-top:11px">
              <div id="evtComentCarrossel" style="display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch">
                ${_coment.map(c => `
                  <div style="flex:0 0 calc(50% - 4px);scroll-snap-align:start;background:#0f0f0f;border-radius:10px;padding:10px 11px;box-sizing:border-box">
                    <div style="font-size:11px;color:#f0b429;margin-bottom:4px">${'★'.repeat(Math.round(c.estrelas||5))}</div>
                    <div style="font-size:10.5px;color:#b0b0b0;line-height:1.4">${escapeHtml(c.texto||'')}</div>
                    <div style="font-size:8.5px;color:#666;margin-top:5px">${escapeHtml(c.autor||'')}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- MAPA -->
        <div style="flex:1;position:relative;background:#0a0a0a;min-height:0">
          <div id="evtMotoristaMap" style="position:absolute;inset:0;background:#0a0b0d"></div>
          <button id="evtBtnEmergencia" type="button" aria-label="Emergência" style="position:absolute;top:14px;right:14px;z-index:500;width:48px;height:48px;border-radius:50%;background:#000;border:1.5px solid #c0c0c0;display:flex;align-items:center;justify-content:center;color:#c0c0c0;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.5)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c0c0c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </button>

          <!-- Foto ampliada (queda diagonal + fade) -->
          <div id="evtFotoBackdrop" style="position:absolute;inset:0;z-index:600;background:rgba(0,0,0,0);display:none;align-items:center;justify-content:center;cursor:pointer;transition:background .35s ease">
            <div id="evtFotoGrande" style="width:220px;height:220px;border-radius:50%;border:3px solid #c0c0c0;background:${_fotoBg};display:flex;align-items:center;justify-content:center;color:#808080;transform:translate(-90px,-150px) scale(.3) rotate(-12deg);opacity:0;transition:transform .5s cubic-bezier(.22,1,.36,1),opacity .45s ease">${m.foto ? '' : '<i class="ti ti-user" style="font-size:96px"></i>'}</div>
            <div id="evtFotoHint" style="position:absolute;bottom:26px;left:0;right:0;text-align:center;color:#c0c0c0;font-size:11px;letter-spacing:.04em;opacity:0;transition:opacity .3s ease .3s">Toca em qualquer lugar para fechar</div>
          </div>
        </div>

        <!-- RODAPÉ -->
        <div style="display:flex;gap:10px;padding:14px;background:#000;border-top:1px solid #333">
          <button id="evtBtnMensagem" type="button" style="flex:1;text-align:center;padding:13px;background:#141414;border:1px solid #333;color:#f4f4f4;font-family:inherit;font-weight:900;font-size:13px;border-radius:12px;cursor:pointer"><i class="ti ti-message" style="font-size:16px;vertical-align:-3px;margin-right:6px"></i>Mensagem</button>
          <button id="evtBtnEstouAqui" type="button" style="flex:1;text-align:center;padding:13px;background:#c0c0c0;border:none;color:#000;font-family:inherit;font-weight:900;font-size:13px;border-radius:12px;cursor:pointer"><i class="ti ti-camera" style="font-size:16px;vertical-align:-3px;margin-right:6px"></i>Estou aqui</button>
        </div>

      </div>
    `;

    // ── Interações ──
    // Abrir/fechar comentários
    const _abrir = document.getElementById('evtAbrirComentarios');
    const _fechar = document.getElementById('evtFecharComentarios');
    const _blocoF = document.getElementById('evtBlocoFechado');
    const _blocoA = document.getElementById('evtBlocoAberto');
    if (_abrir) _abrir.addEventListener('click', () => {
      if (_blocoF) _blocoF.style.display = 'none';
      if (_blocoA) _blocoA.style.display = 'block';
    });
    if (_fechar) _fechar.addEventListener('click', () => {
      if (_blocoA) _blocoA.style.display = 'none';
      if (_blocoF) _blocoF.style.display = 'block';
    });

    // Foto amplia com queda diagonal
    const _back = document.getElementById('evtFotoBackdrop');
    function _abrirFoto(e) {
      if (e) e.stopPropagation();
      if (!_back) return;
      _back.style.display = 'flex';
      requestAnimationFrame(() => requestAnimationFrame(() => _back.classList.add('on')));
    }
    function _fecharFoto() {
      if (!_back) return;
      _back.classList.remove('on');
      setTimeout(() => { _back.style.display = 'none'; }, 500);
    }
    const _fp1 = document.getElementById('evtFotoPequena');
    const _fp2 = document.getElementById('evtFotoPequena2');
    if (_fp1) _fp1.addEventListener('click', _abrirFoto);
    if (_fp2) _fp2.addEventListener('click', _abrirFoto);
    if (_back) _back.addEventListener('click', _fecharFoto);

    // Botões (lógica câmara/mensagem/emergência fica para a próxima fase)
    const _btnEmerg = document.getElementById('evtBtnEmergencia');
    if (_btnEmerg) _btnEmerg.addEventListener('click', () => {
      if (m.contacto) location.href = 'tel:' + String(m.contacto).replace(/[^0-9+]/g, '');
    });
    const _btnMsg = document.getElementById('evtBtnMensagem');
    if (_btnMsg) _btnMsg.addEventListener('click', () => showToast('Mensagem ao motorista — disponível em breve.'));
    const _btnAqui = document.getElementById('evtBtnEstouAqui');
    if (_btnAqui) _btnAqui.addEventListener('click', () => showToast('Enviar foto ao motorista — disponível em breve.'));

    _evtCarregarLeaflet()
      .then(() => _evtIniciarMapaMotorista(m))
      .catch(err => {
        console.warn('[evt] Leaflet falhou:', err?.message);
        const mapEl = document.getElementById('evtMotoristaMap');
        if (mapEl) mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6874;font-size:12px;padding:20px;text-align:center">Não foi possível carregar o mapa.<br>O seu motorista está a caminho.</div>';
      });

    _evtLigarSocketMotorista();
  }

  function _evtEstrelas(r) {
    const n = Math.round(Number(r) || 0);
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  // Carrega Leaflet (CSS + JS) sob demanda. Cache no window para não
  // recarregar. Se falhar, o chamador mostra fallback graceful.
  function _evtCarregarLeaflet() {
    if (window.L?.map) return Promise.resolve();
    if (window._evtLeafletPromise) return window._evtLeafletPromise;
    window._evtLeafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);

      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.async = true;
      s.onload = () => window.L?.map ? resolve() : reject(new Error('Leaflet não expôs L'));
      s.onerror = () => reject(new Error('Falha a carregar Leaflet'));
      document.head.appendChild(s);
    });
    return window._evtLeafletPromise;
  }

  function _evtIniciarMapaMotorista(m) {
    const mapEl = document.getElementById('evtMotoristaMap');
    if (!mapEl || !window.L) return;

    // Coordenadas iniciais: motorista se já sabemos, senão partida
    const partida = _evtInviteInfo.partida;
    const centro = (m.lat && m.lng)
      ? [m.lat, m.lng]
      : (partida?.lat ? [partida.lat, partida.lng] : [38.7223, -9.1393]);   // Lisboa como fallback

    _evtLeafletMap = window.L.map(mapEl, {
      zoomControl: true,
      attributionControl: false,
    }).setView(centro, 15);

    // Tile layer escuro (Carto Dark Matter) — coerente com paleta preto/prata
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(_evtLeafletMap);

    // Marcador da partida (para o convidado ver onde é a recolha)
    if (partida?.lat) {
      window.L.marker([partida.lat, partida.lng], {
        icon: window.L.divIcon({
          className: 'evt-marker-pickup',
          html: '<div style="width:14px;height:14px;background:#c4c9d4;border:2px solid #050507;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.6)"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        title: 'Local de recolha',
      }).addTo(_evtLeafletMap);
    }

    // Marcador do motorista (se já temos posição)
    if (m.lat && m.lng) {
      _evtLeafletMarker = window.L.marker([m.lat, m.lng], {
        icon: window.L.divIcon({
          className: 'evt-marker-driver',
          html: '<div style="width:34px;height:34px;background:rgba(0,0,0,.55);border:2px solid #c0c0c0;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.6)"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16 L4 21 Z" fill="#e8e8e8"/></svg></div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      }).addTo(_evtLeafletMap);
    }

    // Ajustar bounds se temos ambos os pontos
    if (partida?.lat && m.lat && m.lng) {
      const bounds = window.L.latLngBounds([[partida.lat, partida.lng], [m.lat, m.lng]]);
      _evtLeafletMap.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  // Liga socket ao mesmo Socket.io que o dashboard já usa, entra na
  // "sala" da Trip e escuta driver_location. Reconexão automática
  // via lógica interna do Socket.io.
  function _evtLigarSocketMotorista() {
    if (!_evtTripId || typeof io === 'undefined') return;
    try {
      if (_evtSocket) {
        _evtSocket.emit('trip_join', { tripId: _evtTripId });
        return;
      }
      _evtSocket = io({ transports: ['websocket', 'polling'] });

      _evtSocket.on('connect', () => {
        _evtSocket.emit('trip_join', { tripId: _evtTripId });
      });

      _evtSocket.on('driver_location', (d) => {
        if (!d || d.lat == null || d.lng == null) return;
        if (!_evtLeafletMap || !window.L) return;

        if (!_evtLeafletMarker) {
          _evtLeafletMarker = window.L.marker([d.lat, d.lng], {
            icon: window.L.divIcon({
              className: 'evt-marker-driver',
              html: '<div style="width:34px;height:34px;background:rgba(0,0,0,.55);border:2px solid #c0c0c0;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.6)"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16 L4 21 Z" fill="#e8e8e8"/></svg></div>',
              iconSize: [34, 34],
              iconAnchor: [17, 17],
            }),
          }).addTo(_evtLeafletMap);
        } else {
          _evtLeafletMarker.setLatLng([d.lat, d.lng]);
        }
        // Rodar a seta na direção do movimento (heading em graus)
        if (d.heading != null) {
          const _el = _evtLeafletMarker.getElement && _evtLeafletMarker.getElement();
          const _svg = _el && _el.querySelector('svg');
          if (_svg) _svg.style.transform = 'rotate(' + Number(d.heading) + 'deg)';
        }
        _evtLeafletMap.panTo([d.lat, d.lng]);

        // Atualizar ETA se veio
        if (d.eta) {
          const etaEl = document.getElementById('evtMotoristaEta');
          if (etaEl) etaEl.textContent = String(d.eta);
        }
      });

      // Se algum evento diz que o motorista chegou ao passageiro
      _evtSocket.on('trip_arrived', () => {
        const etaEl = document.getElementById('evtMotoristaEta');
        if (etaEl) {
          etaEl.textContent = '🚗 CHEGOU';
          etaEl.style.background = '#1cd68e';
          etaEl.style.color = '#04140e';
          etaEl.style.borderColor = '#1cd68e';
        }
      });
    } catch (err) {
      console.warn('[evt/socket] falha:', err?.message);
      // Sem socket, continuamos com o cartão estático (não trava UX)
    }
  }

  function _mostrarBarraDestinoEvento() {
    let bar = document.getElementById('evtDestinoBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'evtDestinoBar';
      bar.style.cssText = 'position:fixed;top:25vh;left:50%;transform:translate(-50%,-50%);z-index:5000;display:flex;flex-direction:column;gap:10px;background:rgba(10,11,13,.94);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.5);width:min(720px,94vw)';
      document.body.appendChild(bar);
    }
    const sug = _evtInviteInfo.destinoSugerido;
    bar.innerHTML = `
      ${sug ? `
        <div>
          <div style="font-size:9px;color:#8b95a2;font-weight:800;letter-spacing:.08em;margin-bottom:4px;text-transform:uppercase">Nosso endereço (sugerido)</div>
          <button id="evtBtnSugerido" type="button"
            style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(28,214,142,.4);background:rgba(28,214,142,.09);color:#1cd68e;font-family:inherit;font-weight:800;font-size:13px;text-align:left;cursor:pointer;line-height:1.35">
            📍 Ir para: ${escapeHtml(sug.address)}
          </button>
        </div>
        <div style="font-size:10px;color:#8b95a2;text-align:center;margin:-2px 0">— OU —</div>
      ` : ''}
      <div style="display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1;min-width:0">
          <label style="display:block;font-size:9px;color:#8b95a2;font-weight:800;letter-spacing:.08em;margin-bottom:2px;text-transform:uppercase">Partida</label>
          <input id="evtPartidaInput" type="text" readonly
            style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);color:#8b95a2;font-size:12.5px;outline:none;cursor:not-allowed" />
        </div>
        <div style="position:relative;flex:1;min-width:0">
          <label style="display:block;font-size:9px;color:#8b95a2;font-weight:800;letter-spacing:.08em;margin-bottom:2px;text-transform:uppercase">${sug ? 'Ou escreva outro' : 'Para onde vai?'}</label>
          <input id="evtDestinoInput" type="text" placeholder="${sug ? 'Escreva um destino diferente' : 'Escreva o seu destino'}"
            style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;font-size:12.5px;outline:none" />
          <div id="evtDestinoDropdown" class="nm-dropdown" style="position:absolute;top:100%;left:0;right:0;margin-top:4px"></div>
        </div>
        <button id="evtDestinoAdd" style="padding:0 18px;height:38px;margin-top:14px;border-radius:10px;border:none;background:#c4c9d4;color:#04140e;font-weight:900;font-size:11.5px;letter-spacing:.04em;cursor:pointer">CONFIRMAR</button>
      </div>
    `;

    // Pré-preencher partida
    const partidaInp = document.getElementById('evtPartidaInput');
    if (partidaInp) partidaInp.value = _evtInviteInfo.partida?.address || '';

    // Autocomplete no input livre
    const inp  = document.getElementById('evtDestinoInput');
    const drop = document.getElementById('evtDestinoDropdown');
    if (typeof bindNmAutocomplete === 'function') {
      bindNmAutocomplete(inp, drop, place => {
        inp.value = place.address || inp.value;
        inp.dataset.lat = place.lat;
        inp.dataset.lng = place.lng;
      });
    }

    document.getElementById('evtDestinoAdd').addEventListener('click', _evtAdicionarDestino);

    // Se há sugestão, clique no botão dispara popup de confirmação
    const btnSug = document.getElementById('evtBtnSugerido');
    if (btnSug) {
      btnSug.addEventListener('click', () => _evtConfirmarSugerido(sug));
    }

    bar.style.display = 'flex';
  }

  // Popup: "Seguir para XXXXX?" — confirmação antes de gravar o destino
  // sugerido. Se cancelar, volta à barra e pode escrever outro.
  function _evtConfirmarSugerido(sug) {
    let ov = document.getElementById('evtSugPopup');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'evtSugPopup';
      ov.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div style="background:#14171c;border:1px solid rgba(28,214,142,.35);border-radius:16px;padding:22px 24px;width:min(360px,94vw);color:#fff;font-family:Inter,Arial,system-ui,sans-serif;text-align:center">
        <div style="font-size:34px;margin-bottom:8px">📍</div>
        <div style="font-size:14px;color:#c9cdd4;margin-bottom:6px">Seguir para</div>
        <div style="font-size:16px;font-weight:900;color:#fff;margin-bottom:20px;line-height:1.35">${escapeHtml(sug.address)}?</div>
        <div style="display:flex;gap:8px">
          <button id="evtSugVoltar" style="flex:1;padding:11px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#cdd2da;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit">VOLTAR</button>
          <button id="evtSugConfirmar" style="flex:1;padding:11px;border-radius:10px;border:none;background:#1cd68e;color:#04140e;font-weight:900;font-size:12px;cursor:pointer;font-family:inherit">SIM, CONFIRMO</button>
        </div>
      </div>
    `;
    ov.style.display = 'flex';

    document.getElementById('evtSugVoltar').addEventListener('click', () => { ov.style.display = 'none'; });
    document.getElementById('evtSugConfirmar').addEventListener('click', async () => {
      ov.style.display = 'none';
      // Preencher input com o sugerido e disparar o fluxo normal
      // (assim reaproveitamos toda a lógica de gravar destino + rota)
      const inp = document.getElementById('evtDestinoInput');
      if (inp) {
        inp.value = sug.address;
        inp.dataset.lat = sug.lat;
        inp.dataset.lng = sug.lng;
      }
      _evtAdicionarDestino();
    });
  }

  async function _evtAdicionarDestino() {
    const inp = document.getElementById('evtDestinoInput');
    const destinoTxt = (inp?.value || '').trim();
    if (!destinoTxt) { showToast('Escreva o seu destino.'); return; }
    let lat = Number(inp.dataset.lat), lng = Number(inp.dataset.lng);
    if (!lat || !lng) {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destinoTxt)}&format=json&limit=1&accept-language=pt`, { headers: { 'User-Agent': 'RealMetropolis/1.0' } });
        const arr = await r.json();
        if (!arr?.[0]) { showToast('Endereço não encontrado. Escolha uma sugestão da lista.'); return; }
        lat = Number(arr[0].lat); lng = Number(arr[0].lon);
      } catch { showToast('Erro ao localizar destino.'); return; }
    }

    let destinoRes;
    try {
      destinoRes = await fetchJson(url('/partilha/evento/definir-destino'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: _evtInviteInfo.token,
          inviteId: _evtInviteInfo.inviteId,
          destino: { address: destinoTxt, lat, lng },
        })
      });
    } catch (err) {
      showToast('Falha ao gravar destino: ' + (err.message || ''));
      return;
    }

    _evtInviteInfo.destino     = { address: destinoTxt, lat, lng };
    _evtInviteInfo.valor       = Number(destinoRes?.preco || 0);
    _evtInviteInfo.distanciaKm = Number(destinoRes?.distanciaKm || 0);
    document.getElementById('evtDestinoBar').style.display = 'none';

    // Desenhar rota partida → destino
    const p = _evtInviteInfo.partida;
    await _desenharRotaEvento(p.lat, p.lng, lat, lng);

    // 3 segundos para o convidado ver a rota, e só depois o popup
    setTimeout(_evtMostrarCartaoBilhete, 3000);
  }

  async function _desenharRotaEvento(oLat, oLng, dLat, dLng) {
    if (typeof map === 'undefined' || typeof google === 'undefined') return;
    try {
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`);
      const d = await r.json();
      if (d.code !== 'Ok' || !d.routes?.length) return;
      const pontos = d.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
      if (window._evtPolyline) { try { window._evtPolyline.setMap(null); } catch (_) {} }
      window._evtPolyline = new google.maps.Polyline({
        path: pontos, map, strokeColor: '#1fc97d', strokeWeight: 4, strokeOpacity: .85,
      });
      new google.maps.Marker({
        position: { lat: dLat, lng: dLng }, map, title: 'Meu destino',
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#1fc97d', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
      const bounds = new google.maps.LatLngBounds();
      pontos.forEach(p => bounds.extend(p));
      map.fitBounds(bounds, { top: 80, bottom: 220, left: 40, right: 40 });
      _evtInviteInfo.distanciaKm = d.routes[0].distance / 1000;
      _evtInviteInfo.duracaoMin  = Math.round(d.routes[0].duration / 60);
    } catch (_) {}
  }

  // Popup de resumo do bilhete — layout dedicado do modo Evento,
  // não reutiliza #conviteOverlay porque a estrutura pedida é
  // diferente (mais campos: Nome, Contacto, Partida, Destino,
  // Data/Hora, Kms, Tempo, Valor). Fica lado-a-lado (kms/tempo/valor
  // numa só linha inferior) para o formato ser compacto.
  function _evtMostrarCartaoBilhete() {
    const info = _evtInviteInfo;
    const dt = info.scheduledAt
      ? new Date(info.scheduledAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

    // Contacto: vem no JWT do convite (o backend colocou-o no payload
    // do JWT como `contacto`), mas o _evtInviteInfo não guardou. Vou
    // extraí-lo do próprio token (decodificação simples do payload
    // JWT — não requer verificação de assinatura porque só estamos a
    // ler dados que o convidado já pode ver).
    let contacto = info.contacto || '';
    if (!contacto && info.token) {
      try {
        const payload = JSON.parse(atob(info.token.split('.')[1]));
        contacto = payload?.contacto || '';
      } catch (_) {}
    }

    let ov = document.getElementById('evtBilhetePopup');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'evtBilhetePopup';
      ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div style="background:linear-gradient(180deg,rgba(22,25,31,.98),rgba(10,11,14,.99));border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:22px 24px;width:min(400px,94vw);color:#fff;font-family:Inter,Arial,system-ui,sans-serif;box-shadow:0 30px 70px rgba(0,0,0,.6)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:10px;font-weight:800;letter-spacing:.14em;color:#c4c9d4;text-transform:uppercase">🎫 O seu bilhete</div>
          ${info.categoria ? `<div style="font-size:9.5px;font-weight:900;letter-spacing:.06em;color:#050507;background:#c4c9d4;border-radius:999px;padding:3px 10px;text-transform:uppercase">${escapeHtml(_evtNomeCategoria(info.categoria))}</div>` : ''}
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
          ${_evtLinha('Nome',    info.nome)}
          ${_evtLinha('Contacto', contacto || '—')}
          ${_evtLinha('Partida', info.partida?.address || '—')}
          ${_evtLinha('Destino', info.destino?.address || '—')}
          ${_evtLinha('Data e Hora', dt)}
        </div>

        <div style="display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)">
          <div style="flex:1;background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px">
            <div style="font-size:9px;color:#8b95a2;font-weight:700;letter-spacing:.08em;margin-bottom:2px">KMS</div>
            <div style="font-size:13px;font-weight:900">${info.distanciaKm ? info.distanciaKm.toFixed(1) : '—'}</div>
          </div>
          <div style="flex:1;background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px">
            <div style="font-size:9px;color:#8b95a2;font-weight:700;letter-spacing:.08em;margin-bottom:2px">TEMPO</div>
            <div style="font-size:13px;font-weight:900">${info.duracaoMin ? '~' + info.duracaoMin + ' min' : '—'}</div>
          </div>
          <div style="flex:1;background:rgba(28,214,142,.08);border:1px solid rgba(28,214,142,.25);border-radius:10px;padding:8px 10px">
            <div style="font-size:9px;color:#1cd68e;font-weight:700;letter-spacing:.08em;margin-bottom:2px">VALOR</div>
            <div style="font-size:13px;font-weight:900;color:#1cd68e">€${Number(info.valor || 0).toFixed(2)}</div>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button id="evtBtnCancelar" style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,80,80,.35);background:rgba(255,80,80,.06);color:#ff9b9b;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit">CANCELAR</button>
          <button id="evtBtnPagar" style="flex:2;padding:12px;border-radius:10px;border:none;background:#1cd68e;color:#04140e;font-weight:900;font-size:12.5px;letter-spacing:.03em;cursor:pointer;font-family:inherit">PAGAR</button>
        </div>
      </div>
    `;
    ov.style.display = 'flex';

    document.getElementById('evtBtnPagar').addEventListener('click', _evtIniciarPagamento);
    document.getElementById('evtBtnCancelar').addEventListener('click', _evtConfirmarCancelamento);
  }

  function _evtLinha(label, valor) {
    return `
      <div>
        <div style="font-size:9px;color:#8b95a2;font-weight:700;letter-spacing:.08em;margin-bottom:2px;text-transform:uppercase">${label}</div>
        <div style="font-size:13px;font-weight:800;color:#fff;line-height:1.3">${escapeHtml(valor || '—')}</div>
      </div>`;
  }

  // Mapa das categorias — mesmas chaves que o resto do sistema usa
  // no Veiculo/despacho. Se surgir uma categoria nova no futuro,
  // basta acrescentar aqui.
  function _evtNomeCategoria(cat) {
    const m = {
      economica: 'Económica',
      confort:   'Confort',
      executive: 'Executive',
      luxury:    'Luxury',
      grupo6:    'Grupo 6',
      grupo8:    'Grupo 8',
      grupo17:   'Grupo 17',
    };
    return m[String(cat || '').toLowerCase()] || String(cat || '').toUpperCase();
  }

  // Popup de confirmação — cancelar é IRREVERSÍVEL (o backend marca
  // o convite como cancelado; o convidado perde o direito à viagem).
  function _evtConfirmarCancelamento() {
    let ov = document.getElementById('evtCancelPopup');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'evtCancelPopup';
      ov.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div style="background:#14171c;border:1px solid rgba(255,80,80,.35);border-radius:16px;padding:22px 24px;width:min(360px,94vw);color:#fff;font-family:Inter,Arial,system-ui,sans-serif;text-align:center">
        <div style="font-size:34px;margin-bottom:8px">⚠️</div>
        <div style="font-size:15px;font-weight:900;margin-bottom:8px">Cancelar bilhete?</div>
        <div style="font-size:12.5px;color:#c9cdd4;line-height:1.5;margin-bottom:18px">
          Esta ação é <b style="color:#ff9b9b">irreversível</b>.<br>
          Ao cancelar, o seu bilhete será anulado e perderá o direito à viagem. Se pretender viajar terá de pedir um novo convite ao organizador.
        </div>
        <div style="display:flex;gap:8px">
          <button id="evtCancelVoltar" style="flex:1;padding:11px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#cdd2da;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit">VOLTAR</button>
          <button id="evtCancelConfirmar" style="flex:1;padding:11px;border-radius:10px;border:none;background:#ff5a5a;color:#fff;font-weight:900;font-size:12px;cursor:pointer;font-family:inherit">SIM, CANCELAR</button>
        </div>
      </div>
    `;
    ov.style.display = 'flex';

    document.getElementById('evtCancelVoltar').addEventListener('click', () => { ov.style.display = 'none'; });
    document.getElementById('evtCancelConfirmar').addEventListener('click', async () => {
      // Fechar todos os overlays e sinalizar cancelamento. A rota
      // backend de cancelamento pode ainda não existir — nesse caso
      // reportamos o motivo mas fechamos o UI na mesma (o convidado
      // não deve ficar preso a olhar para o cartão que já rejeitou).
      try {
        await fetchJson(url('/partilha/evento/cancelar'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: _evtInviteInfo.token, inviteId: _evtInviteInfo.inviteId })
        });
      } catch (err) {
        // Se a rota ainda não existir (404), o cancelamento é local
        // — o convidado apenas fecha; o organizador poderá reenviar.
        console.warn('[evento] cancelar (backend não disponível):', err?.message);
      }
      ov.style.display = 'none';
      const bilhete = document.getElementById('evtBilhetePopup');
      if (bilhete) bilhete.style.display = 'none';
      showToast('Bilhete cancelado.');
    });
  }

  async function _evtIniciarPagamento() {
    const info = _evtInviteInfo;
    if (typeof _rmPag === 'undefined' || typeof _rmPag.abrir !== 'function') {
      showToast('Módulo de pagamento indisponível.');
      return;
    }

    // Esconder o cartão do bilhete — senão o modal de pagamento
    // fica por trás, cria efeito visual estranho.
    const bilhete = document.getElementById('evtBilhetePopup');
    if (bilhete) bilhete.style.display = 'none';

    // Hook que corre APÓS o Stripe/PayPal aprovar — chama a rota
    // /evento/confirmar-pagamento, que despacha a viagem e notifica
    // o organizador via socket. Sem este hook o pagamento passava
    // mas a reserva ficava presa em "aguarda pagamento".
    window._rmEvtOnPaymentOk = async (provider, ref) => {
      try {
        await fetchJson(url('/partilha/evento/confirmar-pagamento'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token:    info.token,
            inviteId: info.inviteId,
            provider,
            ref,
          })
        });
        showToast('✅ Pagamento confirmado. Vai receber um SMS/email — toque no link lá quando estiver pronto para chamarmos o seu motorista.', 6000);
      } catch (err) {
        showToast('Pagamento cobrado mas confirmação falhou: ' + (err.message || ''));
      }
    };

    _rmPag.abrir({
      codigo:         info.inviteId,
      nome:           info.nome,
      emailPassageiro: '',
      partida:        info.partida?.address || '',
      destino:        info.destino?.address || '',
      datahora:       info.scheduledAt,
      categoria:      _evtNomeCategoria(info.categoria),
      km:             info.distanciaKm || 0,
      portagens:      0,
      valor:          info.valor || 0,
    });
  }

  async function calcularValorImediato() {
    if (!shareSessionToken) return;
    try {
      await fetchJson(url('/partilha/invite/calcular-meu-valor'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: shareSessionToken })
      });
    } catch (_) { /* segue para o polling normal de qualquer forma */ }
    consultarValorConvidado();
    if (_valorConvidadoTimer) clearInterval(_valorConvidadoTimer);
    _valorConvidadoTimer = setInterval(consultarValorConvidado, 8000);
  }

  let _valorConvidadoTimer = null;
  let _valorConvidadoAtual = null;
  let _conviteDestinoGeo = null;
  let _conviteRecolhaGeo = null;
  let _rotaConvidadoJaMostrada = false;
  let _podeMostrarPagamentoConvidado = false;

  async function consultarValorConvidado() {
    if (!shareSessionToken) return;
    try {
      const data = await fetchJson(url('/partilha/invite/meu-valor'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: shareSessionToken })
      });
      const pagarWrap = el('convitePagarWrap');
      const valorEl   = el('convitePagarValor');
      if (!pagarWrap || !valorEl) return;

      if (data?.status === 'pagou') {
        if (_valorConvidadoTimer) { clearInterval(_valorConvidadoTimer); _valorConvidadoTimer = null; }
        pagarWrap.style.display = 'block';
        valorEl.textContent = '✅ Pago';
        el('btnConvitePagar')?.setAttribute('disabled', 'true');
        if (!_rotaConvidadoJaMostrada) {
          _rotaConvidadoJaMostrada = true;
          mostrarRotaConvidado();
        }
        return;
      }
      if (data?.amountDue) {
        _valorConvidadoAtual = Number(data.amountDue);
        if (!_podeMostrarPagamentoConvidado) return; // ainda dentro do atraso — não revelar já
        pagarWrap.style.display = 'block';
        valorEl.textContent = `€${_valorConvidadoAtual.toFixed(2)}`;
        el('btnConvitePagar')?.removeAttribute('disabled');
        if (_valorConvidadoTimer) { clearInterval(_valorConvidadoTimer); _valorConvidadoTimer = null; }
      } else if (_podeMostrarPagamentoConvidado) {
        pagarWrap.style.display = 'block';
        valorEl.textContent = 'A calcular…';
      }
    } catch (_) { /* silencioso — tenta novamente no próximo intervalo */ }
  }

  let _conviteStripe = null, _conviteStripeEls = null, _conviteStripeCard = null;

  async function abrirPagamentoConvidado() {
    if (!_valorConvidadoAtual) return;
    const modal = el('convitePagarModal');
    if (modal) modal.style.display = 'flex';

    if (!_conviteStripe) {
      try {
        const { publicKey } = await fetchJson(url('/reservas/stripe/public-key'));
        _conviteStripe = Stripe(publicKey);
        _conviteStripeEls = _conviteStripe.elements();
        _conviteStripeCard = _conviteStripeEls.create('card', {
          style: { base: { color: '#e8eaed', fontSize: '14px', '::placeholder': { color: '#555a64' } }, invalid: { color: '#ff6b6b' } }
        });
        _conviteStripeCard.mount('#convitePagarCardEl');
      } catch (err) {
        showToast('Erro ao iniciar pagamento: ' + (err.message || ''));
      }
    }
  }

  async function confirmarPagamentoConvidado() {
    const btn = el('btnConvitePagarConfirmar');
    if (btn) { btn.disabled = true; btn.textContent = 'A processar…'; }
    try {
      const { clientSecret } = await fetchJson(url('/reservas/stripe/criar-intent'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: _valorConvidadoAtual, descricao: `Partilha ${shareId} — parte do convidado` })
      });
      const { error, paymentIntent } = await _conviteStripe.confirmCardPayment(clientSecret, {
        payment_method: { card: _conviteStripeCard }
      });
      if (error) {
        // O motivo real (Stripe) era mostrado e, quase de imediato,
        // sobrescrito pela mensagem genérica de "tentativas restantes"
        // chamada a seguir — por isso só se via sempre essa última,
        // nunca o motivo real (fundos insuficientes, 3D Secure, etc).
        // Agora ambas são combinadas numa única mensagem.
        await reportarFalhaPagamentoConvidado(error.message);
        return;
      }
      if (paymentIntent.status === 'succeeded') {
        await fetchJson(url('/partilha/invite/confirmar-pagamento'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken: shareSessionToken, provider: 'stripe', ref: paymentIntent.id })
        });
        el('convitePagarModal').style.display = 'none';
        showToast(`✅ Pagamento confirmado! Valor pago: €${Number(_valorConvidadoAtual || 0).toFixed(2)}`, 4500);
        consultarValorConvidado();
        _rotaConvidadoJaMostrada = true;
        mostrarRotaConvidado();
        // O cartão do convite (destino/data/pagamento) já não é
        // necessário depois de pago — esconder por completo e deixar
        // só a rota visível no mapa, em vez de continuar a ocupar
        // espaço com informação já tratada.
        const overlay = el('conviteOverlay');
        if (overlay) overlay.style.display = 'none';
      }
    } catch (err) {
      await reportarFalhaPagamentoConvidado(err.message || 'Erro ao processar pagamento.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'PAGAR'; }
    }
  }

  // Depois de o pagamento do convidado ser confirmado, mostra de
// imediato a rota desta pessoa — desde onde ele vai ser recolhido
// até ao destino da viagem partilhada. Substitui o pequeno popup
// "✅ Pago" (que ficava sem mostrar mais nada) por um mapa real.
let _conviteMarkerOrigem = null;
let _conviteMarkerDestino = null;

async function mostrarRotaConvidado() {
  if (!_conviteDestinoGeo) {
    showToast('Não há coordenadas suficientes para desenhar a rota ainda.');
    return null;
  }

  // Ponto de partida deste convidado: a sua localização actual, se
  // disponível; senão, o ponto de recolha geral da partilha.
  let origem = _conviteRecolhaGeo;
  try {
    if (navigator.geolocation) {
      origem = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(_conviteRecolhaGeo),
          { enableHighAccuracy: true, timeout: 6000 }
        );
      });
    }
  } catch (_) { /* mantém o fallback */ }

  if (!origem) {
    showToast('Não foi possível determinar o ponto de partida para a rota.');
    return;
  }

  const destino = _conviteDestinoGeo;

  try {
    const apiUrl = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Rota não encontrada.');

    const rota = data.routes[0];
    const pontos = rota.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));

    if (rotaPolyline) { try { rotaPolyline.setMap(null); } catch (_) {} rotaPolyline = null; }
    rotaPolyline = new google.maps.Polyline({ path: pontos, map, strokeColor: '#1cd68e', strokeWeight: 5, strokeOpacity: .9 });

    // Limpar marcadores de uma chamada anterior (este mapa é redesenhado
    // duas vezes — na aceitação do convite e de novo no pagamento — sem
    // isto, ficavam dois pares de marcadores sobrepostos no mapa).
    if (_conviteMarkerOrigem)  { try { _conviteMarkerOrigem.setMap(null); }  catch (_) {} }
    if (_conviteMarkerDestino) { try { _conviteMarkerDestino.setMap(null); } catch (_) {} }

    _conviteMarkerOrigem = new google.maps.Marker({
      position: origem, map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#fff', fillOpacity: 1, strokeColor: '#1cd68e', strokeWeight: 3 },
      title: 'A sua recolha',
    });
    _conviteMarkerDestino = new google.maps.Marker({
      position: destino, map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#1cd68e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
      title: 'Destino',
    });

    const bounds = new google.maps.LatLngBounds();
    pontos.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, { top: 60, bottom: 60, left: 40, right: 40 });

    const km = (rota.distance / 1000).toFixed(1);
    const min = Math.round(rota.duration / 60);
    return { km, min };
  } catch (err) {
    showToast('Não foi possível desenhar a rota (' + (err.message || 'erro') + ').');
    return null;
  }
}

async function reportarFalhaPagamentoConvidado(motivoReal) {
    try {
      const resp = await fetchJson(url('/partilha/invite/pagamento-falhou'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${shareSessionToken}` },
      });
      const motivo = motivoReal ? `${motivoReal} ` : '';
      if (resp?.definitivo) {
        showToast(`❌ ${motivo}Pagamento falhou 3 vezes. Saiu da partilha — contacte o organizador.`, 7000);
      } else if (resp?.tentativasRestantes != null) {
        showToast(`⚠️ ${motivo}Tem mais ${resp.tentativasRestantes} tentativa${resp.tentativasRestantes === 1 ? '' : 's'}.`, 6000);
      } else if (motivoReal) {
        showToast(`⚠️ ${motivoReal}`, 5000);
      }
    } catch (_) {
      // Mesmo que o registo da falha no backend falhe, mostrar pelo
      // menos o motivo real do Stripe — nunca deixar o utilizador
      // sem nenhuma explicação do que correu mal.
      if (motivoReal) showToast(`⚠️ ${motivoReal}`, 5000);
    }
  }

  async function sendInviteLocationOnce() {
    if (!shareSessionToken || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        await fetchJson(url('/partilha/location/update'), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${shareSessionToken}` },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        });
      } catch (_) {}
    });
  }
  function startInviteLocationUpdates() { stopInviteLocationUpdates(); sendInviteLocationOnce(); locationTimer = setInterval(sendInviteLocationOnce, 5000); }
  function stopInviteLocationUpdates()  { if (locationTimer) { clearInterval(locationTimer); locationTimer = null; } }

  /* ── ATIVIDADES ────────────────────────────────────────────── */

// ─────────────────────────────────────────────────────────────


/* ══ OVERLAY CONTACTOS — selecção múltipla centrada ══ */
async function _abrirOverlayContactos(slotIdx) {
  let ov = document.getElementById('ctcMultiOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ctcMultiOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(12px);opacity:0;transition:opacity .22s ease';
    ov.innerHTML = `
      <div style="width:min(420px,92vw);max-height:80vh;display:flex;flex-direction:column;background:var(--c2);border:1px solid var(--line-strong);border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.8);overflow:hidden">
        <div style="padding:18px 20px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex:0 0 auto">
          <div>
            <div style="font-size:14px;font-weight:900;color:#fff">&#x1F465; CONTACTOS</div>
            <div id="ctcMultiCount" style="font-size:10px;color:var(--silver-3);margin-top:2px">Seleccione um ou mais</div>
          </div>
          <button id="ctcMultiClose" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:transparent;color:var(--silver-3);font-size:14px;cursor:pointer">&#x2715;</button>
        </div>
        <div id="ctcMultiLista" style="overflow-y:auto;flex:1;padding:10px 12px"></div>
        <div style="padding:14px 16px;border-top:1px solid var(--line);flex:0 0 auto">
          <button id="ctcMultiAdicionar" style="width:100%;padding:13px;border-radius:13px;border:none;cursor:pointer;background:linear-gradient(180deg,#e0e4ea,#bec6d1);color:#07080a;font-weight:900;font-size:13px;letter-spacing:.06em;box-shadow:0 4px 16px rgba(0,0,0,.4);opacity:.4;pointer-events:none;transition:.15s ease">ADICIONAR</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) _fecharOverlayContactos(); });
    document.getElementById('ctcMultiClose').addEventListener('click', _fecharOverlayContactos);
  }

  ov.dataset.slot = String(slotIdx);
  ov.style.display = 'flex';
  requestAnimationFrame(() => { ov.style.opacity = '1'; });

  const lista  = document.getElementById('ctcMultiLista');
  const btnAdd = document.getElementById('ctcMultiAdicionar');
  const count  = document.getElementById('ctcMultiCount');
  const sel    = new Set();

  lista.innerHTML = '<div style="padding:20px;text-align:center;color:var(--silver-3);font-size:11px">A carregar...</div>';
  btnAdd.onclick = null;

  let contactos = [];
  try {
    const r = await fetch('/api/admin/parceiros/me/contactos', { credentials: 'include' });
    const d = await r.json().catch(() => ({}));
    contactos = r.ok && Array.isArray(d?.contactos) ? d.contactos : [];
  } catch (_) {}

  if (!contactos.length) {
    lista.innerHTML = '<div style="padding:24px;text-align:center;color:var(--silver-3);font-size:11px">Sem contactos guardados.<br>Adicione em MEUS CONTACTOS.</div>';
    return;
  }

  function render() {
    lista.innerHTML = contactos.map((c, i) =>
      `<div class="ctc-mi" data-ci="${i}" style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;margin-bottom:5px;cursor:pointer;transition:.12s;border:1px solid ${sel.has(i) ? 'rgba(31,201,125,.35)' : 'rgba(255,255,255,.06)'};background:${sel.has(i) ? 'rgba(31,201,125,.08)' : 'rgba(255,255,255,.025)'}">
        <div style="width:20px;height:20px;border-radius:6px;flex:0 0 auto;border:2px solid ${sel.has(i) ? '#1fc97d' : 'rgba(255,255,255,.2)'};background:${sel.has(i) ? '#1fc97d' : 'transparent'};display:flex;align-items:center;justify-content:center">${sel.has(i) ? '<span style="color:#000;font-size:11px;font-weight:900">&#x2713;</span>' : ''}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:#fff">${escapeHtml(c.nome)}</div>
          <div style="font-size:11px;color:var(--silver-3);margin-top:1px">${escapeHtml(c.tel)}</div>
        </div>
      </div>`
    ).join('');
    lista.querySelectorAll('.ctc-mi').forEach(el => {
      el.addEventListener('click', () => {
        const ci = Number(el.dataset.ci);
        sel.has(ci) ? sel.delete(ci) : sel.add(ci);
        render(); upd();
      });
    });
  }

  function upd() {
    const n = sel.size;
    count.textContent          = n ? `${n} seleccionado${n > 1 ? 's' : ''}` : 'Seleccione um ou mais';
    btnAdd.textContent         = n ? `ADICIONAR ${n} CONTACTO${n > 1 ? 'S' : ''}` : 'ADICIONAR';
    btnAdd.style.opacity       = n ? '1' : '.4';
    btnAdd.style.pointerEvents = n ? 'auto' : 'none';
  }

  btnAdd.onclick = async () => {
    const selecionados = [...sel].map(i => contactos[i]).filter(Boolean);
    if (!selecionados.length) return;

    // Garantir que há slots suficientes
    const total = Math.max(participantes.length, selecionados.length);
    if (total > participantes.length) buildShareCards(total);

    // Desactivar o botão durante o processamento para evitar duplo clique
    btnAdd.disabled = true;
    btnAdd.textContent = 'A ADICIONAR...';

    // Preencher a partir do slot 1 em SEQUÊNCIA — confirmarContacto() é
    // assíncrona (faz fetch ao backend); disparar todas em paralelo
    // (forEach sem await) causava uma corrida de concorrência: várias
    // chamadas simultâneas ao mesmo endpoint, todas a ler/escrever o
    // array partilhado `participantes` ao mesmo tempo, faziam com que
    // só uma (normalmente a primeira) ficasse efectivamente confirmada.
    for (let i = 0; i < selecionados.length; i++) {
      const c     = selecionados[i];
      const slotN = i + 1;
      const inp   = document.getElementById(`contact_${slotN}`);
      if (!inp) continue;
      inp.value = c.tel;
      await confirmarContacto(slotN);   // espera terminar antes do próximo
    }

    // Os cartões continuam confirmados internamente (participantes[]),
    // mas a apresentação mantém-se em pilha — não se expande para lista.
    // Navegar entre eles continua a ser feito com "PRÓXIMO"/"← ANTERIOR".
    setActiveShareCard(selecionados.length); // mostra o último inserido

    btnAdd.disabled = false;
    _fecharOverlayContactos();
  };

  render(); upd();
}

function bindShareInviteUI() {
  els.btnInviteVerify?.addEventListener('click', verifyInviteAccess);
  els.btnInviteClose?.addEventListener('click', () => closePopup(els.inviteVerifyPopup));
  document.getElementById('btnConvitePagar')?.addEventListener('click', abrirPagamentoConvidado);
  document.getElementById('btnConvitePagarConfirmar')?.addEventListener('click', confirmarPagamentoConvidado);

  // Cancelar participação — pede confirmação (irreversível) antes de
  // chamar o endpoint, com botão vermelho (confirma) e verde
  // (desiste/continua na viagem).
  document.getElementById('btnConviteCancelar')?.addEventListener('click', () => {
    const m = document.getElementById('conviteCancelarConfirmModal');
    if (m) m.style.display = 'flex';
  });
  document.getElementById('btnConfirmCancelarNao')?.addEventListener('click', () => {
    const m = document.getElementById('conviteCancelarConfirmModal');
    if (m) m.style.display = 'none';
  });
  document.getElementById('btnConfirmCancelarSim')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnConfirmCancelarSim');
    if (btn) { btn.disabled = true; btn.textContent = 'A cancelar…'; }
    try {
      await fetchJson(url('/partilha/invite/cancelar-participacao'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: shareSessionToken })
      });
      if (_valorConvidadoTimer) { clearInterval(_valorConvidadoTimer); _valorConvidadoTimer = null; }
      const pagarWrap = document.getElementById('convitePagarWrap');
      if (pagarWrap) {
        pagarWrap.innerHTML = `<div style="text-align:center;color:#8b95a2;font-size:12.5px;padding:6px 0">Participação cancelada.</div>`;
      }
      document.getElementById('conviteCancelarConfirmModal').style.display = 'none';
      showToast('Participação cancelada.');
    } catch (err) {
      showToast(err.message || 'Erro ao cancelar participação.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'OK! CANCELAR'; }
    }
  });
  document.getElementById('btnConvitePagarFechar')?.addEventListener('click', () => {
    const m = document.getElementById('convitePagarModal');
    if (m) m.style.display = 'none';
  });
  parseInviteParams();
}

document.addEventListener('DOMContentLoaded', bindShareInviteUI);

function _fecharOverlayContactos() {
  const ov = document.getElementById('ctcMultiOverlay');
  if (!ov) return;
  ov.style.opacity = '0';
  setTimeout(() => { ov.style.display = 'none'; }, 230);
}