import { useEffect, useMemo, useRef, useState } from 'react';
import Peer from 'peerjs';
import { supabase } from '../lib/supabaseClient';
import { useTimer } from '../context/TimerContext';
import { Settings, Power, Play, Square, RotateCcw, Clock } from 'lucide-react';

export default function Admin() {
  const [participants, setParticipants] = useState([]);
  const [masterPeerId, setMasterPeerId] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [countdown, setCountdown] = useState(null);

  const { mode, displayTime, setGlobalMode } = useTimer();

  async function fetchParticipants() {
    const { data } = await supabase.from('participants').select('*').order('created_at', { ascending: true });
    setParticipants(data || []);
  }

  // --- LOGIC: DATA POLLING (Auto-Refresh every 2s) ---
  useEffect(() => {
    // 1. Initial Fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchParticipants();

    // 2. Poll every 2 seconds to ensure stats are live
    const interval = setInterval(() => {
      fetchParticipants();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const activePilot = useMemo(() => participants.find(p => p.peer_id === masterPeerId), [participants, masterPeerId]);
  const isTimerView = !masterPeerId;

  const stats = {
    total: participants.length,
    flying: participants.filter(p => p.status === 'flying').length,
    landed: participants.filter(p => p.status === 'landed').length,
  };

  // --- LOGIC: CONTROLS ---
  const runSequence = async (label, callback) => {
    setCountdown(3);
    const endAt = new Date(Date.now() + 3000).toISOString();
    await supabase.from('global_state').upsert({
      id: 1,
      countdown_end: endAt,
      countdown_label: label
    }, { onConflict: 'id' });
    setTimeout(() => setCountdown(2), 1000);
    setTimeout(() => setCountdown(1), 2000);
    setTimeout(async () => {
      setCountdown(null);
      await supabase.from('global_state').upsert({
        id: 1,
        countdown_end: null,
        countdown_label: null
      }, { onConflict: 'id' });
      callback();
    }, 3000);
  };

  const handleStartBuild = () => {
    runSequence('BUILD', async () => {
      const { error } = await supabase.from('participants').update({ status: 'building' }).not('id', 'is', null);
      if (error) {
        console.error(error);
        alert('BUILD START FAILED. CHECK DATABASE POLICIES.');
        return;
      }
      setGlobalMode('BUILD');
    });
  };

  const handleStartFlight = () => {
    runSequence('FLIGHT', async () => {
      const now = new Date().toISOString();
      const { error } = await supabase.from('participants').update({
        start_time: now,
        status: 'flying',
        land_time: null,
        flight_duration: null,
        landing_frame_url: null
      }).not('id', 'is', null);
      if (error) {
        console.error(error);
        alert('FLIGHT START FAILED. CHECK DATABASE POLICIES.');
        return;
      }
      setGlobalMode('FLIGHT');
    });
  };

  const freezeMission = async () => {
    if(confirm("PAUSE TELEMETRY?")) setGlobalMode('IDLE');
  };

  const resetHeat = async () => {
    if(!confirm("FULL RESET? This clears all scores.")) return;
    const { error: scoreError } = await supabase.from('scores').delete().not('id', 'is', null);
    if (scoreError) console.error(scoreError);
    const { error: participantError } = await supabase.from('participants').update({
      status: 'waiting', peer_id: null, start_time: null, land_time: null, 
      flight_duration: null, landing_frame_url: null, used_budget: null, landing_status: null, judge_notes: null,
      rover_bonus: false, return_bonus: false, aesthetics_bonus: null, additional_penalty: null
    }).not('id', 'is', null);
    if (participantError) {
      console.error(participantError);
      alert('RESET FAILED. CHECK DATABASE POLICIES.');
      return;
    }
    await supabase.from('global_state').upsert({ id: 1, countdown_end: null, countdown_label: null }, { onConflict: 'id' });
    setGlobalMode('IDLE');
    setMasterPeerId(null);
  };

  // --- UI HELPERS ---
  const getTimelineProgress = () => {
    if (mode === 'IDLE') return 1; 
    if (mode === 'BUILD') return 2; 
    if (mode === 'FLIGHT') return 3; 
    return 0;
  };

  return (
    <div style={styles.container}>
      
      {/* 1. BACKGROUND / VIDEO LAYER */}
      <div style={styles.videoLayer}>
        {masterPeerId ? (
          <MasterStream peerId={masterPeerId} />
        ) : (
          <div style={styles.bigIdleTimerContainer}>
            <div style={styles.bigIdleBackground}>
              <img
                src="/rocket.png"
                alt="Rocket"
                style={{
                  ...styles.bigIdleRocket,
                  opacity: mode === 'FLIGHT' ? 0 : 1
                }}
              />
              <img
                src="/rocketi.png"
                alt="Rocket Ignition"
                style={{
                  ...styles.bigIdleRocket,
                  opacity: mode === 'FLIGHT' ? 1 : 0
                }}
              />
            </div>
            <div style={styles.bigIdleLabel}>MISSION TIME</div>
            <div style={styles.bigIdleTime}>
              <span style={styles.bigIdlePrefix}>{mode === 'BUILD' ? 'T-' : 'T+'}</span>
              <AnimatedDigits value={displayTime} digitStyle={styles.bigTimerDigit} />
            </div>
            <div style={styles.bigIdleStatus}>{mode === 'IDLE' ? 'SYSTEM READY' : mode}</div>
          </div>
        )}
      </div>

      {/* 2. COUNTDOWN OVERLAY */}
      {countdown !== null && (
        <div style={styles.countdownOverlay}>
          <div style={styles.countdownNumber}>{countdown}</div>
        </div>
      )}

      {/* 3. CONTROLS (Top Right) */}
      <div style={styles.commandDeck}>
        <div style={styles.deckHeader} onClick={() => setShowControls(!showControls)}>
          <Settings size={14} /> DIRECTOR
        </div>
        {showControls && (
          <div style={styles.deckGrid}>
            <button style={styles.cmdBtn} onClick={handleStartBuild} disabled={mode !== 'IDLE'}>
              <Power size={14} /> START BUILD
            </button>
            <button style={styles.cmdBtn} onClick={handleStartFlight} disabled={mode === 'FLIGHT'}>
              <Play size={14} /> START FLIGHT
            </button>
            <button style={styles.cmdBtn} onClick={() => setMasterPeerId(null)} disabled={!masterPeerId}>
              <Clock size={14} /> SHOW TIMER
            </button>
            <button style={{...styles.cmdBtn, borderColor: '#ef4444', color:'#ef4444'}} onClick={freezeMission}>
              <Square size={14} /> STOP
            </button>
            <button style={styles.cmdBtn} onClick={resetHeat}>
              <RotateCcw size={14} /> RESET
            </button>
          </div>
        )}
      </div>

      {/* 4. TEAM LIST (Top Left) */}
      <div style={styles.pilotListContainer}>
        <div style={styles.pilotListHeader}>PARTICIPANTS ({participants.length})</div>
        <div style={styles.pilotListScroll}>
          {participants.map(p => (
            <div 
              key={p.id} 
              onClick={() => setMasterPeerId(p.peer_id)}
              style={{
                ...styles.pilotRow,
                background: masterPeerId === p.peer_id ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                borderLeft: masterPeerId === p.peer_id ? '3px solid #38bdf8' : '3px solid transparent',
                opacity: p.peer_id ? 1 : 0.5
              }}
            >
              <div style={styles.pilotStatusDot(p.status)} />
              {p.team_name}
            </div>
          ))}
        </div>
      </div>

      {/* 5. SOFT BOTTOM TELEMETRY BAR */}
      <div style={styles.telemetryBar}>
        
        {/* Soft Glow Behind Center */}
        <div style={styles.centerGlow} />

        {/* LEFT: Semi-Circular Gauges */}
        <div style={styles.gaugeCluster}>
          <Gauge label="TEAMS" value={stats.total} max={20} color="#fff" />
          <Gauge label="FLYING" value={stats.flying} max={stats.total || 1} color="#38bdf8" />
          <Gauge label="LANDED" value={stats.landed} max={stats.total || 1} color="#22c55e" />
        </div>

        {/* CENTER: Timeline & Timer */}
        <div style={styles.centerConsole}>
          <div style={styles.timelineContainer}>
            <div style={styles.timelineLine} />
            <TimelinePoint label="LOBBY" active={getTimelineProgress() >= 1} pos="0%" />
            <TimelinePoint label="BUILD" active={getTimelineProgress() >= 2} pos="33%" />
            <TimelinePoint label="FLIGHT" active={getTimelineProgress() >= 3} pos="66%" />
            <TimelinePoint label="RECOVERY" active={false} pos="100%" />
          </div>
          
          <div style={styles.mainTimer}>
            <span style={styles.timerPrefix}>T{mode === 'BUILD' ? '-' : '+'}</span>
            {displayTime}
          </div>
        </div>

        {/* RIGHT: Info */}
        <div style={styles.infoCluster}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>ACTIVE</span>
            <span style={styles.infoValue}>{isTimerView ? 'TIMER' : (activePilot ? activePilot.team_name.toUpperCase() : 'UNKNOWN')}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>PHASE</span>
            <span style={styles.infoValue}>{mode}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>SIGNAL</span>
            <span style={{...styles.infoValue, color: (isTimerView || activePilot?.peer_id) ? '#22c55e' : '#666'}}>
                {(isTimerView || activePilot?.peer_id) ? 'GOOD' : 'LOS'}
            </span>
          </div>
        </div>

      </div>
      <div style={styles.creditText}>Made with 💙 by Srijal Kumar</div>
    </div>
  );
}

/* --- COMPONENTS --- */

function MasterStream({ peerId }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (!peerId) return;
    const peer = new Peer(undefined, { host: '0.peerjs.com', secure: true });
    peer.on('open', () => {
      const call = peer.call(peerId, createDummyStream());
      call.on('stream', (stream) => { if(videoRef.current) videoRef.current.srcObject = stream; });
    });
    return () => peer.destroy();
  }, [peerId]);

  return (
    <div style={styles.videoBox}>
      <video ref={videoRef} autoPlay playsInline style={styles.videoObj} />
    </div>
  );
}

function Gauge({ label, value, max, color }) {
  // SVG Math for a semi-circle gauge (180 degrees)
  // Circumference of semi-circle = pi * r
  // We use a dasharray where full = pi*r
  const r = 24;
  const full = Math.PI * r; 
  const percentage = Math.min(value / max, 1);
  const offset = full - (percentage * full);

  return (
    <div style={styles.gaugeBox}>
      <div style={styles.gaugeRelative}>
        <svg width="60" height="35" viewBox="0 0 60 35" style={{ overflow: 'visible' }}>
          {/* Background Arc */}
          <path d="M5,30 A25,25 0 0,1 55,30" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" strokeLinecap="round" />
          {/* Active Arc */}
          <path 
            d="M5,30 A25,25 0 0,1 55,30" 
            fill="none" 
            stroke={color} 
            strokeWidth="4" 
            strokeLinecap="round"
            strokeDasharray={full}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div style={styles.gaugeValue}>{value}</div>
      </div>
      <div style={styles.gaugeLabel}>{label}</div>
    </div>
  );
}

function TimelinePoint({ label, active, pos }) {
  return (
    <div style={{...styles.timelinePoint, left: pos}}>
      <div style={{...styles.dot, background: active ? '#fff' : '#555', boxShadow: active ? '0 0 15px rgba(255,255,255,0.6)' : 'none'}} />
      <span style={{...styles.pointLabel, color: active ? '#fff' : '#777', textShadow: active ? '0 0 10px rgba(0,0,0,0.8)' : 'none'}}>{label}</span>
    </div>
  );
}

function AnimatedDigits({ value, digitStyle }) {
  return (
    <span style={styles.digitRow}>
      {value.split('').map((ch, idx) => {
        if (ch === ':') {
          return (
            <span key={`sep-${idx}`} style={{ ...digitStyle, ...styles.digitSeparator }}>
              {ch}
            </span>
          );
        }
        return (
          <span key={`${idx}-${ch}`} style={{ ...digitStyle, animation: 'digitFlip 0.35s ease' }}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}

function createDummyStream() {
  const canvas = document.createElement('canvas');
  canvas.width=1; canvas.height=1; return canvas.captureStream();
}

/* --- STYLES --- */
const styles = {
  container: {
    height: '100vh', width: '100vw', background: '#000', overflow: 'hidden', position: 'relative',
    fontFamily: '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif', color: 'white', userSelect: 'none'
  },
  
  /* VIDEO LAYER */
  videoLayer: { position: 'absolute', inset: 0, zIndex: 0 },
  videoBox: { width: '100%', height: '100%', background: '#000' },
  videoObj: { width: '100%', height: '100%', objectFit: 'contain' },
  
  bigIdleTimerContainer: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column', 
    alignItems: 'center', justifyContent: 'center', 
    background: 'radial-gradient(circle, #1a1a1a 0%, #000 100%)',
    position: 'relative',
    overflow: 'hidden'
  },
  bigIdleBackground: {
    position: 'absolute', inset: 0, zIndex: 0, opacity: 0.18,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden'
  },
  bigIdleRocket: {
    position: 'absolute',
    inset: 0,
    width: '100%', height: '100%', objectFit: 'cover',
    filter: 'drop-shadow(0 0 30px rgba(56, 189, 248, 0.3))',
    transition: 'opacity 0.8s ease'
  },
  bigIdleLabel: { position: 'relative', zIndex: 1, fontSize: '18px', color: '#666', letterSpacing: '4px', marginBottom: '0px' },
  bigIdleTime: { position: 'relative', zIndex: 1, fontSize: '140px', fontWeight: 'bold', fontFamily: 'monospace', lineHeight: '1.1', textShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'baseline', gap: '12px' },
  bigIdlePrefix: { fontSize: '48px', color: '#94a3b8', letterSpacing: '2px' },
  digitRow: { display: 'flex', alignItems: 'baseline', gap: '2px' },
  bigTimerDigit: { display: 'inline-block', minWidth: '0.7em', textAlign: 'center' },
  digitSeparator: { minWidth: '0.3em', opacity: 0.7 },
  bigIdleStatus: { position: 'relative', zIndex: 1, fontSize: '20px', color: '#38bdf8', letterSpacing: '2px', opacity: 0.8 },

  /* COUNTDOWN OVERLAY */
  countdownOverlay: {
    position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)'
  },
  countdownNumber: { fontSize: '350px', fontWeight: 'bold', textShadow: '0 0 60px rgba(255,255,255,0.8)' },

  /* CONTROLS (Top Right) */
  commandDeck: {
    position: 'absolute', top: '25px', right: '25px', zIndex: 20,
    background: 'rgba(20, 20, 20, 0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
    width: '180px', backdropFilter: 'blur(20px)', boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
  },
  deckHeader: {
    padding: '12px', fontSize: '11px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#ccc', letterSpacing: '1px'
  },
  deckGrid: { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' },
  cmdBtn: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: '#eee',
    padding: '10px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
    fontWeight: 'bold', letterSpacing: '0.5px', borderRadius: '6px', transition: '0.2s'
  },

  /* PILOT LIST (Top Left) */
  pilotListContainer: {
    position: 'absolute', top: '25px', left: '25px', zIndex: 20,
    width: '240px', maxHeight: '500px',
    background: 'rgba(10, 10, 10, 0.5)', backdropFilter: 'blur(20px)',
    borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
  },
  pilotListHeader: { 
    padding: '12px', fontSize: '11px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#ccc', letterSpacing: '1px'
  },
  pilotListScroll: { overflowY: 'auto', padding: '8px' },
  pilotRow: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '4px',
    fontSize: '13px', cursor: 'pointer', transition: '0.2s', marginBottom: '4px'
  },
  pilotStatusDot: (status) => ({
    width: '6px', height: '6px', borderRadius: '50%',
    background: status === 'flying' ? '#38bdf8' : status === 'landed' ? '#22c55e' : '#666',
    boxShadow: status === 'flying' ? '0 0 6px #38bdf8' : 'none'
  }),

  /* BOTTOM TELEMETRY BAR (Apple Style) */
  telemetryBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '160px',
    // Ultra soft gradient
    background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 30%, transparent 80%)',
    zIndex: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: '0 60px 40px 60px',
    pointerEvents: 'none' // Let clicks pass through to video if needed, but clusters need pointer-events: auto
  },

  /* SOFT CENTER SHADOW */
  centerGlow: {
    position: 'absolute', bottom: '-80px', left: '50%', transform: 'translateX(-50%)',
    width: '1000px', height: '250px', borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(10, 10, 20, 0.8) 0%, transparent 90%)',
    filter: 'blur(40px)',
    zIndex: -1
  },

  /* GAUGES (Left) */
  gaugeCluster: { display: 'flex', gap: '20px', width: '300px', pointerEvents: 'auto' },
  gaugeBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '80px' },
  gaugeRelative: { position: 'relative', height: '40px', display: 'flex', justifyContent: 'center' },
  gaugeValue: { position: 'absolute', bottom: '0px', fontSize: '18px', fontWeight: 'bold' },
  gaugeLabel: { fontSize: '10px', color: '#888', marginTop: '2px', letterSpacing: '1px' },

  /* CENTER CONSOLE */
  centerConsole: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '0px'
  },
  timelineContainer: {
    position: 'relative', width: '500px', height: '40px', marginBottom: '5px'
  },
  timelineLine: {
    position: 'absolute', top: '7px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.15)'
  },
  timelinePoint: { position: 'absolute', top: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  dot: { width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #000', transition: '0.3s' },
  pointLabel: { fontSize: '10px', marginTop: '8px', fontWeight: 'bold', letterSpacing: '1.5px', transition: '0.3s' },

  mainTimer: { fontSize: '64px', fontWeight: '400', letterSpacing: '2px', fontFamily: 'monospace', textShadow: '0 5px 20px rgba(0,0,0,0.8)' },
  timerPrefix: { fontSize: '32px', marginRight: '8px', color: '#888' },

  /* RIGHT INFO */
  infoCluster: { width: '300px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', pointerEvents: 'auto' },
  infoRow: { display: 'flex', gap: '15px', alignItems: 'baseline' },
  infoLabel: { fontSize: '11px', color: '#777', letterSpacing: '1px' },
  infoValue: { fontSize: '18px', fontWeight: 'bold', textShadow: '0 0 10px rgba(0,0,0,0.5)' },
  creditText: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: '10px',
    zIndex: 30,
    fontSize: '10px',
    color: 'rgba(191, 219, 254, 0.37)',
    letterSpacing: '0.4px',
    pointerEvents: 'none'
  },
};
