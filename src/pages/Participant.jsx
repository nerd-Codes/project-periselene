import { useEffect, useState, useRef } from 'react';
import { useTimer } from '../context/TimerContext';
import { supabase } from '../lib/supabaseClient';
import TimerOverlay from '../components/TimerOverlay';
import Peer from 'peerjs';
import { Radio, MonitorUp, ArrowRight, ShieldCheck, Activity } from 'lucide-react';

export default function Participant() {
  const { mode, displayTime, isAlert } = useTimer();
  const [teamName] = useState(() => localStorage.getItem('sfs_team_name') || '');
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const modeLabel = mode === 'IDLE' ? 'Waiting' : mode === 'BUILD' ? 'Build' : 'Flight';

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCallRef = useRef(null);

  // --- PRESERVED: PEERJS CONNECTION LOGIC ---
  useEffect(() => {
    const teamId = localStorage.getItem('sfs_team_id');
    if (!teamId) {
      console.error('Participant not logged in, cannot start stream.');
      return;
    }

    const peer = new Peer(undefined, {
      host: '0.peerjs.com',
      secure: true,
      port: 443,
      path: '/',
      debug: 2
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      supabase
        .from('participants')
        .update({ peer_id: id })
        .eq('id', teamId)
        .then(({ error }) => {
          if (error) console.error('Supabase Error: Could not save Peer ID.', error);
        });
    });

    peer.on('call', (call) => {
      if (localStreamRef.current) {
        call.answer(localStreamRef.current);
        return;
      }
      pendingCallRef.current = call;
      setShareError('Admin is watching. Click Share Screen to start.');
    });

    peer.on('error', (err) => {
      console.error('PEERJS CONNECTION ERROR:', err);
      alert('Can’t connect to the stream server. Please refresh and try again.');
    });

    peer.on('disconnected', () => {
      console.warn('Disconnected from PeerJS server. Attempting to reconnect...');
    });

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  // --- PRESERVED: SCREEN SHARING LOGIC ---
  const startScreenShare = async () => {
    setShareError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 20 } },
        audio: false
      });
      localStreamRef.current = stream;
      setIsSharing(true);

      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => {
          setIsSharing(false);
          localStreamRef.current = null;
        };
      }

      if (pendingCallRef.current) {
        pendingCallRef.current.answer(stream);
        pendingCallRef.current = null;
      }
    } catch (err) {
      console.error('Failed to get display media:', err);
      setShareError('Screen sharing was blocked.');
    }
  };

  // --- PRESERVED: LANDING LOGIC (Calculation & Update) ---
  const handleLanded = async () => {
    if (mode !== 'FLIGHT') return alert("Flight hasn't started.");

    const teamId = localStorage.getItem('sfs_team_id');
    const landTime = new Date();
    let flightDuration = null;

    try {
      const { data, error } = await supabase
        .from('participants')
        .select('start_time')
        .eq('id', teamId)
        .single();

      if (error) {
        console.error('Error fetching start_time:', error);
      } else if (data?.start_time) {
        const startTime = new Date(data.start_time);
        const seconds = Math.round((landTime.getTime() - startTime.getTime()) / 1000);
        flightDuration = Math.max(0, seconds);
      }
    } catch (err) {
      console.error('Failed to calculate flight duration:', err);
    }

    await supabase
      .from('participants')
      .update({
        status: 'landed',
        land_time: landTime.toISOString(),
        flight_duration: flightDuration
      })
      .eq('id', teamId);

    alert('Landing confirmed. Results saved.');
  };

  const onSliderChange = (e) => {
    const val = parseInt(e.target.value);
    setSliderValue(val);
    if (val >= 98) {
      handleLanded();
      setSliderValue(100);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.background} />
      <div style={styles.glowOne} />
      <div style={styles.glowTwo} />

      <header style={styles.header}>
        <div style={styles.brandBlock}>
          <span style={styles.kicker}>Team</span>
          <h1 style={styles.teamName}>{teamName.toUpperCase() || 'UNKNOWN'}</h1>
        </div>

        <div style={{ ...styles.timerCard, borderColor: isAlert ? '#f87171' : 'rgba(148, 163, 184, 0.25)' }}>
          <span style={styles.kicker}>Timer</span>
          <div style={{ ...styles.timerValue, color: isAlert ? '#f87171' : '#f8fafc' }}>{displayTime}</div>
        </div>
      </header>

      <main style={styles.main}>
        <section style={styles.overlayCard}>
          <TimerOverlay />
        </section>

        <div style={styles.grid}>
          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <Radio size={16} color={isSharing ? '#22c55e' : '#94a3b8'} />
              <span>Screen share</span>
            </div>

            <div style={styles.statusRow}>
              <span style={{ ...styles.statusDot, background: isSharing ? '#22c55e' : '#94a3b8' }} />
              <span>{isSharing ? 'Sharing on' : 'Sharing off'}</span>
            </div>

            {!isSharing && (
              <button style={styles.primaryButton} onClick={startScreenShare}>
                <MonitorUp size={18} /> Share Screen
              </button>
            )}

            {shareError && <div style={styles.errorText}>{shareError}</div>}
          </section>

          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <Activity size={16} color="#38bdf8" />
              <span>Flight</span>
            </div>

            <div style={styles.modeRow}>
              Current stage: <span style={{ color: '#38bdf8' }}>{modeLabel}</span>
            </div>

            {mode === 'FLIGHT' && (
              <div style={styles.sliderShell}>
                <div style={styles.sliderTrack}>
                  <div style={{ ...styles.sliderFill, width: `${sliderValue}%` }} />
                  <span style={styles.sliderText}>{sliderValue > 20 ? '' : 'Slide to confirm'}</span>
                  <input
                    type="range"
                    style={styles.rangeInput}
                    min="0"
                    max="100"
                    value={sliderValue}
                    onChange={onSliderChange}
                    onMouseUp={() => sliderValue < 98 && setSliderValue(0)}
                    onTouchEnd={() => sliderValue < 98 && setSliderValue(0)}
                  />
                  <div style={{ ...styles.sliderHandle, left: `calc(${sliderValue}% - 40px)` }}>
                    <ArrowRight color="#0b1220" size={22} />
                  </div>
                </div>
              </div>
            )}

            {mode === 'IDLE' && <div style={styles.infoText}>Waiting for start...</div>}
            {mode === 'BUILD' && <div style={styles.infoText}>Build in progress. Get ready.</div>}
            {mode === 'FLIGHT' && sliderValue === 100 && (
              <div style={styles.successText}>
                <ShieldCheck size={18} /> Landing saved
              </div>
            )}
          </section>
        </div>
      </main>

      <footer style={styles.footer}>Connection stable · Ready to fly</footer>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0b1020',
    color: '#f8fafc',
    padding: '24px',
    fontFamily: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    position: 'relative',
    overflow: 'hidden'
  },
  background: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'radial-gradient(650px circle at 15% 20%, rgba(56, 189, 248, 0.18), transparent 60%), radial-gradient(450px circle at 85% 15%, rgba(99, 102, 241, 0.18), transparent 55%), linear-gradient(180deg, #0b1020 0%, #0b1220 100%)'
  },
  glowOne: {
    position: 'absolute',
    width: '360px',
    height: '360px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.28), rgba(59, 130, 246, 0))',
    top: '8%',
    right: '10%',
    filter: 'blur(45px)',
    opacity: 0.85
  },
  glowTwo: {
    position: 'absolute',
    width: '480px',
    height: '480px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(236, 72, 153, 0.2), rgba(236, 72, 153, 0))',
    bottom: '-6%',
    left: '-6%',
    filter: 'blur(65px)',
    opacity: 0.7
  },
  header: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    padding: '18px 22px',
    borderRadius: '18px',
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    backdropFilter: 'blur(16px)'
  },
  brandBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  kicker: { fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px' },
  teamName: { margin: 0, fontSize: '1.9rem', fontWeight: 700, letterSpacing: '0.5px' },
  timerCard: {
    minWidth: '180px',
    textAlign: 'center',
    padding: '10px 16px',
    borderRadius: '14px',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    background: 'rgba(2, 6, 23, 0.6)'
  },
  timerValue: { fontSize: '2.2rem', fontWeight: 700, marginTop: '4px' },

  main: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 },
  overlayCard: {
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '18px',
    padding: '6px',
    boxShadow: '0 18px 40px rgba(2, 6, 23, 0.45)'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '18px'
  },
  card: {
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '18px',
    padding: '22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    boxShadow: '0 18px 40px rgba(2, 6, 23, 0.45)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.8rem',
    color: '#cbd5f5',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    fontWeight: 600
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.95rem' },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%' },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '12px',
    borderRadius: '12px',
    border: 'none',
    background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
    color: '#0b1220',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 14px 28px rgba(56, 189, 248, 0.35)'
  },
  errorText: { color: '#f87171', fontSize: '0.85rem' },
  modeRow: { fontSize: '0.95rem', color: '#cbd5f5' },
  infoText: { color: '#94a3b8', fontSize: '0.9rem' },
  successText: { color: '#22c55e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' },

  sliderShell: { marginTop: '6px' },
  sliderTrack: {
    position: 'relative',
    height: '56px',
    background: 'rgba(2, 6, 23, 0.7)',
    borderRadius: '999px',
    overflow: 'hidden',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: '100%',
    background: 'linear-gradient(90deg, #064e3b, #10b981)',
    zIndex: 1
  },
  sliderText: {
    position: 'relative',
    zIndex: 2,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#94a3b8',
    letterSpacing: '0.6px',
    pointerEvents: 'none'
  },
  rangeInput: { position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 4 },
  sliderHandle: {
    position: 'absolute',
    width: '46px',
    height: '46px',
    background: '#f8fafc',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    boxShadow: '0 10px 20px rgba(15, 23, 42, 0.35)',
    transition: '0.05s linear'
  },

  footer: {
    position: 'relative',
    zIndex: 1,
    textAlign: 'center',
    fontSize: '0.8rem',
    color: '#94a3b8',
    letterSpacing: '0.3px'
  }
};
