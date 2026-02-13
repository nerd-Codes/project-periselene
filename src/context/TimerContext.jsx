// @refresh reset
/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabaseClient';

const TimerContext = createContext();
const TIMER_SYNC_PREFIX = 'SYNC::';
const BUILD_DURATION_SECONDS = 1800;

const parseSyncPayload = (value) => {
  if (typeof value !== 'string' || !value.startsWith(TIMER_SYNC_PREFIX)) return null;
  try {
    const payload = JSON.parse(value.slice(TIMER_SYNC_PREFIX.length));
    return {
      mode: typeof payload.mode === 'string' ? payload.mode : null,
      displayTime: typeof payload.displayTime === 'string' ? payload.displayTime : null,
      isAlert: Boolean(payload.isAlert),
      countdown: typeof payload.countdown === 'number' ? payload.countdown : null,
      countdownLabel: typeof payload.countdownLabel === 'string' ? payload.countdownLabel : ''
    };
  } catch {
    return null;
  }
};

const isAdminRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/admin');
};

export function TimerProvider({ children }) {
  const [mode, setMode] = useState('IDLE'); // 'IDLE', 'BUILD', 'FLIGHT'
  const [startTime, setStartTime] = useState(null);
  const [displayTime, setDisplayTime] = useState('00:00');
  const [isAlert, setIsAlert] = useState(false); 
  const [countdownEnd, setCountdownEnd] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [countdownLabel, setCountdownLabel] = useState('');
  const [useAuthoritySnapshot, setUseAuthoritySnapshot] = useState(false);

  // Refs used to manage intervals
  const tickerRef = useRef(null);

  const fetchGlobalState = useCallback(async () => {
    if (!supabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('global_state')
        .select('*')
        .maybeSingle(); // easier than .single() prevents 406 error

      if (error) console.error('Sync Error:', error.message);

      if (data) {
        const nextMode = data.timer_mode || 'IDLE';
        const nextStartTime = data.timer_start_time ? new Date(data.timer_start_time) : null;
        const nextCountdownEnd = data.countdown_end ? new Date(data.countdown_end) : null;
        const syncPayload = parseSyncPayload(data.countdown_label);
        const adminRoute = isAdminRoute();

        if (syncPayload && !adminRoute) {
          setUseAuthoritySnapshot(true);
          setMode(syncPayload.mode || nextMode);
          if (syncPayload.displayTime) setDisplayTime(syncPayload.displayTime);
          setIsAlert(Boolean(syncPayload.isAlert));
          setCountdown(syncPayload.countdown);
          setCountdownLabel(syncPayload.countdownLabel || '');
          setStartTime(nextStartTime);
          setCountdownEnd(nextCountdownEnd);
        } else {
          setUseAuthoritySnapshot(false);
          setMode(nextMode);
          setStartTime(nextStartTime);
          setCountdownEnd(nextCountdownEnd);
          setCountdownLabel(syncPayload ? '' : (data.countdown_label || ''));
        }
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

    // Non-admin clients follow admin authority snapshots directly.
    if (useAuthoritySnapshot && !isAdminRoute()) return undefined;

    tickerRef.current = setInterval(() => {
        const nowMs = Date.now();
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

        const diff = Math.floor((nowMs - startTime.getTime()) / 1000);

        if (mode === 'BUILD') {
          const remaining = BUILD_DURATION_SECONDS - diff;
          if (remaining <= 0) {
            setDisplayTime('00:00');
            setIsAlert(true);
          } else {
            setDisplayTime(formatTime(remaining));
            setIsAlert(remaining < 300);
          }
        } 
        else if (mode === 'FLIGHT') {
          setDisplayTime(formatTime(diff));
          setIsAlert(false);
        }
    }, 1000); // Update screen every second

    return () => clearInterval(tickerRef.current);
  }, [mode, startTime, countdownEnd, useAuthoritySnapshot]);

  // 3. ADMIN CONTROLS
  const setGlobalMode = async (newMode) => {
    if (!supabaseConfigured || !supabase) return;
    const timeData = newMode === 'IDLE' ? null : new Date().toISOString();

    // 1. Update Local Immediately (Optimistic)
    setMode(newMode);
    setStartTime(timeData ? new Date(timeData) : null);
    setUseAuthoritySnapshot(false);

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
    <TimerContext.Provider value={{ mode, displayTime, isAlert, countdown, countdownLabel, setGlobalMode }}>
      {children}
    </TimerContext.Provider>
  );
}

export const useTimer = () => useContext(TimerContext);
