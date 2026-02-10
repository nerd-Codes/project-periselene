import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import StreamViewer from '../components/StreamViewer';
import {
  Shield,
  Coins,
  Timer,
  Rocket,
  CheckCircle2,
  AlertOctagon,
  Tv,
  ClipboardList,
  Info,
  AlertTriangle,
  ChevronDown
} from 'lucide-react';

const TOTAL_BUDGET = 50000;
const BUDGET_BONUS_DIVISOR = 100;
const ROVER_BONUS = 60;
const RETURN_BONUS = 100;
const AESTHETICS_MAX = 30;

const LANDING_OPTIONS = [
  { value: '', label: 'Pending' },
  { value: 'perfect_soft', label: 'Perfect soft (-20s)' },
  { value: 'hard', label: 'Hard landing (0s)' },
  { value: 'crunch', label: 'Crunch (+45s)' },
  { value: 'dq', label: 'Disqualified (DQ)' }
];

export default function Judge() {
  const [participants, setParticipants] = useState([]);
  const [sortBy, setSortBy] = useState('arrival');
  const [now, setNow] = useState(Date.now());
  const [watchingPeerId, setWatchingPeerId] = useState(null);

  useEffect(() => {
    const statusLabel = watchingPeerId ? 'Reviewing' : 'Idle';
    document.title = `Project Periselene - Judge - ${statusLabel}`;
  }, [watchingPeerId]);
  const notesTimersRef = useRef({});

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
    } catch (error) {
      console.error(error);
    }
  }

  const sortedParticipants = useMemo(() => {
    const list = [...participants];
    if (sortBy === 'landing') {
      list.sort((a, b) => {
        const aT = a.land_time - new Date(a.land_time).getTime() : Infinity;
        const bT = b.land_time - new Date(b.land_time).getTime() : Infinity;
        return aT - bT;
      });
    } else if (sortBy === 'rank') {
      list.sort((a, b) => {
        const scoreA = getScoreValue(a, now);
        const scoreB = getScoreValue(b, now);
        return scoreA - scoreB;
      });
    } else {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return list;
  }, [participants, sortBy, now]);

  const updateParticipant = async (id, patch) => {
    const { error } = await supabase.from('participants').update(patch).eq('id', id);
    if (error) console.error('Update failed:', error);
  };

  const handleBudgetChange = (id, raw) => {
    const val = raw === '' - null : Number(raw);
    setParticipants((prev) => prev.map((p) => (p.id === id - { ...p, used_budget: val } : p)));
    updateParticipant(id, { used_budget: val });
  };

  const handleLandingStatusChange = (id, value) => {
    setParticipants((prev) => prev.map((p) => (p.id === id - { ...p, landing_status: value } : p)));
    updateParticipant(id, { landing_status: value });
  };

  const handleToggle = (id, field, checked) => {
    setParticipants((prev) => prev.map((p) => (p.id === id - { ...p, [field]: checked } : p)));
    updateParticipant(id, { [field]: checked });
  };

  const handleAestheticsChange = (id, raw) => {
    const val = raw === '' - null : Math.min(Math.max(Number(raw), 0), AESTHETICS_MAX);
    setParticipants((prev) => prev.map((p) => (p.id === id - { ...p, aesthetics_bonus: val } : p)));
    updateParticipant(id, { aesthetics_bonus: val });
  };

  const handlePenaltyChange = (id, raw) => {
    const val = raw === '' - null : Math.max(0, Math.round(Number(raw)));
    setParticipants((prev) => prev.map((p) => (p.id === id - { ...p, additional_penalty: val } : p)));
    updateParticipant(id, { additional_penalty: val });
  };

  const handleNotesChange = (id, val) => {
    setParticipants((prev) => prev.map((p) => (p.id === id - { ...p, judge_notes: val } : p)));
    if (notesTimersRef.current[id]) clearTimeout(notesTimersRef.current[id]);
    notesTimersRef.current[id] = setTimeout(() => updateParticipant(id, { judge_notes: val }), 400);
  };

  return (
    <div style={styles.container}>
      <div style={styles.background} />
      <div style={styles.glowOne} />
      <div style={styles.glowTwo} />

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.titleGroup}>
            <Shield size={26} color="#38bdf8" />
            <div>
              <h1 style={styles.title}>Judge Panel</h1>
              <div style={styles.subtitle}>Score and review flights</div>
            </div>
          </div>

          <div style={styles.sortBox}>
            <div style={styles.labelSmall}>
              <Info size={12} /> Sort by
            </div>
            <div style={styles.selectWrapper}>
              <select style={styles.minimalSelect} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="arrival">Arrival order</option>
                <option value="landing">Landing time</option>
                <option value="rank">Rank (lowest score first)</option>
              </select>
              <ChevronDown size={14} color="#38bdf8" />
            </div>
          </div>
        </div>

        <div style={styles.budgetStats}>
          <div style={styles.statItem}>
            <div style={styles.labelSmall}>Total budget</div>
            <div style={styles.budgetValue}>
              {TOTAL_BUDGET.toLocaleString()} <span style={styles.unit}>cr</span>
            </div>
          </div>
        </div>
      </header>

      <div style={styles.tableCard}>
        <div style={styles.scrollArea}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.thRow}>
                <th style={styles.th}>TEAM</th>
                <th style={styles.th}>FLIGHT TIME</th>
                <th style={styles.th}>LANDING TIME</th>
                <th style={styles.th}>BUDGET (CR)</th>
                <th style={styles.th}>BUDGET BONUS</th>
                <th style={styles.th}>BONUSES</th>
                <th style={styles.th}>LANDING</th>
                <th style={styles.th}>LANDING ADJ.</th>
                <th style={styles.th}>PENALTY</th>
                <th style={styles.th}>FINAL SCORE</th>
                <th style={styles.th}>NOTES</th>
                <th style={styles.th}>STREAM</th>
              </tr>
            </thead>
            <tbody>
              {sortedParticipants.map((pilot) => {
                const flight = getFlightData(pilot, now);
                const used = pilot.used_budget ?? null;
                const left = used === null - null : TOTAL_BUDGET - used;
                const bBonus = left === null - null : Math.max(0, Math.floor(left / BUDGET_BONUS_DIVISOR));
                const mBonus =
                  (pilot.rover_bonus - ROVER_BONUS : 0) +
                  (pilot.return_bonus - RETURN_BONUS : 0) +
                  (pilot.aesthetics_bonus ?? 0);
                const lStatus = normalizeLandingStatus(pilot.landing_status);
                const lAdj = getLandingAdjustmentSeconds(lStatus);
                const final = getFinalScore({
                  flightSeconds: flight.seconds,
                  budgetBonus: bBonus,
                  missionBonus: mBonus,
                  landingAdjustment: lAdj,
                  additionalPenalty: pilot.additional_penalty || 0,
                  isDQ: lStatus === 'dq'
                });

                return (
                  <tr key={pilot.id} style={{ ...styles.tr, ...getLandingRowStyle(lStatus) }}>
                    <td style={styles.td}>
                      <div style={styles.teamName}>{pilot.team_name.toUpperCase()}</div>
                      <div style={styles.statusBadge(pilot.status)}>{pilot.status?.toUpperCase()}</div>
                    </td>

                    <td style={styles.td}>
                      <div style={styles.monoTime}>{flight.label}</div>
                      <div style={{ ...styles.subtext, color: flight.subLabel === 'Final' - '#22c55e' : '#94a3b8' }}>
                        {flight.subLabel}
                      </div>
                    </td>

                    <td style={styles.td}>
                      <div style={styles.wallTime}>{pilot.land_time - formatWallTime(pilot.land_time) : '--:--:--'}</div>
                    </td>

                    <td style={styles.td}>
                      <input
                        type="number"
                        style={styles.inputBudget}
                        value={used ?? ''}
                        placeholder="0"
                        onChange={(e) => handleBudgetChange(pilot.id, e.target.value)}
                      />
                      <div style={{ ...styles.subtext, color: left < 0 - '#f87171' : '#38bdf8' }}>
                        Left: {left?.toLocaleString() || '---'}
                      </div>
                    </td>

                    <td style={styles.td}>
                      <div style={styles.bonusReadout}>{formatSignedSeconds(bBonus === null - null : -bBonus)}</div>
                    </td>

                    <td style={styles.td}>
                      <div style={styles.bonusStack}>
                        <BonusCheck
                          active={pilot.rover_bonus}
                          label="Rover"
                          onToggle={(c) => handleToggle(pilot.id, 'rover_bonus', c)}
                        />
                        <BonusCheck
                          active={pilot.return_bonus}
                          label="Return"
                          onToggle={(c) => handleToggle(pilot.id, 'return_bonus', c)}
                        />
                        <div style={styles.aestheticRow}>
                          <span>Style</span>
                          <input
                            type="number"
                            style={styles.smallInput}
                            value={pilot.aesthetics_bonus ?? ''}
                            onChange={(e) => handleAestheticsChange(pilot.id, e.target.value)}
                          />
                        </div>
                      </div>
                    </td>

                    <td style={styles.td}>
                      <select
                        style={styles.landingSelect(lStatus)}
                        value={lStatus}
                        onChange={(e) => handleLandingStatusChange(pilot.id, e.target.value)}
                      >
                        {LANDING_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={styles.td}>
                      <div style={styles.adjText}>{lStatus === 'dq' - 'DQ' : formatSignedSeconds(lAdj)}</div>
                    </td>

                    <td style={styles.td}>
                      <input
                        type="number"
                        style={styles.inputPenalty}
                        value={pilot.additional_penalty ?? ''}
                        placeholder="0"
                        onChange={(e) => handlePenaltyChange(pilot.id, e.target.value)}
                      />
                    </td>

                    <td style={styles.td}>
                      <div style={{ ...styles.monoScore, color: lStatus === 'dq' - '#f87171' : '#f8fafc' }}>
                        {final.label}
                      </div>
                    </td>

                    <td style={styles.td}>
                      <textarea
                        style={styles.notes}
                        value={pilot.judge_notes || ''}
                        placeholder="Notes"
                        onChange={(e) => handleNotesChange(pilot.id, e.target.value)}
                      />
                    </td>

                    <td style={styles.td}>
                      <button
                        style={styles.btnReview}
                        disabled={!pilot.peer_id}
                        onClick={() => setWatchingPeerId(pilot.peer_id)}
                      >
                        <Tv size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {watchingPeerId && <StreamViewer peerIdToWatch={watchingPeerId} onClose={() => setWatchingPeerId(null)} />}
    </div>
  );
}

function BonusCheck({ active, label, onToggle }) {
  return (
    <div
      style={{
        ...styles.bonusItem,
        opacity: active - 1 : 0.5,
        borderColor: active - 'rgba(56, 189, 248, 0.6)' : 'rgba(148, 163, 184, 0.25)',
        background: active - 'rgba(56, 189, 248, 0.12)' : 'rgba(2, 6, 23, 0.4)'
      }}
      onClick={() => onToggle(!active)}
    >
      <div style={{ ...styles.dot, backgroundColor: active - '#38bdf8' : '#94a3b8' }} />
      {label}
    </div>
  );
}

function getFlightData(pilot, now) {
  if (pilot.flight_duration) return { seconds: pilot.flight_duration, label: formatDuration(pilot.flight_duration), subLabel: 'Final' };
  if (pilot.land_time && pilot.start_time) {
    const s = Math.round((new Date(pilot.land_time).getTime() - new Date(pilot.start_time).getTime()) / 1000);
    return { seconds: s, label: formatDuration(s), subLabel: 'Final' };
  }
  if (pilot.start_time) {
    const s = Math.round((now - new Date(pilot.start_time).getTime()) / 1000);
    return { seconds: s, label: formatDuration(s), subLabel: 'In flight' };
  }
  return { seconds: null, label: '--:--', subLabel: 'Waiting' };
}

function formatDuration(s) {
  if (s === null) return '--:--';
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function formatWallTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatSignedSeconds(v) {
  if (v === null || isNaN(v)) return '---';
  return `${v > 0 - '+' : v < 0 - '' : ''}${v}s`;
}

function normalizeLandingStatus(v) {
  if (!v) return '';
  const n = v.toLowerCase();
  if (n.includes('soft') || n.includes('perfect')) return 'perfect_soft';
  if (n.includes('hard')) return 'hard';
  if (n.includes('crunch')) return 'crunch';
  if (n.includes('dq') || n.includes('exploded')) return 'dq';
  return '';
}

function getLandingAdjustmentSeconds(s) {
  if (s === 'perfect_soft') return -20;
  if (s === 'crunch') return 45;
  if (s === 'dq') return null;
  return 0;
}

function getFinalScore({ flightSeconds, budgetBonus, missionBonus, landingAdjustment, additionalPenalty, isDQ }) {
  if (isDQ || landingAdjustment === null) return { value: Infinity, label: 'DQ' };
  if (!flightSeconds) return { value: Infinity, label: '---' };
  const score = Math.round(
    flightSeconds - (budgetBonus || 0) - (missionBonus || 0) + (landingAdjustment || 0) + (additionalPenalty || 0)
  );
  return { value: score, label: `${score}s` };
}

function getScoreValue(p, now) {
  const f = getFlightData(p, now);
  const u = p.used_budget ?? null;
  const l = u === null - null : TOTAL_BUDGET - u;
  const bB = l === null - 0 : Math.max(0, Math.floor(l / BUDGET_BONUS_DIVISOR));
  const mB = (p.rover_bonus - ROVER_BONUS : 0) + (p.return_bonus - RETURN_BONUS : 0) + (p.aesthetics_bonus ?? 0);
  const lS = normalizeLandingStatus(p.landing_status);
  const final = getFinalScore({
    flightSeconds: f.seconds,
    budgetBonus: bB,
    missionBonus: mB,
    landingAdjustment: getLandingAdjustmentSeconds(lS),
    additionalPenalty: p.additional_penalty || 0,
    isDQ: lS === 'dq'
  });
  return final.value;
}

function getLandingRowStyle(s) {
  if (s === 'perfect_soft') return { backgroundColor: 'rgba(16, 185, 129, 0.08)', borderLeft: '4px solid #22c55e' };
  if (s === 'hard') return { backgroundColor: 'rgba(245, 158, 11, 0.05)', borderLeft: '4px solid #f59e0b' };
  if (s === 'crunch') return { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderLeft: '4px solid #ef4444' };
  if (s === 'dq') return { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderLeft: '4px solid #b91c1c' };
  return { borderLeft: '4px solid transparent' };
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0b1020',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
    padding: '24px',
    gap: '18px',
    position: 'relative',
    overflow: 'hidden'
  },
  background: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'radial-gradient(700px circle at 10% 10%, rgba(56, 189, 248, 0.16), transparent 60%), radial-gradient(500px circle at 80% 15%, rgba(99, 102, 241, 0.18), transparent 55%), linear-gradient(180deg, #0b1020 0%, #0b1220 100%)'
  },
  glowOne: {
    position: 'absolute',
    width: '420px',
    height: '420px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25), rgba(59, 130, 246, 0))',
    top: '8%',
    right: '12%',
    filter: 'blur(50px)',
    opacity: 0.8
  },
  glowTwo: {
    position: 'absolute',
    width: '520px',
    height: '520px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(236, 72, 153, 0.2), rgba(236, 72, 153, 0))',
    bottom: '-5%',
    left: '-8%',
    filter: 'blur(70px)',
    opacity: 0.7
  },
  header: {
    position: 'relative',
    zIndex: 1,
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '18px',
    padding: '18px 22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    backdropFilter: 'blur(16px)'
  },
  headerLeft: { display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' },
  titleGroup: { display: 'flex', gap: '12px', alignItems: 'center' },
  title: { fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.4px', color: '#f8fafc', margin: 0 },
  subtitle: { fontSize: '0.75rem', color: '#94a3b8' },

  sortBox: { display: 'flex', flexDirection: 'column', gap: '6px' },
  labelSmall: {
    fontSize: '0.65rem',
    color: '#94a3b8',
    fontWeight: 600,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  selectWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    padding: '6px 10px',
    borderRadius: '10px'
  },
  minimalSelect: {
    background: 'transparent',
    border: 'none',
    color: '#e2e8f0',
    fontWeight: 600,
    fontSize: '0.75rem',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none'
  },

  budgetStats: { display: 'flex', gap: '16px', alignItems: 'center' },
  budgetValue: { fontSize: '1.5rem', fontWeight: 700, color: '#38bdf8' },
  unit: { fontSize: '0.75rem', color: '#94a3b8' },

  tableCard: {
    position: 'relative',
    zIndex: 1,
    flex: 1,
    background: 'rgba(15, 23, 42, 0.6)',
    borderRadius: '18px',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    backdropFilter: 'blur(16px)',
    boxShadow: '0 24px 60px rgba(2, 6, 23, 0.5)'
  },
  scrollArea: { flex: 1, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '1100px' },
  thRow: {
    background: 'rgba(2, 6, 23, 0.7)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    backdropFilter: 'blur(12px)'
  },
  th: {
    padding: '14px 12px',
    textAlign: 'left',
    color: '#94a3b8',
    fontWeight: 600,
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.12)'
  },
  tr: { borderBottom: '1px solid rgba(148, 163, 184, 0.08)' },
  td: { padding: '14px 12px', verticalAlign: 'middle' },

  teamName: { fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem' },
  statusBadge: (s) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.6rem',
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: '999px',
    background: 'rgba(2, 6, 23, 0.6)',
    color: s === 'landed' - '#22c55e' : s === 'flying' - '#38bdf8' : s === 'crashed' - '#f87171' : '#f59e0b',
    border: '1px solid rgba(148, 163, 184, 0.2)'
  }),
  monoTime: { fontFamily: '"SF Mono", "SF Pro Text", monospace', fontSize: '1.05rem', fontWeight: 600 },
  subtext: { fontSize: '0.6rem', fontWeight: 600, marginTop: '2px', color: '#94a3b8' },
  wallTime: { color: '#cbd5f5', fontFamily: '"SF Mono", "SF Pro Text", monospace', fontSize: '0.8rem' },

  inputBudget: {
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    color: '#f8fafc',
    width: '90px',
    padding: '6px 8px',
    borderRadius: '8px',
    outline: 'none'
  },
  bonusReadout: { fontFamily: '"SF Mono", "SF Pro Text", monospace', fontWeight: 600, color: '#38bdf8' },

  bonusStack: { display: 'flex', flexDirection: 'column', gap: '6px' },
  bonusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid',
    fontSize: '0.65rem',
    fontWeight: 600,
    cursor: 'pointer',
    color: '#e2e8f0'
  },
  dot: { width: '6px', height: '6px', borderRadius: '50%' },
  aestheticRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', color: '#94a3b8' },
  smallInput: {
    width: '52px',
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    color: '#f8fafc',
    borderRadius: '8px',
    padding: '4px 6px',
    textAlign: 'center',
    outline: 'none'
  },

  landingSelect: (s) => ({
    background:
      s === 'perfect_soft'
        - 'rgba(16, 185, 129, 0.18)'
        : s === 'dq'
          - 'rgba(248, 113, 113, 0.2)'
          : 'rgba(2, 6, 23, 0.6)',
    color: '#f8fafc',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    padding: '6px 10px',
    borderRadius: '10px',
    fontWeight: 600,
    fontSize: '0.65rem',
    cursor: 'pointer'
  }),
  adjText: { fontWeight: 600, fontFamily: '"SF Mono", "SF Pro Text", monospace' },
  inputPenalty: {
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    color: '#f8fafc',
    width: '60px',
    textAlign: 'center',
    borderRadius: '8px',
    padding: '6px',
    outline: 'none'
  },

  monoScore: { fontFamily: '"SF Mono", "SF Pro Text", monospace', fontWeight: 700, fontSize: '1.2rem' },
  notes: {
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    color: '#e2e8f0',
    borderRadius: '8px',
    padding: '8px',
    fontSize: '0.7rem',
    width: '140px',
    height: '52px',
    resize: 'vertical'
  },
  btnReview: {
    background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
    color: '#0b1220',
    border: 'none',
    padding: '8px 10px',
    borderRadius: '10px',
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(56, 189, 248, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};
