import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useSettingsStore } from './store/settingsStore.js';
import { applyMotionAttr } from './lib/motion.js';
import './index.css';

// Stamp <html data-motion="ok|reduce"> BEFORE first render (components read it
// during mount) and keep it current when the FX toggle or the OS reduced-motion
// preference changes. This is the single switch all effects key off.
applyMotionAttr(useSettingsStore.getState().fxMode);
useSettingsStore.subscribe((s) => applyMotionAttr(s.fxMode));
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
