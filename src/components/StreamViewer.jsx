import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

export default function StreamViewer({ peerIdToWatch, onClose }) {
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const dummyStreamRef = useRef(null);
  const [status, setStatus] = useState('Starting...');

  useEffect(() => {
    if (!peerIdToWatch) return;

    // 1. Create our (the Admin's) own PeerJS client
    const peer = new Peer(undefined, {
      host: '0.peerjs.com',
      secure: true,
      port: 443,
      path: '/',
      debug: 2
    });
    peerRef.current = peer;

    // 2. Once our client is connected to the server, try to call the pilot
    peer.on('open', (id) => {
      console.log('Admin PeerJS ID:', id);
      setStatus(`Calling ${peerIdToWatch}...`);
      
      // Attempt to call the participant. The second argument is the stream we are sending (none).
      // The third argument is options, which we don't need right now.
      const dummyStream = createDummyVideoStream();
      dummyStreamRef.current = dummyStream;
      const call = peer.call(peerIdToWatch, dummyStream);

      // --- THIS IS THE FIX ---
      // 3. Check if the call was successfully initiated.
      if (!call) {
        setStatus('Could not start the call. Check the ID.');
        console.error("PeerJS call() returned undefined. This can happen with an invalid remote ID.");
        return; // Stop execution if the call failed to start.
      }
      
      // 4. If the call started, listen for the pilot's video stream
      call.on('stream', (remoteStream) => {
        setStatus('Live');
        if (videoRef.current) {
          videoRef.current.srcObject = remoteStream;
          videoRef.current.play().catch(e => console.error("Video play failed:", e));
        }
      });

      call.on('close', () => {
          setStatus('Stream ended');
      });

      call.on('error', (err) => {
          setStatus('Connection error.');
          console.error("Call error:", err);
      });
    });

    peer.on('error', (err) => {
        setStatus('Connection failed');
        console.error("PeerJS main error:", err);
    });
    
    // Cleanup function when the component is closed
    return () => {
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        if (dummyStreamRef.current) {
            dummyStreamRef.current.getTracks().forEach((t) => t.stop());
        }
    };

  }, [peerIdToWatch]); // Re-run this whole effect if the target ID changes

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={styles.closeButton}>&times;</button>
        <h3>Live Stream: {status}</h3>
        <div style={styles.videoContainer}>
            <video ref={videoRef} style={styles.videoPlayer} autoPlay playsInline />
            {status !== 'Live' && (
                <div style={styles.statusOverlay}>{status}</div>
            )}
        </div>
      </div>
    </div>
  );
}

function createDummyVideoStream() {
  // PeerJS needs at least one track to create a valid offer.
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(1);
  const [track] = stream.getVideoTracks();
  if (track) track.enabled = false;
  return stream;
}

// Simple CSS-in-JS for styling the modal
const styles = {
    modalBackdrop: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
    modalContent: { background: '#1e293b', padding: '20px', borderRadius: '8px', width: '80%', maxWidth: '900px', position: 'relative', border: '1px solid #334155' },
    closeButton: { position: 'absolute', top: '10px', right: '15px', background: 'none', border: 'none', color: 'white', fontSize: '1.8rem', cursor: 'pointer', lineHeight: '1' },
    videoContainer: { position: 'relative', background: 'black', borderRadius: '4px', overflow: 'hidden', minHeight: '400px' },
    videoPlayer: { width: '100%', display: 'block' },
    statusOverlay: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '5px' },
};
