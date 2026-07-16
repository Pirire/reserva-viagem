// ─────────────────────────────────────────────────────────────
// rm-convidado.js — Modo Convidado
// VERSÃO: 2026-07-02-CVD-PAGADOR-UNICO
//
// 1 viagem, 1 pagador. O remetente escolhe se paga ele próprio
// (cartão agora) OU marca um convidado como pagador (esse recebe
// ticket para pagar; despacho arranca depois desse pagamento).
// NÃO cobra várias vezes — o valor é o total da viagem, não N ×
// preço individual. Para dividir, existe o fluxo PARTILHAR.
//
// Tudo envolvido numa função (IIFE) — sem isto, se o script fosse
// executado uma segunda vez por qualquer motivo (cache do browser,
// bfcache ao voltar à página, recarregamento parcial), as variáveis
// declaradas com let/const no topo (ex: _cvdOverlay) entravam em
// conflito com a primeira execução, dando
// "Uncaught SyntaxError: Identifier already declared" — e isso
// impedia o JavaScript de continuar a carregar na página inteira,
// nomeadamente o desenho do mapa.
// ─────────────────────────────────────────────────────────────
(function () {
console.log("✅ rm-convidado.js VERSÃO 2026-07-02-CVD-PAGADOR-UNICO-3 carregado");

let _cvdOverlay         = null;
let _cvdConvidados      = [];   // [{nome, contacto}]
let _cvdValorTotal      = 0;    // preço TOTAL da viagem (única, N passageiros)
let _cvdStripeCard      = null;
let _cvdStripe          = null;

// Pagador escolhido: "remetente" (default) ou "convidado".
// Quando "convidado", _cvdPagadorConvidadoIdx aponta para a posição
// na lista _cvdConvidados. NÃO é uma reserva por passageiro — é UMA
// viagem, UM pagador (se fosse dividir por passageiros era Partilhar).
let _cvdPagadorTipo         = "remetente";
let _cvdPagadorConvidadoIdx = -1;

// ── Abrir overlay ─────────────────────────────────────────────
function abrirModoConvidado() {
  _cvdConvidados = [];
  _cvdPagadorTipo = "remetente";
  _cvdPagadorConvidadoIdx = -1;
  _cvdKmCalculado = null;
  _construirOverlay();
  const ov = document.getElementById('cvdOverlay');
  ov.style.display = 'flex';
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  _cvdRenderLista();
  _cvdInitStripe();
  // _construirOverlay() só cria o DOM na primeira vez (depois disso
  // o overlay é reaproveitado) — por isso o pré-preenchimento de
  // partida/destino tem de ser repetido aqui, não só dentro de
  // _cvdBindEvents(), senão só funcionava da primeira vez que se
  // abria o painel nesta sessão.
  _cvdPreencherDadosViagem();
  const pEl = document.getElementById('cvdPartidaDisplay');
  const dEl = document.getElementById('cvdDestinoDisplay');
  if (pEl) { delete pEl.dataset.lat; delete pEl.dataset.lng; }
  if (dEl) { delete dEl.dataset.lat; delete dEl.dataset.lng; }
}

function fecharModoConvidado() {
  const ov = document.getElementById('cvdOverlay');
  if (!ov) return;
  ov.style.opacity = '0';
  setTimeout(() => { ov.style.display = 'none'; }, 260);
}

// ── Construir HTML do overlay (uma só vez) ────────────────────
function _construirOverlay() {
  if (document.getElementById('cvdOverlay')) return;

  const ov = document.createElement('div');
  ov.id = 'cvdOverlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:9500',
    'display:flex;align-items:center;justify-content:center',
    'background:rgba(0,0,0,.80);backdrop-filter:blur(16px)',
    'opacity:0;transition:opacity .26s ease',
  ].join(';');

  ov.innerHTML = `
    <style>
      /* Overlay (dropdown) do select de categoria — fundo preto sólido,
         igual ao padrão dos outros selects do sistema (ex: grupoSelect).
         Sem isto, o dropdown nativo herda o fundo claro do sistema
         operativo em alguns browsers, tornando o texto ilegível. */
      #cvdOverlay #cvdCategoria option {
        background: #000;
        color: var(--silver, #cdd2da);
      }
    </style>
    <div style="
      width:min(680px,96vw);max-height:92vh;display:flex;flex-direction:column;
      background:var(--c2,#0e1012);border:1px solid rgba(196,201,212,.14);
      border-radius:22px;box-shadow:0 32px 80px rgba(0,0,0,.9);overflow:hidden;
    ">
      <!-- HEADER -->
      <div style="padding:20px 24px 16px;border-bottom:1px solid var(--line,rgba(196,201,212,.10));display:flex;align-items:center;justify-content:space-between;flex:0 0 auto">
        <div>
          <div style="font-size:15px;font-weight:900;color:#fff;letter-spacing:.04em">&#x1F3AB; CONVIDADOS</div>
          <div style="font-size:10px;color:var(--silver-3,#5f6874);margin-top:3px">Seleccione quem paga e quem fica com convite de partilha</div>
        </div>
        <button onclick="fecharModoConvidado()" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:transparent;color:var(--silver-3);font-size:14px;cursor:pointer">&#x2715;</button>
      </div>

      <!-- BODY scroll -->
      <div style="overflow-y:auto;flex:1;padding:16px 20px">

        <!-- Detalhes da viagem -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          <div class="nm-wrap" style="position:relative">
            <label style="font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--silver-3);display:block;margin-bottom:4px">&#x1F4CD; PARTIDA</label>
            <input class="field" type="text" id="cvdPartidaDisplay" placeholder="Local de partida" autocomplete="new-password" style="padding:10px 12px;font-size:12px;width:100%">
            <div class="nm-dropdown" id="nmCvdPartida"></div>
          </div>
          <div class="nm-wrap" style="position:relative">
            <label style="font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--silver-3);display:block;margin-bottom:4px">&#x1F3C1; DESTINO</label>
            <input class="field" type="text" id="cvdDestinoDisplay" placeholder="Endereço de destino" autocomplete="new-password" style="padding:10px 12px;font-size:12px;width:100%">
            <div class="nm-dropdown" id="nmCvdDestino"></div>
          </div>
          <div>
            <label style="font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--silver-3);display:block;margin-bottom:4px">&#x1F697; CATEGORIA</label>
            <select class="field" id="cvdCategoria" style="padding:10px 12px;font-size:12px">
              <option value="economica">Económica</option>
              <option value="confort">Confort</option>
              <option value="executive">Executive</option>
              <option value="luxo">Luxo</option>
              <option value="grupo6">Grupo 6</option>
              <option value="grupo8">Grupo 8</option>
              <option value="grupo17">Grupo 17</option>
            </select>
          </div>
          <div>
            <label style="font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--silver-3);display:block;margin-bottom:4px">&#x1F4C5; DATA / HORA</label>
            <input class="field" type="datetime-local" id="cvdDatahora" style="padding:10px 12px;font-size:12px">
          </div>
        </div>

        <!-- Adicionar convidado -->
        <div style="background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;color:var(--silver-3);letter-spacing:.1em;margin-bottom:10px">ADICIONAR CONVIDADO</div>
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
            <div>
              <label style="font-size:9px;color:var(--silver-3);display:block;margin-bottom:4px">Nome</label>
              <input class="field" id="cvdNovoNome" placeholder="Nome do convidado" style="padding:9px 12px;font-size:12px;width:100%;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:9px;color:var(--silver-3);display:block;margin-bottom:4px">Contacto (tel/email)</label>
              <input class="field" id="cvdNovoContacto" placeholder="+351 912..." style="padding:9px 12px;font-size:12px;width:100%;box-sizing:border-box">
            </div>
            <button id="cvdBtnAdicionar" style="height:36px;padding:0 16px;border-radius:10px;border:1px solid rgba(196,201,212,.25);background:rgba(255,255,255,.06);color:#c4c9d4;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.12)'" onmouseout="this.style.background='rgba(255,255,255,.06)'">
              + ADICIONAR
            </button>
          </div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <button id="cvdBtnImportarContactos" style="font-size:10px;color:rgba(74,142,240,.8);background:none;border:none;cursor:pointer;padding:0;font-weight:600">
              &#x1F465; Importar dos meus contactos
            </button>
          </div>
        </div>

        <!-- Instrução simples: por defeito paga o remetente; clicar num convidado marca-o como pagador -->
        <div style="font-size:11px;color:var(--silver-3);margin-bottom:10px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;line-height:1.4">
          Por defeito, o pagamento fica <b style="color:#1fc97d">consigo</b>. Se quiser que um convidado pague, toque no botão "ESCOLHER" ao lado dele.
        </div>

        <!-- Lista de convidados -->
        <div id="cvdLista" style="display:flex;flex-direction:column;gap:6px;min-height:40px">
          <div style="text-align:center;color:var(--silver-3);font-size:11px;padding:12px">Sem convidados adicionados ainda.</div>
        </div>

        <!-- Resumo pagamento -->
        <div id="cvdResumo" style="display:none;margin-top:16px;background:rgba(31,201,125,.04);border:1px solid rgba(31,201,125,.18);border-radius:14px;padding:16px">
          <div style="font-size:10px;font-weight:700;color:var(--silver-3);letter-spacing:.1em;margin-bottom:10px">RESUMO DO PAGAMENTO</div>
          <div id="cvdResumoLinhas" style="font-size:12px;color:var(--silver-2);display:flex;flex-direction:column;gap:5px"></div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(31,201,125,.15);display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:var(--silver-2)">Total a pagar agora</span>
            <span id="cvdTotalDisplay" style="font-size:20px;font-weight:900;color:#1fc97d">€0.00</span>
          </div>
        </div>

        <!-- Stripe card input -->
        <div id="cvdStripeWrap" style="display:none;margin-top:14px">
          <div style="font-size:10px;font-weight:700;color:var(--silver-3);letter-spacing:.1em;margin-bottom:8px">&#x1F4B3; DADOS DO CARTÃO</div>
          <div id="cvdStripeElement" style="background:rgba(255,255,255,.04);border:1px solid var(--line-strong,rgba(196,201,212,.25));border-radius:12px;padding:14px"></div>
          <div id="cvdStripeError" style="color:var(--bad,#f87171);font-size:11px;margin-top:6px;display:none"></div>
        </div>

      </div>

      <!-- FOOTER -->
      <div style="padding:16px 20px;border-top:1px solid var(--line);flex:0 0 auto">
        <div id="cvdConvidadosNaoPagosInfo" style="font-size:10px;color:var(--silver-3);margin-bottom:10px;display:none">
          &#x2139;&#xFE0F; Os convidados sem marcação receberão um convite para pagarem a sua parte.
        </div>
        <button id="cvdBtnConfirmar" style="
          width:100%;padding:14px;border-radius:14px;border:none;cursor:pointer;
          background:linear-gradient(180deg,#e0e4ea,#bec6d1);
          color:#07080a;font-weight:900;font-size:14px;letter-spacing:.06em;
          box-shadow:0 4px 16px rgba(0,0,0,.4);opacity:.4;pointer-events:none;
          transition:.15s ease;
        ">CONFIRMAR E RESERVAR</button>
        <div id="cvdErroGlobal" style="color:var(--bad);font-size:11px;text-align:center;margin-top:8px;display:none"></div>
      </div>
    </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) fecharModoConvidado(); });
  _cvdBindEvents();
}

// ── Bind eventos do overlay ───────────────────────────────────
function _cvdBindEvents() {
  // Adicionar convidado
  document.getElementById('cvdBtnAdicionar').addEventListener('click', _cvdAdicionarConvidado);
  document.getElementById('cvdNovoContacto').addEventListener('keydown', e => { if (e.key === 'Enter') _cvdAdicionarConvidado(); });

  // Importar contactos
  document.getElementById('cvdBtnImportarContactos').addEventListener('click', _cvdImportarContactos);

  // Calcular ao mudar categoria
  document.getElementById('cvdCategoria').addEventListener('change', _cvdRecalcular);
  document.getElementById('cvdDatahora').addEventListener('change', _cvdRecalcular);

  // Recalcular também ao editar partida/destino directamente aqui
  document.getElementById('cvdPartidaDisplay').addEventListener('change', _cvdRecalcular);
  document.getElementById('cvdDestinoDisplay').addEventListener('change', _cvdRecalcular);

  // Autocomplete de endereço — mesma lógica já usada no Partilhar
  // (bindNmAutocomplete/nominatimSearch, definidas em rm-map.js).
  // Sem isto, os campos eram apenas texto livre, sem sugestões nem
  // coordenadas — o preço acabava a usar a distância da viagem
  // principal (ou 10km fixos), não a desta recolha/destino.
  const cvdPartidaEl = document.getElementById('cvdPartidaDisplay');
  const cvdDestinoEl = document.getElementById('cvdDestinoDisplay');
  if (typeof bindNmAutocomplete === 'function') {
    bindNmAutocomplete(cvdPartidaEl, document.getElementById('nmCvdPartida'), () => _cvdRecalcularDistancia());
    bindNmAutocomplete(cvdDestinoEl, document.getElementById('nmCvdDestino'), () => _cvdRecalcularDistancia());
  }

  // Confirmar
  document.getElementById('cvdBtnConfirmar').addEventListener('click', _cvdConfirmar);

  // Pré-preencher partida/destino da viagem actual
  _cvdPreencherDadosViagem();
}

// ── Recalcular a distância REAL entre a partida e o destino deste
//    ticket (quando ambos têm coordenadas), em vez de depender da
//    distância já calculada no painel principal de reserva. ──────
let _cvdKmCalculado = null;
async function _cvdRecalcularDistancia() {
  const pEl = document.getElementById('cvdPartidaDisplay');
  const dEl = document.getElementById('cvdDestinoDisplay');
  const pLat = pEl?.dataset?.lat, pLng = pEl?.dataset?.lng;
  const dLat = dEl?.dataset?.lat, dLng = dEl?.dataset?.lng;

  if (!pLat || !pLng || !dLat || !dLng) {
    _cvdRecalcular();
    return;
  }
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${dLng},${dLat}?overview=false`;
    const r = await fetch(osrmUrl);
    const d = await r.json();
    if (d.code === 'Ok' && d.routes?.length) {
      _cvdKmCalculado = Number((d.routes[0].distance / 1000).toFixed(2));
    }
  } catch (_) { /* mantém o valor anterior / reserva (_kmCalculado) */ }
  _cvdRecalcular();
}

