import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { Rocket, ShieldAlert, Gavel, Cpu, Loader2, ChevronRight } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState('participant');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const roleLabel = role === 'participant' ? 'Pilot' : role === 'judge' ? 'Judge' : 'Admin';
    document.title = `Project Periselene - Login - ${roleLabel}`;
  }, [role]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (role === 'participant') {
        if (!name) return alert('Please enter a team name.');

        const { data, error } = await supabase
          .from('participants')
          .insert([{ team_name: name, status: 'waiting' }])
          .select();

        if (error) throw error;

        const teamId = data[0].id;
        localStorage.setItem('periselene_team_id', teamId);
        localStorage.setItem('periselene_team_name', name);
        navigate('/participant');
      } else if (role === 'admin') {
        if (password === 'admin123') {
          navigate('/admin');
        } else {
          alert('Wrong admin code.');
        }
      } else if (role === 'judge') {
        if (password === 'judge123') {
          navigate('/judge');
        } else {
          alert('Wrong judge code.');
        }
      }
    } catch (error) {
      console.error('Login Error:', error);
      alert('Could not join: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.background} />
      <div style={styles.glowOne} />
      <div style={styles.glowTwo} />

      <main style={styles.portal}>
        <div style={styles.brandGroup}>
          <h1 style={styles.mainTitle}>Project Periselene</h1>
          <p style={styles.subTitle}>Sign in to start your flight.</p>
        </div>

        <div style={styles.loginCard}>
          <div style={styles.cardHeader}>
            <Cpu size={18} color="#38bdf8" />
            <span>Sign In</span>
          </div>

          <div style={styles.roleSelector}>
            <RoleTab
              active={role === 'participant'}
              onClick={() => setRole('participant')}
              icon={<Rocket size={18} />}
              label="Pilot"
            />
            <RoleTab
              active={role === 'judge'}
              onClick={() => setRole('judge')}
              icon={<Gavel size={18} />}
              label="Judge"
            />
            <RoleTab
              active={role === 'admin'}
              onClick={() => setRole('admin')}
              icon={<ShieldAlert size={18} />}
              label="Admin"
            />
          </div>

          <form onSubmit={handleLogin} style={styles.form}>
            {role === 'participant' - (
              <div style={styles.inputGroup}>
                <label style={styles.inputLabel}>Team name</label>
                <input
                  style={styles.input}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter team name"
                />
              </div>
            ) : (
              <div style={styles.inputGroup}>
                <label style={styles.inputLabel}>Access code</label>
                <input
                  style={styles.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter code"
                />
              </div>
            )}

            <button type="submit" style={styles.submitBtn} disabled={loading}>
              {loading - <Loader2 style={styles.spin} /> : <>Continue <ChevronRight size={18} /></>}
            </button>
          </form>
        </div>

        <footer style={styles.footer}>Secure connection.</footer>
      </main>
    </div>
  );
}

function RoleTab({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.roleTab,
        background: active - '#f8fafc' : 'transparent',
        color: active - '#0b1220' : '#cbd5f5',
        borderColor: active - '#e2e8f0' : 'transparent',
        boxShadow: active - '0 14px 30px rgba(15, 23, 42, 0.35)' : 'none'
      }}
    >
      {icon}
      <span style={styles.roleLabel}>{label}</span>
    </button>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#0b1020',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
    overflow: 'hidden',
    position: 'relative'
  },
  background: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'radial-gradient(600px circle at 15% 15%, rgba(56, 189, 248, 0.18), transparent 60%), radial-gradient(500px circle at 80% 20%, rgba(99, 102, 241, 0.18), transparent 55%), linear-gradient(180deg, #0b1020 0%, #0b1220 100%)'
  },
  glowOne: {
    position: 'absolute',
    width: '340px',
    height: '340px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0))',
    top: '10%',
    right: '10%',
    filter: 'blur(40px)',
    opacity: 0.8
  },
  glowTwo: {
    position: 'absolute',
    width: '420px',
    height: '420px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(236, 72, 153, 0.25), rgba(236, 72, 153, 0))',
    bottom: '8%',
    left: '6%',
    filter: 'blur(60px)',
    opacity: 0.7
  },
  portal: {
    zIndex: 10,
    width: '100%',
    maxWidth: '520px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px'
  },
  brandGroup: {
    textAlign: 'center',
    marginBottom: '28px',
    padding: '10px 0'
  },
  mainTitle: {
    fontSize: '2.4rem',
    fontWeight: 700,
    color: '#f8fafc',
    letterSpacing: '0.5px',
    marginBottom: '6px'
  },
  subTitle: {
    fontSize: '0.95rem',
    color: '#cbd5f5',
    fontWeight: 500
  },
  loginCard: {
    background: 'rgba(15, 23, 42, 0.65)',
    borderRadius: '20px',
    padding: '28px',
    width: '100%',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 30px 70px rgba(2, 6, 23, 0.55)',
    backdropFilter: 'blur(14px)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.75rem',
    color: '#94a3b8',
    letterSpacing: '1.4px',
    fontWeight: 600,
    marginBottom: '20px',
    textTransform: 'uppercase'
  },
  roleSelector: {
    display: 'flex',
    gap: '6px',
    marginBottom: '24px',
    padding: '6px',
    borderRadius: '999px',
    background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)'
  },
  roleTab: {
    flex: 1,
    border: '1px solid transparent',
    borderRadius: '999px',
    padding: '10px 12px',
    textAlign: 'center',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontSize: '0.75rem',
    fontWeight: 600,
    transition: '0.2s',
    background: 'transparent'
  },
  roleLabel: {
    fontSize: '0.75rem'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  inputLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#94a3b8',
    letterSpacing: '0.6px'
  },
  input: {
    background: 'rgba(2, 6, 23, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#f8fafc',
    fontSize: '0.95rem',
    outline: 'none',
    transition: '0.2s',
    fontFamily: '"SF Pro Text", "SF Pro Display", sans-serif'
  },
  submitBtn: {
    marginTop: '6px',
    background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
    color: '#0b1220',
    border: 'none',
    padding: '14px',
    borderRadius: '12px',
    fontWeight: 700,
    fontSize: '0.9rem',
    letterSpacing: '0.6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    transition: '0.2s',
    boxShadow: '0 14px 28px rgba(56, 189, 248, 0.35)'
  },
  footer: {
    marginTop: '24px',
    fontSize: '0.75rem',
    color: '#94a3b8',
    letterSpacing: '0.4px',
    fontWeight: 500
  },
  spin: {
    animation: 'spin 1s linear infinite'
  }
};
