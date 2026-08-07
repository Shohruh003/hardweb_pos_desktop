import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { ConnectivityProvider } from './state/connectivity';
import { DemoNavProvider } from './state/demoNav';
import { AppNavProvider } from './state/appNav';
import { ConfirmProvider } from './state/confirm';
import { ThemeProvider } from './state/theme';
import { I18nProvider } from './state/i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <ConfirmProvider>
          <ConnectivityProvider>
            <AuthProvider>
              <DemoNavProvider>
                <AppNavProvider>
                  <App />
                </AppNavProvider>
              </DemoNavProvider>
            </AuthProvider>
          </ConnectivityProvider>
        </ConfirmProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
