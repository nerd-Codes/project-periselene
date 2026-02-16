const TOTAL_BUDGET = 50000;
const BUDGET_BONUS_DIVISOR = 100;
const ROVER_BONUS = 60;
const RETURN_BONUS = 100;

const LANDING_STATUS_LABELS = {
  perfect_soft: 'Perfect Soft',
  hard: 'Hard',
  crunch: 'Crunch',
  dq: 'Disqualified',
  '': 'Not provided'
};

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestampMs(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : Number.POSITIVE_INFINITY;
}

function resolveFlightSeconds(row) {
  const explicitDuration = toFiniteNumber(row?.flight_duration);
  if (explicitDuration !== null) return Math.max(0, Math.round(explicitDuration));

  if (row?.start_time && row?.land_time) {
    const startMs = Date.parse(row.start_time);
    const endMs = Date.parse(row.land_time);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      const deltaSeconds = Math.round((endMs - startMs) / 1000);
      return Math.max(0, deltaSeconds);
    }
  }

  return null;
}

function formatSignedSeconds(value) {
  if (!Number.isFinite(value)) return 'Not provided';
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}s`;
  return `${rounded}s`;
}

function getLandingStatusLabel(status) {
  return LANDING_STATUS_LABELS[status] || LANDING_STATUS_LABELS[''];
}

export function normalizeLandingStatus(value) {
  if (!value) return '';
  const normalized = String(value).trim().toLowerCase();
  if (normalized.includes('soft') || normalized.includes('perfect')) return 'perfect_soft';
  if (normalized.includes('hard')) return 'hard';
  if (normalized.includes('crunch')) return 'crunch';
  if (normalized.includes('dq') || normalized.includes('exploded')) return 'dq';
  return '';
}

export function getLandingAdjustmentSeconds(status) {
  if (status === 'perfect_soft') return -20;
  if (status === 'crunch') return 20;
  if (status === 'dq') return null;
  return 0;
}

export function formatFlightSeconds(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(wholeSeconds / 60).toString().padStart(2, '0');
  const secondsPart = (wholeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secondsPart}`;
}

export function computeScoreBreakdown(row) {
  const flightSeconds = resolveFlightSeconds(row);
  const usedBudget = toFiniteNumber(row?.used_budget);
  const budgetLeft = usedBudget === null ? null : Math.round(TOTAL_BUDGET - usedBudget);
  const budgetBonus = budgetLeft === null
    ? null
    : Math.max(0, Math.floor(budgetLeft / BUDGET_BONUS_DIVISOR));

  const roverBonus = row?.rover_bonus === true ? ROVER_BONUS : 0;
  const returnBonus = row?.return_bonus === true ? RETURN_BONUS : 0;
  const aestheticsBonusRaw = toFiniteNumber(row?.aesthetics_bonus);
  const aestheticsBonus = aestheticsBonusRaw === null ? 0 : Math.max(0, Math.round(aestheticsBonusRaw));
  const missionBonus = roverBonus + returnBonus + aestheticsBonus;

  const landingStatus = normalizeLandingStatus(row?.landing_status);
  const landingAdjustment = getLandingAdjustmentSeconds(landingStatus);
  const additionalPenaltyRaw = toFiniteNumber(row?.additional_penalty);
  const additionalPenalty = additionalPenaltyRaw === null ? 0 : Math.max(0, Math.round(additionalPenaltyRaw));

  const isDisqualified = landingStatus === 'dq' || landingAdjustment === null;
  const budgetBonusForScore = budgetBonus ?? 0;
  const landingAdjustmentForScore = landingAdjustment ?? 0;

  let finalScoreValue = Number.POSITIVE_INFINITY;
  let finalScoreLabel = 'DQ';
  if (!isDisqualified && flightSeconds !== null) {
    finalScoreValue = Math.round(
      flightSeconds
      - budgetBonusForScore
      - missionBonus
      + landingAdjustmentForScore
      + additionalPenalty
    );
    finalScoreLabel = `${finalScoreValue}s`;
  } else if (!isDisqualified && flightSeconds === null) {
    finalScoreLabel = '---';
  }

  const totalBonus = budgetBonusForScore + missionBonus + Math.max(0, -landingAdjustmentForScore);
  const totalPenalty = Math.max(0, landingAdjustmentForScore) + additionalPenalty;

  return {
    flightSeconds,
    flightLabel: formatFlightSeconds(flightSeconds),
    usedBudget,
    budgetLeft,
    budgetBonus,
    budgetBonusLabel: budgetBonus === null ? 'Not provided' : `-${budgetBonus}s`,
    roverBonus,
    returnBonus,
    aestheticsBonus,
    missionBonus,
    landingStatus,
    landingStatusLabel: getLandingStatusLabel(landingStatus),
    landingAdjustment,
    landingAdjustmentLabel: landingAdjustment === null ? 'DQ' : formatSignedSeconds(landingAdjustment),
    additionalPenalty,
    additionalPenaltyLabel: formatSignedSeconds(additionalPenalty),
    totalBonus,
    totalPenalty,
    finalScoreValue,
    finalScoreLabel,
    isDisqualified
  };
}

export function buildRankedReport(rows = []) {
  const reportRows = Array.isArray(rows) ? rows : [];
  const enriched = reportRows.map((row) => ({
    row,
    breakdown: computeScoreBreakdown(row),
    createdAtMs: toTimestampMs(row?.created_at)
  }));

  enriched.sort((left, right) => {
    if (left.breakdown.finalScoreValue !== right.breakdown.finalScoreValue) {
      return left.breakdown.finalScoreValue - right.breakdown.finalScoreValue;
    }

    if (left.createdAtMs !== right.createdAtMs) {
      return left.createdAtMs - right.createdAtMs;
    }

    const leftName = left.row?.team_name || '';
    const rightName = right.row?.team_name || '';
    return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' });
  });

  return enriched.map((entry, index) => ({
    ...entry.row,
    ...entry.breakdown,
    rank: index + 1
  }));
}

