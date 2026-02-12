import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';
import { ArrowRight, ShieldCheck } from 'lucide-react';

const SLIDER_HANDLE_SIZE = 44;

export default function TimerOverlay({
  compact = false,
  buttonStyle = {},
  containerStyle = {},
  icon: Icon,
  openLabel = 'Open Overlay',
  closeLabel = 'Close Overlay',
  timeValue,
  showLandingSlider = false,
  landingValue = 0,
  onLandingChange,
  onLandingRelease,
  landingSuccess = false,
  landingDisabled = false,
  showBlueprintCapture = false,
  blueprintLinkValue = '',
  onBlueprintLinkChange,
  onBlueprintSubmit,
  blueprintSubmitDisabled = false,
  blueprintSubmitting = false,
  blueprintStatusMessage = ''
}) {
  const { displayTime, mode, isAlert } = useTimer();
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const pipWindowRef = useRef(null);
  const [pipMode, setPipMode] = useState(null);
  const [pipContainer, setPipContainer] = useState(null);
  const [streamReady, setStreamReady] = useState(false);
  const [pipViewport, setPipViewport] = useState({ width: 360, height: 320 });
  const isPipActive = Boolean(pipMode);
  const canUseDocumentPiP = typeof window !== 'undefined'
    && 'documentPictureInPicture' in window
    && typeof window.documentPictureInPicture?.requestWindow === 'function';
  const activeTime = timeValue || displayTime;
  const modeLabel = mode === 'IDLE' ? 'WAITING' : mode === 'BUILD' ? 'BUILD' : 'FLIGHT';
  const timerPrefix = mode === 'BUILD' ? 'T-' : 'T+';
  const isLandingReady = showLandingSlider && !landingSuccess && !landingDisabled;
  const shouldShowLandingSlider = showLandingSlider && !landingSuccess;
  const shouldShowBlueprintForm = mode === 'BUILD' && showBlueprintCapture;
  const defaultPiPSize = useMemo(() => ({
    width: 344,
    height: shouldShowBlueprintForm ? 242 : shouldShowLandingSlider ? 192 : landingSuccess ? 156 : 140
  }), [landingSuccess, shouldShowBlueprintForm, shouldShowLandingSlider]);
  const overlayScale = useMemo(() => {
    const widthScale = pipViewport.width / defaultPiPSize.width;
    const heightScale = pipViewport.height / defaultPiPSize.height;
    return Math.max(0.5, Math.min(1.6, Math.min(widthScale, heightScale)));
  }, [pipViewport.height, pipViewport.width, defaultPiPSize.height, defaultPiPSize.width]);
  const overlayCard = useMemo(() => (
    <div style={styles.overlayRoot}>
      <div style={styles.overlayBackground} />
      <div style={styles.overlayVignette} />

      <div
        style={{
          ...styles.overlayFrame,
          width: `${defaultPiPSize.width}px`,
          height: `${defaultPiPSize.height}px`,
          transform: `translate(-50%, 0) scale(${overlayScale})`
        }}
      >
        <div style={styles.overlayHud}>
          <div style={styles.overlayTopBar}>
            <div style={styles.overlayLabel}>PARTICIPANT</div>
            <span style={{ ...styles.overlayStatusBadge, color: getModeColor(mode) }}>{modeLabel}</span>
          </div>

          <div style={{ ...styles.overlayTimerDisplay, color: isAlert ? '#ef4444' : '#ffffff' }}>
            <span style={styles.overlayTimerPrefix}>{timerPrefix}</span>
            <span>{activeTime}</span>
          </div>
          <div style={styles.overlayTimerLabel}>{landingSuccess ? 'YOUR FLIGHT TIME' : 'MISSION CLOCK'}</div>

          {shouldShowBlueprintForm && (
            <form
              style={styles.overlayBuildForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (!blueprintSubmitDisabled) onBlueprintSubmit?.();
              }}
            >
              <input
                type="text"
                placeholder="Paste SFS blueprint link"
                value={blueprintLinkValue}
                onChange={onBlueprintLinkChange}
                style={styles.overlayBuildInput}
              />
              <button
                type="submit"
                style={{ ...styles.overlayBuildSubmit, opacity: blueprintSubmitDisabled ? 0.6 : 1 }}
                disabled={blueprintSubmitDisabled}
              >
                {blueprintSubmitting ? 'CAPTURING...' : 'SUBMIT BLUEPRINT'}
              </button>
              {blueprintStatusMessage ? <div style={styles.overlayBuildStatus}>{blueprintStatusMessage}</div> : null}
            </form>
          )}

          {shouldShowLandingSlider && (
            <div style={{ ...styles.overlaySliderRegion, opacity: isLandingReady ? 1 : 0.65 }}>
              <div style={styles.sliderTrack}>
                <div style={{ ...styles.sliderFill, width: `${landingValue}%` }} />
                <span style={styles.sliderText}>{landingValue > 15 ? '' : 'SLIDE TO LAND'}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={landingValue}
                  disabled={!isLandingReady}
                  onChange={onLandingChange}
                  onMouseUp={onLandingRelease}
                  onTouchEnd={onLandingRelease}
                  onPointerUp={onLandingRelease}
                  style={styles.rangeInput}
                />
                <div style={{ ...styles.sliderHandle, left: `calc(${landingValue}% - ${SLIDER_HANDLE_SIZE / 2}px)` }}>
                  <ArrowRight color="#000" size={16} />
                </div>
              </div>
            </div>
          )}

          {landingSuccess && (
            <div style={styles.overlaySuccess}>
              <ShieldCheck size={16} /> LANDING RECORDED
            </div>
          )}
        </div>
      </div>
    </div>
  ), [
    activeTime,
    defaultPiPSize.height,
    defaultPiPSize.width,
    isAlert,
    isLandingReady,
    blueprintLinkValue,
    blueprintStatusMessage,
    blueprintSubmitDisabled,
    blueprintSubmitting,
    landingSuccess,
    landingValue,
    mode,
    modeLabel,
    overlayScale,
    onLandingChange,
    onLandingRelease,
    onBlueprintLinkChange,
    onBlueprintSubmit,
    shouldShowBlueprintForm,
    shouldShowLandingSlider,
    timerPrefix
  ]);

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
    ctx.fillText(activeTime, width / 2, 110);
    
    // Force the canvas to update its stream
    // (Browsers sometimes pause streams if pixels don't change)
    if (videoRef.current && videoRef.current.srcObject) {
        // No-op, just ensuring context stays active
    }

  }, [activeTime, mode, isAlert]);

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

            videoRef.current.onleavepictureinpicture = () => {
              setPipMode((prev) => (prev === 'video' ? null : prev));
            };
        } catch (err) {
            console.error("Stream Init Error:", err);
        }
    };

    initStream();
  }, []); // Run once on mount

  useEffect(() => {
    return () => {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (pipMode !== 'document' || !pipWindowRef.current) return;

    const pipWindow = pipWindowRef.current;
    const syncViewport = () => {
      setPipViewport({
        width: pipWindow.innerWidth,
        height: pipWindow.innerHeight
      });
    };

    syncViewport();
    pipWindow.addEventListener('resize', syncViewport);

    return () => {
      pipWindow.removeEventListener('resize', syncViewport);
    };
  }, [pipMode]);

  const closePiP = async () => {
    if (pipMode === 'document') {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.close();
      }
      pipWindowRef.current = null;
      setPipContainer(null);
      setPipMode(null);
      return;
    }

    if (pipMode === 'video' && document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
    setPipMode(null);
  };

  const openVideoPiP = async () => {
    const video = videoRef.current;
    if (!video || !streamReady) {
      alert("Overlay is still loading. Try again in a second.");
      return;
    }

    if (video.paused) await video.play();
    await video.requestPictureInPicture();
    setPipMode('video');
  };

  const openDocumentPiP = async () => {
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: defaultPiPSize.width,
      height: defaultPiPSize.height
    });
    pipWindowRef.current = pipWindow;
    setPipViewport({
      width: pipWindow.innerWidth || defaultPiPSize.width,
      height: pipWindow.innerHeight || defaultPiPSize.height
    });

    const { document: pipDoc } = pipWindow;
    pipDoc.body.style.margin = '0';
    pipDoc.body.style.background = '#020617';
    pipDoc.body.style.height = '100vh';
    pipDoc.body.style.width = '100vw';
    pipDoc.body.style.fontFamily = '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif';
    pipDoc.body.style.overflow = 'hidden';

    const host = pipDoc.createElement('div');
    host.style.height = '100%';
    host.style.width = '100%';
    pipDoc.body.appendChild(host);

    pipWindow.addEventListener('pagehide', () => {
      pipWindowRef.current = null;
      setPipContainer(null);
      setPipViewport(defaultPiPSize);
      setPipMode((prev) => (prev === 'document' ? null : prev));
    }, { once: true });

    setPipContainer(host);
    setPipMode('document');
  };

  // 3. ACTIVATE PIP (User Click)
  const togglePiP = async () => {
    try {
      if (isPipActive) {
        await closePiP();
        return;
      }

      if (canUseDocumentPiP) {
        await openDocumentPiP();
      } else {
        await openVideoPiP();
      }
    } catch (err) {
      console.error("PiP Error:", err);
      if (canUseDocumentPiP && pipMode !== 'video') {
        try {
          await openVideoPiP();
          return;
        } catch (fallbackErr) {
          console.error("Fallback PiP Error:", fallbackErr);
        }
      }
      alert("Could not open overlay: " + err.message);
    }
  };

  if (compact) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', ...containerStyle }}>
          <button
            onClick={togglePiP}
            disabled={!canUseDocumentPiP && !streamReady}
            style={{
              opacity: canUseDocumentPiP || streamReady ? 1 : 0.5,
              background: isPipActive ? '#eab308' : '#3b82f6',
              ...buttonStyle
            }}
          >
            {Icon && <Icon size={18} />}
            {isPipActive ? closeLabel : openLabel}
          </button>

          {/* HIDDEN ELEMENTS */}
          {/* Visibility hidden allows it to render but not be seen. display:none breaks streams */}
          <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -10 }}>
            <canvas ref={canvasRef} width="300" height="150" />
            <video ref={videoRef} muted playsInline width="300" height="150" />
          </div>
        </div>
        {pipMode === 'document' && pipContainer ? createPortal(overlayCard, pipContainer) : null}
      </>
    );
  }

  return (
    <>
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
            disabled={!canUseDocumentPiP && !streamReady}
            style={{
              opacity: canUseDocumentPiP || streamReady ? 1 : 0.5,
              background: isPipActive ? '#eab308' : '#3b82f6'
            }}
          >
            {Icon && <Icon size={18} />}
            {isPipActive ? closeLabel : openLabel}
          </button>
        </div>

        {/* HIDDEN ELEMENTS */}
        {/* Visibility hidden allows it to render but not be seen. display:none breaks streams */}
        <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -10 }}>
          <canvas ref={canvasRef} width="300" height="150" />
          <video ref={videoRef} muted playsInline width="300" height="150" />
        </div>
      </div>
      {pipMode === 'document' && pipContainer ? createPortal(overlayCard, pipContainer) : null}
    </>
  );
}

