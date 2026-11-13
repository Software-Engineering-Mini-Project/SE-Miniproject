const HEADERS = ['id', 'key', 'type', 'title', 'status', 'priority', 'storyPoints', 'labels', 'epic', 'dueDate', 'assignees', 'createdAt', 'updatedAt'];

function csvCell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[=+@\t\r-]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text.trim() !== text) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** `epicKeys` maps an epic's id to its key, for the `epic` column. */
export function tasksToCsv(tasks, usersById, epicKeys = new Map()) {
  const rows = tasks.map((task) => [
    task.id,
    task.key,
    task.type,
    task.title,
    task.status,
    task.priority,
    task.storyPoints,
    task.labels.join('; '),
    task.epicId ? epicKeys.get(task.epicId) ?? '' : '',
    task.dueDate,
    task.assigneeIds.map((id) => usersById.get(id)?.name).filter(Boolean).join('; '),
    task.createdAt.toISOString(),
    task.updatedAt.toISOString(),
  ]);
  return [HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
