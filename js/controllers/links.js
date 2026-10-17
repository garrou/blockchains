// Links to a view: the address bar says what the page shows (`#q=<what you would type in the search box>`: a block number, a
// transaction, an address...), so that a link can be sent, and the Back button works. Opening such a link runs the search.
//   - a search, a transaction / block / address page opened (the chains call Explorer.link.set), push an entry
//   - a block chosen by hand moves the "camera" link; closing a dialog goes back to it in the history, so Forward opens it again
//   - Back / Forward (or a pasted link) run the search again
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});

  let current = null;      // the query in the address bar (null: none)
  let camera = null;       // the query of the block the camera was sent to by a person
  let depth = 0;           // history entries pushed for the dialogs on screen: closing them goes back this far
  let applying = 0;        // while a link is being opened, what that opening sets is not a new entry
  let returning = 0;       // closing a dialog went back in the history: that Back only returns to the camera, nothing is to be opened
  let runSearch = null;

  const fromHash = () => { const m = /[#&]q=([^&]*)/.exec(location.hash); try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; } };

  /** kind: 'dialog' or 'camera': what the entry is for (kept in the entry, so that a Back / Forward to it knows). */
  function write(text, replace, kind = 'camera') {
    const url = location.pathname + location.search + (text ? `#q=${encodeURIComponent(text)}` : '');
    try { (replace ? history.replaceState : history.pushState).call(history, { explorer: kind }, '', url); }
    catch { location.hash = text ? `q=${encodeURIComponent(text)}` : ''; } // a page opened from disk may refuse the history API
    current = text;
    document.getElementById('copylink')?.toggleAttribute('hidden', !text);
  }

  /** What is on screen can be found again by typing `text` in the search box. */
  function set(text) {
    if (text == null || text === '') return;
    text = String(text);
    if (text === current) return;
    if (applying) { write(text, true, 'dialog'); return; } // opening a link: what the chain shows (an address for a name...) replaces the entry, it is not a new one
    write(text, false, 'dialog');
    depth++;
  }

  /** The camera was sent to a block by a person: `text` is its number. */
  function setCamera(text) {
    const replace = applying > 0 || (current !== null && current === camera); // a camera move replaces the previous camera link
    camera = String(text);
    if (camera !== current) { write(camera, replace); if (!applying) depth = 0; }
  }

  /** The dialog was closed: the address bar goes back to the camera (or to the page). */
  function restore() {
    if (applying) return;
    if (depth > 0) { // the entries of the dialogs were pushed by this page: going back through them returns to the camera
      const back = depth;
      depth = 0;
      applying++;
      returning++;
      setTimeout(() => { applying--; returning = Math.max(0, returning - 1); }, 1500); // (a browser that never says it went back must not swallow a later Back)
      history.go(-back);
      return;
    }
    if (current !== camera) write(camera, true);
  }

  /** Opens what the address bar says: the search runs as if it had been typed. */
  function open() {
    const q = fromHash();
    applying++;
    setTimeout(() => { applying--; }, 1500); // while it opens, what the chains show replaces the entry instead of adding one
    current = q;
    depth = history.state && history.state.explorer === 'dialog' ? 1 : 0; // a dialog entry this page pushed, reached by Back / Forward: closing goes back once (a pasted link has nothing before it)
    if (q === null) { Explorer.ui.dialog.close(); return; }
    const input = document.querySelector('#q');
    if (input) input.value = q;
    runSearch(q);
  }

  Explorer.link = {
    set, setCamera, restore,
    /** search(text): what the search box does. The link of the page is opened once the first blocks are there. */
    init(search) {
      runSearch = search;
      window.addEventListener('popstate', () => {
        if (returning) { returning = 0; current = fromHash(); depth = 0; return; } // our own way back, maybe late: what is on screen now is not to be closed
        open();
      });
      if (fromHash() === null) return;
      const started = Date.now();
      const wait = setInterval(() => {
        if (Explorer.state.blocks.length || Date.now() - started > 20000) { clearInterval(wait); open(); }
      }, 300);
    },
    /** The link to the view, for the "Copy link" button. */
    url: () => location.href,
  };
})();
