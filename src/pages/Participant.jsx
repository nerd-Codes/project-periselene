import { useEffect, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';
import { supabase } from '../lib/supabaseClient';
import TimerOverlay from '../components/TimerOverlay';
import Peer from 'peerjs';
import { MonitorUp, ArrowRight, ShieldCheck, Wifi, PictureInPicture2, BookOpen } from 'lucide-react';

const SYNC_CHANNEL_NAME = 'timer-sync-control-v1';
const TOTAL_BUDGET = 50000;
const BUDGET_BONUS_DIVISOR = 100;
const ROVER_BONUS = 60;
const RETURN_BONUS = 100;
const getStoredTeamId = () => localStorage.getItem('sfs_team_id') || localStorage.getItem('periselene_team_id');
const getStoredTeamName = () => localStorage.getItem('sfs_team_name') || localStorage.getItem('periselene_team_name');

export default function Participant() {
  // --- STATE & CONTEXT ---
  const {
    mode,
    displayTime,
    isAlert,
    countdown,
    countdownLabel,
    applyClockOffsetMs,
    getAuthoritativeNowMs,
    lastClockSyncAt,
    winnerAnnouncement
  } = useTimer();

  const [teamName, setTeamName] = useState(() => getStoredTeamName() || '');
  const [blueprintUrl, setBlueprintUrl] = useState('');
  const [blueprintLink, setBlueprintLink] = useState('');
  const [finalFlightSeconds, setFinalFlightSeconds] = useState(null);
  const [hasLanded, setHasLanded] = useState(false);
  const [participantStatus, setParticipantStatus] = useState('waiting');
  const [isLanding, setIsLanding] = useState(false);

  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const [blueprintError, setBlueprintError] = useState('');
  const [isUploadingBlueprint, setIsUploadingBlueprint] = useState(false);
  const [blueprintFile, setBlueprintFile] = useState(null);
  const [syncStateText, setSyncStateText] = useState('CLOCK WAITING');
  const [winnerCountdownTick, setWinnerCountdownTick] = useState(0);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [scoreSnapshot, setScoreSnapshot] = useState({
    usedBudget: null,
    roverBonus: null,
    returnBonus: null,
    aestheticsBonus: null,
    landingStatus: '',
    additionalPenalty: null,
    flightDuration: null
  });

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCallRef = useRef(null);
  const syncChannelRef = useRef(null);
  const syncOffsetsRef = useRef({});
  const leaderboardFetchKeyRef = useRef('');
  const winnerAnnouncementKey = winnerAnnouncement?.announcedAt
    ? `${winnerAnnouncement.announcedAt}:${winnerAnnouncement.winner?.teamId || ''}`
    : '';

  // Mode Display Label
  const modeLabel = mode === 'IDLE' ? 'LOBBY' : mode === 'BUILD' ? 'BUILD' : 'FLIGHT';

  // Ensure we always show the correct callsign + keep status in sync
  useEffect(() => {
    const teamId = getStoredTeamId();
    if (!teamId) return;

    localStorage.setItem('sfs_team_id', teamId);
    localStorage.setItem('periselene_team_id', teamId);

    const fetchParticipant = async () => {
      const { data, error } = await supabase
        .from('participants')
        .select('team_name, blueprint_url, blueprint_link, status, flight_duration, start_time, land_time, used_budget, rover_bonus, return_bonus, aesthetics_bonus, landing_status, additional_penalty')
        .eq('id', teamId)
        .single();
      if (error || !data) return;

      if (data.team_name) {
        setTeamName(data.team_name);
        localStorage.setItem('sfs_team_name', data.team_name);
        localStorage.setItem('periselene_team_name', data.team_name);
      }
      if (data.blueprint_url) setBlueprintUrl(data.blueprint_url);
      if (data.blueprint_link) setBlueprintLink(data.blueprint_link);
      if (data.status) setParticipantStatus(data.status);
      setScoreSnapshot({
        usedBudget: data.used_budget ?? null,
        roverBonus: data.rover_bonus,
        returnBonus: data.return_bonus,
        aestheticsBonus: data.aesthetics_bonus ?? null,
        landingStatus: data.landing_status || '',
        additionalPenalty: data.additional_penalty ?? null,
        flightDuration: data.flight_duration ?? null
      });

      if (data.status === 'landed') {
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
    };

    fetchParticipant();
    const interval = setInterval(fetchParticipant, 1000);
    return () => clearInterval(interval);
  }, []);

  // --- LOGIC: TITLE UPDATE ---
  useEffect(() => {
    document.title = `PILOT // ${teamName}`;
  }, [teamName]);

  useEffect(() => {
    if (!lastClockSyncAt) {
      setSyncStateText('CLOCK WAITING');
      return;
    }
    setSyncStateText('CLOCK SYNCED');
  }, [lastClockSyncAt]);

  useEffect(() => {
    const teamId = getStoredTeamId();
    if (!teamId) return;

    const channel = supabase
      .channel(SYNC_CHANNEL_NAME)
      .on('broadcast', { event: 'sync-request' }, async ({ payload }) => {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
        const phase = typeof payload?.phase === 'string' ? payload.phase : 'PHASE';
        const adminEpochMs = Number(payload?.adminEpochMs);
        if (!sessionId || Number.isNaN(adminEpochMs)) return;

        const clientEpochMs = Date.now();
        const offsetMs = Math.round(adminEpochMs - clientEpochMs);
        syncOffsetsRef.current[sessionId] = offsetMs;
        setSyncStateText(`SYNCING ${phase}...`);

        try {
          await channel.send({
            type: 'broadcast',
            event: 'sync-response',
            payload: {
              sessionId,
              phase,
              teamId,
              teamName: getStoredTeamName() || teamName || 'UNKNOWN',
              clientEpochMs,
              offsetMs,
              respondedAt: new Date().toISOString()
            }
          });
        } catch (error) {
          console.error('Sync response broadcast failed:', error);
        }
      })
      .on('broadcast', { event: 'sync-commit' }, ({ payload }) => {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
        if (!sessionId) return;

        const sessionOffset = Number(payload?.offsetsByTeamId?.[teamId]);
        const fallbackOffset = Number(syncOffsetsRef.current[sessionId]);
        const finalOffset = Number.isNaN(sessionOffset) ? fallbackOffset : sessionOffset;
        if (Number.isNaN(finalOffset)) return;

        applyClockOffsetMs(finalOffset, { source: 'admin-sync' });
      })
      .subscribe();

    syncChannelRef.current = channel;
    return () => {
      syncChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [applyClockOffsetMs, teamName]);

  useEffect(() => {
    if (!winnerAnnouncementKey) return undefined;
    const interval = setInterval(() => {
      setWinnerCountdownTick((tick) => tick + 1);
    }, 200);
    return () => clearInterval(interval);
  }, [winnerAnnouncementKey]);

  useEffect(() => {
    if (!winnerAnnouncementKey) {
      leaderboardFetchKeyRef.current = '';
      setLeaderboardVisible(false);
      setLeaderboardEntries([]);
      setLeaderboardLoading(false);
      return;
    }

    if (leaderboardFetchKeyRef.current === winnerAnnouncementKey) return;
    leaderboardFetchKeyRef.current = winnerAnnouncementKey;

    let cancelled = false;

    const fetchLeaderboard = async () => {
      setLeaderboardLoading(true);
      const { data, error } = await supabase
        .from('participants')
        .select('id, team_name, flight_duration, start_time, land_time, used_budget, rover_bonus, return_bonus, aesthetics_bonus, landing_status, additional_penalty, created_at')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Leaderboard fetch failed:', error);
        if (cancelled) return;
        setLeaderboardEntries([]);
        setLeaderboardLoading(false);
        return;
      }

      if (cancelled) return;
      setLeaderboardEntries(buildLeaderboardEntries(data || []));
      setLeaderboardLoading(false);
    };

    fetchLeaderboard();
    return () => {
      cancelled = true;
    };
  }, [winnerAnnouncementKey]);

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

    peer.on('error', (err) => { console.error(err); alert('Stream Error: Connection failed. Refresh page.'); });

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

  const captureCurrentStreamFrameBlob = async () => {
    const stream = localStreamRef.current;
    const [videoTrack] = stream?.getVideoTracks?.() || [];
    if (!stream || !videoTrack || videoTrack.readyState !== 'live') return null;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    try {
      await video.play();

      if (typeof video.requestVideoFrameCallback === 'function') {
        await new Promise((resolve) => video.requestVideoFrameCallback(() => resolve()));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      const width = video.videoWidth || videoTrack.getSettings?.().width || 1280;
      const height = video.videoHeight || videoTrack.getSettings?.().height || 720;
      if (!width || !height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);

      return await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
      });
    } catch (err) {
      console.error('Stream frame capture failed:', err);
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  };

  const captureAndStoreLandingFrame = async (teamId, landTime) => {
    try {
      const frameBlob = await captureCurrentStreamFrameBlob();
      if (!frameBlob) return;

      const safeTimestamp = landTime.toISOString().replace(/[:.]/g, '-');
      const filePath = `${teamId}/landing-${safeTimestamp}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('blueprint')
        .upload(filePath, frameBlob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from('blueprint').getPublicUrl(filePath);
      const publicUrl = publicData?.publicUrl || '';
      if (!publicUrl) return;

      const { error: linkError } = await supabase
        .from('participants')
        .update({ landing_frame_url: publicUrl })
        .eq('id', teamId);

      if (linkError) {
        console.warn('Landing frame uploaded, but participants.landing_frame_url update failed.', linkError);
      }
    } catch (err) {
      console.error('Landing frame upload failed:', err);
    }
  };

  const handleOverlayBlueprintSubmit = async () => {
    setBlueprintError('');
    const teamId = getStoredTeamId();
    if (!teamId) return setBlueprintError('TEAM ID NOT FOUND');
    if (!blueprintLink.trim()) return setBlueprintError('ADD SFS LINK');
    if (!localStreamRef.current) return setBlueprintError('START STREAM FIRST');

    setIsUploadingBlueprint(true);
    try {
      const frameBlob = await captureCurrentStreamFrameBlob();
      if (!frameBlob) throw new Error('FRAME CAPTURE FAILED');

      const filePath = `${teamId}/blueprint-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('blueprint')
        .upload(filePath, frameBlob, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from('blueprint').getPublicUrl(filePath);
      const publicUrl = publicData?.publicUrl || '';
      if (!publicUrl) throw new Error('NO PUBLIC URL');

      const { error: updateError } = await supabase.from('participants').update({
        blueprint_url: publicUrl,
        blueprint_link: blueprintLink.trim(),
        status: 'built'
      }).eq('id', teamId);

      if (updateError) throw updateError;

      setBlueprintUrl(publicUrl);
      setParticipantStatus('built');
      setBlueprintError('BLUEPRINT CAPTURED');
    } catch (err) {
      console.error(err);
      setBlueprintError('BLUEPRINT CAPTURE FAILED');
    } finally {
      setIsUploadingBlueprint(false);
    }
  };

  // --- LOGIC: LANDING ---
  const handleLanded = async () => {
    if (isLanding) return;
    if (mode !== 'FLIGHT' && participantStatus !== 'flying') return alert("FLIGHT PHASE NOT ACTIVE");
    const teamId = getStoredTeamId();
    if (!teamId) return alert('TEAM ID NOT FOUND');
    let landTime = new Date();
    let flightDuration = null;
    let startTimeDate = null;

    setIsLanding(true);
    try {
      const { data } = await supabase.from('participants').select('start_time').eq('id', teamId).single();
      if (data?.start_time) startTimeDate = new Date(data.start_time);

      const authoritativeNowMs = getAuthoritativeNowMs();

      if (startTimeDate) {
        const seconds = Math.round((authoritativeNowMs - startTimeDate.getTime()) / 1000);
        flightDuration = Math.max(0, seconds);
        landTime = new Date(startTimeDate.getTime() + (flightDuration * 1000));
      } else {
        flightDuration = parseTimeToSeconds(displayTime);
        if (flightDuration !== null) {
          landTime = new Date(authoritativeNowMs);
        }
      }
    } catch (err) { console.error(err); }

    const { error: updateError } = await supabase.from('participants').update({
      status: 'landed', land_time: landTime.toISOString(), flight_duration: flightDuration
    }).eq('id', teamId);

    if (updateError) {
      console.error(updateError);
      setIsLanding(false);
      return alert('LANDING UPDATE FAILED');
    }

    setParticipantStatus('landed');
    setHasLanded(true);
    if (flightDuration !== null) setFinalFlightSeconds(flightDuration);
    captureAndStoreLandingFrame(teamId, landTime);

    alert('LANDING CONFIRMATION RECORDED');
    setIsLanding(false);
  };

  const onSliderChange = (e) => {
    const val = parseInt(e.target.value);
    setSliderValue(val);
    if (val >= 98) {
      handleLanded();
      setSliderValue(100);
    }
  };

  const resetSliderIfIncomplete = () => {
    if (sliderValue < 98) setSliderValue(0);
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
        blueprint_link: blueprintLink.trim(),
        status: 'built'
      }).eq('id', teamId);

      if (updateError) throw updateError;

      setBlueprintUrl(publicUrl);
      setParticipantStatus('built');
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
  const canShowLandingControl = (mode === 'FLIGHT' || participantStatus === 'flying') && !hasLanded;
  const hasLandingSuccess = (mode === 'FLIGHT' || participantStatus === 'flying') && sliderValue === 100;
  const winner = winnerAnnouncement?.winner || null;
  const currentTeamId = getStoredTeamId();
  const isWinner = Boolean(winner && currentTeamId && winner.teamId === currentTeamId);
  const winnerBonusTotal = winner
    ? (Number(winner.bonuses?.budgetBonus) || 0)
      + (Number(winner.bonuses?.roverBonus) || 0)
      + (Number(winner.bonuses?.returnBonus) || 0)
      + (Number(winner.bonuses?.aestheticsBonus) || 0)
    : 0;
  const winnerLandingAdjustment = winner ? Number(winner.penalties?.landingAdjustment) || 0 : 0;
  const winnerExtraPenalty = winner ? Math.abs(Number(winner.penalties?.additionalPenalty) || 0) : 0;
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
  const ownScoreSummary = buildParticipantScoreSummary({
    flightSeconds: scoreSnapshot.flightDuration ?? finalFlightSeconds,
    usedBudget: scoreSnapshot.usedBudget,
    roverBonus: scoreSnapshot.roverBonus,
    returnBonus: scoreSnapshot.returnBonus,
    aestheticsBonus: scoreSnapshot.aestheticsBonus,
    landingStatus: scoreSnapshot.landingStatus,
    additionalPenalty: scoreSnapshot.additionalPenalty
  });
  const showWinnerRevealCountdown = Boolean(winner && winnerRevealSeconds > 0);
  const ownRank = leaderboardEntries.findIndex((entry) => entry.teamId === currentTeamId) + 1;

  if (winner) {
    const ownTeamName = (teamName || 'UNKNOWN').toUpperCase();
    if (showWinnerRevealCountdown) {
      return (
        <div style={styles.winnerRevealRoot}>
          <div style={styles.winnerRevealBackdrop} />
          <div style={styles.winnerRevealContent}>
            <div style={styles.winnerRevealLabel}>WINNER ANNOUNCEMENT</div>
            <div style={styles.winnerRevealCounter}>{winnerRevealSeconds}</div>
            <div style={styles.winnerRevealHint}>FINAL RANKINGS LOCKING</div>
          </div>
        </div>
      );
    }

    return (
      <div style={styles.winnerModeRoot}>
        <div style={styles.winnerModeBackdrop(isWinner)} />
        <div style={styles.winnerModeGlow(isWinner)} />
        <div style={styles.winnerModeContent}>
          <div style={styles.winnerModeActions}>
            <button
              style={styles.winnerModeActionButton}
              onClick={() => setLeaderboardVisible((prev) => !prev)}
            >
              {leaderboardVisible ? 'HIDE LEADERBOARD' : 'SHOW LEADERBOARD'}
            </button>
            {ownRank > 0 && (
              <span style={styles.winnerModeRankTag}>YOUR RANK #{ownRank}</span>
            )}
          </div>

          {isWinner ? (
            <>
              <div style={styles.winnerModeKicker}>YOU ARE THE WINNER</div>
              <h1 style={styles.winnerModeName}>{winner.teamName}</h1>
              <div style={styles.winnerModeMetricGrid}>
                <div style={styles.winnerModeMetricCard}>
                  <span style={styles.winnerModeMetricLabel}>FLIGHT TIME</span>
                  <span style={styles.winnerModeMetricValue}>{winner.flightTimeLabel || '--:--'}</span>
                </div>
                <div style={styles.winnerModeMetricCard}>
                  <span style={styles.winnerModeMetricLabel}>FINAL SCORE</span>
                  <span style={styles.winnerModeMetricValue}>{winner.finalScoreLabel || '---'}</span>
                </div>
                <div style={styles.winnerModeMetricCard}>
                  <span style={styles.winnerModeMetricLabel}>TOTAL BONUSES</span>
                  <span style={styles.winnerModeMetricValue}>{formatBonusSeconds(winnerBonusDisplayTotal)}</span>
                </div>
                <div style={styles.winnerModeMetricCard}>
                  <span style={styles.winnerModeMetricLabel}>TOTAL PENALTIES</span>
                  <span style={styles.winnerModeMetricValue}>{formatPenaltySeconds(winnerPenaltyDisplayTotal)}</span>
                </div>
              </div>
              <div style={styles.winnerModeFooter}>
                Rover {formatBonusSeconds(winner.bonuses?.roverBonus || 0)} | Return {formatBonusSeconds(winner.bonuses?.returnBonus || 0)} | Style {formatBonusSeconds(winner.bonuses?.aestheticsBonus || 0)} | Budget {formatBonusSeconds(winner.bonuses?.budgetBonus || 0)}
              </div>
            </>
          ) : (
            <>
              <div style={styles.winnerModeKicker}>MISSION COMPLETE</div>
              <h1 style={styles.winnerModeName}>WINNER: {winner.teamName}</h1>
              <div style={styles.compareHeader}>{ownTeamName} VS WINNER</div>
              <div style={styles.compareTable}>
                <div style={styles.compareRow}>
                  <span style={styles.compareMetric}>METRIC</span>
                  <span style={styles.compareWinnerCol}>WINNER</span>
                  <span style={styles.compareSelfCol}>{ownTeamName}</span>
                </div>
                <div style={styles.compareRow}>
                  <span style={styles.compareMetric}>FLIGHT</span>
                  <span style={styles.compareWinnerCol}>{winner.flightTimeLabel || '--:--'}</span>
                  <span style={styles.compareSelfCol}>{ownScoreSummary.flightTimeLabel || '--:--'}</span>
                </div>
                <div style={styles.compareRow}>
                  <span style={styles.compareMetric}>FINAL SCORE</span>
                  <span style={styles.compareWinnerCol}>{winner.finalScoreLabel || '---'}</span>
                  <span style={styles.compareSelfCol}>{ownScoreSummary.finalScoreLabel || '---'}</span>
                </div>
                <div style={styles.compareRow}>
                  <span style={styles.compareMetric}>BONUSES</span>
                  <span style={styles.compareWinnerCol}>{formatBonusSeconds(winnerBonusDisplayTotal)}</span>
                  <span style={styles.compareSelfCol}>{formatBonusSeconds(ownScoreSummary.bonusDisplayTotal)}</span>
                </div>
                <div style={styles.compareRow}>
                  <span style={styles.compareMetric}>PENALTIES</span>
                  <span style={styles.compareWinnerCol}>{formatPenaltySeconds(winnerPenaltyDisplayTotal)}</span>
                  <span style={styles.compareSelfCol}>{formatPenaltySeconds(ownScoreSummary.penaltyDisplayTotal)}</span>
                </div>
              </div>
            </>
          )}

          {leaderboardVisible && (
            <div style={styles.leaderboardPanel}>
              <div style={styles.leaderboardTitle}>FINAL LEADERBOARD</div>
              {leaderboardLoading ? (
                <div style={styles.leaderboardLoading}>LOADING...</div>
              ) : (
                <div style={styles.leaderboardTable}>
                  <div style={styles.leaderboardHeaderRow}>
                    <span style={styles.leaderboardHeaderCell}>RANK</span>
                    <span style={styles.leaderboardHeaderCell}>TEAM</span>
                    <span style={styles.leaderboardHeaderCell}>FLIGHT</span>
                    <span style={styles.leaderboardHeaderCell}>SCORE</span>
                  </div>
                  {leaderboardEntries.map((entry) => {
                    const isOwnRow = entry.teamId === currentTeamId;
                    const isWinnerRow = entry.teamId === winner.teamId;
                    return (
                      <div
                        key={entry.teamId}
                        style={styles.leaderboardDataRow(isOwnRow, isWinnerRow)}
                      >
                        <span style={styles.leaderboardDataCell}>#{entry.rank}</span>
                        <span style={styles.leaderboardDataCell}>{entry.teamName}</span>
                        <span style={styles.leaderboardDataCell}>{entry.flightTimeLabel}</span>
                        <span style={styles.leaderboardDataCell}>{entry.finalScoreLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

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
            <div style={styles.label}>PARTICIPANT</div>
            <h1 style={styles.teamName}>{(teamName || 'UNKNOWN').toUpperCase()}</h1>
          </div>
          <a
            href="https://docs.google.com/document/d/1MCypY_ruyvQPM6vdLRUge2IUN8qKkIoUrGD88mQ73gI/edit?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.rulebookLink}
          >
            <BookOpen size={18} /> OPEN RULEBOOK
          </a>
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
          {canShowLandingControl && sliderValue < 100 && (
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
                  onMouseUp={resetSliderIfIncomplete}
                  onTouchEnd={resetSliderIfIncomplete}
                  onPointerUp={resetSliderIfIncomplete}
                />
                <div style={{...styles.sliderHandle, left: `calc(${sliderValue}% - 25px)`}}>
                  <ArrowRight color="#000" size={18} />
                </div>
              </div>
            </div>
          )}

          {hasLandingSuccess && (
            <div style={styles.successBadge}>
              <ShieldCheck size={24} /> LANDING RECORDED
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
                {isSharing ? 'STREAMING ENABLED' : 'STREAM OFFLINE'}
              </span>
            </div>
            <div style={styles.statusIndicator}>
              <Wifi size={16} color={lastClockSyncAt ? '#22c55e' : '#f59e0b'} />
              <span style={{ color: lastClockSyncAt ? '#22c55e' : '#f59e0b' }}>
                {syncStateText}
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
              timeValue={timerValue}
              showLandingSlider={canShowLandingControl && sliderValue < 100}
              landingValue={sliderValue}
              onLandingChange={onSliderChange}
              onLandingRelease={resetSliderIfIncomplete}
              landingSuccess={hasLandingSuccess}
              landingDisabled={isLanding}
              showBlueprintCapture={mode === 'BUILD' && !blueprintUrl}
              blueprintLinkValue={blueprintLink}
              onBlueprintLinkChange={(e) => setBlueprintLink(e.target.value)}
              onBlueprintSubmit={handleOverlayBlueprintSubmit}
              blueprintSubmitDisabled={isUploadingBlueprint || !isSharing || !blueprintLink.trim()}
              blueprintSubmitting={isUploadingBlueprint}
              blueprintStatusMessage={blueprintError || (!isSharing ? 'START STREAM FIRST' : '')}
            />

            {/* Success handled near timer */}
          </div>
        </footer>

      </div>
      <div style={styles.creditText}>Made with ?? by Srijal Kumar</div>
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
const parseTimeToSeconds = (value) => {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const minutes = Number(parts[0]);
  const seconds = Number(parts[1]);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return Math.max(0, minutes * 60 + seconds);
};
const formatBonusSeconds = (value) => `-${Math.abs(Number(value) || 0)}s`;
const formatPenaltySeconds = (value) => `+${Math.abs(Number(value) || 0)}s`;
const normalizeLandingStatus = (value) => {
  if (!value) return '';
  const normalized = String(value).toLowerCase();
  if (normalized.includes('dq')) return 'dq';
  if (normalized.includes('soft') || normalized.includes('perfect')) return 'perfect_soft';
  if (normalized.includes('crunch')) return 'crunch';
  if (normalized.includes('hard')) return 'hard';
  return '';
};
const getLandingAdjustmentSeconds = (status) => {
  if (status === 'perfect_soft') return -20;
  if (status === 'crunch') return 20;
  if (status === 'dq') return null;
  return 0;
};
const buildParticipantScoreSummary = ({
  flightSeconds,
  usedBudget,
  roverBonus,
  returnBonus,
  aestheticsBonus,
  landingStatus,
  additionalPenalty
}) => {
  const safeFlight = Number(flightSeconds);
  const resolvedFlightSeconds = Number.isFinite(safeFlight) ? Math.max(0, Math.round(safeFlight)) : null;
  const budgetBonus = usedBudget === null || usedBudget === undefined
    ? 0
    : Math.max(0, Math.floor((TOTAL_BUDGET - usedBudget) / BUDGET_BONUS_DIVISOR));
  const rover = roverBonus ? ROVER_BONUS : 0;
  const ret = returnBonus ? RETURN_BONUS : 0;
  const style = Number(aestheticsBonus) || 0;
  const totalBonus = budgetBonus + rover + ret + style;
  const resolvedLandingStatus = normalizeLandingStatus(landingStatus);
  const landingAdjustment = getLandingAdjustmentSeconds(resolvedLandingStatus);
  const extraPenalty = Number(additionalPenalty) || 0;
  const extraPenaltyDisplay = Math.abs(extraPenalty);
  const resolvedLandingAdjustment = landingAdjustment || 0;
  const totalPenalty = resolvedLandingAdjustment + extraPenalty;
  const bonusDisplayTotal = totalBonus + Math.max(0, -resolvedLandingAdjustment);
  const penaltyDisplayTotal = Math.max(0, resolvedLandingAdjustment) + extraPenaltyDisplay;
  const finalScoreValue = resolvedLandingStatus === 'dq' || landingAdjustment === null || resolvedFlightSeconds === null
    ? Infinity
    : Math.round(resolvedFlightSeconds - totalBonus + totalPenalty);
  return {
    flightTimeLabel: resolvedFlightSeconds === null ? '--:--' : formatSeconds(resolvedFlightSeconds),
    finalScoreLabel: Number.isFinite(finalScoreValue) ? `${finalScoreValue}s` : 'DQ',
    totalBonus,
    totalPenalty,
    bonusDisplayTotal,
    penaltyDisplayTotal,
    finalScoreValue
  };
};
const resolveFlightSecondsFromRow = (row) => {
  const explicit = Number(row.flight_duration);
  if (Number.isFinite(explicit)) return Math.max(0, Math.round(explicit));
  if (row.start_time && row.land_time) {
    const delta = Math.round((new Date(row.land_time).getTime() - new Date(row.start_time).getTime()) / 1000);
    return Math.max(0, delta);
  }
  return null;
};
const buildLeaderboardEntries = (rows) => {
  const scored = rows.map((row) => {
    const summary = buildParticipantScoreSummary({
      flightSeconds: resolveFlightSecondsFromRow(row),
      usedBudget: row.used_budget ?? null,
      roverBonus: row.rover_bonus,
      returnBonus: row.return_bonus,
      aestheticsBonus: row.aesthetics_bonus ?? null,
      landingStatus: row.landing_status || '',
      additionalPenalty: row.additional_penalty ?? null
    });
    return {
      teamId: row.id,
      teamName: row.team_name || 'UNKNOWN',
      flightTimeLabel: summary.flightTimeLabel,
      finalScoreValue: summary.finalScoreValue,
      finalScoreLabel: summary.finalScoreLabel
    };
  });

  scored.sort((a, b) => {
    if (a.finalScoreValue !== b.finalScoreValue) return a.finalScoreValue - b.finalScoreValue;
    return a.teamName.localeCompare(b.teamName);
  });

  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
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
  winnerModeRoot: {
    height: '89.2vh',
    width: '94.6vw',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif',
    color: '#fff',
    background: '#020617',
    padding: '40px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  winnerModeBackdrop: (isWinner) => ({
    position: 'absolute',
    inset: 0,
    background: isWinner
      ? 'radial-gradient(circle at 16% 10%, rgba(34, 197, 94, 0.4) 0%, rgba(2, 6, 23, 0.95) 62%)'
      : 'radial-gradient(circle at 16% 10%, rgba(239, 68, 68, 0.25) 0%, rgba(30, 41, 59, 0.95) 62%)'
  }),
  winnerModeGlow: (isWinner) => ({
    position: 'absolute',
    inset: '-20%',
    filter: 'blur(72px)',
    opacity: 0.7,
    background: isWinner
      ? 'conic-gradient(from 0deg at 50% 50%, rgba(74, 222, 128, 0.25), rgba(22, 163, 74, 0.12), rgba(74, 222, 128, 0.25))'
      : 'conic-gradient(from 0deg at 50% 50%, rgba(248, 113, 113, 0.2), rgba(148, 163, 184, 0.15), rgba(248, 113, 113, 0.2))'
  }),
  winnerModeContent: {
    position: 'relative',
    zIndex: 2,
    height: '100%',
    width: '100%',
    padding: '54px 68px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '20px'
  },
  winnerModeKicker: {
    fontSize: '20px',
    letterSpacing: '8px',
    fontWeight: 800,
    color: '#cbd5e1'
  },
  winnerModeName: {
    margin: 0,
    fontSize: '98px',
    lineHeight: 0.92,
    fontWeight: 900,
    letterSpacing: '2px',
    color: '#f8fafc',
    textShadow: '0 0 38px rgba(241, 245, 249, 0.28)'
  },
  winnerModeMetricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '14px'
  },
  winnerModeMetricCard: {
    borderRadius: '14px',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(15, 23, 42, 0.55)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  winnerModeMetricLabel: {
    fontSize: '11px',
    letterSpacing: '1.8px',
    fontWeight: 800,
    color: '#cbd5e1'
  },
  winnerModeMetricValue: {
    fontSize: '38px',
    lineHeight: 1,
    fontWeight: 900,
    color: '#fff'
  },
  winnerModeFooter: {
    marginTop: '4px',
    fontSize: '14px',
    letterSpacing: '1px',
    color: '#cbd5e1'
  },
  compareHeader: {
    marginTop: '6px',
    fontSize: '15px',
    fontWeight: 800,
    letterSpacing: '1.5px',
    color: '#e2e8f0'
  },
  compareTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  compareRow: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 1fr 1fr',
    alignItems: 'center',
    gap: '10px',
    borderRadius: '10px',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(15, 23, 42, 0.5)',
    padding: '12px 14px'
  },
  compareMetric: {
    fontSize: '14px',
    fontWeight: 800,
    letterSpacing: '1px',
    color: '#cbd5e1'
  },
  compareWinnerCol: {
    textAlign: 'center',
    fontSize: '20px',
    fontWeight: 900,
    color: '#fde68a'
  },
  compareSelfCol: {
    textAlign: 'center',
    fontSize: '20px',
    fontWeight: 900,
    color: '#f8fafc'
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
    background: 'radial-gradient(circle at 50% 35%, rgba(148, 163, 184, 0.26) 0%, rgba(15, 23, 42, 0.96) 62%)'
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
    color: '#cbd5e1'
  },
  winnerRevealCounter: {
    fontSize: '220px',
    lineHeight: 0.9,
    fontWeight: 900,
    color: '#f8fafc',
    textShadow: '0 0 40px rgba(226, 232, 240, 0.5)'
  },
  winnerRevealHint: {
    fontSize: '14px',
    letterSpacing: '3px',
    color: '#94a3b8',
    fontWeight: 700
  },
  winnerModeActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px'
  },
  winnerModeActionButton: {
    padding: '10px 14px',
    borderRadius: '9px',
    border: '1px solid rgba(148, 163, 184, 0.45)',
    background: 'rgba(15, 23, 42, 0.62)',
    color: '#e2e8f0',
    fontSize: '11px',
    letterSpacing: '1px',
    fontWeight: 800,
    cursor: 'pointer'
  },
  winnerModeRankTag: {
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '1.2px',
    color: '#fde68a'
  },
  leaderboardPanel: {
    marginTop: '6px',
    borderRadius: '12px',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(2, 6, 23, 0.7)',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '34vh',
    overflow: 'hidden'
  },
  leaderboardTitle: {
    fontSize: '13px',
    letterSpacing: '2px',
    fontWeight: 900,
    color: '#e2e8f0'
  },
  leaderboardLoading: {
    fontSize: '12px',
    color: '#94a3b8',
    letterSpacing: '1px'
  },
  leaderboardTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflowY: 'auto',
    paddingRight: '4px'
  },
  leaderboardHeaderRow: {
    display: 'grid',
    gridTemplateColumns: '90px 1.4fr 1fr 1fr',
    gap: '8px',
    fontSize: '10px',
    color: '#94a3b8',
    letterSpacing: '1.2px',
    fontWeight: 800,
    padding: '2px 8px'
  },
  leaderboardHeaderCell: {
    textTransform: 'uppercase'
  },
  leaderboardDataRow: (isOwnRow, isWinnerRow) => ({
    display: 'grid',
    gridTemplateColumns: '90px 1.4fr 1fr 1fr',
    gap: '8px',
    alignItems: 'center',
    borderRadius: '8px',
    border: `1px solid ${isWinnerRow ? 'rgba(250, 204, 21, 0.45)' : isOwnRow ? 'rgba(56, 189, 248, 0.4)' : 'rgba(148, 163, 184, 0.2)'}`,
    background: isWinnerRow
      ? 'rgba(250, 204, 21, 0.12)'
      : isOwnRow
        ? 'rgba(56, 189, 248, 0.11)'
        : 'rgba(15, 23, 42, 0.45)',
    padding: '8px'
  }),
  leaderboardDataCell: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#e2e8f0'
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
  winnerTint: {
    position: 'absolute',
    inset: 0,
    zIndex: 3,
    pointerEvents: 'none',
    background: 'radial-gradient(circle at 50% 35%, rgba(34, 197, 94, 0.25) 0%, rgba(0,0,0,0.4) 72%)'
  },
  nonWinnerTint: {
    position: 'absolute',
    inset: 0,
    zIndex: 3,
    pointerEvents: 'none',
    background: 'radial-gradient(circle at 50% 35%, rgba(239, 68, 68, 0.15) 0%, rgba(100,116,139,0.32) 70%)'
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
  rulebookLink: {
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
    textTransform: 'uppercase',
    textDecoration: 'none'
  },
  label: {
    fontSize: '11px', color: '#64748b', letterSpacing: '2px', fontWeight: 'bold', marginBottom: '4px'
  },
  teamName: {
    fontSize: '32px', fontWeight: 800, margin: 0, letterSpacing: '1px',
    textShadow: '0 0 20px rgba(255,255,255,0.2)'
  },
  winnerPanel: {
    marginTop: '12px',
    borderRadius: '14px',
    border: '1px solid rgba(74, 222, 128, 0.55)',
    background: 'linear-gradient(125deg, rgba(20, 83, 45, 0.9) 0%, rgba(6, 78, 59, 0.82) 100%)',
    boxShadow: '0 14px 40px rgba(34, 197, 94, 0.3)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  winnerTitle: {
    fontSize: '14px',
    letterSpacing: '5px',
    fontWeight: 900,
    color: '#bbf7d0'
  },
  winnerName: {
    fontSize: '38px',
    fontWeight: 900,
    lineHeight: 1,
    color: '#f0fdf4',
    textShadow: '0 0 24px rgba(134, 239, 172, 0.6)'
  },
  winnerMetaRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '8px'
  },
  winnerMetaBox: {
    background: 'rgba(2, 6, 23, 0.4)',
    borderRadius: '8px',
    padding: '8px',
    border: '1px solid rgba(134, 239, 172, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px'
  },
  winnerMetaLabel: {
    fontSize: '9px',
    letterSpacing: '1.4px',
    color: '#86efac',
    fontWeight: 700
  },
  winnerMetaValue: {
    fontSize: '20px',
    fontWeight: 900,
    color: '#ecfeff'
  },
  comparisonPanel: {
    marginTop: '12px',
    borderRadius: '14px',
    border: '1px solid rgba(148, 163, 184, 0.45)',
    background: 'linear-gradient(135deg, rgba(100, 116, 139, 0.4) 0%, rgba(127, 29, 29, 0.45) 100%)',
    boxShadow: '0 14px 40px rgba(148, 163, 184, 0.22)',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  comparisonTitle: {
    fontSize: '13px',
    letterSpacing: '2px',
    fontWeight: 900,
    color: '#f8fafc'
  },
  comparisonGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  comparisonRow: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr 1fr',
    gap: '8px',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: '8px',
    background: 'rgba(15, 23, 42, 0.5)'
  },
  comparisonMetric: {
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '1px',
    color: '#cbd5e1'
  },
  comparisonWinner: {
    textAlign: 'center',
    color: '#fde68a',
    fontWeight: 800
  },
  comparisonSelf: {
    textAlign: 'center',
    color: '#e2e8f0',
    fontWeight: 800
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
  blueprintError: { fontSize: '11px', color: '#fbbf24', letterSpacing: '1px', fontWeight: 700 },
  creditText: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: '10px',
    zIndex: 12,
    fontSize: '10px',
    color: 'rgba(191, 219, 254, 0.9)',
    letterSpacing: '0.4px',
    pointerEvents: 'none'
  }
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