// ── Pré-preencher com dados da viagem activa ──────────────────
function _cvdPreencherDadosViagem() {
  const partida = els?.inputPartida?.value || document.getElementById('inputPartida')?.value || '';
  const destino = els?.inputDestino?.value || document.getElementById('inputDestino')?.value || '';

  const pEl = document.getElementById('cvdPartidaDisplay');
  const dEl = document.getElementById('cvdDestinoDisplay');
  if (pEl) pEl.value = partida;
  if (dEl) dEl.value = destino;
}

// ── Adicionar convidado à lista ───────────────────────────────
function _cvdAdicionarConvidado() {
  const nome     = document.getElementById('cvdNovoNome')?.value.trim();
  const contacto = document.getElementById('cvdNovoContacto')?.value.trim();

  if (!nome || !contacto) {
    if (typeof showToast === 'function') showToast('Preencha nome e contacto.', 2500);
    return;
  }

  _cvdConvidados.push({ nome, contacto });
  document.getElementById('cvdNovoNome').value     = '';
  document.getElementById('cvdNovoContacto').value = '';
  _cvdRenderLista();
  _cvdRecalcular();
}

// ── Importar dos contactos guardados ─────────────────────────
async function _cvdImportarContactos() {
  let contactos = [];
  try {
    const r = await fetch('/api/admin/parceiros/me/contactos', { credentials: 'include' });
    const d = await r.json().catch(() => ({}));
    contactos = r.ok && Array.isArray(d?.contactos) ? d.contactos : [];
  } catch (_) {}

  if (!contactos.length) {
    if (typeof showToast === 'function') showToast('Sem contactos guardados.', 2500);
    return;
  }

  const existentes = new Set(_cvdConvidados.map(c => c.contacto));
  _cvdAbrirSeletorContactos(contactos, existentes);
}

