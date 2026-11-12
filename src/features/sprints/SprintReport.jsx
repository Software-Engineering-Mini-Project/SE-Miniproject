'use client';

import { useId, useMemo, useState } from 'react';
import { TrendingDown } from 'lucide-react';
import { api } from '@/lib/api/client';
import { parseDueDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { orderSprints } from '@/lib/sprints';
import { velocity } from '@/lib/sprint-report';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { formatSprintDates } from './BacklogView';
import './sprints.css';

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const formatDay = (day) => dayFmt.format(parseDueDate(day));

// Burndown geometry (SVG user units; the SVG scales to its container's width).
const W = 640;
const H = 240;
const PAD = { top: 16, right: 76, bottom: 28, left: 36 };

function ChartTableToggle({ value, onChange, label }) {
  return (
    <div className="view-toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === 'chart'} onClick={() => onChange('chart')}>
        Chart
      </button>
      <button type="button" aria-pressed={value === 'table'} onClick={() => onChange('table')}>
        Table
      </button>
    </div>
  );
}

/**
 * Remaining work per day against the ideal line. Keyboard: focus the chart, then Left/Right (and
 * Home/End) step through the days; the values are announced and shown beside the chart.
 */
function Burndown({ report, unitLabel }) {
  const days = report.days;
  const plotted = days.filter((day) => day.remaining !== null);
  const [active, setActive] = useState(null);
  const describedBy = useId();
  const max = Math.max(1, ...days.map((day) => day.ideal), ...plotted.map((day) => day.remaining));
  const x = (index) => PAD.left + (days.length > 1 ? (index / (days.length - 1)) * (W - PAD.left - PAD.right) : 0);
  const y = (value) => PAD.top + (1 - value / max) * (H - PAD.top - PAD.bottom);
  const ticks = [0, Math.round(max / 2), max].filter((value, index, list) => list.indexOf(value) === index);
  const idealPath = days.map((day, index) => `${index ? 'L' : 'M'}${x(index)},${y(day.ideal)}`).join(' ');
  const remainingPath = plotted.map((day, index) => `${index ? 'L' : 'M'}${x(days.indexOf(day))},${y(day.remaining)}`).join(' ');
  const current = active ?? plotted.length - 1;
  const focusDay = plotted[current];
  const focusIndex = focusDay ? days.indexOf(focusDay) : -1;
  const last = plotted.at(-1);
  const describe = (day) => `${formatDay(day.date)}: ${plural(day.remaining, unitLabel)} remaining, ideal ${day.ideal}`;

  const onKeyDown = (event) => {
    if (!plotted.length) return;
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) setActive(Math.max(0, Math.min(plotted.length - 1, current + step)));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(plotted.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className="burndown">
      <ul className="chart-legend" aria-label="Legend">
        <li>
          <span className="line-swatch" data-series="remaining" aria-hidden="true" /> Remaining
        </li>
        <li>
          <span className="line-swatch" data-series="ideal" aria-hidden="true" /> Ideal
        </li>
      </ul>
      <div
        className="burndown-plot"
        role="group"
        tabIndex={0}
        aria-label={`Burndown in ${unitLabel}s. Use the left and right arrow keys to read each day.`}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="burndown-svg" aria-hidden="true" focusable="false">
          {ticks.map((value) => (
            <g key={value}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} />
              <text className="chart-axis-text" x={PAD.left - 8} y={y(value)} dy="0.32em" textAnchor="end">
                {value}
              </text>
            </g>
          ))}
          {[0, Math.floor((days.length - 1) / 2), days.length - 1].filter((value, index, list) => list.indexOf(value) === index).map((index) => (
            <text key={index} className="chart-axis-text" x={x(index)} y={H - 8} textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}>
              {formatDay(days[index].date)}
            </text>
          ))}
          <path className="burndown-ideal" d={idealPath} />
          {remainingPath ? <path className="burndown-remaining" d={remainingPath} /> : null}
          {plotted.map((day) => {
            const index = days.indexOf(day);
            return (
              <g key={day.date} onMouseEnter={() => setActive(plotted.indexOf(day))}>
                {/* A wide, invisible hit area per day, bigger than the mark. */}
                <rect className="chart-hit" x={x(index) - (W - PAD.left - PAD.right) / Math.max(2, days.length) / 2} y={PAD.top} width={(W - PAD.left - PAD.right) / Math.max(2, days.length)} height={H - PAD.top - PAD.bottom} />
                <circle className="burndown-dot" cx={x(index)} cy={y(day.remaining)} r={index === focusIndex ? 5 : 3.5} data-active={index === focusIndex || undefined} />
              </g>
            );
          })}
          {focusIndex >= 0 ? <line className="chart-crosshair" x1={x(focusIndex)} x2={x(focusIndex)} y1={PAD.top} y2={H - PAD.bottom} /> : null}
          {last ? (
            <text className="chart-direct-label" x={x(days.indexOf(last)) + 8} y={y(last.remaining)} dy="0.32em">
              Remaining
            </text>
          ) : null}
          <text className="chart-direct-label" data-series="ideal" x={x(days.length - 1) + 8} y={y(0)} dy="-0.4em">
            Ideal
          </text>
        </svg>
      </div>
      <p className="burndown-readout" id={describedBy} aria-live="polite">
        {focusDay ? describe(focusDay) : 'The burndown starts when the sprint starts.'}
      </p>
    </div>
  );
}

