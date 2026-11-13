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

// Kutilmagan render xatosi butun oynani oq/qora ekranga aylantirmasin — tushunarli xabar
// va "Qayta yuklash" tugmasi ko'rsatiladi. Provayderlardan tashqarida turadi (ular ham
// xato bersa ishlaydi), shuning uchun faqat rang tokenlaridan foydalanadi.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[DasturXon] Kutilmagan UI xatosi:', error, info.componentStack);
  }

  // Saqlangan sessiya buzilgan bo'lsa qayta yuklash yordam bermaydi — sessiyani tozalab yuklaymiz
  // (oflayn navbatdagi buyurtmalar va server manzili saqlanib qoladi)
  private resetSession = () => {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch {
      /* e'tiborsiz */
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-full h-full flex items-center justify-center bg-bg text-text p-6">
        <div className="w-full max-w-[440px] bg-surface border border-border rounded-2xl p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-danger/15 text-danger flex items-center justify-center text-3xl font-black">
            !
          </div>
          <div className="text-xl font-extrabold mb-1">Kutilmagan xato yuz berdi</div>
          <div className="text-sm text-muted mb-4">
            Ilovani qayta yuklang. Xato takrorlansa — administratorga quyidagi matnni ko‘rsating.
          </div>
          <div className="mb-5 max-h-40 overflow-auto rounded-lg border border-border bg-bg p-3 text-left font-mono text-xs break-words text-text">
            {error.message || String(error)}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            Qayta yuklash
          </button>
          <button
            onClick={this.resetSession}
            className="mt-3 text-sm text-muted hover:text-danger transition-colors"
          >
            Tizimdan chiqib, qayta yuklash
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
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
    </ErrorBoundary>
  </React.StrictMode>,
);
