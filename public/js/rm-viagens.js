// ─────────────────────────────────────────────────────────────
// rm-viagens.js — Viagens Activas + Monitor em Tempo Real
// ─────────────────────────────────────────────────────────────

let _viagensTimer    = null;
let _viagensAtivas   = [];
let _monitorTimer    = null;
let _monitorViagemId = null;
let _monitorMap      = null;
let _monitorMarker   = null;
let _monitorPolyline = null;

// ── Requisitos especiais (ovo / cadeirinha / elevação) ─────────
function renderRequisitosBadgesHtml(req) {
  if (!req || typeof req !== 'object' || !Object.keys(req).length) return '';
  const labels = { ovo: '🍼 Ovo', cadeirinha: '🪑 Cadeirinha', elevacao: '⬆️ Elevação' };
  const chips = Object.entries(req)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([key, qty]) => `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:#ffd9ab;background:rgba(255,160,60,.12);border:1px solid rgba(255,160,60,.3);border-radius:999px;padding:2px 7px;margin-right:4px;margin-top:5px">${labels[key] || escapeHtml(key)} ×${qty}</span>`)
    .join('');
  return chips ? `<div>${chips}</div>` : '';
}

// ── Lista de viagens ──────────────────────────────────────────
function abrirViagensMapa() {
  openPopup(document.getElementById('viagensAtivasPopup'));
  carregarViagensMapa();
  _viagensTimer = setInterval(carregarViagensMapa, 10000);
}

function fecharViagensMapa() {
  closePopup(document.getElementById('viagensAtivasPopup'));
  if (_viagensTimer) { clearInterval(_viagensTimer); _viagensTimer = null; }
}

async function carregarViagensMapa() {
  const lista    = document.getElementById('viagensAtivasLista');
  const contador = document.getElementById('viagensAtivasContador');
  if (!lista) return;
  try {
    const data = await fetchJson(url('/admin/parceiros/viagens/ativas'));
    _viagensAtivas = data?.viagens || [];
    if (contador) contador.textContent = _viagensAtivas.length;
    if (!_viagensAtivas.length) {
      lista.innerHTML = '<div style="padding:40px;text-align:center;color:var(--silver-3)"><div style="font-size:32px;margin-bottom:10px">🗺️</div><div style="font-size:12px;font-weight:600;color:var(--silver-2)">Sem viagens activas</div></div>';
      return;
    }
    lista.innerHTML = _viagensAtivas.map(v => {
      const sc = {pendente:'var(--warn)',aceite:'var(--ok)',em_curso:'var(--ok)',iniciada:'var(--ok)',ativo:'var(--ok)',in_progress:'var(--ok)'}[v.status?.toLowerCase()] || 'var(--silver-3)';
      const sl = {pendente:'PENDENTE',aceite:'ACEITE',aceita:'ACEITE',em_curso:'EM CURSO',iniciada:'EM CURSO',ativo:'EM CURSO',in_progress:'EM CURSO',assigned:'ATRIBUÍDA',picking_up:'A RECOLHER'}[v.status?.toLowerCase()] || (v.status||'—').toUpperCase();
      const hora = v.criadaEm ? new Date(v.criadaEm).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}) : '—';
      return `<div class="viagem-ativa-card" data-id="${v.id}" style="padding:13px 15px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.025);cursor:pointer;transition:.15s ease;margin-bottom:7px" onmouseover="this.style.borderColor='rgba(255,255,255,.20)';this.style.background='rgba(255,255,255,.05)'" onmouseout="this.style.borderColor='rgba(200,210,225,.10)';this.style.background='rgba(255,255,255,.025)'">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:#fff">${escapeHtml(v.nomeHospede)}</span>
            <span style="font-size:9px;font-weight:700;letter-spacing:.1em;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--silver-3)">${escapeHtml(v.codigo)}</span>
          </div>
          <span style="font-size:9px;font-weight:700;letter-spacing:.08em;color:${sc}">${sl}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:10px;color:var(--silver-3)">
          <div>📍 <span style="color:var(--silver-2)">${escapeHtml(v.partida.split(',')[0])}</span></div>
          <div>🏁 <span style="color:var(--silver-2)">${escapeHtml(v.destino.split(',')[0])}</span></div>
          <div>${v.motorista ? '🚗 '+escapeHtml(v.motorista) : '⏳ Sem motorista'}</div>
          <div style="text-align:right">🕐 ${hora}</div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:rgba(255,255,255,.3);text-align:right">Clique para monitorizar →</div>
        ${renderRequisitosBadgesHtml(v.requisitosEspeciais)}
      </div>`;
    }).join('');
    lista.querySelectorAll('.viagem-ativa-card').forEach(card => {
      card.addEventListener('click', () => { const id = card.dataset.id; if (id) abrirMonitorViagem(id); });
    });
  } catch (err) {
    if (!lista.querySelector('.viagem-ativa-card'))
      lista.innerHTML = '<div style="padding:24px;text-align:center;color:var(--bad);font-size:11px">Erro ao carregar viagens</div>';
  }
}

