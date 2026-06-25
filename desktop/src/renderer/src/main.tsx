import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { ConnectivityProvider } from './state/connectivity';
import { DemoNavProvider } from './state/demoNav';
import { ConfirmProvider } from './state/confirm';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <ConnectivityProvider>
        <AuthProvider>
          <DemoNavProvider>
            <App />
          </DemoNavProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </ConfirmProvider>
  </React.StrictMode>,
);
