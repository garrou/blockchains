// Minimal DOM helpers shared by the views.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});

  const $ = (selector) => document.querySelector(selector);

  /** Creates an element: props are attributes ('class', 'on<event>' for listeners), kids are nodes or strings. */
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    n.append(...kids.flat().filter((c) => c != null && c !== false));
    return n;
  }

  /** 'smooth' for the scrolling the page does by itself, 'auto' (at once) for a person who asked for less motion. */
  const scrollBehavior = () => (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

  /**
   * Runs `render` (which replaces the children of `container`), then gives the focus back to the element that had it, found again by its
   * data-id or data-txid: a person who moves through a list with the keyboard must not lose their place when the list refreshes.
   */
  function keepFocus(container, render) {
    const a = document.activeElement;
    const attr = a && a !== document.body && container.contains(a) ? (a.dataset.id != null ? 'data-id' : a.dataset.txid != null ? 'data-txid' : null) : null;
    const key = attr && a.getAttribute(attr);
    render();
    const again = attr && [...container.querySelectorAll(`[${attr}]`)].find((n) => n.getAttribute(attr) === key);
    if (again) again.focus({ preventScroll: true });
  }

  Explorer.dom = { $, el, scrollBehavior, keepFocus };
  Explorer.ui = Explorer.ui || {};
})();