// ── Seletor de contactos (checkboxes) — antes importava todos os
//    contactos de uma vez; agora abre uma lista para escolher quem
//    adicionar, igual ao padrão usado na Partilha. ────────────────
function _cvdAbrirSeletorContactos(contactos, existentes) {
  let modal = document.getElementById('cvdSeletorContactosModal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'cvdSeletorContactosModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9700;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75)';

  const linhas = contactos.map((c, i) => {
    const jaTem = existentes.has(c.tel);
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--line,rgba(196,201,212,.12));margin-bottom:6px;cursor:${jaTem ? 'default' : 'pointer'};opacity:${jaTem ? .45 : 1}">
        <input type="checkbox" class="cvd-contacto-check" data-idx="${i}" ${jaTem ? 'disabled' : ''} style="width:16px;height:16px;cursor:pointer">
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:700;color:#fff">${escapeHtml(c.nome || c.tel)}</div>
          <div style="font-size:11px;color:var(--silver-3,#5f6874)">${escapeHtml(c.tel)}${jaTem ? ' · já adicionado' : ''}</div>
        </div>
      </label>`;
  }).join('');

  modal.innerHTML = `
    <div style="width:min(420px,92vw);max-height:80vh;display:flex;flex-direction:column;background:var(--c2,#0e1012);border:1px solid rgba(196,201,212,.14);border-radius:18px;box-shadow:0 30px 70px rgba(0,0,0,.7);overflow:hidden">
      <div style="padding:16px 18px;border-bottom:1px solid var(--line,rgba(196,201,212,.10));display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:900;color:#fff">👥 Escolher contactos</div>
        <button id="cvdSelCancelar" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--line);background:transparent;color:var(--silver-3);font-size:13px;cursor:pointer">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:12px 14px">${linhas}</div>
      <div style="padding:14px 18px;border-top:1px solid var(--line,rgba(196,201,212,.10))">
        <button id="cvdSelConfirmar" style="width:100%;padding:12px;border-radius:12px;border:none;cursor:pointer;background:linear-gradient(180deg,#e0e4ea,#bec6d1);color:#07080a;font-weight:900;font-size:13px">ADICIONAR SELECCIONADOS</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('cvdSelCancelar').addEventListener('click', () => modal.remove());
  document.getElementById('cvdSelConfirmar').addEventListener('click', () => {
    const marcados = modal.querySelectorAll('.cvd-contacto-check:checked:not(:disabled)');
    if (!marcados.length) { modal.remove(); return; }
    marcados.forEach(chk => {
      const c = contactos[Number(chk.dataset.idx)];
      if (c) _cvdConvidados.push({ nome: c.nome, contacto: c.tel });
    });
    modal.remove();
    _cvdRenderLista();
    _cvdRecalcular();
  });
}

