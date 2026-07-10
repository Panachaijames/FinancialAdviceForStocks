// Zustand settings store with localStorage persistence.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      displayCurrency: 'USD',
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

      /**
       * Set the refresh interval in milliseconds (clamped to a sane range).
       */
      setRefreshMs(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return;
        const clamped = Math.max(1000, Math.min(60000, v));
        set({ refreshMs: clamped });
      },
    }),
    {
      name: 'pt-settings',
      version: 2,
      // v1 -> v2: effects now default ON (the user wants animations even on
      // machines whose OS asks for reduced motion). Users who explicitly chose
      // 'off' keep it; everyone still on the old 'auto' default is upgraded.
      // NOTE: never bump `version` without a migrate fn — persist would
      // otherwise DISCARD the saved state.
      migrate(persisted) {
        const state = persisted || {};
        if (state.fxMode !== 'off') state.fxMode = 'on';
        if (typeof state.glassMode !== 'boolean') state.glassMode = false;
        return state;
      },
    }
  )
);