const styles = {
  overlayRoot: {
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    color: '#fff',
    fontFamily: '"DIN Alternate", "Franklin Gothic Medium", "Arial", sans-serif',
    overflow: 'hidden'
  },
  overlayFrame: {
    position: 'absolute',
    left: '50%',
    top: '0',
    transformOrigin: 'top center',
    zIndex: 2
  },
  overlayBackground: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle at center, #1a202c 0%, #000000 100%)',
    zIndex: 0
  },
  overlayVignette: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle, transparent 60%, black 100%)',
    zIndex: 0,
    pointerEvents: 'none'
  },
  overlayHud: {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: '100%',
    gap: '6px',
    padding: '4px 10px 0'
  },
  overlayTopBar: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2px'
  },
  overlayLabel: {
    fontSize: '9px',
    color: '#64748b',
    letterSpacing: '2px',
    fontWeight: 700
  },
  overlayStatusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    fontSize: '9px',
    fontWeight: 800,
    letterSpacing: '1.6px',
    background: 'rgba(15, 23, 42, 0.6)',
    textShadow: '0 0 10px rgba(0,0,0,0.6)'
  },
  overlayTimerDisplay: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    fontFamily: 'monospace',
    fontSize: '62px',
    fontWeight: 700,
    lineHeight: 0.9,
    letterSpacing: '-2px',
    textShadow: '0 0 40px rgba(56, 189, 248, 0.15)'
  },
  overlayTimerPrefix: {
    fontSize: '24px',
    letterSpacing: '2px',
    color: '#94a3b8',
    fontWeight: 700
  },
  overlayTimerLabel: {
    fontSize: '10px',
    color: '#64748b',
    letterSpacing: '3px',
    fontWeight: 600,
    marginTop: '-1px'
  },
  overlaySliderRegion: {
    width: '100%',
    maxWidth: '280px',
    height: '44px',
    marginTop: '2px'
  },
  overlayBuildForm: {
    width: '100%',
    maxWidth: '300px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '2px'
  },
  overlayBuildInput: {
    background: 'rgba(2, 6, 23, 0.75)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '8px',
    padding: '7px 10px',
    color: '#e2e8f0',
    fontSize: '11px',
    outline: 'none',
    width: '100%'
  },
  overlayBuildSubmit: {
    width: '100%',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #38bdf8 0%, #22c55e 100%)',
    color: '#0b1220',
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '0.8px',
    padding: '7px 10px',
    cursor: 'pointer'
  },
  overlayBuildStatus: {
    fontSize: '10px',
    color: '#fbbf24',
    letterSpacing: '1px',
    fontWeight: 700
  },
  sliderTrack: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'rgba(20, 20, 20, 0.8)',
    borderRadius: '25px',
    border: '1px solid rgba(255,255,255,0.15)',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: '100%',
    background: 'linear-gradient(90deg, #0ea5e9, #22c55e)',
    zIndex: 0
  },
  sliderText: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    fontSize: '11px',
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '2px',
    zIndex: 1,
    pointerEvents: 'none'
  },
  rangeInput: {
    position: 'absolute',
    inset: 0,
    opacity: 0,
    cursor: 'pointer',
    zIndex: 10
  },
  sliderHandle: {
    position: 'absolute',
    width: `${SLIDER_HANDLE_SIZE}px`,
    height: `${SLIDER_HANDLE_SIZE}px`,
    background: '#fff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    pointerEvents: 'none',
    boxShadow: '0 0 15px rgba(255,255,255,0.5)'
  },
  overlaySuccess: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#22c55e',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '1px',
    textShadow: '0 0 10px rgba(34, 197, 94, 0.4)',
    marginTop: '4px'
  }
};

const getModeColor = (m) => m === 'BUILD' ? '#fbbf24' : m === 'FLIGHT' ? '#38bdf8' : '#94a3b8';
