import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import './index.css';
import './styles/premium-ui.css';
import { initOrientationRespect } from './orientationRespect';
import { bootstrapUiTheme } from './theme/uiTheme';
import { premiumToastOptions } from './theme/toastOptions';
import i18n from './i18n';

bootstrapUiTheme();
initOrientationRespect();

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      const showDebug = import.meta.env.DEV;
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
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
              <Toaster position="top-right" toastOptions={premiumToastOptions} gutter={10} />
            </CartProvider>
          </AuthProvider>
        </HashRouter>
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <CartProvider>
              <App />
              <Toaster position="top-right" toastOptions={premiumToastOptions} gutter={10} />
            </CartProvider>
          </AuthProvider>
        </BrowserRouter>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
