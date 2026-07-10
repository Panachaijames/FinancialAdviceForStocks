import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useSettingsStore } from './store/settingsStore.js';
import { applyMotionAttr } from './lib/motion.js';
import './index.css';

// Stamp <html data-motion="ok|reduce"> and <html data-glass="0|1"> BEFORE first
// render (components read them during mount) and keep them current when the FX
// or Glass toggles — or the OS reduced-motion preference — change. These are
// the single switches all effects/styling key off.
const applyGlassAttr = (on) => {
  document.documentElement.dataset.glass = on ? '1' : '0';
};
applyMotionAttr(useSettingsStore.getState().fxMode);
applyGlassAttr(useSettingsStore.getState().glassMode);
useSettingsStore.subscribe((s) => {
  applyMotionAttr(s.fxMode);
  applyGlassAttr(s.glassMode);
});
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onChange = () => applyMotionAttr(useSettingsStore.getState().fxMode);
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
