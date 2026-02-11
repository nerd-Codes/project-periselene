import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import StreamViewer from '../components/StreamViewer';
import {
  Shield, Coins, Tv, Info, ChevronDown, 
  FileImage, Link as LinkIcon, Check, X, Eye, Calculator
} from 'lucide-react';

const TOTAL_BUDGET = 50000;
const BUDGET_BONUS_DIVISOR = 100;
const ROVER_BONUS = 60;
const RETURN_BONUS = 100;
const AESTHETICS_MAX = 30;

const LANDING_OPTIONS = [
  { value: '', label: 'Select Status...' },
  { value: 'perfect_soft', label: 'Perfect Soft (-20s)' },
  { value: 'hard', label: 'Hard Landing (0s)' },
  { value: 'crunch', label: 'Crunch Landing (+20s)' },
  { value: 'dq', label: 'Disqualified (DQ)' }
];

export default function Judge() {
  const [participants, setParticipants] = useState([]);
  const [sortBy, setSortBy] = useState('arrival');
  const [now, setNow] = useState(Date.now());
  const [watchingPeerId, setWatchingPeerId] = useState(null);
  const [viewingBlueprint, setViewingBlueprint] = useState(null);
  
  const notesTimersRef = useRef({});

  useEffect(() => {
    document.title = `JUDGE DASHBOARD // ${watchingPeerId ? 'LIVE' : 'IDLE'}`;
  }, [watchingPeerId]);

  useEffect(() => {
    fetchParticipants();
    const channel = supabase
      .channel('judge-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => fetchParticipants())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  async function fetchParticipants() {
    try {
      const { data, error } = await supabase.from('participants').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      setParticipants(data || []);
    } catch (error) { console.error(error); }
  }

  const sortedParticipants = useMemo(() => {
    const list = [...participants];
    if (sortBy === 'landing') {
      list.sort((a, b) => {
        const aT = a.land_time ? new Date(a.land_time).getTime() : Infinity;
        const bT = b.land_time ? new Date(b.land_time).getTime() : Infinity;
        return aT - bT;
      });
    } else if (sortBy === 'rank') {
      list.sort((a, b) => getScoreValue(a, now) - getScoreValue(b, now));
    } else {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return list;
  }, [participants, sortBy, now]);

  const updateParticipant = async (id, patch) => {
    await supabase.from('participants').update(patch).eq('id', id);
  };

  const handleBudgetChange = (id, raw) => {
    const val = raw === '' ? null : Number(raw);
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, used_budget: val } : p)));
    updateParticipant(id, { used_budget: val });
  };

  const handleLandingStatusChange = (id, value) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, landing_status: value } : p)));
    updateParticipant(id, { landing_status: value });
  };

  const handleToggle = (id, field, checked) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: checked } : p)));
    updateParticipant(id, { [field]: checked });
  };

  const handleAestheticsChange = (id, raw) => {
    const val = raw === '' ? null : Math.min(Math.max(Number(raw), 0), AESTHETICS_MAX);
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, aesthetics_bonus: val } : p)));
    updateParticipant(id, { aesthetics_bonus: val });
  };

  const handlePenaltyChange = (id, raw) => {
    const val = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, additional_penalty: val } : p)));
    updateParticipant(id, { additional_penalty: val });
  };

  const handleNotesChange = (id, val) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, judge_notes: val } : p)));
    if (notesTimersRef.current[id]) clearTimeout(notesTimersRef.current[id]);
    notesTimersRef.current[id] = setTimeout(() => updateParticipant(id, { judge_notes: val }), 400);
  };

  const copyBlueprintLink = (link) => {
    if(!link) return;
    navigator.clipboard.writeText(link);
    alert("Blueprint Link Copied");
  };

  return (
    <div style={styles.container}>
      <div style={styles.background} />
      <div style={styles.vignette} />

      {/* HEADER */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.brand}>
            <Shield size={32} color="#38bdf8" />
            <div>
              <h1 style={styles.title}>JUDGE DASHBOARD</h1>
              <div style={styles.subtitle}>MISSION SCORING & VERIFICATION</div>
            </div>
          </div>

          <div style={styles.controlGroup}>
            <label style={styles.label}>SORTING ORDER</label>
            <div style={styles.selectWrap}>
              <select style={styles.select} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="arrival">Arrival Sequence</option>
                <option value="landing">Landing Time</option>
                <option value="rank">Current Ranking</option>
              </select>
              <ChevronDown size={16} color="#94a3b8" style={{position:'absolute', right: 12, pointerEvents:'none'}} />
            </div>
          </div>
        </div>

        <div style={styles.budgetCard}>
          <div style={styles.label}>MISSION BUDGET CAP</div>
          <div style={styles.budgetValue}>
            <Coins size={20} color="#fbbf24" />
            {TOTAL_BUDGET.toLocaleString()}
          </div>
        </div>
      </header>

      {/* DATA GRID */}
      <div style={styles.gridContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tHead}>
              <th style={styles.th}>PILOT DETAILS</th>
              <th style={styles.th}>FLIGHT DURATION</th>
              <th style={styles.th}>BUDGET ANALYSIS</th>
              <th style={styles.th}>MISSION OBJECTIVES</th>
              <th style={styles.th}>LANDING & PENALTIES</th>
              <th style={styles.th}>FINAL SCORE</th>
              <th style={styles.th}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {sortedParticipants.map((pilot) => {
              const flight = getFlightData(pilot, now);
              const used = pilot.used_budget ?? null;
              const left = used === null ? null : TOTAL_BUDGET - used;
              const bBonus = left === null ? null : Math.max(0, Math.floor(left / BUDGET_BONUS_DIVISOR));
              const mBonus = (pilot.rover_bonus ? ROVER_BONUS : 0) + (pilot.return_bonus ? RETURN_BONUS : 0) + (pilot.aesthetics_bonus ?? 0);
              const lStatus = normalizeLandingStatus(pilot.landing_status);
              const lAdj = getLandingAdjustmentSeconds(lStatus);
              const final = getFinalScore({
                flightSeconds: flight.seconds, budgetBonus: bBonus, missionBonus: mBonus,
                landingAdjustment: lAdj, additionalPenalty: pilot.additional_penalty || 0, isDQ: lStatus === 'dq'
              });

              return (
                <tr key={pilot.id} style={{...styles.tr, ...getLandingRowStyle(lStatus)}}>
                  
                  {/* COLUMN 1: IDENTITY */}
                  <td style={styles.td}>
                    <div style={styles.identityCell}>
                      <div>
                        <div style={styles.teamName}>{pilot.team_name}</div>
                        <div style={styles.statusBadge(pilot.status)}>{pilot.status?.toUpperCase()}</div>
                      </div>
                      <div style={styles.blueprintRow}>
                        {pilot.blueprint_url ? (
                          <button style={styles.miniBtn} onClick={() => setViewingBlueprint({ url: pilot.blueprint_url, name: pilot.team_name })}>
                            <Eye size={12} /> View BP
                          </button>
                        ) : <span style={styles.dimText}>No Img</span>}
                        
                        {pilot.blueprint_link ? (
                          <button style={styles.miniBtn} onClick={() => copyBlueprintLink(pilot.blueprint_link)}>
                            <LinkIcon size={12} /> Copy Link
                          </button>
                        ) : <span style={styles.dimText}>No Link</span>}
                      </div>
                    </div>
                  </td>

                  {/* COLUMN 2: TIME */}
                  <td style={styles.td}>
                    <div style={styles.timeCell}>
                      <span style={styles.monoBig}>{flight.label}</span>
                      <span style={{...styles.statusText, color: flight.subLabel === 'Final' ? '#22c55e' : '#94a3b8'}}>
                        {flight.subLabel}
                      </span>
                    </div>
                  </td>

                  {/* COLUMN 3: ECONOMICS */}
                  <td style={styles.td}>
                    <div style={styles.inputGroup}>
                      <label style={styles.inputLabel}>USED BUDGET</label>
                      <input 
                        type="number" 
                        style={styles.input} 
                        value={used ?? ''} 
                        placeholder="0" 
                        onChange={(e) => handleBudgetChange(pilot.id, e.target.value)} 
                      />
                    </div>
                    <div style={styles.calcRow}>
                      <span style={styles.dimText}>Left:</span>
                      <span style={{color: (left < 0) ? '#ef4444' : '#22c55e', fontWeight: 700}}>
                        {left ? left.toLocaleString() : '---'}
                      </span>
                    </div>
                  </td>

                  {/* COLUMN 4: BONUSES */}
                  <td style={styles.td}>
                    <div style={styles.bonusGrid}>
                      <ToggleButton 
                        active={pilot.rover_bonus} 
                        label="ROVER" 
                        onClick={() => handleToggle(pilot.id, 'rover_bonus', !pilot.rover_bonus)} 
                      />
                      <ToggleButton 
                        active={pilot.return_bonus} 
                        label="RETURN" 
                        onClick={() => handleToggle(pilot.id, 'return_bonus', !pilot.return_bonus)} 
                      />
                      <div style={styles.inputGroup}>
                        <label style={styles.inputLabel}>STYLE (0-30)</label>
                        <input 
                          type="number" 
                          style={styles.input} 
                          value={pilot.aesthetics_bonus ?? ''} 
                          onChange={(e) => handleAestheticsChange(pilot.id, e.target.value)} 
                        />
                      </div>
                    </div>
                  </td>

                  {/* COLUMN 5: OUTCOME */}
                  <td style={styles.td}>
                    <div style={styles.stack}>
                      <div style={styles.inputGroup}>
                        <label style={styles.inputLabel}>LANDING GRADE</label>
                        <select 
                          style={styles.selectInput(lStatus)} 
                          value={lStatus} 
                          onChange={(e) => handleLandingStatusChange(pilot.id, e.target.value)}
                        >
                          {LANDING_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                      <div style={styles.inputGroup}>
                        <label style={styles.inputLabel}>EXTRA PENALTY (+Sec)</label>
                        <input 
                          type="number" 
                          style={styles.input} 
                          value={pilot.additional_penalty ?? ''} 
                          placeholder="0" 
                          onChange={(e) => handlePenaltyChange(pilot.id, e.target.value)} 
                        />
                      </div>
                    </div>
                  </td>

                  {/* COLUMN 6: SCORE */}
                  <td style={styles.td}>
                    <div style={{...styles.scoreBox, color: lStatus === 'dq' ? '#ef4444' : '#fff'}}>
                      {final.label}
                    </div>
                  </td>

                  {/* COLUMN 7: FEEDBACK */}
                  <td style={styles.td}>
                    <div style={styles.stack}>
                      <textarea 
                        style={styles.notesArea} 
                        value={pilot.judge_notes || ''} 
                        placeholder="Judge's notes..." 
                        onChange={(e) => handleNotesChange(pilot.id, e.target.value)} 
                      />
                      <button 
                        style={styles.streamBtn} 
                        disabled={!pilot.peer_id} 
                        onClick={() => setWatchingPeerId(pilot.peer_id)}
                      >
                        <Tv size={16} /> WATCH FEED
                      </button>
                    </div>
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* STREAM MODAL */}
      {watchingPeerId && <StreamViewer peerIdToWatch={watchingPeerId} onClose={() => setWatchingPeerId(null)} />}

      {/* BLUEPRINT MODAL */}
      {viewingBlueprint && (
        <div style={styles.modalOverlay} onClick={() => setViewingBlueprint(null)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                <FileImage size={18} color="#38bdf8" /> 
                BLUEPRINT: {viewingBlueprint.name.toUpperCase()}
              </div>
              <button style={styles.closeBtn} onClick={() => setViewingBlueprint(null)}><X size={24} /></button>
            </div>
            <div style={styles.imageWrapper}>
              <img src={viewingBlueprint.url} alt="Blueprint" style={styles.blueprintImg} />
            </div>
          </div>
        </div>
      )}
      <div style={styles.creditText}>Made with 💙 by Srijal Kumar</div>
    </div>
  );
}

/* --- UI COMPONENTS --- */

function ToggleButton({ active, label, onClick }) {
  return (
    <div style={{...styles.toggleBtn, ...(active ? styles.toggleActive : {})}} onClick={onClick}>
      {active ? <Check size={14} /> : <div style={styles.dot} />}
      {label}
    </div>
  );
}

/* --- LOGIC HELPERS --- */
function getFlightData(p, now) {
  if (p.flight_duration) return { seconds: p.flight_duration, label: fmt(p.flight_duration), subLabel: 'Final' };
  if (p.land_time && p.start_time) {
    const s = Math.round((new Date(p.land_time) - new Date(p.start_time)) / 1000);
    return { seconds: s, label: fmt(s), subLabel: 'Final' };
  }
  if (p.start_time) {
    const s = Math.round((now - new Date(p.start_time).getTime()) / 1000);
    return { seconds: s, label: fmt(s), subLabel: 'In Flight' };
  }
  return { seconds: null, label: '--:--', subLabel: 'Waiting' };
}
function fmt(s) { const m=Math.floor(s/60).toString().padStart(2,'0'); const sec=(s%60).toString().padStart(2,'0'); return `${m}:${sec}`; }
function normalizeLandingStatus(v) { if (!v) return ''; const n = v.toLowerCase(); if(n.includes('soft')||n.includes('perfect'))return 'perfect_soft'; if(n.includes('hard'))return 'hard'; if(n.includes('crunch'))return 'crunch'; if(n.includes('dq')||n.includes('exploded'))return 'dq'; return ''; }
function getLandingAdjustmentSeconds(s) { if(s==='perfect_soft')return -20; if(s==='crunch')return 20; if(s==='dq')return null; return 0; }
function getFinalScore({ flightSeconds, budgetBonus, missionBonus, landingAdjustment, additionalPenalty, isDQ }) {
  if (isDQ || landingAdjustment === null) return { value: Infinity, label: 'DQ' };
  if (!flightSeconds) return { value: Infinity, label: '---' };
  const score = Math.round(flightSeconds - (budgetBonus || 0) - (missionBonus || 0) + (landingAdjustment || 0) + (additionalPenalty || 0));
  return { value: score, label: `${score}s` };
}
function getScoreValue(p, now) {
  const f = getFlightData(p, now);
  const u = p.used_budget ?? null;
  const l = u === null ? null : TOTAL_BUDGET - u;
  const b = l === null ? 0 : Math.max(0, Math.floor(l / BUDGET_BONUS_DIVISOR));
  const m = (p.rover_bonus ? ROVER_BONUS : 0) + (p.return_bonus ? RETURN_BONUS : 0) + (p.aesthetics_bonus ?? 0);
  const s = normalizeLandingStatus(p.landing_status);
  const final = getFinalScore({ flightSeconds: f.seconds, budgetBonus: b, missionBonus: m, landingAdjustment: getLandingAdjustmentSeconds(s), additionalPenalty: p.additional_penalty || 0, isDQ: '' === 'dq' });
  return final.value;
}
function getLandingRowStyle(s) {
  if (s === 'perfect_soft') return { background: 'rgba(16, 185, 129, 0.05)', borderLeft: '4px solid #22c55e' };
  if (s === 'dq') return { background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444' };
  return { borderLeft: '4px solid transparent' };
}

/* --- STYLES --- */
const styles = {
  container: {
    height: '100vh', backgroundColor: '#0b1020', color: '#f1f5f9',
    fontFamily: '"SF Pro Display", "Inter", sans-serif',
    display: 'flex', flexDirection: 'column', padding: '24px', gap: '20px',
    position: 'relative', overflow: 'hidden'
  },
  background: {
    position: 'absolute', inset: 0, zIndex: 0,
    background: 'radial-gradient(circle at top right, #1e293b 0%, #020617 100%)'
  },
  vignette: {
    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
    background: 'radial-gradient(circle, transparent 50%, rgba(0,0,0,0.8) 100%)'
  },

  /* HEADER */
  header: {
    position: 'relative', zIndex: 10,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'rgba(30, 41, 59, 0.5)', backdropFilter: 'blur(16px)',
    border: '1px solid rgba(148, 163, 184, 0.1)',
    borderRadius: '16px', padding: '20px 30px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
  },
  headerLeft: { display: 'flex', gap: '40px', alignItems: 'center' },
  brand: { display: 'flex', gap: '16px', alignItems: 'center' },
  title: { fontSize: '1.8rem', fontWeight: 800, letterSpacing: '1px', color: '#fff', margin: 0 },
  subtitle: { fontSize: '0.8rem', color: '#38bdf8', letterSpacing: '2px', fontWeight: 700 },
  
  controlGroup: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px' },
  selectWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  select: {
    appearance: 'none', background: '#0f172a', border: '1px solid #334155',
    color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 600, padding: '10px 40px 10px 16px',
    borderRadius: '8px', cursor: 'pointer', outline: 'none', minWidth: '180px'
  },

  budgetCard: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  budgetValue: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.8rem', fontWeight: 700, color: '#fff' },

  /* GRID */
  gridContainer: { 
    position: 'relative', zIndex: 10, flex: 1, overflow: 'auto',
    background: 'rgba(15, 23, 42, 0.4)', borderRadius: '16px', 
    border: '1px solid rgba(148, 163, 184, 0.1)',
    display: 'flex', flexDirection: 'column', minHeight: 0,
  },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: '1400px' },
  tHead: { position: 'sticky', top: 0, background: '#0f172a', zIndex: 20 },
  th: {
    padding: '16px 20px', textAlign: 'left', fontSize: '0.7rem', color: '#94a3b8',
    fontWeight: 700, letterSpacing: '1px', borderBottom: '1px solid #334155'
  },
  tr: { borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' },
  td: { padding: '16px 20px', verticalAlign: 'top' },

  /* COLUMNS */
  identityCell: { display: 'flex', flexDirection: 'column', gap: '8px' },
  teamName: { fontSize: '1.1rem', fontWeight: 700, color: '#fff' },
  statusBadge: (s) => ({
    display: 'inline-block', fontSize: '0.6rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px',
    background: s === 'landed' ? '#22c55e' : s === 'flying' ? '#38bdf8' : '#64748b', color: '#000', marginTop: '4px'
  }),
  blueprintRow: { display: 'flex', gap: '8px', marginTop: '4px' },
  miniBtn: {
    background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)',
    color: '#38bdf8', fontSize: '0.65rem', padding: '4px 8px', borderRadius: '4px',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600
  },
  dimText: { fontSize: '0.7rem', color: '#475569', fontStyle: 'italic' },

  timeCell: { display: 'flex', flexDirection: 'column', gap: '2px' },
  monoBig: { fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 700, color: '#fff' },
  statusText: { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' },

  inputGroup: { display: 'flex', flexDirection: 'column', gap: '6px' },
  inputLabel: { fontSize: '0.6rem', color: '#64748b', fontWeight: 700 },
  input: {
    background: '#020617', border: '1px solid #334155', color: '#fff',
    padding: '10px 12px', borderRadius: '8px', fontSize: '0.9rem', width: '100%',
    minWidth: '90px', outline: 'none', transition: 'border 0.2s', fontWeight: 600
  },
  calcRow: { display: 'flex', gap: '8px', fontSize: '0.8rem', marginTop: '6px' },

  bonusGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', minWidth: '180px' },
  toggleBtn: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
    borderRadius: '8px', border: '1px solid rgba(148, 163, 184, 0.2)',
    fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', cursor: 'pointer',
    background: 'rgba(2, 6, 23, 0.5)', transition: 'all 0.2s'
  },
  toggleActive: {
    background: 'rgba(56, 189, 248, 0.15)', borderColor: '#38bdf8', color: '#38bdf8'
  },
  dot: { width: '6px', height: '6px', borderRadius: '50%', background: '#64748b' },

  selectInput: (s) => ({
    width: '100%', padding: '10px', borderRadius: '8px', background: '#020617',
    border: `1px solid ${s === 'dq' ? '#ef4444' : '#334155'}`, color: '#fff',
    fontSize: '0.85rem', cursor: 'pointer', outline: 'none'
  }),
  stack: { display: 'flex', flexDirection: 'column', gap: '10px' },

  scoreBox: {
    fontSize: '1.8rem', fontWeight: 800, fontFamily: 'monospace',
    padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', textAlign: 'center'
  },

  notesArea: {
    width: '100%', height: '60px', background: '#020617', border: '1px solid #334155',
    color: '#cbd5f5', borderRadius: '8px', padding: '8px', fontSize: '0.75rem', resize: 'vertical'
  },
  streamBtn: {
    background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)', border: 'none',
    color: '#fff', padding: '10px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 800,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    boxShadow: '0 4px 12px rgba(56, 189, 248, 0.25)'
  },

  /* MODAL */
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px'
  },
  modalContent: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: '16px',
    display: 'flex', flexDirection: 'column', maxWidth: '95vw', maxHeight: '90vh',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)'
  },
  modalHeader: {
    padding: '20px 24px', borderBottom: '1px solid #1e293b',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  modalTitle: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1rem', fontWeight: 800, color: '#fff' },
  closeBtn: { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' },
  imageWrapper: { padding: '0', overflow: 'auto', display: 'flex', justifyContent: 'center', background: '#020617', flex: 1 },
  blueprintImg: { maxWidth: '100%', height: 'auto', display: 'block' },
  creditText: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: '10px',
    zIndex: 30,
    fontSize: '10px',
    color: 'rgba(191, 219, 254, 0.9)',
    letterSpacing: '0.4px',
    pointerEvents: 'none'
  }
};
