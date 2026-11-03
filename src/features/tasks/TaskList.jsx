'use client';

import { AvatarStack } from '@/components/ui/Avatar';
import { DueTag, PriorityTag, StatusChip } from '@/components/ui/Tags';

/** Dense list view of tasks; rows open the task. Used on the project page and in search. */
export function TaskList({ tasks, membersById, projectsById, onOpen }) {
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <li key={task.id}>
          <button type="button" className="task-row" onClick={() => onOpen(task)}>
            <span className="task-row-title">
              <strong>{task.title}</strong>
              {projectsById ? <span className="task-row-project">{projectsById.get(task.projectId)?.name}</span> : null}
            </span>
            <StatusChip status={task.status} />
            <span className="task-row-extra">
              <PriorityTag priority={task.priority} />
            </span>
            <span className="task-row-due">
              <DueTag task={task} />
            </span>
            <span className="task-row-extra">
              <AvatarStack users={task.assigneeIds.map((id) => membersById?.get(id)).filter(Boolean)} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
