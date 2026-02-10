export default function SupabaseMissing() {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.kicker}>Configuration Required</div>
        <h1 style={styles.title}>Project Periselene</h1>
        <p style={styles.text}>
          Supabase environment variables are missing. The app needs these values to connect:
        </p>
        <ul style={styles.list}>
          <li><code style={styles.code}>VITE_SUPABASE_URL</code></li>
          <li><code style={styles.code}>VITE_SUPABASE_ANON_KEY</code></li>
        </ul>
        <p style={styles.text}>
          If you deployed on Vercel, add them in <span style={styles.inline}>Project Settings → Environment Variables</span>
          and redeploy.
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#0b1020',
    color: '#e2e8f0',
    fontFamily: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'
  },
  card: {
    maxWidth: '520px',
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 24px 60px rgba(2, 6, 23, 0.5)'
  },
  kicker: {
    fontSize: '0.7rem',
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color: '#94a3b8',
    marginBottom: '10px'
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '1.8rem',
    color: '#f8fafc'
  },
  text: {
    margin: '10px 0',
    lineHeight: 1.6
  },
  list: {
    margin: '8px 0 12px 18px'
  },
  code: {
    background: 'rgba(2, 6, 23, 0.7)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '6px',
    padding: '2px 6px'
  },
  inline: {
    color: '#38bdf8',
    fontWeight: 600
  }
};
