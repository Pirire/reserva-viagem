// ─────────────────────────────────────────────────────────────
// rm-stats.js — Estatísticas e Classificações
// ─────────────────────────────────────────────────────────────

function destruirGrafico() {
    if (_statsChart) { _statsChart.destroy(); _statsChart = null; }
  }

  function construirGrafico(period) {
    destruirGrafico();
    const ctx = document.getElementById('statsChart');
    if (!ctx || typeof Chart === 'undefined') return;
    const d = STATS_DATA[period];
    _statsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.labels,
        datasets: [
          { label:'Finalizadas', data:d.fin, backgroundColor:'rgba(31,201,125,.60)', borderColor:'rgba(31,201,125,.85)', borderWidth:1.5, borderRadius:4, borderSkipped:false },
          { label:'Canceladas',  data:d.can, backgroundColor:'rgba(240,80,80,.50)',  borderColor:'rgba(240,80,80,.75)',  borderWidth:1.5, borderRadius:4, borderSkipped:false }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: {
          legend: { labels:{ color:'#8a939f', font:{size:10,weight:'700',family:'DM Sans,system-ui,sans-serif'}, boxWidth:9, boxHeight:9, borderRadius:3, useBorderRadius:true, padding:14 } },
          tooltip: {
            backgroundColor:'rgba(13,15,18,.96)', borderColor:'rgba(200,210,225,.18)', borderWidth:1,
            titleColor:'#fff', bodyColor:'#8a939f', padding:11,
            callbacks:{ afterBody(items){ const i=items[0]?.dataIndex; return i!=null ? 'Faturado: €'+STATS_DATA[_statsPeriod].fat[i].toLocaleString('pt-PT') : ''; } }
          }
        },
        scales: {
          x:{ grid:{color:'rgba(200,210,225,.06)'}, ticks:{color:'#545d68',font:{size:10,weight:'600'}} },
          y:{ grid:{color:'rgba(200,210,225,.06)'}, ticks:{color:'#545d68',font:{size:10,weight:'600'}}, beginAtZero:true }
        }
      }
    });
  }

  function atualizarKPIs(period) {
    const k = STATS_DATA[period].kpi;
    const lbl = {ano:'este ano',mes:'este mês',semana:'esta semana',dia:'hoje'}[period];
    const s = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    s('kpiFinalizadas',    k.fin.toLocaleString('pt-PT'));
    s('kpiCanceladas',     k.can.toLocaleString('pt-PT'));
    s('kpiFaturado',       '€'+k.fat.toLocaleString('pt-PT'));
    s('kpiFinalizadasSub', 'viagens concluídas '+lbl);
    s('kpiCanceladasSub',  'viagens canceladas '+lbl);
    s('kpiFaturadoSub',    'receita total '+lbl);
  }

  function abrirEstatisticas() {
    _statsPeriod = 'ano';
    // Reset tabs
    document.querySelectorAll('#statsPeriodRow .cat-btn').forEach(b => b.classList.toggle('selected', b.dataset.period === 'ano'));
    // Period tab listeners (idempotent — safe to rebind)
    document.querySelectorAll('#statsPeriodRow .cat-btn').forEach(btn => {
      btn.onclick = () => {
        _statsPeriod = btn.dataset.period;
        document.querySelectorAll('#statsPeriodRow .cat-btn').forEach(b => b.classList.toggle('selected', b === btn));
        construirGrafico(_statsPeriod);
        atualizarKPIs(_statsPeriod);
      };
    });
    openPopup(document.getElementById('estatisticasPopup'));
    setTimeout(() => { construirGrafico('ano'); atualizarKPIs('ano'); }, 80);
  }

  /* ── CLASSIFICAÇÕES — API REAL ────────────────────────────── */
  const _classif = {
    periodo: 'all', ordem: 'recente',
    pagina: 1, temMais: false, carregando: false,
    mediaGlobal: null
  };

  function renderizarStars(n, total=5) {
    const round = Math.round(n);
    return Array.from({length:total}, (_,i) =>
      `<span class="${i<round?'star-full':'star-empty'}">★</span>`
    ).join('');
  }

  function tagClass(v) {
    if (v==='Excelente') return 'ex';
    if (v==='Boa')       return 'bo';
    if (v==='Regular')   return 're';
    if (v==='Fraca')     return 'fr';
    return '';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});
  }

  function renderAvgSection(media, total) {
    if (!media) return;
    const avgWrap = document.getElementById('ratingsAvgWrap');
    const catGrid = document.getElementById('ratingsCatGrid');
    const dist    = media.distribuicao || {};
    const maxDist = Math.max(...Object.values(dist), 1);

    if (avgWrap) avgWrap.innerHTML = `
      <span class="rating-avg-num">${media.geral.toFixed(1)}</span>
      <div class="rating-avg-right">
        <div style="display:flex;gap:2px;margin-bottom:4px">${renderizarStars(media.geral)}</div>
        <div style="font-size:10px;color:var(--silver-3);margin-bottom:8px">${total} avaliação${total!==1?'es':''} · ${media.recomendaria}% recomendam</div>
        ${[5,4,3,2,1].map(s=>`
          <div class="rating-dist-row">
            <span style="width:12px;text-align:right">${s}</span>
            <div class="rating-dist-bar"><div class="rating-dist-fill" style="width:${dist[s]?Math.round(dist[s]/maxDist*100):0}%"></div></div>
            <span style="width:22px;color:var(--silver-3)">${dist[s]||0}</span>
          </div>`).join('')}
      </div>`;

    const cats = [
      ['Pontualidade',   media.porCategoria?.pontualidade   || 0],
      ['Condução',       media.porCategoria?.conducao       || 0],
      ['Simpatia',       media.porCategoria?.simpatia       || 0],
      ['Limpeza',        media.porCategoria?.limpeza        || 0],
      ['Qualidade Geral',media.porCategoria?.qualidadeGeral || 0],
    ];
    if (catGrid) {
      catGrid.style.display = 'flex';
      catGrid.style.flexDirection = 'column';
      catGrid.style.gap = '5px';
      catGrid.style.padding = '6px 0';
      catGrid.innerHTML = cats.map(([lbl, val]) => `
        <div class="cat-bar-row">
          <span class="cat-bar-label">${lbl}</span>
          <div class="cat-bar-wrap"><div class="cat-bar-fill" style="width:${val?Math.round(val/5*100):0}%"></div></div>
          <span class="cat-bar-val">${val||'—'}</span>
        </div>`).join('');
    }
  }

  function renderItems(items, append=false) {
    const list = document.getElementById('ratingsList');
    if (!list) return;
    const html = items.map(r => {
      const tags = ['pontualidade','conducao','simpatia','limpeza','qualidadeGeral']
        .filter(k => r.ratings?.[k])
        .map(k => `<span class="rating-tag ${tagClass(r.ratings[k])}">${r.ratings[k]}</span>`)
        .join('');
      const rec = r.ratings?.recomendaria
        ? `<span class="rec-badge ${r.ratings.recomendaria==='Sim'?'rec-sim':'rec-nao'}">${r.ratings.recomendaria==='Sim'?'✓ Recomenda':'✗ Não recomenda'}</span>`
        : '';
      return `
        <div class="rating-row">
          <div class="rating-row-top">
            <div style="min-width:0">
              <div class="rating-guest">${r.guestName}</div>
              <div class="rating-route">📍 ${r.partida} → ${r.destino}</div>
              ${r.categoria?`<div style="font-size:9px;color:var(--silver-3);margin-top:1px">${r.categoria}${r.motoristaNome?' · '+r.motoristaNome:''}</div>`:''}
            </div>
            <div style="text-align:right;flex:0 0 auto">
              <div style="display:flex;gap:2px;justify-content:flex-end">${renderizarStars(r.scoreGeral)}</div>
              <div class="rating-meta">${formatDate(r.respondidoEm)}</div>
            </div>
          </div>
          ${tags||rec ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">${tags}${rec}</div>` : ''}
          ${r.comentario ? `<div class="rating-comment">"${r.comentario}"</div>` : ''}
        </div>`;
    }).join('');
    if (append) list.insertAdjacentHTML('beforeend', html);
    else list.innerHTML = html || '<div style="font-size:11px;color:var(--silver-3);padding:16px 0;text-align:center">Sem avaliações para este período.</div>';
  }

  async function carregarClassificacoes(append=false) {
    if (_classif.carregando) return;
    _classif.carregando = true;

    const lmBtn  = document.getElementById('btnClassifLoadMore');
    const erroEl = document.getElementById('classifErro');
    const lmWrap = document.getElementById('classifLoadMoreWrap');

    if (lmBtn) lmBtn.textContent = 'A CARREGAR...';
    if (erroEl) erroEl.style.display = 'none';

    if (!append) {
      const list = document.getElementById('ratingsList');
      if (list) list.innerHTML = '<div style="font-size:11px;color:var(--silver-3);padding:16px 0;text-align:center">A carregar avaliações...</div>';
      const avgWrap = document.getElementById('ratingsAvgWrap');
      if (avgWrap) avgWrap.innerHTML = '<div style="font-size:11px;color:var(--silver-3);padding:8px 0">A calcular médias...</div>';
      const catGrid = document.getElementById('ratingsCatGrid');
      if (catGrid) catGrid.style.display = 'none';
    }

    try {
      const params = new URLSearchParams({
        periodo: _classif.periodo,
        pagina:  _classif.pagina,
        limite:  15,
        ordem:   _classif.ordem,
      });
      const res  = await fetch('/api/feedback/classificacoes?' + params, { credentials: 'include' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

      _classif.temMais = data.temMais || false;

      // Médias (só na primeira página ou se mudou filtro)
      if (!append || !_classif.mediaGlobal) {
        _classif.mediaGlobal = data.media;
        renderAvgSection(data.media, data.total);
      }

      renderItems(data.items || [], append);

      if (lmWrap) lmWrap.style.display = _classif.temMais ? 'block' : 'none';
      if (lmBtn)  lmBtn.textContent = 'CARREGAR MAIS';
    } catch (err) {
      if (erroEl) {
        erroEl.textContent = err.message || 'Erro ao carregar avaliações.';
        erroEl.style.display = 'block';
      }
      if (!append) {
        const list = document.getElementById('ratingsList');
        if (list) list.innerHTML = '';
      }
      if (lmBtn) lmBtn.textContent = 'TENTAR NOVAMENTE';
      if (lmWrap) lmWrap.style.display = 'block';
    } finally {
      _classif.carregando = false;
    }
  }

  function abrirClassificacoes() {
    // Reset estado
    _classif.periodo = 'all';
    _classif.ordem   = 'recente';
    _classif.pagina  = 1;
    _classif.temMais = false;
    _classif.mediaGlobal = null;

    // Reset filtros visuais
    document.querySelectorAll('#classifPeriodRow .cat-btn').forEach(b =>
      b.classList.toggle('selected', b.dataset.cperiod === 'all'));
    const ordemSel = document.getElementById('classifOrdem');
    if (ordemSel) ordemSel.value = 'recente';

    // Ligar filtros (idempotent)
    document.querySelectorAll('#classifPeriodRow .cat-btn').forEach(btn => {
      btn.onclick = () => {
        _classif.periodo = btn.dataset.cperiod;
        _classif.pagina  = 1;
        _classif.mediaGlobal = null;
        document.querySelectorAll('#classifPeriodRow .cat-btn').forEach(b =>
          b.classList.toggle('selected', b === btn));
        carregarClassificacoes(false);
      };
    });
    if (ordemSel) {
      ordemSel.onchange = () => {
        _classif.ordem  = ordemSel.value;
        _classif.pagina = 1;
        carregarClassificacoes(false);
      };
    }
    const lmBtn = document.getElementById('btnClassifLoadMore');
    if (lmBtn) {
      lmBtn.onclick = () => {
        _classif.pagina++;
        carregarClassificacoes(true);
      };
    }

    openPopup(document.getElementById('classificacoesPopup'));
    carregarClassificacoes(false);
  }


  /* ══════════════════════════════════════════════════════════════
     MÓDULO SLA — Relatório Profissional Completo
  ══════════════════════════════════════════════════════════════ */
  let _slaMap = null, _slaPolyline = null, _slaChartInst = null;

  /* Dados semanais — tenta API real, fallback para mock */
  const SLA_WEEK_MOCK = {
    labels:['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'],
    fin:   [8,11,7,14,18,22,6],
    can:   [1,1,0,2,2,3,1],
    fat:   [360,495,315,630,810,990,270]
  };