import { initUI } from './ui.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) =>
      console.warn('SW no registrado:', err)
    );
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initUI().catch((err) => {
    console.error('Error inicializando app:', err);
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<p style="color:red;padding:1rem">Error al iniciar. Revisa la consola.</p>'
    );
  });
});