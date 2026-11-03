import { Task } from '../models/index.js';
import { toApi } from '../utils/to-api.js';

function summarizeStages(now) {
  const today = now.toISOString().slice(0, 10);
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

export async function getProjectSummaries(projectIds, now) {
  if (projectIds.length === 0) return [];
  const rows = await Task.aggregate([
    { $match: { projectId: { $in: projectIds.map(String) } } },
    ...summarizeStages(now()),
  ]);
  return applySummaries(projectIds, rows);
}

export async function getDashboardData(projectIds, userId, now) {
  const normalizedIds = projectIds.map(String);
  if (normalizedIds.length === 0) return { projects: [], myTasks: [] };

  const [result] = await Task.aggregate([
    { $match: { projectId: { $in: normalizedIds } } },
    {
      $facet: {
        summaries: summarizeStages(now()),
        myTasks: [
          { $match: { assigneeIds: String(userId) } },
          { $sort: { dueDate: 1, createdAt: 1, _id: 1 } },
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
  };
}
