import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { Toaster, ToastBar, toast } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import SwipeToDismiss from './components/SwipeToDismiss';
import './index.css';
import './styles/premium-ui.css';
import { initOrientationRespect } from './orientationRespect';
import { bootstrapUiTheme } from './theme/uiTheme';
import { premiumToastOptions } from './theme/toastOptions';
import i18n from './i18n';
import './utils/pwaInstall';

function AppToaster() {
  return (
    <Toaster position="top-right" toastOptions={premiumToastOptions} gutter={10}>
      {(t) => (
        <SwipeToDismiss
          onDismiss={() => toast.dismiss(t.id)}
          className="rounded-xl max-w-[min(100vw-1.5rem,26rem)]"
        >
          <ToastBar toast={t} style={{ ...t.style, maxWidth: '100%' }} />
        </SwipeToDismiss>
      )}
    </Toaster>
  );
}

bootstrapUiTheme();
initOrientationRespect();

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      const showDebug = import.meta.env.DEV;
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif', background: '#f8fafc', color: '#0f172a', minHeight: '100vh' }}>
          <h1 style={{ color: 'red' }}>{i18n.t('common:app.unexpectedError')}</h1>
          <pre style={{ background: '#fee', padding: 20, borderRadius: 8, whiteSpace: 'pre-wrap' }}>
            {showDebug ? `${this.state.error?.message}\n${this.state.error?.stack}` : i18n.t('common:app.unexpectedError')}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>{i18n.t('common:app.reload')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {window.location.protocol === 'file:' ? (
        <HashRouter>
          <AuthProvider>
            <CartProvider>
              <App />
              <AppToaster />
            </CartProvider>
          </AuthProvider>
        </HashRouter>
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <CartProvider>
              <App />
              <AppToaster />
            </CartProvider>
          </AuthProvider>
        </BrowserRouter>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
