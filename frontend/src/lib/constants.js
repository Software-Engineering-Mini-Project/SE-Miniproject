// Domain constants shared by the UI and the mock API (SRS §4, §10).

/** @typedef {'To Do' | 'In Progress' | 'Done'} TaskStatus */
/** @typedef {'High' | 'Medium' | 'Low'} TaskPriority */
/** @typedef {'Admin' | 'Lead' | 'Member'} UserRole */

/** @type {TaskStatus[]} */
export const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];

/** @type {TaskPriority[]} */
export const TASK_PRIORITIES = ['High', 'Medium', 'Low'];

/** @type {UserRole[]} */
export const USER_ROLES = ['Admin', 'Lead', 'Member'];

export const STATUS_META = {
  'To Do': { key: 'todo', label: 'To Do' },
  'In Progress': { key: 'progress', label: 'In Progress' },
  Done: { key: 'done', label: 'Done' },
};

export const PRIORITY_META = {
  High: { key: 'high', label: 'High', rank: 0 },
  Medium: { key: 'medium', label: 'Medium', rank: 1 },
  Low: { key: 'low', label: 'Low', rank: 2 },
};

export const LIMITS = {
  nameMax: 80,
  projectNameMax: 80,
  descriptionMax: 2000,
  taskTitleMax: 200,
  commentMax: 1000,
  passwordMin: 8,
  passwordMax: 128,
};

// Initial reminder rule proposal from SRS TM-F-031: due within 24 hours and not Done.
export const REMINDER_WINDOW_HOURS = 24;

/** Roles that may create projects and manage tasks (SRS §2.2). */
export const canManageProjects = (user) => user?.role === 'Admin' || user?.role === 'Lead';
