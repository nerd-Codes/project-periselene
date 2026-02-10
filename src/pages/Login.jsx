import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { Rocket, ShieldAlert, Gavel, ArrowRight, Loader2, KeyRound, User } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState('participant');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = 'Project Periselene // Access Control';
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (role === 'participant') {
        if (!name) return alert('Please enter a team name!');

        // 1. Insert team into Supabase Database
        const { data, error } = await supabase
          .from('participants')
          .insert([{ team_name: name, status: 'waiting' }])
          .select();

        if (error) throw error;

        // 2. Save the Team ID
        const teamId = data[0].id;
        
        // Saving to both keys to ensure compatibility with all previous code
        localStorage.setItem('sfs_team_id', teamId);
        localStorage.setItem('sfs_team_name', name);
        localStorage.setItem('periselene_team_id', teamId);
        localStorage.setItem('periselene_team_name', name);

        // 3. Go to Participant Page
        navigate('/participant');
      } 
      
      else if (role === 'admin') {
        if (password === 'admin123') {
          navigate('/admin');
        } else {
          alert('Access Denied: Invalid Command Code');
        }
      } 
      
      else if (role === 'judge') {
        if (password === 'judge123') {
          navigate('/judge');
        } else {
          alert('Access Denied: Invalid Judge Code');
        }
      }

    } catch (error) {
      console.error('Login Error:', error);
      alert('Connection Failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      
      {/* 1. BACKGROUND LAYERS */}
      <div style={styles.background} />
      <div style={styles.vignette} />
      
      {/* 2. ROCKET SILHOUETTE (Subtle Background) */}
      <div style={styles.rocketLayer}>
        <img src="/rocket.png" alt="Silhouette" style={styles.rocketImage} />
      </div>

      {/* 3. MAIN CONTENT */}
      <main style={styles.content}>
        
        {/* BRANDING */}
        <div style={styles.brandGroup}>
          <h1 style={styles.title}>PROJECT PERISELENE</h1>
          <div style={styles.kicker}>ROCKET BUILDING COMPETITION</div>
        </div>

        {/* LOGIN CARD */}
        <div style={styles.card}>
          
          {/* Role Tabs */}
          <div style={styles.tabRail}>
            <RoleTab 
              active={role === 'participant'} 
              icon={<Rocket size={16} />} 
              label="PILOT" 
              onClick={() => setRole('participant')} 
            />
            <RoleTab 
              active={role === 'judge'} 
              icon={<Gavel size={16} />} 
              label="JUDGE" 
              onClick={() => setRole('judge')} 
            />
            <RoleTab 
              active={role === 'admin'} 
              icon={<ShieldAlert size={16} />} 
              label="ADMIN" 
              onClick={() => setRole('admin')} 
            />
          </div>

          <form onSubmit={handleLogin} style={styles.form}>
            
            {/* Input Section */}
            <div style={styles.inputSection}>
              {role === 'participant' ? (
                <>
                  <label style={styles.label}>SQUADRON CALLSIGN</label>
                  <div style={styles.inputWrapper}>
                    <User size={18} color="#64748b" style={styles.inputIcon} />
                    <input 
                      type="text" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="ENTER TEAM NAME" 
                      style={styles.input}
                      autoFocus
                    />
                  </div>
                </>
              ) : (
                <>
                  <label style={styles.label}>SECURITY CLEARANCE</label>
                  <div style={styles.inputWrapper}>
                    <KeyRound size={18} color="#64748b" style={styles.inputIcon} />
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="ACCESS CODE" 
                      style={styles.input}
                      autoFocus
                    />
                  </div>
                </>
              )}
            </div>

            {/* Action Button */}
            <button type="submit" style={styles.submitBtn} disabled={loading}>
              {loading ? (
                <Loader2 style={styles.spin} size={20} />
              ) : (
                <>INITIATE UPLINK <ArrowRight size={18} /></>
              )}
            </button>

          </form>
        </div>

        <div style={styles.footer}>
          SECURE CONNECTION ESTABLISHED // V4.0
        </div>

      </main>
    </div>
  );
}

