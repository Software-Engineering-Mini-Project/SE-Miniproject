import { resolveToday } from '../../src/lib/dates.js';
import { Task } from '../models/index.js';
import { toApi } from '../utils/to-api.js';

function summarizeStages(today) {
  return [
    {
      $group: {
        _id: { projectId: '$projectId', status: '$status' },
        total: { $sum: 1 },
        overdue: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ['$status', 'Done'] }, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', today] }] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $group: {
        _id: '$_id.projectId',
        total: { $sum: '$total' },
        overdue: { $sum: '$overdue' },
        statusTotals: { $push: { k: '$_id.status', v: '$total' } },
      },
    },
  ];
}

function emptySummary(projectId) {
  return { projectId: String(projectId), total: 0, counts: { 'To Do': 0, 'In Progress': 0, Done: 0 }, overdue: 0 };
}

function applySummaries(projectIds, rows) {
  const results = new Map(projectIds.map((id) => [String(id), emptySummary(id)]));
  for (const row of rows) {
    const summary = results.get(String(row._id));
    if (!summary) continue;
    summary.total = row.total;
    summary.overdue = row.overdue;
    for (const { k, v } of row.statusTotals) summary.counts[k] = v;
  }
  return [...results.values()];
}

export async function getProjectSummaries(projectIds, now, clientToday) {
  if (projectIds.length === 0) return [];
  const rows = await Task.aggregate([
    { $match: { projectId: { $in: projectIds.map(String) } } },
    ...summarizeStages(resolveToday(clientToday, now())),
  ]);
  return applySummaries(projectIds, rows);
}

export async function getDashboardData(projectIds, userId, now, clientToday) {
  const normalizedIds = projectIds.map(String);
  const today = resolveToday(clientToday, now());
  const weekEnd = new Date(Date.parse(today + 'T00:00:00.000Z') + 7 * 86400000).toISOString().slice(0, 10);
  const emptyStats = { openAssigned: 0, dueIn7Days: 0, overdue: 0, completed: 0 };
  if (normalizedIds.length === 0) return { projects: [], myTasks: [], stats: emptyStats };

  const [result] = await Task.aggregate([
    { $match: { projectId: { $in: normalizedIds } } },
    {
      $facet: {
        summaries: summarizeStages(today),
        stats: [
          { $match: { assigneeIds: String(userId) } },
          { $group: { _id: null,
            openAssigned: { $sum: { $cond: [{ $ne: ['$status', 'Done'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } },
            overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'Done'] }, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', today] }] }, 1, 0] } },
            dueIn7Days: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'Done'] }, { $ne: ['$dueDate', null] }, { $gte: ['$dueDate', today] }, { $lte: ['$dueDate', weekEnd] }] }, 1, 0] } },
          } },
        ],
        myTasks: [
          { $match: { assigneeIds: String(userId), status: { $ne: 'Done' } } },
          { $addFields: { hasDue: { $cond: [{ $eq: ['$dueDate', null] }, 1, 0] } } },
          { $sort: { hasDue: 1, dueDate: 1, createdAt: 1, _id: 1 } },
          { $limit: 500 },
          {
            $project: {
              _id: 1,
              title: 1,
              description: 1,
              status: 1,
              priority: 1,
              dueDate: 1,
              projectId: 1,
              assigneeIds: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
      },
    },
  ]);

  return {
    projects: applySummaries(normalizedIds, result?.summaries ?? []),
    myTasks: (result?.myTasks ?? []).map(toApi),
    stats: result?.stats?.[0] ? (({ openAssigned, dueIn7Days, overdue, completed }) => ({ openAssigned, dueIn7Days, overdue, completed }))(result.stats[0]) : emptyStats,
  };
}
