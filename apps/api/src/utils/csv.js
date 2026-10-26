const HEADERS = ['id', 'title', 'status', 'priority', 'dueDate', 'assignees', 'createdAt', 'updatedAt'];

function csvCell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[=+@\t\r-]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text.trim() !== text) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function tasksToCsv(tasks, usersById) {
  const rows = tasks.map((task) => [
    task.id,
    task.title,
    task.status,
    task.priority,
    task.dueDate,
    task.assigneeIds.map((id) => usersById.get(id)?.name).filter(Boolean).join('; '),
    task.createdAt.toISOString(),
    task.updatedAt.toISOString(),
  ]);
  return [HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
