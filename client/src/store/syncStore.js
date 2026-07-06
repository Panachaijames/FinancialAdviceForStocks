// Cross-device sync settings (persisted). `code` links this device to a shared
// data bucket on the server; `updatedAt` is the last sync stamp we've seen so we
// only apply strictly-newer remote data (last-write-wins).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSyncStore = create(
  persist(
    (set) => ({
      code: '',
      updatedAt: 0, // last-known synced stamp (epoch ms)
      lastSyncedAt: 0, // wall-clock of last successful sync
      status: '', // '' | 'syncing' | 'ok' | 'error'
      error: '',

      setCode: (code) => set({ code: (code || '').trim().toUpperCase() }),
      setSync: (patch) => set(patch),
      unlink: () => set({ code: '', updatedAt: 0, lastSyncedAt: 0, status: '', error: '' }),
    }),
    { name: 'pt-sync', version: 1 }
  )
);

export default useSyncStore;
