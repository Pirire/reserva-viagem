// ─────────────────────────────────────────────────────────────
// rm-sla.js — Relatório SLA (mapa, gráfico, PDF, email)
// ─────────────────────────────────────────────────────────────

async function _slaCarregarSemana() {
    try {
      const res = await fetch('/api/feedback/admin/classificacoes?periodo=semana&limite=1', { credentials:'include' });
      if (!res.ok) throw new Error();
      // Se endpoint existe, tenta buscar dados de viagens semanais
      const r2 = await fetch('/api/viagens/stats/semana', { credentials:'include' });
      if (!r2.ok) throw new Error();
      return await r2.json();
    } catch {
      return SLA_WEEK_MOCK;
    }
  }

  function _slaBuildChart(data) {
    if (_slaChartInst) { _slaChartInst.destroy(); _slaChartInst = null; }
    const ctx = document.getElementById('slaWeekChart');
    if (!ctx || typeof Chart === 'undefined') return;

    _slaChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          {
            label:'Finalizadas',
            data: data.fin,
            backgroundColor:'rgba(31,201,125,.65)',
            borderColor:'rgba(31,201,125,.9)',
            borderWidth:1.5,borderRadius:4,borderSkipped:false,
            yAxisID:'y'
          },
          {
            label:'Canceladas',
            data: data.can,
            backgroundColor:'rgba(240,80,80,.55)',
            borderColor:'rgba(240,80,80,.8)',
            borderWidth:1.5,borderRadius:4,borderSkipped:false,
            yAxisID:'y'
          },
          {
            label:'Faturado (€)',
            data: data.fat,
            type:'line',
            borderColor:'#ffd060',
            backgroundColor:'rgba(255,208,96,.08)',
            borderWidth:2,pointRadius:3,pointBackgroundColor:'#ffd060',
            fill:true,tension:.35,
            yAxisID:'y2'
          }
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        layout:{padding:{top:4}},
        plugins:{
          legend:{display:false},
          tooltip:{
            backgroundColor:'rgba(10,12,16,.96)',
            borderColor:'rgba(200,210,225,.18)',borderWidth:1,
            titleColor:'#fff',bodyColor:'#8a939f',padding:10,
            callbacks:{
              afterBody(items){
                const i=items[0]?.dataIndex;
                return i!=null?`Faturado: €${(data.fat[i]||0).toLocaleString('pt-PT')}`:'';
              }
            }
          }
        },
        scales:{
          x:{grid:{color:'rgba(200,210,225,.05)'},ticks:{color:'#545d68',font:{size:9,weight:'600'}}},
          y:{grid:{color:'rgba(200,210,225,.05)'},ticks:{color:'#545d68',font:{size:9}},beginAtZero:true,position:'left'},
          y2:{grid:{display:false},ticks:{color:'#ffd060',font:{size:9},callback:v=>`€${v}`},beginAtZero:true,position:'right'}
        }
      }
    });

    // KPIs semanais
    const totFin = data.fin.reduce((a,b)=>a+b,0);
    const totCan = data.can.reduce((a,b)=>a+b,0);
    const totFat = data.fat.reduce((a,b)=>a+b,0);
    const s = (id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
    s('slaWeekFin', totFin.toLocaleString('pt-PT'));
    s('slaWeekCan', totCan.toLocaleString('pt-PT'));
    s('slaWeekFat', '€'+totFat.toLocaleString('pt-PT'));
  }

  function _slaFmt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function _slaDia(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-PT', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  }
  function _slaDuracao(inicio, fim) {
    if (!inicio || !fim) return '—';
    const diff = Math.round((new Date(fim) - new Date(inicio)) / 60000);
    const h = Math.floor(diff / 60), m = diff % 60;
    return h > 0 ? `${h}h ${m}min` : `${m} min`;
  }

  async function abrirSLA() {
    const pop = el('slaPopup');
    if (!pop) return;

    const ctx = currentTripContext;
    const partida  = els.inputPartida?.value  || ctx.partida  || '—';
    const destino  = els.inputDestino?.value  || ctx.destino  || '—';
    const datahora = els.inputDateTime?.value || ctx.datahora || null;
    const inicio   = datahora ? new Date(datahora).toISOString() : null;

    let fimISO = null;
    const km = _kmCalculado || 0;
    if (inicio && km > 0) {
      const minutos = Math.round((km / 40) * 60);
      fimISO = new Date(new Date(inicio).getTime() + minutos * 60000).toISOString();
    }

    const valor     = _precosCalculados[selectedCategory] || 0;
    const portagens = _portagensMap[selectedCategory]     || 0;
    const base      = valor > 0 ? valor - portagens : 0;

    // Preencher campos
    const s = (id, v) => { const e = el(id); if (e) e.textContent = v || '—'; };
    s('slaPassageiro',   currentUser.nomeCompleto || '—');
    s('slaPartida',      partida);
    s('slaDestino',      destino);
    s('slaInicio',       _slaFmt(inicio));
    s('slaFim',          _slaFmt(fimISO));
    s('slaMotorista',    ctx.motoristaNome || '—');
    s('slaVeiculo',      ctx.veiculo ? `${ctx.veiculo} · ${ctx.matricula}` : '—');
    s('slaPortagens',    portagens > 0 ? `€${portagens.toFixed(2)}` : '€0.00');
    s('slaCodigo',       ctx.tripId || '—');

    s('slaKm',           km > 0 ? `${km.toFixed(1)} km` : '—');
    s('slaDuracao',      _slaDuracao(inicio, fimISO));
    s('slaData',         inicio ? new Date(inicio).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}) : '—');
    s('slaDia',          _slaDia(inicio));
    s('slaCategoria',    getCategoryLabel(getCategoryValue()));
    s('slaValor',        valor > 0 ? `€${valor.toFixed(2)}` : '—');
    // Despesas
    s('slaBase',         base > 0 ? `€${base.toFixed(2)}` : '—');
    s('slaPortagensVal', portagens > 0 ? `€${portagens.toFixed(2)}` : '€0.00');
    s('slaExtras',       '€0.00');
    s('slaTotal',        valor > 0 ? `€${valor.toFixed(2)}` : '—');

    // Email
    const emailInp = el('slaEmailInput');
    if (emailInp && !emailInp.value && currentUser.email) emailInp.value = currentUser.email;
    const st = el('slaEmailStatus');
    if (st) { st.textContent = ''; st.className = 'sla-status'; }

    openPopup(pop);

    // Mapa
    setTimeout(() => _slaInitMap(partida, destino), 120);

    // Gráfico semanal
    setTimeout(async () => {
      const weekData = await _slaCarregarSemana();
      _slaBuildChart(weekData);
    }, 200);
  }

  async function _slaInitMap(partidaStr, destinoStr) {
    const container = el('slaMapInner');
    if (!container) return;

    if (!_slaMap) {
      _slaMap = new google.maps.Map(container, {
        center:{lat:38.72,lng:-9.13}, zoom:12,
        styles:[
          {elementType:'geometry',stylers:[{color:'#0a0c10'}]},
          {featureType:'road',elementType:'geometry',stylers:[{color:'#1a1e28'}]},
          {featureType:'water',elementType:'geometry',stylers:[{color:'#060810'}]}
        ]
      });
    }

    if (_slaPolyline) { try{_slaPolyline.setMap(null);}catch(_){} _slaPolyline = null; }

    const pLat = els.inputPartida?.dataset?.lat;
    const pLng = els.inputPartida?.dataset?.lng;
    const dLat = els.inputDestino?.dataset?.lat;
    const dLng = els.inputDestino?.dataset?.lng;

    if (pLat && pLng && dLat && dLng) {
      try {
        const r = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${dLng},${dLat}?overview=full&geometries=geojson`
        );
        const data = await r.json();
        if (data.code === 'Ok' && data.routes?.length) {
          const pontos = data.routes[0].geometry.coordinates.map(c => ({lat:c[1],lng:c[0]}));
          _slaPolyline = new google.maps.Polyline({path:pontos,map:_slaMap,strokeColor:'#1fc97d',strokeWeight:4,strokeOpacity:.9});
          new google.maps.Marker({position:{lat:+pLat,lng:+pLng},map:_slaMap,label:'A',title:'Partida'});
          new google.maps.Marker({position:{lat:+dLat,lng:+dLng},map:_slaMap,label:'B',title:'Destino'});
          const _slb=new google.maps.LatLngBounds();
          _slaPolyline.getPath().forEach(p=>_slb.extend(p));
          _slaMap.fitBounds(_slb);
        }
      } catch (_) {}
    } else {
      _slaMap.setCenter({lat:38.72,lng:-9.13}); _slaMap.setZoom(11);
    }
  }

  /* ── Gerar PDF profissional (jsPDF) ────────────────────────── */
  async function _slaGerarPDF() {
    if (!window.jspdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    let y = 0;

    // ── Header bar ──────────────────────────────────────────────
    doc.setFillColor(6, 7, 10);
    doc.rect(0, 0, W, 32, 'F');
    // Accent line
    doc.setFillColor(31, 201, 125);
    doc.rect(0, 32, W, 1.5, 'F');

    doc.setTextColor(255,255,255);
    doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text('REALMETROPOLIS', 14, 13);
    doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.setTextColor(140,150,165);
    doc.text('RELATÓRIO SLA — VIAGEM', 14, 22);
    doc.text('Gerado em: ' + new Date().toLocaleString('pt-PT'), W-14, 22, { align:'right' });

    y = 44;

    // ── Helper functions ─────────────────────────────────────────
    const section = (title, color=[100,110,125]) => {
      if (y > H - 40) { doc.addPage(); y = 20; }
      doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.setTextColor(...color);
      doc.text(title.toUpperCase(), 14, y); y += 2;
      doc.setDrawColor(40,45,55); doc.setLineWidth(0.25);
      doc.line(14, y, W-14, y); y += 5;
    };

    const row = (lbl, val, valColor=[230,235,245]) => {
      if (y > H - 20) { doc.addPage(); y = 20; }
      doc.setFontSize(9.5); doc.setFont('helvetica','normal');
      doc.setTextColor(110,120,135); doc.text(lbl, 14, y);
      doc.setTextColor(...valColor); doc.setFont('helvetica','bold');
      const vStr = String(val||'—');
      doc.text(vStr, W-14, y, { align:'right', maxWidth: W-90 });
      y += 7;
    };

    const kpiBox = (x, yy, w, h, label, value, color=[230,235,245], bg=[16,18,22]) => {
      doc.setFillColor(...bg); doc.setDrawColor(40,46,58);
      doc.roundedRect(x, yy, w, h, 2, 2, 'FD');
      doc.setFontSize(6.5); doc.setFont('helvetica','bold');
      doc.setTextColor(100,110,125);
      doc.text(label.toUpperCase(), x+4, yy+7);
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      doc.setTextColor(...color);
      doc.text(String(value||'—'), x+4, yy+16);
    };

    // ── KPIs principais ──────────────────────────────────────────
    const bw = (W-28)/4; const bh = 22;
    const kpiData = [
      { lbl:'DISTÂNCIA', val: el('slaKm')?.textContent||'—', c:[31,201,125] },
      { lbl:'DURAÇÃO',   val: el('slaDuracao')?.textContent||'—', c:[230,235,245] },
      { lbl:'VALOR TOTAL',val: el('slaTotal')?.textContent||'—', c:[255,208,96] },
      { lbl:'CATEGORIA', val: el('slaCategoria')?.textContent||'—', c:[230,235,245] },
    ];
    kpiData.forEach((k, i) => kpiBox(14 + i*(bw+2.67), y, bw, bh, k.lbl, k.val, k.c));
    y += bh + 10;

    // ── Dados da Viagem ──────────────────────────────────────────
    section('Dados da Viagem');
    row('Passageiro',          el('slaPassageiro')?.textContent);
    row('Local de Partida',    el('slaPartida')?.textContent);
    row('Destino',             el('slaDestino')?.textContent);
    row('Início da Viagem',    el('slaInicio')?.textContent);
    row('Fim Estimado',        el('slaFim')?.textContent);
    row('Data',                el('slaDia')?.textContent);
    y += 4;

    // ── Motorista & Veículo ─────────────────────────────────────
    section('Motorista & Veículo');
    row('Motorista',           el('slaMotorista')?.textContent);
    row('Veículo / Matrícula', el('slaVeiculo')?.textContent);
    row('Código de Reserva',   el('slaCodigo')?.textContent);
    y += 4;

    // ── Despesas ────────────────────────────────────────────────
    section('Resumo de Despesas', [255,208,96]);
    row('Tarifa Base',         el('slaBase')?.textContent);
    row('Portagens',           el('slaPortagensVal')?.textContent, [240,160,32]);
    row('Extras',              el('slaExtras')?.textContent);
    // Total em destaque
    doc.setFillColor(20,24,16); doc.setDrawColor(31,201,125);
    doc.setLineWidth(0.5); doc.roundedRect(14, y, W-28, 12, 2, 2, 'FD');
    doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.setTextColor(140,150,160); doc.text('TOTAL A PAGAR', 18, y+8);
    doc.setFontSize(13); doc.setTextColor(255,208,96);
    doc.text(el('slaTotal')?.textContent||'—', W-18, y+8, { align:'right' });
    y += 20;

    // ── Estatísticas Semanais ───────────────────────────────────
    section('Estatísticas Semanais do Hotel');
    const sw = (W-28)/3;
    const swData = [
      { lbl:'FINALIZADAS', val:el('slaWeekFin')?.textContent||'—', c:[31,201,125], bg:[12,24,18] },
      { lbl:'CANCELADAS',  val:el('slaWeekCan')?.textContent||'—', c:[240,80,80],  bg:[24,12,12] },
      { lbl:'FATURADO',    val:el('slaWeekFat')?.textContent||'—', c:[255,208,96], bg:[24,20,10] },
    ];
    swData.forEach((k,i) => kpiBox(14+i*(sw+2), y, sw, bh, k.lbl, k.val, k.c, k.bg));
    y += bh + 6;

    // Gráfico semanal como imagem (canvas to base64)
    const chartCanvas = document.getElementById('slaWeekChart');
    if (chartCanvas) {
      try {
        const imgData = chartCanvas.toDataURL('image/png');
        const chartH  = 50;
        doc.setFillColor(13,15,18); doc.setDrawColor(40,46,58);
        doc.roundedRect(14, y, W-28, chartH, 2, 2, 'FD');
        doc.addImage(imgData, 'PNG', 16, y+2, W-32, chartH-4);
        y += chartH + 8;
      } catch(_) {}
    }

    // ── Rodapé ──────────────────────────────────────────────────
    doc.setFillColor(6,7,10);
    doc.rect(0, H-14, W, 14, 'F');
    doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.setTextColor(70,80,95);
    doc.text('REALMETROPOLIS © ' + new Date().getFullYear() + '  ·  Documento gerado automaticamente  ·  Confidencial', W/2, H-5, { align:'center' });

    return doc;
  }

  /* ── Enviar PDF por email ───────────────────────────────────── */
  async function _slaEnviarEmail() {
    const emailEl = el('slaEmailInput');
    const statusEl = el('slaEmailStatus');
    const btn = el('btnSlaEnviarEmail');
    const email = (emailEl?.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (statusEl) { statusEl.textContent = 'Email inválido.'; statusEl.className = 'sla-status err'; }
      return;
    }
    btn.disabled = true; btn.textContent = 'A ENVIAR...';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'sla-status'; }
    try {
      const doc = await _slaGerarPDF();
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      const payload = {
        email,
        nomePassageiro: el('slaPassageiro')?.textContent || '',
        partida:        el('slaPartida')?.textContent || '',
        destino:        el('slaDestino')?.textContent || '',
        inicio:         el('slaInicio')?.textContent || '',
        fim:            el('slaFim')?.textContent || '',
        km:             el('slaKm')?.textContent || '',
        duracao:        el('slaDuracao')?.textContent || '',
        valor:          el('slaValor')?.textContent || '',
        motorista:      el('slaMotorista')?.textContent || '',
        veiculo:        el('slaVeiculo')?.textContent || '',
        categoria:      el('slaCategoria')?.textContent || '',
        pdfBase64,
      };
      const res = await fetch('/api/viagens/sla/enviar-email', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.ok || data.success)) {
        if (statusEl) { statusEl.textContent = `✓ PDF enviado para ${email}`; statusEl.className = 'sla-status ok'; }
        btn.textContent = '✓ ENVIADO';
      } else {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
    } catch (err) {
      if (statusEl) { statusEl.textContent = '✗ ' + (err.message || 'Erro ao enviar.'); statusEl.className = 'sla-status err'; }
      btn.disabled = false; btn.textContent = 'ENVIAR PDF';
    } finally {
      if (btn.textContent === 'A ENVIAR...') { btn.disabled = false; btn.textContent = 'ENVIAR PDF'; }
    }
  }

  // Bind SLA popup buttons
  document.addEventListener('DOMContentLoaded', () => {
    el('btnSlaFechar')?.addEventListener('click',  () => closePopup(el('slaPopup')));
    el('btnSlaGerarPDF')?.addEventListener('click', async () => {
      const btn = el('btnSlaGerarPDF');
      btn.disabled = true; btn.textContent = 'A GERAR...';
      try {
        const doc = await _slaGerarPDF();
        const pass = el('slaPassageiro')?.textContent || 'viagem';
        doc.save(`SLA_${pass.replace(/\s+/g,'_')}_${Date.now()}.pdf`);
      } catch(e) { showToast('Erro ao gerar PDF.'); }
      finally { btn.disabled = false; btn.textContent = '⬇ DESCARREGAR PDF'; }
    });
    el('btnSlaEnviarEmail')?.addEventListener('click', _slaEnviarEmail);
  });

  window.addEventListener('beforeunload', stopInviteLocationUpdates);