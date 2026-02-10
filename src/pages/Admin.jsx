import { useEffect, useMemo, useRef, useState } from 'react';
import Peer from 'peerjs';
import { supabase } from '../lib/supabaseClient';
import { useTimer } from '../context/TimerContext';
import { Activity, Rocket, CheckCircle2, Users, Settings2, Trash2 } from 'lucide-react';

export default function Admin() {
  const [participants, setParticipants] = useState([]);
  const [masterPeerId, setMasterPeerId] = useState(null);
  const { mode, displayTime, setGlobalMode } = useTimer();
  const modeLabel = mode === 'IDLE' ? 'Waiting' : mode === 'BUILD' ? 'Build' : 'Flight';

  useEffect(() => {
    document.title = `Project Periselene - Admin - ${modeLabel}`;
  }, [modeLabel]);

  useEffect(() => {
    fetchParticipants();
    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        fetchParticipants();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchParticipants() {
    try {
      const { data, error } = await supabase.from('participants').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      setParticipants(data || []);
    } catch (error) { console.error(error); }
  }

  const activePilot = useMemo(() => 
    participants.find((p) => p.peer_id === masterPeerId) || null, 
  [participants, masterPeerId]);

  // Statistics
  const stats = {
    total: participants.length,
    flying: participants.filter(p => p.status === 'flying').length,
    landed: participants.filter(p => p.status === 'landed').length,
    crashed: participants.filter(p => p.status === 'crashed').length,
  };

  // Logic Handlers
  const startBuildTimer = async () => {
    const { error } = await supabase
      .from('participants')
      .update({ status: 'building' })
      .in('status', ['waiting', 'building']);
    if (error) {
      console.error('Failed to move participants to BUILD:', error);
      alert('Failed to start build phase. Check connection and permissions.');
      return;
    }
    await setGlobalMode('BUILD');
  };

  const startFlightTimer = async () => {
    const startTime = new Date().toISOString();
    const { error: timeError } = await supabase
      .from('participants')
      .update({ start_time: startTime })
      .not('id', 'is', null);
    if (timeError) {
      console.error('Failed to set start_time for all participants:', timeError);
      alert('Failed to start flight timer. Check connection and permissions.');
      return;
    }

    const { error: statusError } = await supabase
      .from('participants')
      .update({ status: 'flying' })
      .eq('status', 'building');
    if (statusError) {
      console.error('Failed to move participants to FLIGHT:', statusError);
    }

    await setGlobalMode('FLIGHT');
  };

  const endMission = async () => {
    if (confirm('Stop the timer? This will freeze results.')) await setGlobalMode('IDLE');
  };

  const newHeat = async () => {
    if (!confirm('Reset for a new round? This clears scores and pilots.')) return;
    const scoresResult = await supabase.from('scores').delete().not('id', 'is', null);
    if (scoresResult.error) {
      console.warn('Scores table reset failed (table may not exist yet):', scoresResult.error);
    }

    const { error } = await supabase
      .from('participants')
      .update({
        status: 'waiting',
        peer_id: null,
        start_time: null,
        land_time: null,
        flight_duration: null,
        used_budget: null,
        landing_status: null,
        judge_notes: null,
        rover_bonus: false,
        return_bonus: false,
        aesthetics_bonus: null,
        additional_penalty: null
      })
      .not('id', 'is', null);
    if (error) {
      console.error('Reset participants failed:', error);
      alert('Failed to reset participants. Check connection and permissions.');
      return;
    }

    await setGlobalMode('IDLE');
    setMasterPeerId(null);
  };

  return (
    <div style={styles.dashboard}>
      <div style={styles.background} />
      <div style={styles.glowOne} />
      <div style={styles.glowTwo} />
      {/* --- TOP HUD --- */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>Project Periselene <span style={{fontWeight:300}}>ADMIN</span></div>
          <div style={styles.phaseIndicator}>
             <div style={{...styles.pulse, backgroundColor: getModeColor(mode)}} />
             Stage: {modeLabel}
          </div>
        </div>

        <div style={styles.timerContainer}>
          <div style={styles.timerLabel}>TIMER</div>
          <div style={styles.timerValue}>{displayTime}</div>
        </div>

        <div style={styles.headerRight}>
            <StatBlock icon={<Users size={16}/>} label="TEAMS" value={stats.total} color="#fff" />
            <StatBlock icon={<Rocket size={16}/>} label="FLYING" value={stats.flying} color="#38bdf8" />
            <StatBlock icon={<CheckCircle2 size={16}/>} label="LANDED" value={stats.landed} color="#2ecc71" />
        </div>
      </header>

      <main style={styles.mainContent}>
        {/* --- MASTER FEED AREA --- */}
        <section style={styles.feedSection}>
          <div style={styles.masterMonitor}>
             <MasterStream peerId={masterPeerId} teamName={activePilot?.team_name} />
             
             {/* PILOT SELECTOR (OVERLAY STRIP) */}
             <div style={styles.pilotStrip}>
                {participants.map(p => (
                   <button 
                    key={p.id} 
                    onClick={() => setMasterPeerId(p.peer_id)}
                    disabled={!p.peer_id}
                    style={{
                        ...styles.pilotTab,
                        borderColor: masterPeerId === p.peer_id - 'rgba(248, 250, 252, 0.7)' : 'transparent',
                        background: masterPeerId === p.peer_id - 'rgba(248, 250, 252, 0.12)' : styles.pilotTab.background,
                        opacity: p.peer_id - 1 : 0.4
                    }}
                   >
                     <span style={styles.tabStatus(p.status)} />
                     {p.team_name}
                   </button>
                ))}
             </div>
          </div>
        </section>

        {/* --- CONTROL SIDEBAR --- */}
        <aside style={styles.sidebar}>
            <div style={styles.controlGroup}>
                <div style={styles.sidebarLabel}><Settings2 size={14}/> CONTROLS</div>
                <button style={styles.btnPrimary} onClick={startBuildTimer} disabled={mode !== 'IDLE'}>
                    Start Build
                </button>
                <button style={styles.btnPrimary} onClick={startFlightTimer} disabled={mode === 'FLIGHT'}>
                    Start Flight
                </button>
                <button style={styles.btnDanger} onClick={endMission}>
                    Stop / Freeze
                </button>
            </div>

            <div style={styles.controlGroup}>
                <div style={styles.sidebarLabel}><Trash2 size={14}/> RESET</div>
                <button style={styles.btnOutline} onClick={newHeat}>Reset Round</button>
            </div>

            <div style={styles.telemetryCard}>
                <div style={styles.sidebarLabel}><Activity size={14}/> LIVE STATS</div>
                <TelemetryRow label="CRASHES" value={stats.crashed} color="#ef4444" />
                <TelemetryRow label="SUCCESS RATE" value={stats.total - Math.round((stats.landed/stats.total)*100)+'%' : '0%'} color="#38bdf8" />
            </div>
        </aside>
      </main>
    </div>
  );
}

/* --- COMPONENTS --- */

function MasterStream({ peerId, teamName }) {
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!peerId) { 
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLive(false); 
      return; 
    }
    const peer = new Peer(undefined, { host: '0.peerjs.com', secure: true, port: 443, path: '/' });
    peerRef.current = peer;

    peer.on('open', () => {
      const call = peer.call(peerId, createDummyStream());
      call.on('stream', (stream) => {
        setIsLive(true);
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    });

    return () => peer.destroy();
  }, [peerId]);

  return (
    <div style={styles.videoWrapper}>
        <video ref={videoRef} autoPlay playsInline style={styles.videoElement} />
        {!isLive && <div style={styles.videoPlaceholder}>{peerId - 'Connecting...' : 'No stream'}</div>}
        {teamName && <div style={styles.videoOverlayLabel}>Live: {teamName.toUpperCase()}</div>}
    </div>
  );
}

function StatBlock({ icon, label, value, color }) {
    return (
        <div style={styles.statBlock}>
            <div style={{color}}>{icon}</div>
            <div>
                <div style={styles.statLabel}>{label}</div>
                <div style={{...styles.statValue, color}}>{value}</div>
            </div>
        </div>
    );
}

function TelemetryRow({ label, value, color }) {
    return (
        <div style={styles.teleRow}>
            <span>{label}</span>
            <span style={{color, fontWeight: 'bold'}}>{value}</span>
        </div>
    );
}

function createDummyStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  return canvas.captureStream();
}

const getModeColor = (m) => m === 'BUILD' - '#eab308' : m === 'FLIGHT' - '#ef4444' : '#6b7280';

/* --- STYLES --- */
const styles = {
  dashboard: {
    minHeight: '100vh',
    backgroundColor: '#0b1020',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
    padding: '24px',
    gap: '18px',
    position: 'relative',
    overflow: 'hidden'
  },
  background: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'radial-gradient(700px circle at 10% 10%, rgba(56, 189, 248, 0.16), transparent 60%), radial-gradient(500px circle at 80% 15%, rgba(99, 102, 241, 0.18), transparent 55%), linear-gradient(180deg, #0b1020 0%, #0b1220 100%)'
  },
  glowOne: {
    position: 'absolute',
    width: '420px',
    height: '420px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25), rgba(59, 130, 246, 0))',
    top: '8%',
    right: '12%',
    filter: 'blur(50px)',
    opacity: 0.8
  },
  glowTwo: {
    position: 'absolute',
    width: '520px',
    height: '520px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(236, 72, 153, 0.2), rgba(236, 72, 153, 0))',
    bottom: '-5%',
    left: '-8%',
    filter: 'blur(70px)',
    opacity: 0.7
  },
  header: {
    position: 'relative',
    zIndex: 1,
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '18px',
    padding: '18px 22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backdropFilter: 'blur(16px)'
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: '6px' },
  logo: { fontSize: '1.2rem', fontWeight: 700, letterSpacing: '0.8px', color: '#f8fafc' },
  phaseIndicator: {
    fontSize: '0.75rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: '#cbd5f5',
    background: 'rgba(15, 23, 42, 0.55)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    padding: '4px 10px',
    borderRadius: '999px'
  },
  pulse: { width: '8px', height: '8px', borderRadius: '50%', boxShadow: '0 0 12px rgba(255,255,255,0.3)' },

  timerContainer: {
    textAlign: 'center',
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '14px',
    padding: '8px 16px',
    minWidth: '160px'
  },
  timerLabel: { fontSize: '0.65rem', color: '#94a3b8', letterSpacing: '0.6px', textTransform: 'uppercase' },
  timerValue: { fontSize: '2.4rem', fontWeight: 700, lineHeight: 1 },

  headerRight: { display: 'flex', gap: '16px' },
  statBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '12px',
    background: 'rgba(15, 23, 42, 0.55)',
    border: '1px solid rgba(148, 163, 184, 0.15)'
  },
  statLabel: { fontSize: '0.6rem', color: '#94a3b8', letterSpacing: '0.4px', textTransform: 'uppercase' },
  statValue: { fontSize: '1.1rem', fontWeight: 700 },

  mainContent: {
    position: 'relative',
    zIndex: 1,
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)',
    gap: '18px'
  },
  feedSection: { minHeight: 0, display: 'flex' },
  masterMonitor: {
    flex: 1,
    background: 'rgba(2, 6, 23, 0.7)',
    borderRadius: '22px',
    position: 'relative',
    overflow: 'hidden',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 24px 60px rgba(2, 6, 23, 0.6)'
  },

  videoWrapper: { width: '100%', height: '100%', position: 'relative' },
  videoElement: { width: '100%', height: '100%', objectFit: 'contain' },
  videoPlaceholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    letterSpacing: '1px',
    fontSize: '1rem',
    background: 'rgba(2, 6, 23, 0.35)'
  },
  videoOverlayLabel: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    background: 'rgba(2, 6, 23, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '0.75rem',
    color: '#e2e8f0'
  },

  pilotStrip: {
    position: 'absolute',
    bottom: '16px',
    left: '16px',
    right: '16px',
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    padding: '8px',
    background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '14px',
    backdropFilter: 'blur(12px)'
  },
  pilotTab: {
    padding: '8px 14px',
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid transparent',
    borderRadius: '999px',
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: '0.2s',
    fontSize: '0.8rem',
    fontWeight: 600
  },
  tabStatus: (status) => ({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor:
      status === 'flying' - '#38bdf8' : status === 'landed' - '#22c55e' : status === 'crashed' - '#ef4444' : '#94a3b8'
  }),

  sidebar: { display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 },
  sidebarLabel: {
    fontSize: '0.7rem',
    color: '#94a3b8',
    fontWeight: 600,
    letterSpacing: '0.6px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    textTransform: 'uppercase'
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '16px',
    borderRadius: '16px',
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 16px 40px rgba(2, 6, 23, 0.4)'
  },

  btnPrimary: {
    background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
    color: '#0b1220',
    border: 'none',
    padding: '12px',
    borderRadius: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 14px 28px rgba(56, 189, 248, 0.35)'
  },
  btnDanger: {
    background: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
    color: '#fff',
    border: 'none',
    padding: '12px',
    borderRadius: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnOutline: {
    background: 'rgba(2, 6, 23, 0.5)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    color: '#e2e8f0',
    padding: '10px 12px',
    borderRadius: '12px',
    cursor: 'pointer'
  },

  telemetryCard: {
    background: 'rgba(15, 23, 42, 0.65)',
    padding: '16px',
    borderRadius: '16px',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 16px 40px rgba(2, 6, 23, 0.4)'
  },
  teleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.85rem',
    padding: '8px 0',
    borderBottom: '1px solid rgba(148, 163, 184, 0.12)'
  }
};
