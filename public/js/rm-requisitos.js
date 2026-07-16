/* ============================================================
   rm-requisitos.js — REALMETROPOLIS
   Módulo partilhado: botões de requisitos especiais
   (cadeira de ovo / cadeirinha / assento de elevação) + popup
   de quantidade. Usado por hotel-dashboard.html, minha-conta.html
   e qualquer outra página que tenha o painel de Reserva Privada
   com os elementos:
     .req-esp-btn[data-req][data-label]  — botões (3, lado a lado)
     #reqQtyOverlay / #reqQtyBox / #reqQtyTitle /
     #reqQtyStepper / #reqQtyVal / #reqQtyMinus / #reqQtyPlus /
     #reqQtyCancel / #reqQtyOk
   Cada página é responsável apenas pelo HTML/CSS (dimensões e
   estilo podem variar entre páginas); este ficheiro trata
   exclusivamente do comportamento.

   Estado exposto: window.requisitosEspeciais = { ovo: 2, ... }
   Lido por rm-core.js (e equivalente em minha-conta.html) ao
   montar o payload da reserva.
   ============================================================ */
(function () {
  'use strict';

  const MAX_QTY = 4;
  const MIN_QTY = 1;
  const SEL_CLASSES = ['sel', 'selected']; // hotel-dashboard usa "sel", minha-conta usa "selected"

  function addSelected(btn) { SEL_CLASSES.forEach(c => btn.classList.add(c)); }
  function removeSelected(btn) { SEL_CLASSES.forEach(c => btn.classList.remove(c)); }
  function isSelected(btn) { return SEL_CLASSES.some(c => btn.classList.contains(c)); }

  function initRequisitosEspeciais() {
    const overlay   = document.getElementById('reqQtyOverlay');
    const btns      = document.querySelectorAll('.req-esp-btn');
    if (!overlay || !btns.length) return; // página sem este painel — não faz nada

    const valEl   = document.getElementById('reqQtyVal');
    const titleEl = document.getElementById('reqQtyTitle');
    const minusEl = document.getElementById('reqQtyMinus');
    const plusEl  = document.getElementById('reqQtyPlus');
    const cancelEl = document.getElementById('reqQtyCancel');
    const okEl     = document.getElementById('reqQtyOk');

    if (!valEl || !titleEl || !minusEl || !plusEl || !cancelEl || !okEl) {
      console.warn('[rm-requisitos] Popup incompleto — elementos em falta no HTML.');
      return;
    }

    window.requisitosEspeciais = window.requisitosEspeciais || {};

    let btnAtual = null;
    let qtyTemp = MIN_QTY;

    function abrir(btn) {
      btnAtual = btn;
      qtyTemp = clamp(parseInt(window.requisitosEspeciais[btn.dataset.req], 10) || MIN_QTY);
      valEl.textContent = qtyTemp;
      titleEl.textContent = btn.dataset.label || 'Quantidade';
      overlay.classList.add('open');
      okEl.focus();
    }

    function fechar() {
      overlay.classList.remove('open');
      btnAtual = null;
    }

    function clamp(n) { return Math.min(MAX_QTY, Math.max(MIN_QTY, n)); }

    function confirmar() {
      if (btnAtual) {
        window.requisitosEspeciais[btnAtual.dataset.req] = qtyTemp;
        addSelected(btnAtual);
        const qtyEl = btnAtual.querySelector('.req-esp-qty');
        if (qtyEl) qtyEl.textContent = qtyTemp;
      }
      fechar();
    }

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (isSelected(btn)) {
          removeSelected(btn);
          delete window.requisitosEspeciais[btn.dataset.req];
          return;
        }
        abrir(btn);
      });
    });

    minusEl.addEventListener('click', () => { qtyTemp = clamp(qtyTemp - 1); valEl.textContent = qtyTemp; });
    plusEl.addEventListener('click',  () => { qtyTemp = clamp(qtyTemp + 1); valEl.textContent = qtyTemp; });
    cancelEl.addEventListener('click', fechar);
    okEl.addEventListener('click', confirmar);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') fechar();
      if (e.key === 'Enter')  confirmar();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequisitosEspeciais);
  } else {
    initRequisitosEspeciais();
  }
})();
