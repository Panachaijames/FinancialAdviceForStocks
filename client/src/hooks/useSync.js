// Mounts the cross-device sync engine once: pulls newer remote data on load and
// pushes local changes (debounced) whenever a synced store changes.
import { useEffect, useRef } from 'react';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSavingsStore } from '../store/savingsStore.js';
import { useFundsStore } from '../store/fundsStore.js';
import { useSyncStore } from '../store/syncStore.js';
import { pushNow, pullNow, isApplying } from '../lib/sync.js';

export default function useSync() {
  const code = useSyncStore((s) => s.code);
  const timer = useRef(null);

  // Pull newer remote data when a code is set / on mount.
  useEffect(() => {
    if (!code) return;
    pullNow().catch(() => useSyncStore.getState().setSync({ status: 'error', error: 'Could not reach sync server' }));
  }, [code]);

  // Debounced push whenever local data changes (skip while applying a pull).
  useEffect(() => {
    if (!code) return undefined;
    const schedule = () => {
      if (isApplying()) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        pushNow().catch(() => useSyncStore.getState().setSync({ status: 'error', error: 'Could not reach sync server' }));
      }, 1500);
    };
    const unsubs = [
      usePortfolioStore.subscribe(schedule),
      useSavingsStore.subscribe(schedule),
      useFundsStore.subscribe(schedule),
    ];
    return () => {
      clearTimeout(timer.current);
      unsubs.forEach((u) => u());
    };
  }, [code]);
}
