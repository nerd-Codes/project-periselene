// @refresh reset
/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabaseClient';

const TimerContext = createContext();

export function TimerProvider({ children }) {
  const [mode, setMode] = useState('IDLE'); // 'IDLE', 'BUILD', 'FLIGHT'
  const [startTime, setStartTime] = useState(null);
  const [displayTime, setDisplayTime] = useState('00:00');
  const [isAlert, setIsAlert] = useState(false); 
  const [countdownEnd, setCountdownEnd] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [countdownLabel, setCountdownLabel] = useState('');
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  // Refs used to manage intervals
  const tickerRef = useRef(null);
  const clockOffsetRef = useRef(0);
  const previousModeRef = useRef('IDLE');
  const hadCountdownRef = useRef(false);

  const clampOffset = (value) => Math.max(-60000, Math.min(60000, Math.round(value)));

  useEffect(() => {
    clockOffsetRef.current = clockOffsetMs;
  }, [clockOffsetMs]);

  const fetchGlobalState = async () => {
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
        const localNowMs = Date.now();

        // If countdown appears wildly off from 3s, infer local clock skew.
        if (nextCountdownEnd && !hadCountdownRef.current) {
          const rawRemainingMs = nextCountdownEnd.getTime() - localNowMs;
          if (rawRemainingMs > 5000 || rawRemainingMs < -1000) {
            const targetRemainingMs = 2000; // expected mid-point after poll delay
            const correctionMs = rawRemainingMs - targetRemainingMs;
            setClockOffsetMs((prev) => clampOffset(prev + correctionMs));
          }
        }

        // On mode transitions, elapsed should be close to 0s (plus small network delay).
        // If not, snap offset so all clients align to the same timeline.
        if (nextMode !== previousModeRef.current && nextMode !== 'IDLE' && nextStartTime) {
          const rawElapsedMs = localNowMs + clockOffsetRef.current - nextStartTime.getTime();
          if (Math.abs(rawElapsedMs) > 4000) {
            setClockOffsetMs((prev) => clampOffset(prev - rawElapsedMs));
          }
        }

        previousModeRef.current = nextMode;
        hadCountdownRef.current = Boolean(nextCountdownEnd);

        // Only update state if it actually changed to prevent flickers
        setMode(nextMode);
        setStartTime(nextStartTime);
        setCountdownEnd(nextCountdownEnd);
        setCountdownLabel(data.countdown_label || '');
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
  };

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

    // Run every 2000ms (2 seconds)
    const heartbeat = setInterval(() => {
      fetchGlobalState();
    }, 2000);

    return () => clearInterval(heartbeat);
  }, []);

  // 2. THE LOCAL TICKER (Visual Smoothness)
  // This runs every second to update the numbers on screen
  useEffect(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);

    tickerRef.current = setInterval(() => {
        const nowMs = Date.now() + clockOffsetMs;
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
          const remaining = 1800 - diff; // 30 mins
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
  }, [mode, startTime, countdownEnd, clockOffsetMs]); // Re-run if mode/start/countdown/offset changes

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
    <TimerContext.Provider value={{ mode, displayTime, isAlert, countdown, countdownLabel, setGlobalMode }}>
      {children}
    </TimerContext.Provider>
  );
}

export const useTimer = () => useContext(TimerContext);
