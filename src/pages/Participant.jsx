import { useEffect, useState, useRef } from 'react';
import { useTimer } from '../context/TimerContext';
import { supabase } from '../lib/supabaseClient';
import TimerOverlay from '../components/TimerOverlay';
import Peer from 'peerjs';
import { Radio, MonitorUp, ArrowRight, ShieldCheck, Activity } from 'lucide-react';

export default function Participant() {
  const { mode, displayTime, isAlert } = useTimer();
  const [teamName] = useState(() => localStorage.getItem('periselene_team_name') || '');
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const modeLabel = mode === 'IDLE' ? 'Waiting' : mode === 'BUILD' ? 'Build' : 'Flight';


  useEffect(() => {
    const teamLabel = teamName ? teamName.toUpperCase() : 'UNKNOWN';
    document.title = `Project Periselene - Participant - ${teamLabel} - ${modeLabel}`;
  }, [teamName, modeLabel]);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCallRef = useRef(null);

  // --- PRESERVED: PEERJS CONNECTION LOGIC ---
  useEffect(() => {
    const teamId = localStorage.getItem('periselene_team_id');
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

    const teamId = localStorage.getItem('periselene_team_id');
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
      <div style={styles.gridGlow} />

      <div style={styles.cockpitShell}>
        <div style={styles.shellGlow} />
        <div style={styles.shellEdge} />
        <div style={styles.shellInner}>
          <header style={styles.header}>
            <div style={styles.brandBlock}>
              <span style={styles.kicker}>Callsign</span>
              <h1 style={styles.teamName}>{teamName.toUpperCase() || 'UNKNOWN'}</h1>
              <div style={styles.subline}>Project Periselene Participant</div>
            </div>

            <div style={styles.modePill}>
              <span style={styles.modeDot(isAlert)} />
              <span style={styles.modeText}>Stage: {modeLabel}</span>
            </div>

            <div style={{ ...styles.timerCard, borderColor: isAlert ? '#f87171' : 'rgba(56, 189, 248, 0.35)' }}>
              <span style={styles.kicker}>Timer</span>
              <div style={{ ...styles.timerValue, color: isAlert ? '#f87171' : '#e2f3ff' }}>{displayTime}</div>
            </div>
          </header>

          <main style={styles.main}>
            <section style={styles.overlayCard}>
              <div style={styles.overlayFrame}>
                <TimerOverlay />
              </div>
            </section>

            <div style={styles.grid}>
              <section style={styles.card}>
                <div style={styles.cardHeader}>
                  <Radio size={16} color={isSharing ? '#22c55e' : '#7dd3fc'} />
                  <span>Screen share</span>
                </div>

                <div style={styles.statusRow}>
                  <span style={{ ...styles.statusDot, background: isSharing ? '#22c55e' : '#7dd3fc' }} />
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
                  Current stage: <span style={{ color: '#7dd3fc' }}>{modeLabel}</span>
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
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#05070f',
    color: '#e2f3ff',
    padding: '24px',
    fontFamily: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden'
  },
  background: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'radial-gradient(700px circle at 15% 20%, rgba(59, 130, 246, 0.18), transparent 60%), radial-gradient(600px circle at 85% 20%, rgba(14, 165, 233, 0.14), transparent 55%), linear-gradient(180deg, #04060d 0%, #0b1329 100%)'
  },
  gridGlow: {
    position: 'absolute',
    inset: 0,
    opacity: 0.35,
    backgroundImage:
      'linear-gradient(transparent 96%, rgba(56, 189, 248, 0.14) 96%), linear-gradient(90deg, transparent 96%, rgba(56, 189, 248, 0.12) 96%)',
    backgroundSize: '36px 36px',
    pointerEvents: 'none'
  },
  cockpitShell: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: '1200px',
    borderRadius: '28px',
    background: 'linear-gradient(180deg, rgba(6, 12, 28, 0.95), rgba(2, 6, 18, 0.95))',
    border: '1px solid rgba(56, 189, 248, 0.35)',
    boxShadow: '0 30px 80px rgba(2, 6, 23, 0.75), inset 0 0 40px rgba(56, 189, 248, 0.08)',
    overflow: 'hidden'
  },
  shellGlow: {
    position: 'absolute',
    inset: 0,
    background:
      'radial-gradient(600px circle at 20% -10%, rgba(56, 189, 248, 0.25), transparent 55%), radial-gradient(500px circle at 80% 0%, rgba(99, 102, 241, 0.18), transparent 60%)',
    pointerEvents: 'none'
  },
  shellEdge: {
    position: 'absolute',
    inset: '10px',
    borderRadius: '22px',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: 'inset 0 0 30px rgba(2, 6, 23, 0.7)',
    pointerEvents: 'none'
  },
  shellInner: {
    position: 'relative',
    zIndex: 2,
    padding: '26px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  header: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '18px',
    padding: '18px 24px',
    borderRadius: '22px',
    background: 'linear-gradient(135deg, rgba(7, 14, 32, 0.9), rgba(5, 10, 24, 0.85))',
    border: '1px solid rgba(56, 189, 248, 0.28)',
    boxShadow: '0 18px 40px rgba(2, 6, 23, 0.55)',
    backdropFilter: 'blur(18px)'
  },
  brandBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  kicker: { fontSize: '0.65rem', color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '1.4px' },
  teamName: { margin: 0, fontSize: '2rem', fontWeight: 700, letterSpacing: '1px' },
  subline: { fontSize: '0.75rem', color: '#94a3b8', letterSpacing: '0.6px' },
  modePill: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderRadius: '999px',
    border: '1px solid rgba(56, 189, 248, 0.35)',
    background: 'rgba(6, 12, 30, 0.8)',
    boxShadow: 'inset 0 0 16px rgba(56, 189, 248, 0.15)'
  },
  modeDot: (alert) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: alert ? '#f87171' : '#38bdf8',
    boxShadow: alert ? '0 0 10px rgba(248, 113, 113, 0.8)' : '0 0 12px rgba(56, 189, 248, 0.8)'
  }),
  modeText: { fontSize: '0.8rem', color: '#e2f3ff', fontWeight: 600, letterSpacing: '0.4px' },
  timerCard: {
    minWidth: '190px',
    textAlign: 'center',
    padding: '12px 18px',
    borderRadius: '16px',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    background: 'radial-gradient(circle at top, rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.8))',
    boxShadow: 'inset 0 0 20px rgba(2, 6, 23, 0.6)'
  },
  timerValue: { fontSize: '2.3rem', fontWeight: 700, marginTop: '6px', letterSpacing: '1px' },

  main: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 },
  overlayCard: {
    background: 'rgba(6, 12, 28, 0.8)',
    border: '1px solid rgba(56, 189, 248, 0.22)',
    borderRadius: '22px',
    padding: '8px',
    boxShadow: '0 22px 50px rgba(2, 6, 23, 0.55)'
  },
  overlayFrame: {
    borderRadius: '16px',
    border: '1px solid rgba(148, 163, 184, 0.15)',
    background: 'rgba(2, 6, 23, 0.65)',
    overflow: 'hidden'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '18px'
  },
  card: {
    background: 'linear-gradient(150deg, rgba(8, 14, 32, 0.95), rgba(3, 8, 20, 0.95))',
    border: '1px solid rgba(56, 189, 248, 0.2)',
    borderRadius: '20px',
    padding: '22px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    boxShadow: '0 20px 50px rgba(2, 6, 23, 0.55)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.75rem',
    color: '#7dd3fc',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    fontWeight: 700
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.95rem', color: '#e2f3ff' },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%' },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '12px 14px',
    borderRadius: '14px',
    border: '1px solid rgba(125, 211, 252, 0.5)',
    background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
    color: '#04101e',
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    cursor: 'pointer',
    boxShadow: '0 14px 30px rgba(56, 189, 248, 0.4)'
  },
  errorText: { color: '#f87171', fontSize: '0.85rem' },
  modeRow: { fontSize: '0.9rem', color: '#cbd5f5' },
  infoText: { color: '#94a3b8', fontSize: '0.9rem' },
  successText: { color: '#22c55e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' },

  sliderShell: { marginTop: '10px' },
  sliderTrack: {
    position: 'relative',
    height: '58px',
    backgroundImage:
      'linear-gradient(90deg, rgba(2, 6, 23, 0.85) 0%, rgba(15, 23, 42, 0.85) 50%, rgba(2, 6, 23, 0.85) 100%), repeating-linear-gradient(90deg, rgba(56, 189, 248, 0.18) 0, rgba(56, 189, 248, 0.18) 1px, transparent 1px, transparent 12px)',
    borderRadius: '999px',
    overflow: 'hidden',
    border: '1px solid rgba(56, 189, 248, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: '100%',
    background: 'linear-gradient(90deg, rgba(8, 145, 178, 0.85), rgba(34, 197, 94, 0.9))',
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
    background: 'linear-gradient(135deg, #e2f3ff, #7dd3fc)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    boxShadow: '0 0 16px rgba(125, 211, 252, 0.6), 0 10px 20px rgba(15, 23, 42, 0.4)',
    transition: '0.05s linear',
    border: '1px solid rgba(56, 189, 248, 0.6)'
  },

  footer: {
    textAlign: 'center',
    fontSize: '0.8rem',
    color: '#94a3b8',
    letterSpacing: '0.8px',
    textTransform: 'uppercase'
  }
};
