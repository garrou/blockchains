// The bar on top of the 3D scene (title, follow toggle, layout order and placement, details button), the scene message,
// the status pill.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const { $, el } = Explorer.dom;

  const ORDER_KEY = 'layoutOrder', PLACEMENT_KEY = 'layoutPlacement', COLOR_KEY = 'colorBy';

  const picked = new Set(); // the kinds of the legend that the person chose to show alone (the colors of the towers), none: all of them
  let onKindFilter = () => {};

  /** A <select> whose choice is remembered between visits. Calls onChange(value) on a change; returns the value to start with. */
  function rememberedSelect(selector, key, onChange) {
    const select = $(selector);
    try {
      const saved = localStorage.getItem(key);
      if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
    } catch { /* storage unavailable */ }
    select.addEventListener('change', () => {
      try { localStorage.setItem(key, select.value); } catch { /* storage unavailable */ }
      onChange(select.value);
    });
    return select.value;
  }

  /**
   * The legend of what the towers are colored by: the fee scale (gradient and ticks come from the very stops the towers are colored with:
   * the chain's rates) or, for colors by kind, a swatch for each kind. A chain can switch between the two (chain.colorSwitch).
   */
  function renderLegend() {
    const hint = $('#color-hint'); // "height & color = price": by kind, the color no longer says the price
    if (hint) {
      hint.dataset.price ??= hint.textContent;
      hint.textContent = Explorer.colors.mode === 'kind' ? `${hint.dataset.price.replace(/^height & color/, 'height')} · color = kind` : hint.dataset.price;
    }
    const legend = Explorer.chain.legend;
    if (legend && Explorer.colors.mode === 'kind') return renderCategories(legend);
    const scale = $('.legend-scale');
    scale.classList.remove('categories');
    scale.replaceChildren(el('i', { id: 'legend-bar' }), el('span', { id: 'legend-ticks' }));
    const C = Explorer.colors, rates = Explorer.chain.rates, label = rates.label ?? String, at = (r) => `${(C.position(r) * 100).toFixed(1)}%`;
    const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
    $('#legend-bar').style.background = `linear-gradient(90deg, ${C.stops.map((s) => `${css(s.hex)} ${at(s.rate)}`).join(', ')})`;
    $('#legend-ticks').replaceChildren(...rates.ticks.map((r) =>
      el('span', { style: `left:${at(r)}`, class: r === C.MIN_RATE ? 'first' : '' }, label(r))));
    $('#legend-max').textContent = `${label(C.MAX_RATE)}+ ${rates.unit}`; // the right end of the bar: this rate and above look the same
  }

  /** The swatches say which kinds are shown alone: those are lit, the others fade. */
  function paintKinds() {
    document.querySelectorAll('.legend-scale .kind').forEach((b) => {
      const on = picked.has(Number(b.dataset.color));
      b.classList.toggle('on', on);
      b.classList.toggle('off', picked.size > 0 && !on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** The choice of kinds is forgotten (the colors no longer mean kinds, or the scene starts afresh). */
  function clearKinds() {
    if (!picked.size) return;
    picked.clear();
    paintKinds();
    onKindFilter(null);
  }

  /** A chain whose colors name a kind of tower rather than a rate (chain.legend): a swatch and a word for each kind. */
  function renderCategories(legend) {
    const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
    const scale = $('.legend-scale');
    scale.classList.add('categories');
    const buttons = legend.items.map((it) => el('button', {
      type: 'button', class: 'kind', 'aria-pressed': 'false', title: `Show only: ${it.label}`, 'data-color': String(it.color),
      onclick: () => { picked.has(it.color) ? picked.delete(it.color) : picked.add(it.color); paintKinds(); onKindFilter(picked.size ? new Set(picked) : null); },
    }, el('i', { style: `background:${css(it.color)}` }), it.label));
    scale.replaceChildren(...buttons);
    paintKinds();
    $('#legend-max').textContent = legend.note ?? 'click a kind to show only it';
  }

  Explorer.ui.hud = {
    /**
     * handlers: onFollow(bool), onOrder(mode), onPlacement(mode), onColorBy(mode), onKindFilter(Set of tower colors | null), onDetails().
     * Returns {order, placement}: the layout choices to start with (the remembered ones, if any).
     */
    init(handlers) {
      onKindFilter = handlers.onKindFilter ?? (() => {});
      if (Explorer.chain.colorSwitch && $('#colorby')) { // price or kind: the colors are decided before anything is drawn
        const apply = (mode) => { if (Explorer.colors.setMode(mode)) { clearKinds(); renderLegend(); } };
        apply(rememberedSelect('#colorby', COLOR_KEY, (mode) => { apply(mode); handlers.onColorBy?.(mode); }));
      }
      renderLegend();
      const order = rememberedSelect('#order', ORDER_KEY, handlers.onOrder);
      const placement = rememberedSelect('#placement', PLACEMENT_KEY, handlers.onPlacement);
      $('#follow').checked = Explorer.state.follow; // a browser may restore the checkbox of the previous visit
      $('#follow').addEventListener('change', (e) => handlers.onFollow(e.target.checked));
      $('#hud-details').addEventListener('click', () => handlers.onDetails());
      return { order, placement };
    },
    /** No 3D view: hides it, with the reason (nothing else says why the page has no scene). */
    hideStage(reason) {
      const stage = $('.stage');
      stage.hidden = true;
      if (reason) stage.before(Explorer.dom.el('p', { class: 'no3d' }, `3D view off: ${reason}`));
    },
    setFollow(on) { $('#follow').checked = on; },
    setMessage(text) { $('#scene-msg').textContent = text; },
    setStatus(online) {
      const pill = $('#status');
      pill.textContent = online ? 'live' : 'offline';
      pill.className = `pill ${online ? 'on' : 'off'}`;
    },
    /** m: first projected block from the mempool (may be undefined). The sentence under the title is the chain's. */
    showNext(m) {
      $('#hud-title').textContent = 'Next block';
      $('#hud-sub').textContent = Explorer.chain.nextLine(m);
      $('#hud-details').hidden = true;
    },
    showBlock(b) {
      $('#hud-title').textContent = `Block #${Explorer.chain.blockNumber(b)}`;
      $('#hud-sub').textContent = Explorer.chain.blockLine(b);
      $('#hud-details').hidden = false;
    },
  };
})();