// ══════════════════════════════════════════════════════════════
// MONITOR EM TEMPO REAL
// ══════════════════════════════════════════════════════════════

async function abrirMonitorViagem(tripId) {
  _monitorViagemId = tripId;
  fecharViagensMapa();
  const ov = document.getElementById('tripMonitorOverlay');
  if (ov) { ov.style.display = 'flex'; setTimeout(() => ov.classList.add('show'), 10); }
  await _carregarMonitor();
  _monitorTimer = setInterval(_carregarMonitor, 10000);
}

function fecharMonitorViagem() {
  if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
  _monitorViagemId = null;
  const ov = document.getElementById('tripMonitorOverlay');
  if (ov) { ov.classList.remove('show'); setTimeout(() => { ov.style.display = 'none'; }, 280); }
  if (_monitorMarker)   { try { _monitorMarker.setMap(null); }   catch(_){} _monitorMarker   = null; }
  if (_monitorPolyline) { try { _monitorPolyline.setMap(null); } catch(_){} _monitorPolyline = null; }
  _monitorMap = null;
  const mapEl = document.getElementById('monitorMapDiv');
  if (mapEl) mapEl.dataset.markersAdded = '';
}

async function _carregarMonitor() {
  if (!_monitorViagemId) return;
  try {
    const data = await fetchJson(url(`/admin/parceiros/viagens/${_monitorViagemId}`));
    if (data?.ok && data.viagem) _renderMonitor(data.viagem);
  } catch(_) {}
}

