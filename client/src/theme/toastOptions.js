/** Estilo premium para react-hot-toast (sin cambiar llamadas toast.* en módulos). */
export const premiumToastOptions = {
  duration: 3000,
  style: {
    background: 'var(--ui-surface)',
    color: 'var(--ui-body-text)',
    border: '1px solid var(--ui-border)',
    borderRadius: '12px',
    boxShadow: 'var(--ui-shadow-lg)',
    fontSize: '0.875rem',
    fontFamily: 'var(--ui-font)',
    padding: '12px 16px',
    maxWidth: '420px',
  },
  success: {
    iconTheme: {
      primary: 'var(--ui-success)',
      secondary: '#fff',
    },
    style: {
      borderLeft: '3px solid var(--ui-success)',
    },
  },
  error: {
    iconTheme: {
      primary: 'var(--ui-danger)',
      secondary: '#fff',
    },
    style: {
      borderLeft: '3px solid var(--ui-danger)',
    },
  },
  loading: {
    style: {
      borderLeft: '3px solid var(--ui-accent)',
    },
  },
};
