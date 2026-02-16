import { useEffect, useMemo } from 'react';
import reportRows from '../data/participantsReport.json';
import { buildRankedReport } from '../lib/reportScoring';
import './Report.css';

const NOT_PROVIDED = 'Not provided';

function formatTimestamp(value) {
  if (!value) return NOT_PROVIDED;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NOT_PROVIDED;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return NOT_PROVIDED;
  return Math.round(Number(value)).toLocaleString('en-US');
}

function formatSignedSeconds(value, mode = 'plain') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return NOT_PROVIDED;
  const rounded = Math.round(Number(value));
  if (mode === 'penalty') {
    if (rounded > 0) return `+${rounded}s`;
    return `${rounded}s`;
  }
  return `-${Math.max(0, rounded)}s`;
}

function toStatusLabel(value) {
  if (!value) return NOT_PROVIDED;
  return String(value).replaceAll('_', ' ').toUpperCase();
}

function toLandingChipClass(status) {
  if (!status) return 'landing-chip landing-chip--unknown';
  return `landing-chip landing-chip--${status}`;
}

function ExternalLink({ href }) {
  if (!href) return <span className="detail-value detail-value--fallback">{NOT_PROVIDED}</span>;
  return (
    <a className="report-link" href={href} target="_blank" rel="noreferrer">
      {href}
    </a>
  );
}

function DetailRow({ label, value, note = false }) {
  const displayValue = value || <span className="detail-value detail-value--fallback">{NOT_PROVIDED}</span>;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <div className={`detail-value${note ? ' detail-value--note' : ''}`}>
        {displayValue}
      </div>
    </div>
  );
}

