/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const TimerContext = createContext();

export function TimerProvider({ children }) {
  const [mode, setMode] = useState('IDLE'); // 'IDLE', 'BUILD', 'FLIGHT'
  const [startTime, setStartTime] = useState(null);
  const [displayTime, setDisplayTime] = useState('00:00');
  const [isAlert, setIsAlert] = useState(false); 

  // Refs used to manage intervals
  const tickerRef = useRef(null);

  const fetchGlobalState = async () => {
    try {
      const { data, error } = await supabase
        .from('global_state')
        .select('*')
        .maybeSingle(); // easier than .single() prevents 406 error

      if (error) console.error('Sync Error:', error.message);

      if (data) {
        // Only update state if it actually changed to prevent flickers
        setMode(data.timer_mode);
        setStartTime(data.timer_start_time ? new Date(data.timer_start_time) : null);
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

    if (mode === 'IDLE') {
        setDisplayTime('00:00');
        setIsAlert(false);
        return;
    }

    tickerRef.current = setInterval(() => {
        if (!startTime) return;

        const now = new Date();
        const diff = Math.floor((now - startTime) / 1000);

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
  }, [mode, startTime]); // Re-run if mode or start time changes

  // 3. ADMIN CONTROLS
  const setGlobalMode = async (newMode) => {
    const timeData = newMode === 'IDLE' ? null : new Date().toISOString();

    // 1. Update Local Immediately (Optimistic)
    setMode(newMode);
    setStartTime(timeData ? new Date(timeData) : null);

    // 2. Update Database
    await supabase
        .from('global_state')
        .update({
            timer_mode: newMode,
            timer_start_time: timeData,
            is_running: newMode !== 'IDLE'
        })
        .eq('id', 1);
  };

  return (
    <TimerContext.Provider value={{ mode, displayTime, isAlert, setGlobalMode }}>
      {children}
    </TimerContext.Provider>
  );
}

export const useTimer = () => useContext(TimerContext);
