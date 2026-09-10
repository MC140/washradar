import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {installAddressAutocomplete} from './services/addressAutocomplete';
import {installCostOptimizations} from './services/costOptimizations';
import {installPostalSearch} from './services/postalSearch';
import './styles.css';
import './ui-polish.css';
import './release-polish.css';
import './native-hardening.css';

installCostOptimizations();
installAddressAutocomplete();
installPostalSearch();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('washradar:update-ready'));
          }
        });
      });
    });
  });
}
