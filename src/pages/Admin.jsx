import { useEffect, useMemo, useRef, useState } from 'react';
import Peer from 'peerjs';
import { supabase } from '../lib/supabaseClient';
import { useTimer } from '../context/TimerContext';
import { Settings, Power, Play, Square, RotateCcw, Clock } from 'lucide-react';

const SYNC_CHANNEL_NAME = 'timer-sync-control-v1';
const createInitialSyncModalState = () => ({
  open: false,
  phase: null,
  sessionId: null,
  status: 'idle',
  expectedParticipants: [],
  responses: {}
});
const formatBonusSeconds = (value) => `-${Math.abs(Number(value) || 0)}s`;
const formatPenaltySeconds = (value) => `+${Math.abs(Number(value) || 0)}s`;
const formatLandingLabel = (value) => String(value || 'hard').replaceAll('_', ' ').toUpperCase();

export default function Admin() {
  const [participants, setParticipants] = useState([]);
  const [masterPeerId, setMasterPeerId] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [countdown, setCountdown] = useState(null);
  const [syncModal, setSyncModal] = useState(() => createInitialSyncModalState());
  const [winnerCountdownTick, setWinnerCountdownTick] = useState(0);

  const syncChannelRef = useRef(null);

  const {
    mode,
    displayTime,
    setGlobalMode,
    winnerAnnouncement,
    clearWinnerAnnouncement,
    getAuthoritativeNowMs
  } = useTimer();

  async function fetchParticipants() {
    const { data } = await supabase.from('participants').select('*').order('created_at', { ascending: true });
    setParticipants(data || []);
  }

  // --- LOGIC: DATA POLLING (Auto-Refresh every 1s) ---
  useEffect(() => {
    // 1. Initial Fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchParticipants();

    // 2. Poll every second to ensure stats are live
    const interval = setInterval(() => {
      fetchParticipants();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(SYNC_CHANNEL_NAME)
      .on('broadcast', { event: 'sync-response' }, ({ payload }) => {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
        const teamId = typeof payload?.teamId === 'string' ? payload.teamId : null;
        const offsetMs = Number(payload?.offsetMs);
        if (!sessionId || !teamId || Number.isNaN(offsetMs)) return;

        setSyncModal((prev) => {
          if (!prev.open || prev.sessionId !== sessionId) return prev;
          return {
            ...prev,
            responses: {
              ...prev.responses,
              [teamId]: {
                ...payload,
                offsetMs: Math.round(offsetMs),
                receivedAtMs: Date.now()
              }
            }
          };
        });
      })
      .subscribe();

    syncChannelRef.current = channel;
    return () => {
      syncChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!syncModal.open || syncModal.status !== 'probing' || !syncModal.phase || !syncModal.sessionId) {
      return undefined;
    }

    const sendProbe = async () => {
      try {
        await syncChannelRef.current?.send({
          type: 'broadcast',
          event: 'sync-request',
          payload: {
            sessionId: syncModal.sessionId,
            phase: syncModal.phase,
            adminEpochMs: Date.now(),
            sentAt: new Date().toISOString()
          }
        });
      } catch (error) {
        console.error('Sync probe broadcast failed:', error);
      }
    };

    sendProbe();
    const interval = setInterval(sendProbe, 1000);
    return () => clearInterval(interval);
  }, [syncModal.open, syncModal.phase, syncModal.sessionId, syncModal.status]);

  const activePilot = useMemo(() => participants.find(p => p.peer_id === masterPeerId), [participants, masterPeerId]);
  const isTimerView = !masterPeerId;
  const readyCount = useMemo(
    () => syncModal.expectedParticipants.filter((participant) => Boolean(syncModal.responses[participant.id])).length,
    [syncModal.expectedParticipants, syncModal.responses]
  );
  const allReady = syncModal.expectedParticipants.length === 0 || readyCount === syncModal.expectedParticipants.length;

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
      await callback();
    }, 3000);
  };

  const startBuildAfterSync = () => {
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

  const startFlightAfterSync = () => {
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

  const openSyncModalForPhase = (phase) => {
    const expectedParticipants = participants
      .filter((participant) => Boolean(participant?.id))
      .map((participant) => ({
        id: participant.id,
        teamName: participant.team_name || 'UNKNOWN'
      }));

    setSyncModal({
      open: true,
      phase,
      sessionId: `${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'probing',
      expectedParticipants,
      responses: {}
    });
  };

  const handleSyncCancel = () => {
    setSyncModal(createInitialSyncModalState());
  };

  const handleSyncLaunch = async (forceStart = false) => {
    if (!syncModal.open || !syncModal.phase || !syncModal.sessionId) return;
    if (!forceStart && !allReady) return;

    setSyncModal((prev) => ({ ...prev, status: 'launching' }));

    const offsetsByTeamId = {};
    for (const participant of syncModal.expectedParticipants) {
      const offsetMs = Number(syncModal.responses[participant.id]?.offsetMs);
      if (!Number.isNaN(offsetMs)) {
        offsetsByTeamId[participant.id] = Math.round(offsetMs);
      }
    }

    try {
      await syncChannelRef.current?.send({
        type: 'broadcast',
        event: 'sync-commit',
        payload: {
          sessionId: syncModal.sessionId,
          phase: syncModal.phase,
          offsetsByTeamId,
          committedAt: new Date().toISOString(),
          adminEpochMs: Date.now()
        }
      });
    } catch (error) {
      console.error('Sync commit broadcast failed:', error);
    }

    const launchPhase = syncModal.phase;
    setSyncModal(createInitialSyncModalState());

    if (launchPhase === 'BUILD') {
      startBuildAfterSync();
      return;
    }

    if (launchPhase === 'FLIGHT') {
      startFlightAfterSync();
    }
  };

  const handleStartBuild = () => {
    openSyncModalForPhase('BUILD');
  };

  const handleStartFlight = () => {
    openSyncModalForPhase('FLIGHT');
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
    try {
      await clearWinnerAnnouncement();
    } catch (error) {
      console.error('Winner reset cleanup failed:', error);
    }
    setGlobalMode('IDLE');
    setMasterPeerId(null);
    setSyncModal(createInitialSyncModalState());
  };

  // --- UI HELPERS ---
  const getTimelineProgress = () => {
    if (mode === 'IDLE') return 1; 
    if (mode === 'BUILD') return 2; 
    if (mode === 'FLIGHT') return 3; 
    return 0;
  };

  const winner = winnerAnnouncement?.winner || null;
  const winnerBonusTotal = winner
    ? (Number(winner.bonuses?.budgetBonus) || 0)
      + (Number(winner.bonuses?.roverBonus) || 0)
      + (Number(winner.bonuses?.returnBonus) || 0)
      + (Number(winner.bonuses?.aestheticsBonus) || 0)
    : 0;
  const winnerLandingAdjustment = Number(winner?.penalties?.landingAdjustment) || 0;
  const winnerExtraPenalty = Math.abs(Number(winner?.penalties?.additionalPenalty) || 0);
  const winnerBonusDisplayTotal = winnerBonusTotal + Math.max(0, -winnerLandingAdjustment);
  const winnerPenaltyDisplayTotal = Math.max(0, winnerLandingAdjustment) + winnerExtraPenalty;
  const winnerRevealSeconds = (() => {
    void winnerCountdownTick;
    if (!winnerAnnouncement?.announcedAt) return 0;
    const announcedAtMs = Date.parse(winnerAnnouncement.announcedAt);
    if (Number.isNaN(announcedAtMs)) return 0;
    const remainingMs = (announcedAtMs + 5000) - getAuthoritativeNowMs();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  })();
  const showWinnerRevealCountdown = Boolean(winner && winnerRevealSeconds > 0);

  useEffect(() => {
    if (!winnerAnnouncement?.announcedAt) return undefined;
    const interval = setInterval(() => {
      setWinnerCountdownTick((tick) => tick + 1);
    }, 200);
    return () => clearInterval(interval);
  }, [winnerAnnouncement]);

  if (winner && !syncModal.open) {
    if (showWinnerRevealCountdown) {
      return (
        <div style={styles.winnerRevealRoot}>
          <div style={styles.winnerRevealBackdrop} />
          <div style={styles.winnerRevealContent}>
            <div style={styles.winnerRevealLabel}>WINNER ANNOUNCEMENT</div>
            <div style={styles.winnerRevealCounter}>{winnerRevealSeconds}</div>
            <div style={styles.winnerRevealHint}>LOCKING FINAL SCOREBOARD</div>
          </div>
        </div>
      );
    }

    return (
      <div style={styles.winnerScreenRoot}>
        <div style={styles.winnerScreenBackdrop} />
        <div style={styles.winnerScreenGlow} />
        <div style={styles.winnerScreenContent}>
          <div style={styles.winnerScreenKicker}>MISSION CHAMPION</div>
          <h1 style={styles.winnerScreenName}>{winner.teamName}</h1>
          <div style={styles.winnerScreenMetrics}>
            <div style={styles.winnerScreenMetricCard}>
              <span style={styles.winnerScreenMetricLabel}>FLIGHT TIME</span>
              <span style={styles.winnerScreenMetricValue}>{winner.flightTimeLabel || '--:--'}</span>
            </div>
            <div style={styles.winnerScreenMetricCard}>
              <span style={styles.winnerScreenMetricLabel}>FINAL SCORE</span>
              <span style={styles.winnerScreenMetricValue}>{winner.finalScoreLabel || '---'}</span>
            </div>
            <div style={styles.winnerScreenMetricCard}>
              <span style={styles.winnerScreenMetricLabel}>TOTAL BONUSES</span>
              <span style={styles.winnerScreenMetricValue}>{formatBonusSeconds(winnerBonusDisplayTotal)}</span>
            </div>
            <div style={styles.winnerScreenMetricCard}>
              <span style={styles.winnerScreenMetricLabel}>TOTAL PENALTIES</span>
              <span style={styles.winnerScreenMetricValue}>{formatPenaltySeconds(winnerPenaltyDisplayTotal)}</span>
            </div>
          </div>
          <div style={styles.winnerScreenBreakdown}>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>ROVER BONUS</span>
              <span style={styles.winnerScreenRowValue}>{formatBonusSeconds(winner.bonuses?.roverBonus || 0)}</span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>RETURN BONUS</span>
              <span style={styles.winnerScreenRowValue}>{formatBonusSeconds(winner.bonuses?.returnBonus || 0)}</span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>AESTHETICS BONUS</span>
              <span style={styles.winnerScreenRowValue}>{formatBonusSeconds(winner.bonuses?.aestheticsBonus || 0)}</span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>BUDGET BONUS</span>
              <span style={styles.winnerScreenRowValue}>{formatBonusSeconds(winner.bonuses?.budgetBonus || 0)}</span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>LANDING STATUS</span>
              <span style={styles.winnerScreenRowValue}>{formatLandingLabel(winner.penalties?.landingStatus)}</span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>{winnerLandingAdjustment < 0 ? 'LANDING BONUS' : 'LANDING PENALTY'}</span>
              <span style={styles.winnerScreenRowValue}>
                {winnerLandingAdjustment < 0
                  ? formatBonusSeconds(winnerLandingAdjustment)
                  : formatPenaltySeconds(winnerLandingAdjustment)}
              </span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>EXTRA PENALTY</span>
              <span style={styles.winnerScreenRowValue}>{formatPenaltySeconds(winnerExtraPenalty)}</span>
            </div>
            <div style={styles.winnerScreenRow}>
              <span style={styles.winnerScreenRowLabel}>BUDGET USED</span>
              <span style={styles.winnerScreenRowValue}>
                {winner.budgetUsed === null || winner.budgetUsed === undefined ? '---' : Number(winner.budgetUsed).toLocaleString()}
              </span>
            </div>
          </div>
          <button style={styles.winnerScreenResetBtn} onClick={resetHeat}>
            RESET FOR NEXT HEAT
          </button>
        </div>
      </div>
    );
  }

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

      {syncModal.open && (
        <div style={styles.syncModalBackdrop}>
          <div style={styles.syncModalCard}>
            <div style={styles.syncModalTitle}>SYNC {syncModal.phase} TIMER</div>
            <div style={styles.syncModalSubtitle}>
              READY {readyCount}/{syncModal.expectedParticipants.length}
            </div>

            <div style={styles.syncParticipantList}>
              {syncModal.expectedParticipants.length === 0 && (
                <div style={styles.syncEmptyState}>No participants available. You can continue.</div>
              )}

              {syncModal.expectedParticipants.map((participant) => {
                const response = syncModal.responses[participant.id];
                const isReady = Boolean(response);
                return (
                  <div key={participant.id} style={styles.syncParticipantRow}>
                    <span style={styles.syncParticipantName}>{participant.teamName}</span>
                    <span style={styles.syncParticipantMeta(isReady)}>
                      {isReady ? 'READY' : 'WAITING'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={styles.syncActions}>
              <button style={styles.syncActionButton} onClick={handleSyncCancel} disabled={syncModal.status === 'launching'}>
                CANCEL
              </button>
              <button
                style={styles.syncActionButton}
                onClick={() => handleSyncLaunch(true)}
                disabled={syncModal.status === 'launching'}
              >
                FORCE START
              </button>
              <button
                style={styles.syncPrimaryButton}
                onClick={() => handleSyncLaunch(false)}
                disabled={syncModal.status === 'launching' || !allReady}
              >
                {syncModal.status === 'launching' ? 'LAUNCHING...' : `START ${syncModal.phase}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. CONTROLS (Top Right) */}
      <div style={styles.commandDeck}>
        <div style={styles.deckHeader} onClick={() => setShowControls(!showControls)}>
          <Settings size={14} /> DIRECTOR
        </div>
        {showControls && (
          <div style={styles.deckGrid}>
            <button style={styles.cmdBtn} onClick={handleStartBuild} disabled={mode !== 'IDLE' || syncModal.open}>
              <Power size={14} /> START BUILD
            </button>
            <button style={styles.cmdBtn} onClick={handleStartFlight} disabled={mode === 'FLIGHT' || syncModal.open}>
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
  syncModalBackdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 120,
    background: 'rgba(2, 6, 23, 0.7)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  syncModalCard: {
    width: 'min(620px, 92vw)',
    maxHeight: '80vh',
    overflow: 'hidden',
    borderRadius: '14px',
    border: '1px solid rgba(148,163,184,0.3)',
    background: 'rgba(15, 23, 42, 0.95)',
    boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  syncModalTitle: {
    fontSize: '18px',
    fontWeight: 800,
    letterSpacing: '1.2px',
    color: '#e2e8f0'
  },
  syncModalSubtitle: {
    fontSize: '12px',
    color: '#94a3b8',
    letterSpacing: '1px'
  },
  syncParticipantList: {
    maxHeight: '44vh',
    overflowY: 'auto',
    border: '1px solid rgba(148,163,184,0.2)',
    borderRadius: '10px'
  },
  syncParticipantRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(148,163,184,0.15)',
    fontSize: '13px'
  },
  syncParticipantName: {
    color: '#e2e8f0'
  },
  syncParticipantMeta: (isReady) => ({
    color: isReady ? '#22c55e' : '#f59e0b',
    fontWeight: 700,
    fontSize: '12px',
    letterSpacing: '0.6px'
  }),
  syncEmptyState: {
    padding: '12px',
    fontSize: '12px',
    color: '#94a3b8'
  },
  syncActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px'
  },
  syncActionButton: {
    padding: '9px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(148,163,184,0.4)',
    background: 'rgba(15,23,42,0.8)',
    color: '#cbd5e1',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.7px',
    cursor: 'pointer'
  },
  syncPrimaryButton: {
    padding: '9px 14px',
    borderRadius: '8px',
    border: '1px solid transparent',
    background: 'linear-gradient(120deg, #22d3ee 0%, #3b82f6 100%)',
    color: '#0f172a',
    fontSize: '11px',
    fontWeight: 900,
    letterSpacing: '0.7px',
    cursor: 'pointer'
  },
  winnerRevealRoot: {
    height: '100vh',
    width: '100vw',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif',
    color: '#fff',
    background: '#020617'
  },
  winnerRevealBackdrop: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle at 50% 40%, rgba(250, 204, 21, 0.25) 0%, rgba(2,6,23,0.96) 62%)'
  },
  winnerRevealContent: {
    position: 'relative',
    zIndex: 2,
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '18px'
  },
  winnerRevealLabel: {
    fontSize: '20px',
    letterSpacing: '7px',
    fontWeight: 800,
    color: '#fde68a'
  },
  winnerRevealCounter: {
    fontSize: '220px',
    lineHeight: 0.9,
    fontWeight: 900,
    color: '#fff7ed',
    textShadow: '0 0 42px rgba(250, 204, 21, 0.7)'
  },
  winnerRevealHint: {
    fontSize: '14px',
    letterSpacing: '3px',
    color: '#cbd5e1',
    fontWeight: 700
  },
  winnerScreenRoot: {
    height: '89.2vh',
    width: '94.6vw',
    position: 'relative',
    overflow: 'hidden',
    color: '#fff',
    fontFamily: '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif',
    background: '#020617',
    padding: '40px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  winnerScreenBackdrop: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle at 20% 10%, rgba(251, 191, 36, 0.35) 0%, rgba(2, 6, 23, 0.95) 62%)'
  },
  winnerScreenGlow: {
    position: 'absolute',
    inset: '-20%',
    background: 'conic-gradient(from 0deg at 50% 50%, rgba(250, 204, 21, 0.25), rgba(245, 158, 11, 0.1), rgba(250, 204, 21, 0.25))',
    filter: 'blur(70px)',
    opacity: 0.7
  },
  winnerScreenContent: {
    position: 'relative',
    zIndex: 2,
    height: '100%',
    width: '100%',
    padding: '56px 74px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '20px'
  },
  winnerScreenKicker: {
    fontSize: '22px',
    letterSpacing: '10px',
    fontWeight: 800,
    color: '#fde68a'
  },
  winnerScreenName: {
    margin: 0,
    fontSize: '120px',
    lineHeight: 0.9,
    letterSpacing: '3px',
    fontWeight: 900,
    color: '#fff7ed',
    textShadow: '0 0 40px rgba(250, 204, 21, 0.6)'
  },
  winnerScreenMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '16px'
  },
  winnerScreenMetricCard: {
    borderRadius: '16px',
    border: '1px solid rgba(250, 204, 21, 0.4)',
    background: 'rgba(15, 23, 42, 0.48)',
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  winnerScreenMetricLabel: {
    fontSize: '12px',
    letterSpacing: '2px',
    color: '#fde68a',
    fontWeight: 800
  },
  winnerScreenMetricValue: {
    fontSize: '42px',
    lineHeight: 1,
    letterSpacing: '1px',
    color: '#f8fafc',
    fontWeight: 900
  },
  winnerScreenBreakdown: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px 20px',
    marginTop: '6px'
  },
  winnerScreenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid rgba(250, 204, 21, 0.22)',
    background: 'rgba(15, 23, 42, 0.42)'
  },
  winnerScreenRowLabel: {
    fontSize: '13px',
    letterSpacing: '1.1px',
    fontWeight: 700,
    color: '#fde68a'
  },
  winnerScreenRowValue: {
    fontSize: '20px',
    letterSpacing: '0.6px',
    fontWeight: 900,
    color: '#f8fafc'
  },
  winnerScreenResetBtn: {
    marginTop: '16px',
    alignSelf: 'flex-start',
    padding: '12px 18px',
    borderRadius: '10px',
    border: '1px solid rgba(248, 250, 252, 0.35)',
    background: 'rgba(2, 6, 23, 0.55)',
    color: '#e2e8f0',
    fontSize: '12px',
    letterSpacing: '1.4px',
    fontWeight: 800,
    cursor: 'pointer'
  },

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
