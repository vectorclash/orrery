// ─── The library ──────────────────────────────────────────────────────────────
// What Infinite mode has played, and what you've kept. A song is a share link (see
// share.js), which plays it note for note whatever gets written later, so these lists
// keep working as the composer changes. An entry is a link and what to call it:
// { link, genre, root, scale, tempo, seconds, at }.
//
// Kept in this browser's storage, so they outlast a reload; where there is no storage
// (a private window, or it's full) they last as long as the page does.
const KEPT_KEY    = 'orrery.kept';
const RECENT_KEY  = 'orrery.recent';
const RECENT_MOST = 60;

function load(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key));
    return Array.isArray(list) ? list.filter(e => typeof e?.link === 'string') : [];
  } catch { return []; }
}

function save(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* see above */ }
}

export const library = {
  kept:   load(KEPT_KEY),   // newest first
  recent: load(RECENT_KEY), // Infinite's history, in the order PREV and NEXT walk it

  // A song starts that isn't from the history: it goes in at `place`. Returns where
  // it ended up, once the oldest has gone if the list was full.
  played(entry, place) {
    this.recent.splice(place, 0, entry);
    if (this.recent.length > RECENT_MOST) { this.recent.shift(); place--; }
    save(RECENT_KEY, this.recent);
    return place;
  },

  isKept(link) { return this.kept.some(e => e.link === link); },

  keep(entry) {
    if (this.isKept(entry.link)) return;
    this.kept.unshift({ ...entry, at: Date.now() });
    save(KEPT_KEY, this.kept);
  },

  unkeep(link) {
    this.kept = this.kept.filter(e => e.link !== link);
    save(KEPT_KEY, this.kept);
  },
};
