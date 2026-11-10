// ─── Orrery's home moved ──────────────────────────────────────────────────────
// Orrery lived at vectorclash.com/orrery/ and now lives at its own subdomain.
// The same files still answer at the old address, and this, run before
// anything else on the page (main.js imports it first), sends a visitor on.
//
// What the site keeps in the browser -- the library's kept and recent songs,
// the KALEIDOSCOPE and ERAS/SONGS choices -- belongs to the address it was
// saved at, and the new one starts with none of it; no server redirect can
// carry it. So the old address brings it along in the link (`move=`, beside
// any `c=` share link), and the new one merges it in -- every song on either
// side kept -- and takes it back out of the address bar. Each browser moves
// its own the first time it opens the old address.
//
// The same carries a library from one browser to another, by hand: COPY
// LIBRARY in the library (main.js) makes a link with its songs in it
// (`library=`, compressed), and opening that link elsewhere merges them in
// and opens the library, saying how many came.
export const HOME = 'https://orrery.vectorclash.com/';
const OLD_HOSTS = new Set(['vectorclash.com', 'www.vectorclash.com']);
const PREFIX = 'orrery.';
const RECENT_MOST = 60; // as library.js keeps

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const fromBase64Url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

function stored() {
  const items = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) items[k] = localStorage.getItem(k);
    }
  } catch { /* no storage: nothing to bring */ }
  return items;
}

// Squeezed and unsqueezed, as a link carries a library (deflate, without its header).
const through = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export const canCopyLibrary = typeof CompressionStream === 'function';
const LIBRARY_KEYS = ['orrery.kept', 'orrery.recent'];

// A link that brings this browser's library -- its kept and recent songs, not
// its settings, which are this device's own -- into any other.
export async function libraryLink() {
  const items = {};
  for (const k of LIBRARY_KEYS) { const v = localStorage.getItem(k); if (v) items[k] = v; }
  const packed = await through(new TextEncoder().encode(JSON.stringify(items)), new CompressionStream('deflate-raw'));
  // To this page's own address: the live site's, or a local copy's while it's tried out.
  return `${location.origin}${location.pathname}#library=${toBase64Url(packed)}`;
}

// What a library link brought, once merged: { kept, recent }, the songs new
// here; null if the page wasn't opened with one.
export let arrival = null;

const list = s => { try { const l = JSON.parse(s); return Array.isArray(l) ? l : []; } catch { return []; } };

// What arrived, into what's here. Settings only where there's none here;
// kept songs together, newest first; the recent ones in the order they were
// heard, the old address's first.
function merge(items) {
  for (const [k, v] of Object.entries(items)) {
    if (typeof v !== 'string' || !k.startsWith(PREFIX)) continue;
    const here = localStorage.getItem(k);
    if (k === 'orrery.kept') {
      const all = [...list(here), ...list(v)].filter((e, i, a) => typeof e?.link === 'string' && a.findIndex(x => x.link === e.link) === i);
      all.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      localStorage.setItem(k, JSON.stringify(all));
    } else if (k === 'orrery.recent') {
      const ours = list(here), links = new Set(ours.map(e => e.link));
      const all = [...list(v).filter(e => typeof e?.link === 'string' && !links.has(e.link)), ...ours];
      localStorage.setItem(k, JSON.stringify(all.slice(-RECENT_MOST)));
    } else if (here === null) {
      localStorage.setItem(k, v);
    }
  }
}

const params = new URLSearchParams(location.hash.slice(1));

if (OLD_HOSTS.has(location.hostname)) {
  const items = stored();
  if (Object.keys(items).length) params.set('move', toBase64Url(new TextEncoder().encode(JSON.stringify(items))));
  const hash = params.toString();
  location.replace(HOME + (hash ? `#${hash}` : ''));
  await new Promise(() => {}); // the app never starts here: the page is leaving
} else if (params.has('library')) {
  try {
    const items = JSON.parse(new TextDecoder().decode(await through(fromBase64Url(params.get('library')), new DecompressionStream('deflate-raw'))));
    const links = k => new Set(list(localStorage.getItem(k)).map(e => e.link));
    const before = { kept: links('orrery.kept'), recent: links('orrery.recent') };
    merge(Object.fromEntries(Object.entries(items).filter(([k]) => LIBRARY_KEYS.includes(k))));
    const added = k => [...links(k)].filter(l => !before[k.slice(7)].has(l)).length;
    arrival = { kept: added('orrery.kept'), recent: added('orrery.recent') };
    localStorage.setItem('orrery.infinite', 'songs'); // where the library is
  } catch (err) { console.error('Orrery: the library in this link could not be read', err); }
  params.delete('library');
  const hash = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (hash ? `#${hash}` : ''));
} else if (params.has('move')) {
  try { merge(JSON.parse(new TextDecoder().decode(fromBase64Url(params.get('move'))))); } catch (err) { console.error('Orrery: what the old address sent could not be read', err); }
  params.delete('move');
  const hash = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (hash ? `#${hash}` : ''));
}

// A library link pasted into a tab Orrery is already open in changes only the
// address's #, which loads nothing: load it, so the library is read as above.
addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).has('library')) location.reload();
});