function _renderMonitor(v) {
  // CARD MOTORISTA
  const cm = document.getElementById('monitorCardMotorista');
  if (cm) {
    const stars = v.motoristaRating ? ('★'.repeat(Math.round(v.motoristaRating))+'☆'.repeat(5-Math.round(v.motoristaRating))) : '';
    cm.innerHTML = `
      <div style="font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--silver-3);margin-bottom:10px;text-transform:uppercase;display:flex;align-items:center;gap:6px">
        🚗 Motorista
        <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 7px rgba(31,201,125,.5);animation:btnPulse 1.5s ease-in-out infinite"></span>
        <span style="font-size:8px;color:var(--ok)">AO VIVO</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--c3);border:2px solid rgba(31,201,125,.3);display:grid;place-items:center;font-size:22px;flex:0 0 auto;overflow:hidden">
          ${v.motoristaFoto ? `<img src="${escapeHtml(v.motoristaFoto)}" style="width:100%;height:100%;object-fit:cover" onerror="this.outerHTML='👤'">` : '👤'}
        </div>
        <div>
          <div style="font-size:15px;font-weight:900;color:#fff">${escapeHtml(v.motoristaNome)}</div>
          <div style="font-size:11px;color:var(--silver-3);margin-top:2px">${escapeHtml(v.motoristaMatricula)}${v.motoristaVeiculo!=='—'?' · '+escapeHtml(v.motoristaVeiculo):''}</div>
          ${stars ? `<div style="color:#f5c518;font-size:12px;margin-top:3px">${stars} <span style="color:var(--silver-3);font-size:10px">${Number(v.motoristaRating).toFixed(1)}</span></div>` : ''}
        </div>
      </div>
      <div style="font-size:10px;color:var(--silver-3);display:flex;flex-direction:column;gap:4px;padding-top:8px;border-top:1px solid var(--line)">
        <div>📍 <span style="color:var(--silver-2)">${escapeHtml(v.partida.split(',')[0])}</span></div>
        <div>🏁 <span style="color:var(--silver-2)">${escapeHtml(v.destino.split(',')[0])}</span></div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:8px">
          <span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(31,201,125,.09);border:1px solid rgba(31,201,125,.22);color:var(--ok)">${(v.status||'—').toUpperCase()}</span>
          ${v.valor?`<span style="color:var(--ok);font-weight:700">€${Number(v.valor).toFixed(2)}</span>`:''}
        </div>
      </div>`;
  }

  // CARD HÓSPEDE
  const ch = document.getElementById('monitorCardHospede');
  if (ch) {
    ch.innerHTML = `
      <div style="font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--silver-3);margin-bottom:10px;text-transform:uppercase">👤 Hóspede</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--c3);border:1px solid var(--line);display:grid;place-items:center;font-size:22px;flex:0 0 auto">👤</div>
        <div>
          <div style="font-size:15px;font-weight:900;color:#fff">${escapeHtml(v.nomeHospede)}</div>
          <div style="font-size:11px;color:var(--silver-3);margin-top:2px">${escapeHtml(v.emailHospede)}</div>
          ${v.telHospede&&v.telHospede!=='—'?`<div style="font-size:11px;color:var(--silver-3);margin-top:1px">${escapeHtml(v.telHospede)}</div>`:''}
        </div>
      </div>
      <div style="font-size:10px;color:var(--silver-3);display:flex;flex-direction:column;gap:4px;padding-top:8px;border-top:1px solid var(--line)">
        <div>🎫 Código: <span style="color:var(--silver-2);font-weight:700;letter-spacing:.08em">${escapeHtml(v.codigo)}</span></div>
        ${v.categoria!=='—'?`<div>🚗 Categoria: <span style="color:var(--silver-2)">${escapeHtml(v.categoria)}</span></div>`:''}
        ${v.criadaEm?`<div>🕐 Criada: <span style="color:var(--silver-2)">${new Date(v.criadaEm).toLocaleString('pt-PT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></div>`:''}
      </div>
      ${renderRequisitosBadgesHtml(v.requisitosEspeciais)}`;
  }

  // MAPA
  const mapEl = document.getElementById('monitorMapDiv');
  if (!mapEl || typeof google === 'undefined') return;

  if (!_monitorMap) {
    _monitorMap = new google.maps.Map(mapEl, {
      center: { lat: 38.7169, lng: -9.1393 }, zoom: 13,
      styles: [
        {elementType:'geometry',stylers:[{color:'#0a0c10'}]},
        {elementType:'labels.text.fill',stylers:[{color:'#8b93a0'}]},
        {featureType:'road',elementType:'geometry',stylers:[{color:'#1a1e28'}]},
        {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#232b38'}]},
        {featureType:'water',elementType:'geometry',stylers:[{color:'#060810'}]},
        {featureType:'poi',stylers:[{visibility:'off'}]}
      ]
    });
  }

  if (v.motoristaLat && v.motoristaLng) {
    const pos = { lat: Number(v.motoristaLat), lng: Number(v.motoristaLng) };
    _monitorMap.setCenter(pos);
    if (_monitorMarker) {
      _monitorMarker.setPosition(pos);
    } else {
      _monitorMarker = new google.maps.Marker({
        position: pos, map: _monitorMap, title: v.motoristaNome,
        icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale:6, fillColor:'#1fc97d', fillOpacity:1, strokeColor:'#fff', strokeWeight:2 }
      });
    }
  }

  if (!mapEl.dataset.markersAdded && v.partidaLat) {
    mapEl.dataset.markersAdded = '1';
    new google.maps.Marker({position:{lat:Number(v.partidaLat),lng:Number(v.partidaLng)},map:_monitorMap,title:'Partida',
      icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:'#fff',fillOpacity:1,strokeColor:'#1fc97d',strokeWeight:3}});
    if (v.destinoLat) {
      new google.maps.Marker({position:{lat:Number(v.destinoLat),lng:Number(v.destinoLng)},map:_monitorMap,title:'Destino',
        icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:'#1fc97d',fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});
      _desenharRotaMonitor(v.partidaLat,v.partidaLng,v.destinoLat,v.destinoLng);
    }
  }

  google.maps.event.trigger(_monitorMap,'resize');
}

async function _desenharRotaMonitor(oLat,oLng,dLat,dLng) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`);
    const data = await r.json();
    if (data.code!=='Ok'||!data.routes?.length) return;
    const pontos = data.routes[0].geometry.coordinates.map(c=>({lat:c[1],lng:c[0]}));
    if (_monitorPolyline) { try{_monitorPolyline.setMap(null);}catch(_){} }
    _monitorPolyline = new google.maps.Polyline({path:pontos,map:_monitorMap,strokeColor:'#1fc97d',strokeWeight:4,strokeOpacity:.7});
    const bounds = new google.maps.LatLngBounds();
    pontos.forEach(p=>bounds.extend(p));
    _monitorMap.fitBounds(bounds,{top:40,bottom:40,left:20,right:20});
  } catch(_){}
}

window.abrirViagensMapa    = abrirViagensMapa;
window.fecharViagensMapa   = fecharViagensMapa;
window.abrirMonitorViagem  = abrirMonitorViagem;
window.fecharMonitorViagem = fecharMonitorViagem;