// ── Render lista de convidados ────────────────────────────────
function _cvdRenderLista() {
  const lista = document.getElementById('cvdLista');
  if (!lista) return;

  if (!_cvdConvidados.length) {
    lista.innerHTML = '<div style="text-align:center;color:var(--silver-3);font-size:11px;padding:12px">Sem convidados adicionados ainda.</div>';
    _cvdUpdateConfirmar();
    return;
  }

  lista.innerHTML = _cvdConvidados.map((c, i) => {
    const isPagador = _cvdPagadorTipo === "convidado" && i === _cvdPagadorConvidadoIdx;
    return `
    <div style="
      display:flex;align-items:center;gap:12px;padding:10px 14px;
      border-radius:12px;border:1px solid ${isPagador ? 'rgba(31,201,125,.3)' : 'rgba(255,255,255,.07)'};
      background:${isPagador ? 'rgba(31,201,125,.06)' : 'rgba(255,255,255,.025)'};
      transition:.12s;
    " data-ci="${i}">
      <!-- Radio: este convidado é o pagador (sempre visível — clique marca/desmarca) -->
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:0 0 auto" title="Clique para este convidado pagar a viagem toda">
        <div style="
          width:20px;height:20px;border-radius:50%;
          border:2px solid ${isPagador ? '#1fc97d' : 'rgba(255,255,255,.2)'};
          background:${isPagador ? '#1fc97d' : 'transparent'};
          display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.12s;
        " onclick="_cvdEscolherPagador(${i})">
          ${isPagador ? '<div style="width:8px;height:8px;border-radius:50%;background:#000"></div>' : ''}
        </div>
        <span style="font-size:9px;color:${isPagador ? '#1fc97d' : 'var(--silver-3)'};font-weight:700;white-space:nowrap">
          ${isPagador ? 'ELE PAGA' : 'ESCOLHER'}
        </span>
      </label>
      <!-- Info -->
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.nome)}</div>
        <div style="font-size:11px;color:var(--silver-3);margin-top:1px">${escapeHtml(c.contacto)}</div>
      </div>
      <!-- Remover -->
      <button onclick="_cvdRemover(${i})" style="background:none;border:none;color:rgba(248,113,113,.6);font-size:16px;cursor:pointer;padding:0 4px;line-height:1;flex:0 0 auto">&#x2715;</button>
    </div>`;
  }).join('');

  _cvdUpdateConfirmar();
}

