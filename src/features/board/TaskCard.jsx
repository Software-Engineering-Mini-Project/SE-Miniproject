'use client';

import { forwardRef } from 'react';
import { ListChecks } from 'lucide-react';
import { AvatarStack } from '@/components/ui/Avatar';
import { DueTag, PriorityTag, RiskTag, TaskKey } from '@/components/ui/Tags';
import { isOverdue } from '@/lib/format';
import { checklistProgress } from '@/features/tasks/Checklist';

export const TaskCard = forwardRef(function TaskCard({ task, assignees = [], risk, placeholder, overlay, ...rest }, ref) {
  const progress = checklistProgress(task.checklist);
  return (
    <article
      ref={ref}
      className="task-card"
      data-placeholder={placeholder || undefined}
      data-overlay={overlay || undefined}
      data-done={task.status === 'Done' || undefined}
      data-overdue={isOverdue(task) || undefined}
      {...rest}
    >
      <div className="task-card-top">
        {task.key ? <TaskKey value={task.key} /> : null}
        <PriorityTag priority={task.priority} />
        <RiskTag risk={risk} />
      </div>
      <h3 className="task-card-title">{task.title}</h3>
      <div className="task-card-meta">
        <div className="task-card-facts">
          <DueTag task={task} />
          {progress ? (
            <span className="checklist-count" data-complete={progress.done === progress.total || undefined}>
              <ListChecks size={13} aria-hidden="true" />
              <span className="tabular">
                {progress.done}/{progress.total}
              </span>
              <span className="visually-hidden"> checklist items done</span>
            </span>
          ) : null}
        </div>
        <AvatarStack users={assignees} max={3} />
      </div>
    </article>
  );
});
