import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {ensureFontsCached} from './lib/fontCache';

// Fire-and-forget: caches the app's Arabic Google Fonts in IndexedDB (first visit) or
// injects them straight from IndexedDB (every visit after) - see lib/fontCache.ts.
void ensureFontsCached();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