// (segmentado do topo removido — a escolha faz-se clicando no
// próprio convidado; sem segmentado, deixámos de precisar de
// _cvdSincronizarSelectorPagador nem _cvdEscolherPagadorTipo.
// Mantidas as funções expostas em `window` só como no-ops para
// não partir código antigo.)

// ── Clicar num convidado marca-o como pagador; clicar de novo cancela ──
function _cvdEscolherPagador(i) {
  if (!_cvdConvidados[i]) return;
  if (_cvdPagadorTipo === "convidado" && _cvdPagadorConvidadoIdx === i) {
    // Segundo clique — cancela, volta para remetente
    _cvdPagadorTipo = "remetente";
    _cvdPagadorConvidadoIdx = -1;
  } else {
    _cvdPagadorTipo = "convidado";
    _cvdPagadorConvidadoIdx = i;
  }
  _cvdRenderLista();
  _cvdRecalcular();
}

function _cvdRemover(i) {
  _cvdConvidados.splice(i, 1);
  // Se removemos o pagador escolhido, cair para o primeiro (ou remetente se lista ficar vazia)
  if (_cvdPagadorTipo === "convidado") {
    if (!_cvdConvidados.length) {
      _cvdPagadorTipo = "remetente";
      _cvdPagadorConvidadoIdx = -1;
    } else if (i === _cvdPagadorConvidadoIdx) {
      _cvdPagadorConvidadoIdx = 0;
    } else if (i < _cvdPagadorConvidadoIdx) {
      _cvdPagadorConvidadoIdx -= 1;
    }
  }
  _cvdRenderLista();
  _cvdRecalcular();
}

