'use client';

import { AvatarStack } from '@/components/ui/Avatar';
import { DueTag, PriorityTag, RiskTag, StatusChip, TaskKey } from '@/components/ui/Tags';

/** Dense list view of tasks; rows open the task. Used on the project page and in search. */
export function TaskList({ tasks, membersById, projectsById, risk, onOpen }) {
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <li key={task.id}>
          <button type="button" className="task-row" onClick={() => onOpen(task)}>
            <span className="task-row-title">
              <strong>{task.title}</strong>
              {task.key || projectsById ? (
                <span className="task-row-project">
                  <TaskKey value={task.key} />
                  {task.key && projectsById ? ' · ' : null}
                  {projectsById ? projectsById.get(task.projectId)?.name : null}
                </span>
              ) : null}
            </span>
            <StatusChip status={task.status} />
            <span className="task-row-extra">
              <PriorityTag priority={task.priority} />
            </span>
            <span className="task-row-due">
              <DueTag task={task} />
              <RiskTag risk={risk?.get(task.id)} />
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
