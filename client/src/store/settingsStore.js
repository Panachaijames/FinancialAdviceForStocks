// Zustand settings store with localStorage persistence.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      displayCurrency: 'USD',
      language: 'en', // UI language: 'en' | 'th' (lib/i18n.js). Tax panels are Thai regardless.
      refreshMs: 5000,
      analysisGoal: '', // user's stated objective for the AI Insights panel
      analysisAge: '', // optional age -> lets the AI reason about risk capacity / horizon
      // UI effects: 'on' (default) forces animations even where the OS asks for
      // reduced motion (e.g. Windows boxes where IT disabled animation effects),
      // 'auto' follows the OS setting, 'off' disables them. Resolved by
      // lib/motion.js onto <html data-motion>.
      fxMode: 'on',
      // Glassmorphism: frosted translucent panels over the aurora. Stamped by
      // main.jsx onto <html data-glass>.
      glassMode: false,
      // Privacy mode: blur money values (shared-screen use). Stamped by main.jsx
      // onto <html data-private>; CSS blurs elements with the .pm-mask class.
      privacy: false,
      // Holdings grid ordering. key: 'added'|'value'|'day'|'pl'|'symbol'; dir: 'asc'|'desc'.
      // Default 'added'/'asc' reproduces the historical insertion order exactly.
      holdingsSort: { key: 'added', dir: 'asc' },

      /**
       * Set the display currency ('USD' | 'THB').
       */
      setDisplayCurrency(c) {
        const cur = c === 'THB' ? 'THB' : 'USD';
        set({ displayCurrency: cur });
      },

      /**
       * Toggle between USD and THB.
       */
      toggleCurrency() {
        set({ displayCurrency: get().displayCurrency === 'USD' ? 'THB' : 'USD' });
      },

      /** Set the UI language ('en' | 'th'). */
      setLanguage(l) {
        set({ language: l === 'th' ? 'th' : 'en' });
      },
      /** Toggle between English and Thai. */
      toggleLanguage() {
        set({ language: get().language === 'th' ? 'en' : 'th' });
      },

      /**
       * Set the user's AI-analysis goal (capped so it stays a short objective).
       */
      setAnalysisGoal(v) {
        set({ analysisGoal: typeof v === 'string' ? v.slice(0, 500) : '' });
      },

      /** Set the user's age for risk-capacity reasoning (kept as a raw string). */
      setAnalysisAge(v) {
        set({ analysisAge: typeof v === 'string' ? v.replace(/[^0-9]/g, '').slice(0, 3) : '' });
      },

      /** Set the UI effects mode: 'auto' | 'on' | 'off'. */
      setFxMode(m) {
        set({ fxMode: m === 'on' || m === 'off' ? m : 'auto' });
      },

      /** Toggle / set glassmorphism panels. */
      setGlassMode(v) {
        set({ glassMode: !!v });
      },
      toggleGlassMode() {
        set({ glassMode: !get().glassMode });
      },

      /** Toggle / set privacy mode (blur money values). */
      setPrivacy(v) {
        set({ privacy: !!v });
      },
      togglePrivacy() {
        set({ privacy: !get().privacy });
      },

      /**
       * Set the refresh interval in milliseconds (clamped to a sane range).
       */
      setRefreshMs(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return;
        const clamped = Math.max(1000, Math.min(60000, v));
        set({ refreshMs: clamped });
      },

      /** Set holdings sort; validates key/dir and merges partial patches. */
      setHoldingsSort(patch) {
        const VALID = ['added', 'value', 'day', 'pl', 'symbol'];
        const cur = get().holdingsSort || { key: 'added', dir: 'asc' };
        const next = { ...cur, ...(patch || {}) };
        if (!VALID.includes(next.key)) next.key = 'added';
        next.dir = next.dir === 'desc' ? 'desc' : 'asc';
        set({ holdingsSort: next });
      },
    }),
    {
      name: 'pt-settings',
      version: 4,
      // v1 -> v2: effects now default ON (the user wants animations even on
      // machines whose OS asks for reduced motion). Users who explicitly chose
      // 'off' keep it; everyone still on the old 'auto' default is upgraded.
      // v2 -> v3: holdingsSort added with a safe default.
      // v3 -> v4: UI language added, defaulting to English.
      // NOTE: never bump `version` without a migrate fn — persist would
      // otherwise DISCARD the saved state.
      migrate(persisted, version) {
        const state = persisted || {};
        if (version < 2) {
          if (state.fxMode !== 'off') state.fxMode = 'on';
          if (typeof state.glassMode !== 'boolean') state.glassMode = false;
        }
        if (!state.holdingsSort || typeof state.holdingsSort !== 'object' || typeof state.holdingsSort.key !== 'string') {
          state.holdingsSort = { key: 'added', dir: 'asc' };
        }
        if (state.language !== 'th' && state.language !== 'en') state.language = 'en';
        return state;
      },
    }
  )
);