// ── Recalcular total ──────────────────────────────────────────
async function _cvdRecalcular() {
  const categoria = document.getElementById('cvdCategoria')?.value;
  const partida   = document.getElementById('cvdPartidaDisplay')?.value;
  const destino   = document.getElementById('cvdDestinoDisplay')?.value;

  // Fetch preço TOTAL da viagem (é UMA corrida — não multiplicar por
  // convidados; isso pertenceria ao fluxo PARTILHAR).
  try {
    const r = await fetch(url('/quotes/quote'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria, distanciaKm: _cvdKmCalculado || _kmCalculado || 10, contexto: { origemTexto: partida, destinoTexto: destino } }),
    });
    const d = await r.json().catch(() => ({}));
    _cvdValorTotal = d?.ok ? Number(d.total) : 0;
  } catch (_) { _cvdValorTotal = 0; }

  const total = +Number(_cvdValorTotal || 0).toFixed(2);
  const remetentePaga = _cvdPagadorTipo === "remetente";
  const nomePagador = !remetentePaga && _cvdConvidados[_cvdPagadorConvidadoIdx]
    ? _cvdConvidados[_cvdPagadorConvidadoIdx].nome
    : null;

  // Elementos
  const resumoEl   = document.getElementById('cvdResumo');
  const linhasEl   = document.getElementById('cvdResumoLinhas');
  const totalEl    = document.getElementById('cvdTotalDisplay');
  const infoEl     = document.getElementById('cvdConvidadosNaoPagosInfo');
  const stripeWrap = document.getElementById('cvdStripeWrap');

  const nConv = _cvdConvidados.length;
  if (resumoEl) resumoEl.style.display = nConv ? 'block' : 'none';
  // Info só aparece quando é um convidado a pagar
  if (infoEl) {
    infoEl.style.display = (nConv && !remetentePaga) ? 'block' : 'none';
    if (nConv && !remetentePaga) {
      infoEl.textContent = nomePagador
        ? `ℹ️ ${nomePagador} irá receber um convite para pagar. A viagem só arranca após pagamento confirmado.`
        : 'ℹ️ O convidado escolhido irá receber um convite para pagar. A viagem só arranca após pagamento confirmado.';
    }
  }
  // Stripe só é preciso quando é o remetente a pagar agora
  if (stripeWrap) stripeWrap.style.display = (nConv && remetentePaga && total > 0) ? 'block' : 'none';

  if (linhasEl) {
    const linhaPagador = remetentePaga
      ? `<div style="display:flex;justify-content:space-between"><span>Paga agora</span><span style="color:#1fc97d">Eu (remetente)</span></div>`
      : `<div style="display:flex;justify-content:space-between"><span>Vai pagar</span><span style="color:#1fc97d">${escapeHtml(nomePagador || '—')}</span></div>`;
    linhasEl.innerHTML = [
      `<div style="display:flex;justify-content:space-between"><span>Passageiros</span><span>${nConv}</span></div>`,
      linhaPagador,
      total ? `<div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.06)"><span style="color:var(--silver-3)">Preço da viagem</span><span>€${total.toFixed(2)}</span></div>` : '',
    ].filter(Boolean).join('');
  }

  if (totalEl) totalEl.textContent = `€${total.toFixed(2)}`;

  _cvdUpdateConfirmar();
}