/* --- COMPONENTS --- */

function RoleTab({ active, icon, label, onClick }) {
  return (
    <button 
      type="button" 
      onClick={onClick}
      style={{
        ...styles.tab,
        background: active ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
        borderColor: active ? '#38bdf8' : 'transparent',
        color: active ? '#fff' : '#64748b'
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* --- STYLES --- */
const styles = {
  container: {
    height: '100vh', width: '100vw',
    backgroundColor: '#000', color: '#fff',
    fontFamily: '"SF Pro Display", "Helvetica Neue", sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden'
  },
  
  /* BACKGROUND */
  background: {
    position: 'absolute', inset: 0,
    background: 'radial-gradient(circle at 50% 30%, #1e293b 0%, #020617 100%)',
    zIndex: 0
  },
  vignette: {
    position: 'absolute', inset: 0,
    background: 'radial-gradient(circle, transparent 40%, #000 100%)',
    zIndex: 2, pointerEvents: 'none'
  },
  rocketLayer: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1, pointerEvents: 'none', opacity: 0.3
  },
  rocketImage: {
    height: '110%', width: 'auto',
    filter: 'drop-shadow(0 0 50px rgba(56, 189, 248, 0.2)) blur(2px)'
  },

  /* CONTENT */
  content: {
    position: 'relative', zIndex: 10,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '30px', width: '100%', maxWidth: '420px', padding: '20px'
  },
  
  brandGroup: { textAlign: 'center' },
  kicker: { 
    fontSize: '12px', fontWeight: 700, letterSpacing: '4px', 
    color: '#38bdf8', marginBottom: '8px', textTransform: 'uppercase'
  },
  title: { 
    fontSize: '32px', fontWeight: 900, letterSpacing: '2px', 
    margin: 0, textShadow: '0 0 30px rgba(255,255,255,0.2)' 
  },

  /* CARD */
  card: {
    width: '100%',
    background: 'rgba(15, 23, 42, 0.75)',
    backdropFilter: 'blur(20px)',
    borderRadius: '24px',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    padding: '8px' // Padding for the outer rim
  },

  /* TABS */
  tabRail: {
    display: 'flex', gap: '4px',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: '18px',
    padding: '4px',
    marginBottom: '20px'
  },
  tab: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '12px', borderRadius: '14px',
    border: '1px solid transparent',
    fontSize: '11px', fontWeight: 800, letterSpacing: '1px',
    cursor: 'pointer', transition: 'all 0.2s ease',
    outline: 'none'
  },

  /* FORM */
  form: {
    padding: '0 20px 24px 20px',
    display: 'flex', flexDirection: 'column', gap: '24px'
  },
  inputSection: { display: 'flex', flexDirection: 'column', gap: '8px' },
  label: { fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '1px', marginLeft: '4px' },
  inputWrapper: { position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon: { position: 'absolute', left: '16px', pointerEvents: 'none' },
  input: {
    width: '100%',
    background: 'rgba(2, 6, 23, 0.5)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '12px',
    padding: '16px 16px 16px 48px', // Left padding for icon
    color: '#fff', fontSize: '14px', fontWeight: 600, letterSpacing: '0.5px',
    outline: 'none', transition: 'border 0.2s',
    fontFamily: 'monospace'
  },

  submitBtn: {
    width: '100%',
    background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
    border: 'none', borderRadius: '12px',
    padding: '16px',
    color: '#fff', fontSize: '14px', fontWeight: 800, letterSpacing: '1px',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
    boxShadow: '0 10px 30px rgba(56, 189, 248, 0.3)',
    transition: 'transform 0.1s'
  },

  footer: {
    fontSize: '10px', color: '#475569', letterSpacing: '1px', fontWeight: 600
  },
  spin: { animation: 'spin 1s linear infinite' }
};