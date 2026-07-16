// Coordenadas do utilizador (Lisboa por defeito)
let _userLat = 38.7169;
let _userLng = -9.1393;

// ─────────────────────────────────────────────────────────────
// rm-map.js — Google Maps (mapa principal, overlay motorista,
//             Nominatim autocomplete, geolocalização)
// ─────────────────────────────────────────────────────────────

function initOverlayMap() {
    if (ovMap) return;
    ovMap = new google.maps.Map(document.getElementById('ovMapa'), {center:{lat:38.72,lng:-9.13},zoom:14,styles:[{elementType:'geometry',stylers:[{color:'#0a0c10'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#1a1e28'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#060810'}]}]});
  }

  function showMotoristaOverlay(dados) {
    el('motoristaOverlay').classList.add('show');
    el('tripPanel').classList.add('hidden');
    el('shareSheet')?.classList.add('hidden');
    document.querySelector('.trip-type-wrap')?.classList.add('hidden');
    el('ovMatricula').textContent = dados.matricula || '—';
    el('ovModelo').textContent    = (dados.veiculo || '') + (dados.cor ? ' · ' + dados.cor : '');
    el('ovNome').textContent      = dados.motoristaNome || dados.nome || '—';
    const rating = Number(dados.rating || 5).toFixed(1);
    const stars  = Math.round(Number(rating));
    el('ovStars').textContent  = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    el('ovRating').textContent = rating;
    el('ovEta').textContent    = dados.eta || 'A calcular...';
    const fw = el('ovFotoWrap');
    if (dados.foto && fw) fw.outerHTML = `<img class="motorista-foto" id="ovFotoWrap" src="${dados.foto}" alt="Foto" onerror="this.outerHTML='<div class=motorista-foto-placeholder id=ovFotoWrap>👤</div>'">`;
    setTimeout(() => { initOverlayMap(); if (dados.lat && dados.lng) { ovMap.setCenter({lat:dados.lat,lng:dados.lng}); ovMap.setZoom(15); if (ovMarker) ovMarker.setPosition({lat:dados.lat,lng:dados.lng}); else ovMarker = new google.maps.Marker({position:{lat:dados.lat,lng:dados.lng},map:ovMap,icon:{path:google.maps.SymbolPath.CIRCLE,scale:9,fillColor:'#19d68b',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}}); } }, 200);
    setReservaAtiva(true);
  }

  function hideMotoristaOverlay() { el('motoristaOverlay').classList.remove('show'); }
  function setReservaAtiva(ativa) { const btn = el('btnReservaAtiva'); if (!btn) return; btn.classList.toggle('hidden', !ativa); }

  /* ── MAPA PRINCIPAL ────────────────────────────────────────── */

function initMap() {
    const _mapEl = document.getElementById('map');
    if (!_mapEl) return;
    map = new google.maps.Map(_mapEl, {
      center: { lat: 38.7169, lng: -9.1393 }, zoom: 13,
      styles: [
        { featureType:'poi',     stylers:[{ visibility:'off' }] },
        { featureType:'transit', stylers:[{ visibility:'off' }] }
      ]
    });
  }

async function nominatimSearch(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const key = `${q}|${_userLat.toFixed(2)}|${_userLng.toFixed(2)}`;
  if (_nmCache[key]) return _nmCache[key];
  try {
    const d  = 1.0;
    const vb = `${(_userLng-d).toFixed(4)},${(_userLat+d).toFixed(4)},${(_userLng+d).toFixed(4)},${(_userLat-d).toFixed(4)}`;
    const url_nm = `https://nominatim.openstreetmap.org/search`
      + `?q=${encodeURIComponent(q)}`
      + `&format=json&addressdetails=1&limit=8&bounded=0`
      + `&viewbox=${vb}&accept-language=pt`;
    const r    = await fetch(url_nm, { headers: { 'User-Agent': 'RealMetropolis/1.0' } });
    const data = await r.json();
    data.sort((a, b) => {
      const d2 = (la, lo) => (la - _userLat) ** 2 + (lo - _userLng) ** 2;
      return d2(+a.lat, +a.lon) - d2(+b.lat, +b.lon);
    });
    _nmCache[key] = data;
    return data;
  } catch (e) { console.warn('[NM]', e.message); return []; }
}

  function formatNmLabel(item) {
    const a = item.address || {};
    const principal = a.road || a.pedestrian || a.suburb || item.display_name.split(',')[0];
    const secundario = [a.city || a.town || a.village || a.municipality, a.postcode].filter(Boolean).join(' · ');
    return { principal, secundario };
  }

  function renderNmDropdown(dropdown, results, onSelect) {
    dropdown.innerHTML = '';
    if (!results.length) { dropdown.classList.remove('open'); return; }
    results.forEach((item, i) => {
      const { principal, secundario } = formatNmLabel(item);
      const div = document.createElement('div');
      div.className = 'nm-item';
      div.innerHTML = `${escapeHtml(principal)}<small>${escapeHtml(secundario)}</small>`;
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        onSelect(item);
        dropdown.classList.remove('open');
      });
      dropdown.appendChild(div);
    });
    dropdown.classList.add('open');
  }

  function bindNmAutocomplete(input, dropdown, onSelect) {
    let _timer = null;
    input.addEventListener('input', () => {
      clearTimeout(_timer);
      const q = input.value.trim();
      if (q.length < 3) { dropdown.classList.remove('open'); return; }
      _timer = setTimeout(async () => {
        const results = await nominatimSearch(q);
        renderNmDropdown(dropdown, results, item => {
          input.value = item.display_name.split(',').slice(0, 2).join(',').trim();
          input.dataset.lat = item.lat;
          input.dataset.lng = item.lon;
          onSelect({ lat: Number(item.lat), lng: Number(item.lon), address: input.value });
        });
      }, 350);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => dropdown.classList.remove('open'), 200);
      // Tentar calcular se o campo tiver texto mas sem coordenadas
      if (input.value.trim() && !input.dataset.lat) {
        setTimeout(() => tentarCalcularPrecos(), 300);
      }
    });
    input.addEventListener('keydown', e => {
      const items = dropdown.querySelectorAll('.nm-item');
      const active = dropdown.querySelector('.nm-item.active');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = active ? (active.nextElementSibling || items[0]) : items[0];
        active?.classList.remove('active'); next.classList.add('active');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = active ? (active.previousElementSibling || items[items.length-1]) : items[items.length-1];
        active?.classList.remove('active'); prev.classList.add('active');
      } else if (e.key === 'Enter' && active) {
        e.preventDefault(); active.dispatchEvent(new MouseEvent('mousedown'));
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('open');
      }
    });
  }

  function initAutocomplete() {
    // Botão 📍 geo na partida
    el('geoPartidaBtn')?.addEventListener('click', () => rmAutoGeo('inputPartida', 'reservar'));

    // Partida (painel de reserva privada)
    bindNmAutocomplete(els.inputPartida, el('nmPartida'), place => {
      map.setCenter({lat:place.lat,lng:place.lng}); map.setZoom(15);
      tentarCalcularPrecos();
    });

    // Destino (painel de reserva privada)
    bindNmAutocomplete(els.inputDestino, el('nmDestino'), place => {
      map.setCenter({lat:place.lat,lng:place.lng}); map.setZoom(15);
      tentarCalcularPrecos();
    });

    // Recolha (partilha)
    const shareRecolhaEl = el('shareRecolha');
    if (shareRecolhaEl) {
      bindNmAutocomplete(shareRecolhaEl, el('nmRecolha'), place => {
        shareRecolhaEl.dataset.lat = place.lat;
        shareRecolhaEl.dataset.lng = place.lng;
        map.setCenter({lat:place.lat,lng:place.lng}); map.setZoom(14);
        updateShareButtonsState();
        calcularPrecoPartilha();
      });
    }

    // Destino (partilha)
    bindNmAutocomplete(els.shareDestino, el('nmShareDestino'), place => {
      shareDestinoPlace = { address: els.shareDestino.value, lat: place.lat, lng: place.lng };
      map.setCenter({lat:place.lat,lng:place.lng}); map.setZoom(14);
      updateShareButtonsState();
      calcularPrecoPartilha();
    });
  }

  function requestUserLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      _userLat = pos.coords.latitude;
      _userLng = pos.coords.longitude;
      map.setCenter({lat:_userLat,lng:_userLng}); map.setZoom(14);
    }, () => {}, { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 });
  }

  /* ── BIND DE EVENTOS ───────────────────────────────────────── */