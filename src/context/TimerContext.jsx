// @refresh reset
/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabaseClient';

const TimerContext = createContext();
const TIMER_SYNC_PREFIX = 'SYNC::';
const BUILD_DURATION_SECONDS = 1800;

const isAdminRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/admin');
};

const createClockSyncState = () => ({
  offsetMs: 0,
  anchorClientMs: Date.now(),
  anchorPerfMs: typeof performance !== 'undefined' ? performance.now() : 0,
  syncedAt: null,
  source: 'local'
});

const getSyncedNowMs = (syncState) => {
  const perfNow = typeof performance !== 'undefined' ? performance.now() : 0;
  const elapsedMs = Math.max(0, perfNow - syncState.anchorPerfMs);
  return syncState.anchorClientMs + elapsedMs + syncState.offsetMs;
};

export function TimerProvider({ children }) {
  const [mode, setMode] = useState('IDLE'); // 'IDLE', 'BUILD', 'FLIGHT'
  const [startTime, setStartTime] = useState(null);
  const [displayTime, setDisplayTime] = useState('00:00');
  const [isAlert, setIsAlert] = useState(false);
  const [countdownEnd, setCountdownEnd] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [countdownLabel, setCountdownLabel] = useState('');
  const [clockSync, setClockSync] = useState(() => createClockSyncState());

  // Refs used to manage intervals
  const tickerRef = useRef(null);
  const clockSyncRef = useRef(clockSync);

  useEffect(() => {
    clockSyncRef.current = clockSync;
  }, [clockSync]);

  const getAuthoritativeNowMs = useCallback(() => {
    if (isAdminRoute()) return Date.now();
    return getSyncedNowMs(clockSyncRef.current);
  }, []);

  const applyClockOffsetMs = useCallback((offsetMs, metadata = {}) => {
    const normalizedOffset = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
    const nextSync = {
      offsetMs: normalizedOffset,
      anchorClientMs: Date.now(),
      anchorPerfMs: typeof performance !== 'undefined' ? performance.now() : 0,
      syncedAt: new Date().toISOString(),
      source: metadata.source || 'sync'
    };
    clockSyncRef.current = nextSync;
    setClockSync(nextSync);
  }, []);

  const fetchGlobalState = useCallback(async () => {
    if (!supabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('global_state')
        .select('*')
        .maybeSingle(); // easier than .single() prevents 406 error

      if (error) console.error('Sync Error:', error.message);

      if (data) {
        const nextCountdownLabel = typeof data.countdown_label === 'string'
          && data.countdown_label.startsWith(TIMER_SYNC_PREFIX)
          ? ''
          : (data.countdown_label || '');
        setMode(data.timer_mode || 'IDLE');
        setStartTime(data.timer_start_time ? new Date(data.timer_start_time) : null);
        setCountdownEnd(data.countdown_end ? new Date(data.countdown_end) : null);
        setCountdownLabel(nextCountdownLabel);
      } else {
        // If no row exists yet, seed a default row
        await supabase
          .from('global_state')
          .upsert({
            id: 1,
            timer_mode: 'IDLE',
            timer_start_time: null,
            is_running: false,
            countdown_end: null,
            countdown_label: null
          }, { onConflict: 'id' });
      }
    } catch (err) {
      console.error('Connection error:', err);
    }
  }, []);

  const formatTime = (totalSeconds) => {
    const m = Math.floor(Math.abs(totalSeconds) / 60).toString().padStart(2, '0');
    const s = Math.floor(Math.abs(totalSeconds) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // 1. THE SYNC LOOP (The Heartbeat)
  // This asks the database "What time is it?" every 2 seconds.
  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;

    // Run immediately on load
    fetchGlobalState();

    // Run every 1000ms as fallback if realtime delivery is unavailable.
    const heartbeat = setInterval(() => {
      fetchGlobalState();
    }, 1000);

    const channel = supabase
      .channel('timer-sync-global-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_state' }, () => {
        fetchGlobalState();
      })
      .subscribe();

    return () => {
      clearInterval(heartbeat);
      supabase.removeChannel(channel);
    };
  }, [fetchGlobalState]);

  // 2. THE LOCAL TICKER (Visual Smoothness)
  // This runs every second to update the numbers on screen
  useEffect(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);

    const updateTicker = () => {
      const nowMs = getAuthoritativeNowMs();

      if (countdownEnd) {
        const remaining = Math.ceil((countdownEnd.getTime() - nowMs) / 1000);
        setCountdown(remaining > 0 ? remaining : null);
      } else {
        setCountdown(null);
      }

      if (mode === 'IDLE') {
        setDisplayTime('00:00');
        setIsAlert(false);
        return;
      }

      if (!startTime) return;

      const diff = Math.max(0, Math.floor((nowMs - startTime.getTime()) / 1000));

      if (mode === 'BUILD') {
        const remaining = BUILD_DURATION_SECONDS - diff;
        if (remaining <= 0) {
          setDisplayTime('00:00');
          setIsAlert(true);
        } else {
          setDisplayTime(formatTime(remaining));
          setIsAlert(remaining < 300);
        }
        return;
      }

      if (mode === 'FLIGHT') {
        setDisplayTime(formatTime(diff));
        setIsAlert(false);
      }
    };

    updateTicker();
    tickerRef.current = setInterval(updateTicker, 1000); // Update screen every second

    return () => clearInterval(tickerRef.current);
  }, [mode, startTime, countdownEnd, getAuthoritativeNowMs]);

  // 3. ADMIN CONTROLS
  const setGlobalMode = async (newMode) => {
    if (!supabaseConfigured || !supabase) return;
    const timeData = newMode === 'IDLE' ? null : new Date().toISOString();

    // 1. Update Local Immediately (Optimistic)
    setMode(newMode);
    setStartTime(timeData ? new Date(timeData) : null);

    // 2. Update Database
    await supabase
      .from('global_state')
      .upsert({
        id: 1,
        timer_mode: newMode,
        timer_start_time: timeData,
        is_running: newMode !== 'IDLE'
      }, { onConflict: 'id' });
  };

  return (
    <TimerContext.Provider
      value={{
        mode,
        displayTime,
        isAlert,
        countdown,
        countdownLabel,
        setGlobalMode,
        applyClockOffsetMs,
        getAuthoritativeNowMs,
        clockOffsetMs: clockSync.offsetMs,
        lastClockSyncAt: clockSync.syncedAt
      }}
    >
      {children}
    </TimerContext.Provider>
  );
}

export const useTimer = () => useContext(TimerContext);
