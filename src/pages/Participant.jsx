import { useEffect, useState, useRef } from 'react';
import { useTimer } from '../context/TimerContext';
import { supabase } from '../lib/supabaseClient';
import TimerOverlay from '../components/TimerOverlay';
import Peer from 'peerjs';
import { MonitorUp, ArrowRight, ShieldCheck, Wifi, PictureInPicture2 } from 'lucide-react';

const getStoredTeamId = () => localStorage.getItem('sfs_team_id') || localStorage.getItem('periselene_team_id');
const getStoredTeamName = () => localStorage.getItem('sfs_team_name') || localStorage.getItem('periselene_team_name');

export default function Participant() {
  // --- STATE & CONTEXT ---
  const { mode, displayTime, isAlert, countdown, countdownLabel } = useTimer();

  const [teamName, setTeamName] = useState(() => getStoredTeamName() || '');
  const [blueprintUrl, setBlueprintUrl] = useState('');
  const [blueprintLink, setBlueprintLink] = useState('');
  const [finalFlightSeconds, setFinalFlightSeconds] = useState(null);
  const [hasLanded, setHasLanded] = useState(false);

  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const [blueprintError, setBlueprintError] = useState('');
  const [isUploadingBlueprint, setIsUploadingBlueprint] = useState(false);
  const [blueprintFile, setBlueprintFile] = useState(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCallRef = useRef(null);

  // Mode Display Label
  const modeLabel = mode === 'IDLE' ? 'LOBBY' : mode === 'BUILD' ? 'BUILD' : 'FLIGHT';

  // Ensure we always show the correct callsign
  useEffect(() => {
    const teamId = getStoredTeamId();
    if (!teamId) return;

    localStorage.setItem('sfs_team_id', teamId);
    localStorage.setItem('periselene_team_id', teamId);

    supabase
      .from('participants')
      .select('team_name, blueprint_url, blueprint_link, status, flight_duration, start_time, land_time')
      .eq('id', teamId)
      .single()
      .then(({ data, error }) => {
        if (error) return;
        if (data?.team_name) {
          if (data.team_name !== teamName) {
            setTeamName(data.team_name);
          }
          localStorage.setItem('sfs_team_name', data.team_name);
          localStorage.setItem('periselene_team_name', data.team_name);
        }
        if (data?.blueprint_url) {
          setBlueprintUrl(data.blueprint_url);
        }
        if (data?.blueprint_link) {
          setBlueprintLink(data.blueprint_link);
        }
        if (data?.status === 'landed') {
          setHasLanded(true);
          if (data.flight_duration) {
            setFinalFlightSeconds(data.flight_duration);
          } else if (data.start_time && data.land_time) {
            const s = Math.round((new Date(data.land_time) - new Date(data.start_time)) / 1000);
            setFinalFlightSeconds(Math.max(0, s));
          }
        } else {
          setHasLanded(false);
          setFinalFlightSeconds(null);
        }
      });
  }, [teamName]);

  // --- LOGIC: TITLE UPDATE ---
  useEffect(() => {
    document.title = `PILOT // ${teamName}`;
  }, [teamName]);

  // --- LOGIC: PEERJS CONNECTION (Strictly Preserved) ---
  useEffect(() => {
    const teamId = getStoredTeamId();
    if (!teamId) {
      console.error('Participant not logged in.');
      return;
    }

    const peer = new Peer(undefined, {
      host: '0.peerjs.com',
      secure: true, port: 443, path: '/', debug: 2
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      // Update Supabase so Admin can find us
      supabase.from('participants').update({ peer_id: id }).eq('id', teamId).then();
    });

    peer.on('call', (call) => {
      // If we are already sharing, answer immediately
      if (localStreamRef.current) {
        call.answer(localStreamRef.current);
        return;
      }
      // Otherwise wait for user interaction
      pendingCallRef.current = call;
      setShareError('MISSION CONTROL REQUESTING VISUALS');
    });

    peer.on('error', (err) => { console.error(err); alert('Uplink Error: Connection failed. Refresh page.'); });

    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // --- LOGIC: SCREEN SHARE ---
  const startScreenShare = async () => {
    setShareError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 20 } }, audio: false
      });
      localStreamRef.current = stream;
      setIsSharing(true);

      const [track] = stream.getVideoTracks();
      if (track) track.onended = () => { setIsSharing(false); localStreamRef.current = null; };

      // Answer any pending call from Admin
      if (pendingCallRef.current) { pendingCallRef.current.answer(stream); pendingCallRef.current = null; }
    } catch (err) { console.error(err); setShareError('SCREEN SHARE DENIED'); }
  };

  // --- LOGIC: LANDING ---
  const handleLanded = async () => {
    if (mode !== 'FLIGHT') return alert("FLIGHT PHASE NOT ACTIVE");
    const teamId = getStoredTeamId();
    if (!teamId) return alert('TEAM ID NOT FOUND');
    const landTime = new Date();
    let flightDuration = null;

    try {
      const { data } = await supabase.from('participants').select('start_time').eq('id', teamId).single();
      if (data?.start_time) {
        const seconds = Math.round((landTime.getTime() - new Date(data.start_time).getTime()) / 1000);
        flightDuration = Math.max(0, seconds);
      }
    } catch (err) { console.error(err); }

    await supabase.from('participants').update({
      status: 'landed', land_time: landTime.toISOString(), flight_duration: flightDuration
    }).eq('id', teamId);

    setHasLanded(true);
    if (flightDuration !== null) setFinalFlightSeconds(flightDuration);

    alert('TOUCHDOWN CONFIRMED. TELEMETRY SENT.');
  };

  const onSliderChange = (e) => {
    const val = parseInt(e.target.value);
    setSliderValue(val);
    if (val >= 98) {
      handleLanded();
      setSliderValue(100);
    }
  };

  const handleBlueprintUpload = async () => {
    setBlueprintError('');
    const teamId = getStoredTeamId();
    if (!teamId) return setBlueprintError('TEAM ID NOT FOUND');
    if (!blueprintLink.trim()) return setBlueprintError('ADD SFS LINK');
    if (!blueprintFile) return setBlueprintError('CHOOSE IMAGE');

    setIsUploadingBlueprint(true);
    try {
      const safeName = blueprintFile.name.replace(/\s+/g, '-').toLowerCase();
      const filePath = `${teamId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('blueprint')
        .upload(filePath, blueprintFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from('blueprint').getPublicUrl(filePath);
      const publicUrl = publicData?.publicUrl || '';

      const { error: updateError } = await supabase.from('participants').update({
        blueprint_url: publicUrl,
        blueprint_link: blueprintLink.trim()
      }).eq('id', teamId);

      if (updateError) throw updateError;

      setBlueprintUrl(publicUrl);
      setBlueprintError('UPLOAD COMPLETE');
      setBlueprintFile(null);
    } catch (err) {
      console.error(err);
      setBlueprintError('UPLOAD FAILED');
    } finally {
      setIsUploadingBlueprint(false);
    }
  };

  const timerPrefix = mode === 'BUILD' ? 'T-' : 'T+';
  const timerValue = hasLanded && finalFlightSeconds !== null ? formatSeconds(finalFlightSeconds) : displayTime;

  return (
    <div style={styles.container}>

      {/* 1. BACKGROUND LAYERS */}
      <div style={styles.background} />
      <div style={styles.vignette} />
      {countdown ? (
        <div style={styles.countdownOverlay}>
          <div style={styles.countdownNumber}>{countdown}</div>
          {countdownLabel && <div style={styles.countdownLabel}>{countdownLabel} STARTING</div>}
        </div>
      ) : null}

      {/* 2. ROCKET IMAGE (Centered Silhouette) */}
      <div style={styles.rocketContainer}>
        <img
          src={blueprintUrl || "/rocket.png"}
          alt="Rocket Silhouette"
          style={{
            ...styles.rocketImage,
            opacity: mode === 'FLIGHT' && !blueprintUrl ? 0 : 1
          }}
        />
        {!blueprintUrl && (
          <img
            src="/rocketi.png"
            alt="Rocket Ignition"
            style={{
              ...styles.rocketImage,
              opacity: mode === 'FLIGHT' ? 1 : 0
            }}
          />
        )}
      </div>

      {/* 3. MAIN UI LAYER (The HUD) */}
      <div style={styles.hudLayer}>

        {/* TOP BAR: Info */}
        <header style={styles.topBar}>
          <div style={styles.topLeft}>
            <div style={styles.label}>CALLSIGN</div>
            <h1 style={styles.teamName}>{(teamName || 'UNKNOWN').toUpperCase()}</h1>
          </div>
        </header>

        {/* CENTER: The Big Timer */}
        <main style={styles.centerStage}>
          <div style={styles.statusAboveTimer}>
            <span style={{ ...styles.statusBadge, color: getModeColor(mode) }}>{modeLabel}</span>
          </div>
          <div style={{...styles.timerDisplay, color: isAlert ? '#ef4444' : '#ffffff'}}>
            <span style={styles.timerPrefix}>{timerPrefix}</span>
            <AnimatedDigits value={timerValue} digitStyle={styles.timerDigit} />
          </div>
          <div style={styles.timerLabel}>{hasLanded ? 'YOUR FLIGHT TIME' : 'MISSION CLOCK'}</div>

          {/* Blueprint Upload (Build only) */}
          {mode === 'BUILD' && !blueprintUrl && (
            <div style={styles.blueprintPanel}>
              <div style={styles.blueprintLabel}>Blueprint Upload</div>
              <input
                type="text"
                placeholder="Paste SFS blueprint link"
                value={blueprintLink}
                onChange={(e) => setBlueprintLink(e.target.value)}
                style={styles.blueprintInput}
              />
              <div style={styles.blueprintRow}>
                <label style={styles.blueprintFileBtn}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setBlueprintFile(e.target.files?.[0] || null)}
                    style={{ display: 'none' }}
                  />
                  {blueprintFile ? 'IMAGE SELECTED' : 'CHOOSE IMAGE'}
                </label>
                <button
                  style={{ ...styles.blueprintUploadBtn, opacity: isUploadingBlueprint ? 0.6 : 1 }}
                  onClick={handleBlueprintUpload}
                  disabled={isUploadingBlueprint}
                >
                  {isUploadingBlueprint ? 'UPLOADING...' : 'UPLOAD'}
                </button>
              </div>
              {blueprintError && <div style={styles.blueprintError}>{blueprintError}</div>}
            </div>
          )}

          {/* Landing Slider (Just below timer during Flight) */}
          {mode === 'FLIGHT' && sliderValue < 100 && (
            <div style={styles.sliderContainer}>
              <div style={styles.sliderTrack}>
                <div style={{...styles.sliderFill, width: `${sliderValue}%`}} />
                <span style={styles.sliderText}>
                  {sliderValue > 15 ? '' : 'SLIDE TO LAND'}
                </span>
                <input
                  type="range" style={styles.rangeInput}
                  min="0" max="100" value={sliderValue}
                  onChange={onSliderChange}
                  onMouseUp={() => sliderValue < 98 && setSliderValue(0)}
                  onTouchEnd={() => sliderValue < 98 && setSliderValue(0)}
                />
                <div style={{...styles.sliderHandle, left: `calc(${sliderValue}% - 25px)`}}>
                  <ArrowRight color="#000" size={18} />
                </div>
              </div>
            </div>
          )}

          {mode === 'FLIGHT' && sliderValue === 100 && (
            <div style={styles.successBadge}>
              <ShieldCheck size={24} /> SECURE
            </div>
          )}
        </main>

        {/* BOTTOM: Controls */}
        <footer style={styles.bottomBar}>
          
          {/* Uplink Status (Left) */}
          <div style={styles.statusGroup}>
            <div style={styles.statusIndicator}>
              <Wifi size={16} color={isSharing ? "#22c55e" : "#64748b"} />
              <span style={{color: isSharing ? "#22c55e" : "#64748b"}}>
                {isSharing ? 'UPLINK ESTABLISHED' : 'UPLINK OFFLINE'}
              </span>
            </div>
            {shareError && <div style={styles.errorText}>{shareError}</div>}
          </div>

          {/* Actions (Right) */}
          <div style={styles.actionGroup}>
            
            {/* Screen Share Button */}
            {!isSharing && (
              <button style={styles.btnShare} onClick={startScreenShare}>
                <MonitorUp size={18} /> INITIALIZE STREAM
              </button>
            )}

            <TimerOverlay
              compact
              containerStyle={styles.overlayButtonWrap}
              buttonStyle={styles.overlayButton}
              icon={PictureInPicture2}
              openLabel="OPEN OVERLAY"
              closeLabel="CLOSE OVERLAY"
            />

            {/* Success handled near timer */}
          </div>
        </footer>

      </div>
    </div>
  );
}

// --- HELPERS ---
const getModeColor = (m) => m === 'BUILD' ? '#fbbf24' : m === 'FLIGHT' ? '#38bdf8' : '#94a3b8';
const formatSeconds = (s) => {
  const minutes = Math.floor(s / 60).toString().padStart(2, '0');
  const seconds = Math.floor(s % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

// --- STYLES ---
const styles = {
  container: {
    height: '100vh', width: '100vw',
    backgroundColor: '#000',
    color: '#fff',
    fontFamily: '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif',
    overflow: 'hidden',
    position: 'relative',
    display: 'flex', flexDirection: 'column'
  },

  /* BACKGROUNDS */
  background: {
    position: 'absolute', inset: 0,
    background: 'radial-gradient(circle at center, #1a202c 0%, #000000 100%)',
    zIndex: 0
  },
  vignette: {
    position: 'absolute', inset: 0,
    background: 'radial-gradient(circle, transparent 60%, black 100%)',
    zIndex: 2, pointerEvents: 'none'
  },
  countdownOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    background: 'rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(8px)'
  },
  countdownNumber: {
    fontSize: '260px',
    fontWeight: 800,
    color: '#fff',
    textShadow: '0 0 60px rgba(255,255,255,0.8)'
  },
  countdownLabel: {
    marginTop: '-20px',
    fontSize: '14px',
    letterSpacing: '4px',
    color: '#94a3b8',
    fontWeight: 700
  },
  rocketContainer: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: 0.2,
    zIndex: 1, pointerEvents: 'none',
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden'
  },
  rocketImage: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    filter: 'drop-shadow(0 0 20px rgba(56, 189, 248, 0.3))',
    transition: 'opacity 0.8s ease'
  },

  /* HUD LAYER */
  hudLayer: {
    position: 'relative', zIndex: 10,
    flex: 1,
    display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '40px'
  },

  /* TOP HEADER */
  topBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
  },
  label: {
    fontSize: '11px', color: '#64748b', letterSpacing: '2px', fontWeight: 'bold', marginBottom: '4px'
  },
  teamName: {
    fontSize: '32px', fontWeight: 800, margin: 0, letterSpacing: '1px',
    textShadow: '0 0 20px rgba(255,255,255,0.2)'
  },
  statusAboveTimer: {
    marginBottom: '8px'
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 14px',
    borderRadius: '999px',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '2px',
    background: 'rgba(15, 23, 42, 0.6)',
    textShadow: '0 0 10px rgba(0,0,0,0.6)'
  },

  /* CENTER STAGE (TIMER) */
  centerStage: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    transform: 'translateY(-10px)',
    gap: '10px'
  },
  timerDisplay: {
    fontSize: '160px',
    fontWeight: 700,
    fontFamily: 'monospace',
    lineHeight: 0.9,
    letterSpacing: '-5px',
    textShadow: '0 0 40px rgba(56, 189, 248, 0.15)',
    display: 'flex',
    alignItems: 'baseline',
    gap: '14px'
  },
  timerPrefix: {
    fontSize: '48px',
    letterSpacing: '2px',
    color: '#94a3b8'
  },
  digitRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '2px'
  },
  timerDigit: {
    display: 'inline-block',
    minWidth: '0.7em',
    textAlign: 'center'
  },
  digitSeparator: { minWidth: '0.3em', opacity: 0.7 },
  timerLabel: {
    fontSize: '14px', color: '#64748b', letterSpacing: '6px', marginTop: '10px', fontWeight: 600
  },
  overlayButtonWrap: {
    marginTop: '8px',
    alignSelf: 'flex-end'
  },
  overlayButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 20px',
    borderRadius: '4px',
    border: '1px solid rgba(56, 189, 248, 0.4)',
    background: 'rgba(56, 189, 248, 0.1)',
    color: '#38bdf8',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '1px',
    cursor: 'pointer',
    backdropFilter: 'blur(10px)',
    transition: 'all 0.2s ease',
    textTransform: 'uppercase'
  },

  /* BOTTOM BAR */
  bottomBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    height: '80px'
  },

  statusGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
  statusIndicator: {
    display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px',
    fontWeight: 700, letterSpacing: '1px'
  },
  errorText: { color: '#ef4444', fontSize: '11px', fontWeight: 700, letterSpacing: '1px' },

  actionGroup: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '15px' },

  btnShare: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '12px 20px', borderRadius: '4px',
    border: '1px solid rgba(56, 189, 248, 0.4)',
    background: 'rgba(56, 189, 248, 0.1)',
    color: '#38bdf8', fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
    cursor: 'pointer', backdropFilter: 'blur(10px)',
    transition: 'all 0.2s ease',
    textTransform: 'uppercase'
  },

  /* SLIDER COMPONENT */
  sliderContainer: { width: '300px', height: '50px' },
  sliderTrack: {
    position: 'relative', width: '100%', height: '100%',
    background: 'rgba(20, 20, 20, 0.8)',
    borderRadius: '25px',
    border: '1px solid rgba(255,255,255,0.15)',
    display: 'flex', alignItems: 'center',
    overflow: 'hidden',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
  },
  sliderFill: {
    position: 'absolute', left: 0, height: '100%',
    background: 'linear-gradient(90deg, #0ea5e9, #22c55e)',
    zIndex: 0
  },
  sliderText: {
    position: 'absolute', width: '100%', textAlign: 'center',
    fontSize: '12px', fontWeight: 700, color: '#94a3b8', letterSpacing: '2px',
    zIndex: 1, pointerEvents: 'none'
  },
  rangeInput: {
    position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', zIndex: 10
  },
  sliderHandle: {
    position: 'absolute', width: '50px', height: '50px',
    background: '#fff', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 5, pointerEvents: 'none',
    boxShadow: '0 0 15px rgba(255,255,255,0.5)'
  },

  successBadge: {
    display: 'flex', alignItems: 'center', gap: '10px',
    color: '#22c55e', fontSize: '18px', fontWeight: 700, letterSpacing: '1px',
    textShadow: '0 0 10px rgba(34, 197, 94, 0.4)'
  },

  /* BLUEPRINT UPLOAD */
  blueprintPanel: {
    display: 'flex', flexDirection: 'column', gap: '8px',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid rgba(148,163,184,0.2)',
    background: 'rgba(2, 6, 23, 0.5)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
    minWidth: '320px'
  },
  blueprintLabel: { fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: '#94a3b8' },
  blueprintInput: {
    background: 'rgba(2, 6, 23, 0.7)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '8px',
    padding: '8px 10px',
    color: '#e2e8f0',
    fontSize: '12px',
    outline: 'none'
  },
  blueprintRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  blueprintFileBtn: {
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid rgba(56, 189, 248, 0.4)',
    color: '#38bdf8',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1px',
    cursor: 'pointer',
    background: 'rgba(56, 189, 248, 0.08)'
  },
  blueprintUploadBtn: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #38bdf8 0%, #22c55e 100%)',
    color: '#0b1220',
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '1px',
    cursor: 'pointer'
  },
  blueprintError: { fontSize: '11px', color: '#fbbf24', letterSpacing: '1px', fontWeight: 700 }
};

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
