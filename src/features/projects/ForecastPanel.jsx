'use client';

import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { MIN_COMPLETIONS, WINDOW_DAYS, weeklyThroughput } from '@/lib/forecast';
import { localToday } from '@/lib/dates';
import { formatDue, plural } from '@/lib/format';
import { RiskTag } from '@/components/ui/Tags';

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const toLocal = (dateOnly) => {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const WEEKS = WINDOW_DAYS / 7;

/** Today → P95 on one axis, with the three confidence levels marked and labelled. */
function FinishRange({ today, finish }) {
  const span = Math.max(1, daysBetween(today, finish.p95));
  const at = (date) => (daysBetween(today, date) / span) * 100;
  // Percentiles that land on the same day share one mark and one label ("50–95%").
  const marks = [];
  for (const [key, label, date] of [['p50', '50', finish.p50], ['p85', '85', finish.p85], ['p95', '95', finish.p95]]) {
    const same = marks.find((mark) => mark.date === date);
    if (same) same.labels.push(label);
    else marks.push({ key, date, labels: [label] });
  }
  return (
    <div className="forecast-range" aria-hidden="true">
      <div className="forecast-range-track">
        <span className="forecast-range-band" style={{ left: `${at(finish.p50)}%`, width: `${at(finish.p95) - at(finish.p50)}%` }} />
        {marks.map((mark) => (
          <span key={mark.key} className="forecast-range-mark" data-mark={mark.key} style={{ left: `${at(mark.date)}%` }} />
        ))}
      </div>
      <div className="forecast-range-labels">
        {at(marks[0].date) > 18 ? <span data-mark="today" style={{ left: '0%' }}>Today</span> : null}
        {marks.map((mark, index) => (
          <span
            key={mark.key}
            data-mark={mark.key}
            // A label too close to the previous one drops to a second line instead of overlapping.
            data-row={index > 0 && at(mark.date) - at(marks[index - 1].date) < 14 && index % 2 === 1 ? 2 : undefined}
            style={{ left: `${at(mark.date)}%` }}
          >
            {mark.labels.length > 1 ? `${mark.labels[0]}–${mark.labels.at(-1)}%` : `${mark.labels[0]}%`}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Completed tasks per week for the history window; the values are printed, so no axis is needed. */
function Throughput({ weeks }) {
  const max = Math.max(1, ...weeks.map((week) => week.count));
  return (
    <ol className="throughput" aria-label={`Tasks completed per week, last ${WEEKS} weeks`}>
      {weeks.map((week) => (
        <li key={week.weekEnding} className="throughput-week">
          <span className="throughput-value tabular">{week.count}</span>
          <span className="throughput-bar" aria-hidden="true">
            {week.count ? <span style={{ height: `${(week.count / max) * 100}%` }} /> : null}
          </span>
          <span className="throughput-label">
            <span className="visually-hidden">Week ending </span>
            {shortFmt.format(toLocal(week.weekEnding))}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Delivery forecast for a project (src/lib/forecast.js): a likely finish date with its spread,
 * the throughput it is based on, and the due dates it doubts.
 */
export function ForecastPanel({ forecast, tasks, onOpenTask }) {
  const today = localToday();
  const weeks = useMemo(() => weeklyThroughput(tasks, today, WEEKS), [tasks, today]);
  const atRisk = useMemo(() => {
    if (!forecast) return [];
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return [...forecast.risk.entries()]
      .filter(([, risk]) => risk.level !== 'on-track')
      .sort((a, b) => a[1].probability - b[1].probability)
      .map(([id, risk]) => ({ task: byId.get(id), risk }))
      .filter((entry) => entry.task);
  }, [forecast, tasks]);
  if (!forecast || forecast.state === 'empty') return null;

  const basis = `${plural(forecast.completedInWindow, 'task')} completed in the last ${WEEKS} weeks (${forecast.averagePerWeek} a week)`;

  return (
    <section className="panel insights-panel insights-wide forecast" aria-labelledby="forecast-title">
      <div className="insights-head">
        <div>
          <h2 id="forecast-title">
            <Gauge size={18} aria-hidden="true" /> Delivery forecast
          </h2>
          <p className="insights-sub">Based on {basis}</p>
        </div>
      </div>

      {forecast.state === 'complete' ? (
        <p className="forecast-note">Every task in this project is done.</p>
      ) : forecast.state === 'insufficient' ? (
        <p className="forecast-note">
          The forecast needs at least {MIN_COMPLETIONS} tasks completed in the last {WEEKS} weeks to learn this team&apos;s pace. So far:{' '}
          {forecast.completedInWindow}. It appears on its own once there is enough history.
        </p>
      ) : forecast.state === 'stalled' ? (
        <p className="forecast-note" data-tone="danger">
          At the recent pace, the {plural(forecast.remaining, 'open task')} would take more than a year. Finish or remove work, or add people, to bring this in.
        </p>
      ) : (
        <div className="forecast-body">
          <div className="forecast-hero">
            <p className="forecast-kicker">85% likely to be done by</p>
            <p className="forecast-date">{dayFmt.format(toLocal(forecast.finish.p85))}</p>
            <p className="forecast-spread">
              {plural(forecast.remaining, 'open task')} · 50% by {shortFmt.format(toLocal(forecast.finish.p50))} · 95% by{' '}
              {shortFmt.format(toLocal(forecast.finish.p95))}
            </p>
            <FinishRange today={today} finish={forecast.finish} />
          </div>
          <div className="forecast-history">
            <h3 className="forecast-subtitle">Completed per week</h3>
            <Throughput weeks={weeks} />
          </div>
        </div>
      )}

      {forecast.state === 'ready' ? (
        <div className="forecast-risks">
          <h3 className="forecast-subtitle">Due dates the forecast doubts</h3>
          {atRisk.length ? (
            <ul className="forecast-risk-list">
              {atRisk.map(({ task, risk }) => (
                <li key={task.id}>
                  <button type="button" className="forecast-risk" onClick={() => onOpenTask?.(task.id)}>
                    <span className="forecast-risk-title">{task.title}</span>
                    <span className="forecast-risk-due">{formatDue(task.dueDate)}</span>
                    <span className="forecast-risk-chance tabular">{Math.round(risk.probability * 100)}% chance</span>
                    <RiskTag risk={risk} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="forecast-note">Every dated open task is on track (85% or better).</p>
          )}
        </div>
      ) : null}

      <details className="forecast-method">
        <summary>How the forecast works</summary>
        <p>
          It replays this project&apos;s last {WINDOW_DAYS} days: each simulated day picks one of those days at random and completes as many
          tasks as the team did then. Running that {forecast.simulations ? forecast.simulations.toLocaleString() : 'thousands of'} times gives a
          range instead of a single guess. 85% means 85 of every 100 runs finished by that date.
        </p>
        <p>
          Open tasks are assumed to be picked up earliest due date first, work in progress before new work, then by priority. A task is
          flagged <strong>Tight</strong> below 85% and <strong>At risk</strong> below 50% chance of finishing by its due date. Overdue tasks are
          already marked overdue and are not forecast.
        </p>
      </details>
    </section>
  );
}