function MediaCard({ title, imageUrl, imageAlt, links }) {
  return (
    <div className="media-card">
      <h3 className="media-title">{title}</h3>
      {imageUrl ? (
        <img className="media-image" src={imageUrl} alt={imageAlt} loading="lazy" />
      ) : (
        <div className="media-fallback">Not provided</div>
      )}

      {links.map((link) => (
        <div className="media-link-row" key={link.label}>
          <span className="media-link-label">{link.label}</span>
          <div className="media-link-value">
            <ExternalLink href={link.url} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Report() {
  useEffect(() => {
    document.title = 'Project Periselene // Competition Report';
  }, []);

  const participants = useMemo(() => buildRankedReport(reportRows), []);

  const reportDateLabel = useMemo(() => {
    const timestamps = participants
      .map((participant) => Date.parse(participant.created_at))
      .filter((timestamp) => Number.isFinite(timestamp));

    if (timestamps.length === 0) return NOT_PROVIDED;
    return new Date(Math.max(...timestamps)).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }, [participants]);

  const disqualifiedCount = participants.filter((participant) => participant.isDisqualified).length;
  const scoredCount = participants.length - disqualifiedCount;

  return (
    <div className="report-page">
      <div className="report-bg-orb report-bg-orb-one" />
      <div className="report-bg-orb report-bg-orb-two" />

      <main className="report-shell">
        <section className="report-hero">
          <p className="report-eyebrow">Project Periselene</p>
          <h1 className="report-title">Competition Report</h1>
          <p className="report-subtitle">
            Final leaderboard and complete participant submissions, ordered by final score.
          </p>

          <div className="report-stat-grid">
            <div className="report-stat">
              <span className="report-stat-label">Participants</span>
              <span className="report-stat-value">{participants.length}</span>
            </div>
            <div className="report-stat">
              <span className="report-stat-label">Scored Entries</span>
              <span className="report-stat-value">{scoredCount}</span>
            </div>
            <div className="report-stat">
              <span className="report-stat-label">Snapshot Date</span>
              <span className="report-stat-value">{reportDateLabel}</span>
            </div>
          </div>
        </section>

        <section className="report-panel">
          <h2 className="section-title">Leaderboard</h2>
          <p className="section-subtitle">Sorted by final score (best time first, DQ entries last).</p>
          <div className="leaderboard-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Team</th>
                  <th>Final Score</th>
                  <th>Flight Time</th>
                  <th>Landing</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => (
                  <tr key={`${participant.rank}-${participant.team_name}-${participant.created_at}`}>
                    <td className="leaderboard-rank">#{participant.rank}</td>
                    <td>{participant.team_name || 'Unknown team'}</td>
                    <td>
                      <span className={`score-chip ${participant.isDisqualified ? 'score-chip--dq' : 'score-chip--ok'}`}>
                        {participant.finalScoreLabel}
                      </span>
                    </td>
                    <td>{participant.flightLabel}</td>
                    <td>
                      <span className={toLandingChipClass(participant.landingStatus)}>
                        {participant.landingStatusLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="report-panel">
          <h2 className="section-title">Participant Details</h2>
          <p className="section-subtitle">Every scoring and media detail from the final competition snapshot.</p>

          <div className="participant-list">
            {participants.map((participant, index) => (
              <article
                className="participant-card"
                key={`${participant.rank}-${participant.team_name}-${participant.created_at}`}
                style={{ '--card-delay': `${Math.min(index * 70, 700)}ms` }}
              >
                <header className="participant-card-head">
                  <div>
                    <p className="participant-rank">Rank #{participant.rank}</p>
                    <h3 className="participant-team">{participant.team_name || 'Unknown team'}</h3>
                    <div className="participant-status">Status: {toStatusLabel(participant.status)}</div>
                  </div>
                  <div className="participant-head-score">
                    <span className="participant-head-label">Final Score</span>
                    <span className={`score-chip ${participant.isDisqualified ? 'score-chip--dq' : 'score-chip--ok'}`}>
                      {participant.finalScoreLabel}
                    </span>
                  </div>
                </header>

                <div className="participant-grid">
                  <div className="details-grid">
                    <DetailRow label="Created At" value={formatTimestamp(participant.created_at)} />
                    <DetailRow label="Flight Start" value={formatTimestamp(participant.start_time)} />
                    <DetailRow label="Landing Time" value={formatTimestamp(participant.land_time)} />
                    <DetailRow
                      label="Flight Duration"
                      value={
                        participant.flightSeconds === null
                          ? NOT_PROVIDED
                          : `${participant.flightLabel} (${participant.flightSeconds}s)`
                      }
                    />
                    <DetailRow label="Used Budget" value={formatNumber(participant.usedBudget)} />
                    <DetailRow label="Budget Left" value={formatNumber(participant.budgetLeft)} />
                    <DetailRow label="Budget Bonus" value={participant.budgetBonusLabel} />
                    <DetailRow label="Rover Bonus" value={formatSignedSeconds(participant.roverBonus)} />
                    <DetailRow label="Return Bonus" value={formatSignedSeconds(participant.returnBonus)} />
                    <DetailRow label="Aesthetics Bonus" value={formatSignedSeconds(participant.aestheticsBonus)} />
                    <DetailRow label="Mission Bonus Total" value={formatSignedSeconds(participant.missionBonus)} />
                    <DetailRow label="Landing Status" value={participant.landingStatusLabel} />
                    <DetailRow label="Landing Adjustment" value={participant.landingAdjustmentLabel} />
                    <DetailRow label="Additional Penalty" value={participant.additionalPenaltyLabel} />
                    <DetailRow label="Total Bonuses Applied" value={formatSignedSeconds(participant.totalBonus)} />
                    <DetailRow label="Total Penalties Applied" value={formatSignedSeconds(participant.totalPenalty, 'penalty')} />
                    <DetailRow label="Judge Notes" note value={participant.judge_notes || NOT_PROVIDED} />
                  </div>

                  <div className="media-column">
                    <MediaCard
                      title="Blueprint"
                      imageUrl={participant.blueprint_url}
                      imageAlt={`${participant.team_name || 'Participant'} blueprint`}
                      links={[
                        { label: 'Blueprint Image URL', url: participant.blueprint_url },
                        { label: 'Blueprint Share URL', url: participant.blueprint_link }
                      ]}
                    />
                    <MediaCard
                      title="Landing Evidence"
                      imageUrl={participant.landing_frame_url}
                      imageAlt={`${participant.team_name || 'Participant'} landing frame`}
                      links={[
                        { label: 'Landing Image URL', url: participant.landing_frame_url }
                      ]}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
