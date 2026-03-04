import React from 'react';
import ReactDOM from 'react-dom/client';
import CortexApp from './CortexApp';

// Skip React mount when capacitor-boot.js is handling a redirect
if (!window.__capRedirectUrl) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <CortexApp />
    </React.StrictMode>
  );
}