// ── Actualizar botão confirmar ────────────────────────────────
function _cvdUpdateConfirmar() {
  const btn = document.getElementById('cvdBtnConfirmar');
  if (!btn) return;
  const temConvidados = _cvdConvidados.length > 0;
  btn.style.opacity       = temConvidados ? '1' : '.4';
  btn.style.pointerEvents = temConvidados ? 'auto' : 'none';
}

// ── Init Stripe ───────────────────────────────────────────────
async function _cvdInitStripe() {
  if (_cvdStripe) return;
  try {
    // A chave pública vem sempre do servidor — nunca esteve definida
    // uma variável global STRIPE_PK; Stripe('') falhava em silêncio
    // (o catch engolia o erro), por isso o campo do cartão nunca
    // chegava a aparecer. Mesmo endpoint já usado em rm-payment.js.
    const { publicKey } = await fetch('/api/reservas/stripe/public-key', { credentials: 'include' }).then(r => r.json());
    if (!publicKey) throw new Error('Chave Stripe indisponível.');
    _cvdStripe = Stripe(publicKey);
    const elements = _cvdStripe.elements();
    _cvdStripeCard = elements.create('card', {
      style: {
        base: { color: '#c4c9d4', fontSize: '14px', '::placeholder': { color: '#5f6874' } },
        invalid: { color: '#f87171' }
      }
    });
    _cvdStripeCard.mount('#cvdStripeElement');
    _cvdStripeCard.addEventListener('change', e => {
      const errEl = document.getElementById('cvdStripeError');
      if (errEl) {
        errEl.style.display = e.error ? 'block' : 'none';
        errEl.textContent   = e.error?.message || '';
      }
    });
  } catch (err) {
    console.error('[Convidado] Falha ao iniciar Stripe:', err);
    const errEl = document.getElementById('cvdStripeError');
    if (errEl) {
      errEl.textContent = 'Não foi possível carregar o pagamento por cartão. ' + (err.message || '');
      errEl.style.display = 'block';
    }
  }
}