function BurndownTable({ report, unitLabel }) {
  return (
    <div className="insights-table-wrap">
      <table className="chart-table">
        <caption className="visually-hidden">Burndown by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Remaining ({unitLabel}s)</th>
            <th scope="col">Ideal</th>
          </tr>
        </thead>
        <tbody>
          {report.days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatDay(day.date)}</th>
              <td>{day.remaining ?? '—'}</td>
              <td>{day.ideal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Points committed and finished per completed sprint, values printed at each bar. */
function Velocity({ data, view }) {
  const max = Math.max(1, ...data.sprints.flatMap((item) => [item.committedPoints, item.completedPoints]));
  if (view === 'table') {
    return (
      <div className="insights-table-wrap">
        <table className="chart-table">
          <caption className="visually-hidden">Velocity: points per completed sprint</caption>
          <thead>
            <tr>
              <th scope="col">Sprint</th>
              <th scope="col">Committed</th>
              <th scope="col">Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.sprints.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.name}</th>
                <td>{item.committedPoints}</td>
                <td>{item.completedPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <ul className="chart-legend" aria-label="Legend">
        <li>
          <span className="chart-swatch" data-series="committed" aria-hidden="true" /> Committed
        </li>
        <li>
          <span className="chart-swatch" data-series="completed" aria-hidden="true" /> Completed
        </li>
      </ul>
      <ul className="velocity" aria-label="Points per completed sprint">
        {data.sprints.map((item) => (
          <li key={item.id} className="velocity-row" tabIndex={0} aria-label={`${item.name}: ${item.completedPoints} of ${plural(item.committedPoints, 'point')} committed completed`}>
            <span className="bar-label" aria-hidden="true">{item.name}</span>
            <span className="velocity-bars" aria-hidden="true">
              <span className="velocity-bar" data-series="committed" style={{ width: `${(item.committedPoints / max) * 100}%` }} />
              <span className="velocity-bar" data-series="completed" style={{ width: `${(item.completedPoints / max) * 100}%` }} />
            </span>
            <span className="velocity-values tabular" aria-hidden="true">
              {item.completedPoints}/{item.committedPoints}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div className="sprint-stat">
      <dt>{label}</dt>
      <dd>
        <span className="sprint-stat-value tabular">{value}</span>
        {detail ? <span className="sprint-stat-detail">{detail}</span> : null}
      </dd>
    </div>
  );
}

/**
 * Sprint report for the Insights view (issue #77): the burndown of a chosen sprint, what it
 * committed to, finished, gained and carried over, and the team's velocity across sprints.
 */
export function SprintReport({ sprints, tasks = [], onOpenTask }) {
  const started = useMemo(() => orderSprints(sprints).filter((sprint) => sprint.state !== 'planned'), [sprints]);
  const [chosen, setChosen] = useState(null);
  const [view, setView] = useState('chart');
  const [velocityView, setVelocityView] = useState('chart');
  const sprint = started.find((item) => item.id === chosen) ?? started[0] ?? null;
  const report = useQuery(sprint ? `sprints:report:${sprint.id}` : null, () => api.sprints.report(sprint.id));
  const velocityData = useMemo(() => velocity(sprints), [sprints]);
  if (!sprint) return null;
  const data = report.data?.sprintId === sprint.id ? report.data : null;
  const unitLabel = data?.unit === 'items' ? 'item' : 'point';
  const amount = (part) => (data.unit === 'points' ? plural(part.points, 'point') : plural(part.count, 'item'));
  const sprintsById = new Map(sprints.map((item) => [item.id, item]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return (
    <section className="panel insights-panel insights-wide sprint-report" aria-labelledby="sprint-report-title">
      <div className="insights-head">
        <div>
          <h2 id="sprint-report-title">
            <TrendingDown size={18} aria-hidden="true" /> Sprint report
          </h2>
          <p className="insights-sub">
            {formatSprintDates(sprint)} · {sprint.state === 'active' ? 'running now' : 'completed'}
            {data ? ` · burndown in ${unitLabel}s${data.unit === 'items' ? ' (no story points yet)' : ''}` : ''}
          </p>
        </div>
        <div className="sprint-report-controls">
          <label className="sprint-scope">
            <span>Sprint</span>
            <select className="select" value={sprint.id} onChange={(event) => setChosen(event.target.value)}>
              {started.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.state === 'active' ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </label>
          <ChartTableToggle value={view} onChange={setView} label="Show the burndown as" />
        </div>
      </div>

      {report.error && !data ? (
        <ErrorState error={report.error} title="The sprint report did not load" onRetry={report.reload} />
      ) : !data ? (
        <Skeleton height={260} radius="var(--radius)" />
      ) : (
        <>
          <dl className="sprint-stats">
            <Stat label="Committed" value={amount(data.committed)} detail={data.unit === 'points' ? plural(data.committed.count, 'item') : null} />
            <Stat label="Completed" value={amount(data.completed)} detail={data.unit === 'points' ? plural(data.completed.count, 'item') : null} />
            <Stat label="Added during the sprint" value={plural(data.added.count, 'item')} detail={data.removed.count ? `${data.removed.count} taken out` : null} />
            {sprint.state === 'completed' ? (
              <Stat
                label="Carried over"
                value={plural(data.carriedOver.count, 'item')}
                detail={data.carriedOver.count ? `to ${data.carriedOver.movedTo ? sprintsById.get(data.carriedOver.movedTo)?.name ?? 'another sprint' : 'the backlog'}` : null}
              />
            ) : (
              <Stat label="Days left" value={Math.max(0, data.days.filter((day) => day.remaining === null).length)} />
            )}
          </dl>
          {view === 'chart' ? <Burndown key={sprint.id} report={data} unitLabel={unitLabel} /> : <BurndownTable report={data} unitLabel={unitLabel} />}
          {data.added.count ? (
            <p className="insights-sub sprint-added">
              Added after the start:{' '}
              {data.added.taskIds.map((taskId, index) => (
                <span key={taskId}>
                  {index ? ', ' : ''}
                  <button type="button" className="sprint-added-link" onClick={() => onOpenTask?.(taskId)}>
                    {tasksById.get(taskId)?.key ?? tasksById.get(taskId)?.title ?? 'a deleted task'}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
        </>
      )}

      {velocityData.sprints.length ? (
        <div className="sprint-velocity">
          <div className="insights-head">
            <div>
              <h3>Velocity</h3>
              <p className="insights-sub">
                Points finished per sprint · {velocityData.average !== null ? `${velocityData.average} on average over the last ${plural(Math.min(3, velocityData.sprints.length), 'sprint')}` : ''}
              </p>
            </div>
            <ChartTableToggle value={velocityView} onChange={setVelocityView} label="Show velocity as" />
          </div>
          <Velocity data={velocityData} view={velocityView} />
        </div>
      ) : null}
    </section>
  );
}
