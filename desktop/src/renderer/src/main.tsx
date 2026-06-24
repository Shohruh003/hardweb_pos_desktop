import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { ConnectivityProvider } from './state/connectivity';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectivityProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ConnectivityProvider>
  </React.StrictMode>,
);