// ── Confirmar e reservar ──────────────────────────────────────
async function _cvdConfirmar() {
  const btn    = document.getElementById('cvdBtnConfirmar');
  const errEl  = document.getElementById('cvdErroGlobal');
  const total  = +Number(_cvdValorTotal || 0).toFixed(2);
  const remetentePaga = _cvdPagadorTipo === "remetente";

  if (!_cvdConvidados.length) return;
  if (errEl) errEl.style.display = 'none';

  if (!remetentePaga && (_cvdPagadorConvidadoIdx < 0 || !_cvdConvidados[_cvdPagadorConvidadoIdx])) {
    if (errEl) { errEl.textContent = 'Selecione qual convidado vai pagar.'; errEl.style.display = 'block'; }
    return;
  }

  const partida   = document.getElementById('cvdPartidaDisplay')?.value || '';
  const destino   = document.getElementById('cvdDestinoDisplay')?.value || '';
  const categoria = document.getElementById('cvdCategoria')?.value || 'economica';
  const datahora  = document.getElementById('cvdDatahora')?.value;

  if (!partida.trim() || !destino.trim()) {
    if (errEl) { errEl.textContent = 'Preencha a partida e o destino.'; errEl.style.display = 'block'; }
    return;
  }
  if (!datahora) {
    if (errEl) { errEl.textContent = 'Seleccione data e hora da viagem.'; errEl.style.display = 'block'; }
    return;
  }

  // Geocodificar como reserva — se o utilizador escreveu o endereço
  // mas não chegou a clicar numa sugestão do autocomplete, dataset.lat
  // fica vazio e o mapa de "Partilhas" nunca consegue desenhar a rota.
  const pElGeo = document.getElementById('cvdPartidaDisplay');
  const dElGeo = document.getElementById('cvdDestinoDisplay');
  if (typeof nominatimSearch === 'function') {
    if (!pElGeo.dataset.lat && partida.trim()) {
      const r = await nominatimSearch(partida.trim());
      if (r?.[0]) { pElGeo.dataset.lat = r[0].lat; pElGeo.dataset.lng = r[0].lon; }
    }
    if (!dElGeo.dataset.lat && destino.trim()) {
      const r = await nominatimSearch(destino.trim());
      if (r?.[0]) { dElGeo.dataset.lat = r[0].lat; dElGeo.dataset.lng = r[0].lon; }
    }
  }

  btn.textContent = 'A processar...';
  btn.style.opacity = '.6';
  btn.style.pointerEvents = 'none';

  let stripePaymentMethodId = null;

  // Stripe SÓ quando remetente paga (se for um convidado a pagar,
  // ele preencherá o cartão dele mais tarde ao abrir o ticket)
  if (remetentePaga && total > 0 && _cvdStripe && _cvdStripeCard) {
    try {
      const { paymentMethod, error } = await _cvdStripe.createPaymentMethod({
        type: 'card', card: _cvdStripeCard,
      });
      if (error) {
        if (errEl) { errEl.textContent = error.message; errEl.style.display = 'block'; }
        btn.textContent = 'CONFIRMAR E RESERVAR';
        btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
        return;
      }
      stripePaymentMethodId = paymentMethod.id;
    } catch (e) {
      if (errEl) { errEl.textContent = 'Erro Stripe: ' + e.message; errEl.style.display = 'block'; }
      btn.textContent = 'CONFIRMAR E RESERVAR';
      btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
      return;
    }
  }

  // POST ao backend
  try {
    const pEl = document.getElementById('cvdPartidaDisplay');
    const dEl = document.getElementById('cvdDestinoDisplay');
    const origemGeo = (pEl?.dataset?.lat && pEl?.dataset?.lng)
      ? { lat: Number(pEl.dataset.lat), lng: Number(pEl.dataset.lng), address: partida }
      : null;
    const destinoGeo = (dEl?.dataset?.lat && dEl?.dataset?.lng)
      ? { lat: Number(dEl.dataset.lat), lng: Number(dEl.dataset.lng), address: destino }
      : null;

    const data = await fetchJson(url('/convidado/reservar'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        convidados: _cvdConvidados,
        partida, destino, categoria,
        datahora, distanciaKm: _cvdKmCalculado || _kmCalculado || 10,
        origemGeo, destinoGeo,
        stripePaymentMethodId,
        pagadorTipo: _cvdPagadorTipo,
        pagadorConvidadoIdx: _cvdPagadorConvidadoIdx,
      }),
    });

    if (!data.ok) {
      // Backend pode devolver motivos concretos (ex: "Twilio: número
      // inválido") — muito mais úteis do que "Erro ao reservar."
      const motivos = data.motivos ? ' — ' + data.motivos : '';
      throw new Error((data.message || 'Erro ao reservar.') + motivos);
    }

    // Sucesso, mas verificar se houve notificações que falharam
    fecharModoConvidado();
    if (typeof showToast === 'function') {
      let msg;
      if (remetentePaga) {
        const n     = data.notificacoes || {};
        const total = data.totalPassageiros || _cvdConvidados.length;
        if (n.totalFalharam && n.totalFalharam > 0) {
          // Reserva feita e paga, mas alguns passageiros não foram
          // avisados — o remetente tem de saber, para poder ligar
          // ou enviar por outro canal.
          const falharam = n.detalhes
            .filter(d => !d.entregue)
            .map(d => d.nome)
            .join(', ');
          msg = `⚠️ Viagem reservada e paga — ${total} passageiro(s). Mas não foi possível avisar: ${falharam}. Verifique os contactos.`;
          showToast(msg, 8000);
        } else {
          msg = `✅ Viagem reservada e paga — ${total} passageiro${total > 1 ? 's' : ''} avisado${total > 1 ? 's' : ''}.`;
          showToast(msg, 5000);
        }
      } else {
        const canais = [];
        if (data.notificacaoPagador?.smsEnviado)   canais.push('SMS');
        if (data.notificacaoPagador?.emailEnviado) canais.push('email');
        const canalTxt = canais.length ? ` (${canais.join(' + ')})` : '';
        msg = `✅ Convite enviado a ${data.pagadorNome || 'convidado'}${canalTxt}. A viagem arranca após pagamento.`;
        showToast(msg, 5000);
      }
    }
    _cvdConvidados = [];
    _cvdPagadorTipo = "remetente";
    _cvdPagadorConvidadoIdx = -1;

  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Erro desconhecido.'; errEl.style.display = 'block'; }
    btn.textContent = 'CONFIRMAR E RESERVAR';
    btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
  }
}

// Expor globalmente (as funções são chamadas por onclick="" inline)
window.abrirModoConvidado       = abrirModoConvidado;
window.fecharModoConvidado      = fecharModoConvidado;
window._cvdRemover              = _cvdRemover;
window._cvdEscolherPagador      = _cvdEscolherPagador;
})();