'use client';

import { useMemo, useState } from 'react';
import { BarList, StackedBars, StatusLegend } from '@/components/charts/Charts';
import { TASK_STATUSES } from '@/lib/constants';
import { localToday } from '@/lib/dates';
import { completionPercent, dueBuckets, priorityCounts, workloadByMember } from '@/lib/insights';
import { plural } from '@/lib/format';

/** Project "Insights" view: who carries the work, how urgent it is, and when it is due. */
export function ProjectInsights({ tasks, members }) {
  const [workloadView, setWorkloadView] = useState('chart');
  const today = localToday();
  const workload = useMemo(() => workloadByMember(tasks, members, today), [tasks, members, today]);
  const due = useMemo(() => dueBuckets(tasks, today).map((b) => (b.key === 'overdue' ? { ...b, tone: 'danger' } : b)), [tasks, today]);
  const priorities = useMemo(() => priorityCounts(tasks), [tasks]);
  const openCount = tasks.filter((task) => task.status !== 'Done').length;
  const percent = completionPercent(tasks);

  return (
    <div className="insights">
      <section className="panel insights-panel insights-wide" aria-labelledby="workload-title">
        <div className="insights-head">
          <div>
            <h2 id="workload-title">Workload by member</h2>
            <p className="insights-sub">
              {percent}% of {plural(tasks.length, 'task')} done · a task with two assignees counts for both
            </p>
          </div>
          <div className="view-toggle" role="group" aria-label="Show workload as">
            <button type="button" aria-pressed={workloadView === 'chart'} onClick={() => setWorkloadView('chart')}>
              Chart
            </button>
            <button type="button" aria-pressed={workloadView === 'table'} onClick={() => setWorkloadView('table')}>
              Table
            </button>
          </div>
        </div>
        {workloadView === 'chart' ? (
          <>
            <StatusLegend className="insights-legend" />
            <StackedBars rows={workload} label="Tasks per member by status" />
          </>
        ) : (
          <div className="insights-table-wrap">
            <table className="chart-table">
              <caption className="visually-hidden">Tasks per member by status</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  {TASK_STATUSES.map((status) => (
                    <th key={status} scope="col">
                      {status}
                    </th>
                  ))}
                  <th scope="col">Overdue</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.name}</th>
                    {TASK_STATUSES.map((status) => (
                      <td key={status}>{row.counts[status]}</td>
                    ))}
                    <td>{row.overdue}</td>
                    <td>{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel insights-panel" aria-labelledby="due-title">
        <div className="insights-head">
          <div>
            <h2 id="due-title">When open work is due</h2>
            <p className="insights-sub">{plural(openCount, 'open task')}</p>
          </div>
        </div>
        <BarList items={due} label="Open tasks by due date" />
      </section>

      <section className="panel insights-panel" aria-labelledby="priority-title">
        <div className="insights-head">
          <div>
            <h2 id="priority-title">Open work by priority</h2>
            <p className="insights-sub">{plural(openCount, 'open task')}</p>
          </div>
        </div>
        <BarList items={priorities} label="Open tasks by priority" />
      </section>
    </div>
  );
}
