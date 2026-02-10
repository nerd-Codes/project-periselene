import { useEffect, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';

export default function TimerOverlay({ compact = false, buttonStyle = {}, containerStyle = {} }) {
  const { displayTime, mode, isAlert } = useTimer();
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const [isPipActive, setIsPipActive] = useState(false);
  const [streamReady, setStreamReady] = useState(false);

  // 1. DRAW THE TIMER (Standard React Effect)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Settings
    const width = 300;
    const height = 150;
    
    // Clear Screen
    ctx.fillStyle = isAlert ? '#7f1d1d' : '#0f172a'; 
    ctx.fillRect(0, 0, width, height);

    // Draw Border
    ctx.lineWidth = 10;
    ctx.strokeStyle = isAlert ? '#ef4444' : '#334155';
    ctx.strokeRect(0, 0, width, height);

    // Draw Mode Text
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    const modeLabel = mode === 'IDLE' ? 'Waiting' : mode === 'BUILD' ? 'Build' : 'Flight';
    ctx.fillText(modeLabel, width / 2, 40);

    // Draw Time Text
    ctx.font = 'bold 60px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = "black";
    ctx.shadowBlur = 10;
    ctx.fillText(displayTime, width / 2, 110);
    
    // Force the canvas to update its stream
    // (Browsers sometimes pause streams if pixels don't change)
    if (videoRef.current && videoRef.current.srcObject) {
        // No-op, just ensuring context stays active
    }

  }, [displayTime, mode, isAlert]); 

  // 2. INITIALIZE STREAM ON MOUNT (The Fix)
  useEffect(() => {
    const initStream = async () => {
        if (!canvasRef.current || !videoRef.current) return;
        
        // Only create stream if not exists
        if (videoRef.current.srcObject) return;

        try {
            console.log("Initializing overlay stream...");
            // Capture stream at 10fps (enough for a timer, saves CPU)
            const stream = canvasRef.current.captureStream(10);
            videoRef.current.srcObject = stream;
            
            // Wait for video to be ready
            videoRef.current.onloadedmetadata = async () => {
                try {
                    await videoRef.current.play();
                    setStreamReady(true);
                } catch (e) {
                    console.error("Auto-play failed (harmless):", e);
                }
            };
        } catch (err) {
            console.error("Stream Init Error:", err);
        }
    };

    initStream();
  }, []); // Run once on mount

  // 3. ACTIVATE PIP (User Click)
  const togglePiP = async () => {
    const video = videoRef.current;
    
    if (!video || !streamReady) {
        alert("Overlay is still loading. Try again in a second.");
        return;
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        // Ensure it's playing before requesting PiP
        if (video.paused) await video.play();
        
        await video.requestPictureInPicture();
        setIsPipActive(true);
      }
    } catch (err) {
      console.error("PiP Error:", err);
      // Fallback for Edge/Chrome strict policies
      alert("Could not open overlay: " + err.message);
    }
  };

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', ...containerStyle }}>
        <button
          onClick={togglePiP}
          disabled={!streamReady}
          style={{
            opacity: streamReady ? 1 : 0.5,
            background: isPipActive ? '#eab308' : '#3b82f6',
            ...buttonStyle
          }}
        >
          {isPipActive ? 'Close Overlay' : 'Open Overlay'}
        </button>

        {/* HIDDEN ELEMENTS */}
        {/* Visibility hidden allows it to render but not be seen. display:none breaks streams */}
        <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -10 }}>
          <canvas ref={canvasRef} width="300" height="150" />
          <video ref={videoRef} muted playsInline width="300" height="150" />
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '20px', border: '1px solid #333' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: '0 0 5px 0'}}>Timer Overlay</h4>
          <small style={{ color: '#888' }}>
            Show this timer over your game.
          </small>
        </div>

        <button
          onClick={togglePiP}
          disabled={!streamReady}
          style={{
            opacity: streamReady ? 1 : 0.5,
            background: isPipActive ? '#eab308' : '#3b82f6'
          }}
        >
          {isPipActive ? 'Close Overlay' : 'Open Overlay'}
        </button>
      </div>

      {/* HIDDEN ELEMENTS */}
      {/* Visibility hidden allows it to render but not be seen. display:none breaks streams */}
      <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -10 }}>
        <canvas ref={canvasRef} width="300" height="150" />
        <video ref={videoRef} muted playsInline width="300" height="150" />
      </div>
    </div>
  );
}
