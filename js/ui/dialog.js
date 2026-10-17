// The dialog that shows the detail of a block, a transaction or an address. This is only the shell: opening, closing,
// "Loading…", messages. What goes inside is drawn by the chain (Bitcoin: chains/bitcoin/ui/detail.js).
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const { $, el } = Explorer.dom;

  const dialog = $('#detail');
  const body = $('#detail-body');

  /** Replaces the content and opens the dialog if it is closed. Accepts nodes and arrays of nodes; null/false are skipped. */
  function show(...nodes) {
    body.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
    if (!dialog.open) {
      document.getElementById('copylink')?.toggleAttribute('hidden', !/[#&]q=/.test(location.hash));
      dialog.showModal();
      dialog.focus(); // showModal() focuses the close button, which then shows a focus ring on top of its hover border
    }
  }

  Explorer.ui.dialog = {
    init() {
      $('#close').addEventListener('click', () => dialog.close());
      // a link to what the dialog shows (the address bar says it, see controllers/links.js)
      const copy = el('button', { type: 'button', id: 'copylink', title: 'Copy a link to this view', 'aria-label': 'Copy a link to this view', hidden: '' }, '🔗');
      copy.addEventListener('click', () => {
        const url = Explorer.link.url();
        const done = () => { copy.textContent = '✓'; setTimeout(() => { copy.textContent = '🔗'; }, 1200); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
        else window.prompt('Copy this link:', url);
      });
      $('#close').before(copy);
      // Close on a click on the backdrop only (not on the dialog's own padding), and only if the press began there too: a
      // tap on the 3D scene opens the dialog on pointerup, and the click the browser synthesizes right after lands on the
      // backdrop; it has no press of its own on the dialog and must not close it.
      const onBackdrop = (e) => {
        if (e.target !== dialog) return false;
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOnBackdrop = false;
      dialog.addEventListener('pointerdown', (e) => { pressedOnBackdrop = onBackdrop(e); });
      dialog.addEventListener('click', (e) => { if (pressedOnBackdrop && onBackdrop(e)) dialog.close(); pressedOnBackdrop = false; });
      dialog.addEventListener('close', () => { pressedOnBackdrop = false; Explorer.link?.restore(); });
    },
    show,
    close() { if (dialog.open) dialog.close(); },
    isOpen: () => dialog.open,
    loading(text = 'Loading…') { show(el('p', { class: 'muted' }, text)); },
    message(text) { show(el('p', {}, text)); },
  };
})();
