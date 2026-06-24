import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { ConnectivityProvider } from './state/connectivity';
import { DemoNavProvider } from './state/demoNav';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectivityProvider>
      <AuthProvider>
        <DemoNavProvider>
          <App />
        </DemoNavProvider>
      </AuthProvider>
    </ConnectivityProvider>
  </React.StrictMode>,
);
