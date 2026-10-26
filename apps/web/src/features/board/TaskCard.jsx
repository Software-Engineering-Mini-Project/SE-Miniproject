'use client';

import { forwardRef } from 'react';
import { AvatarStack } from '@/components/ui/Avatar';
import { DueTag, PriorityTag } from '@/components/ui/Tags';
import { isOverdue } from '@/lib/format';

export const TaskCard = forwardRef(function TaskCard({ task, assignees = [], placeholder, overlay, ...rest }, ref) {
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
        <PriorityTag priority={task.priority} />
      </div>
      <h3 className="task-card-title">{task.title}</h3>
      <div className="task-card-meta">
        <DueTag task={task} />
        <AvatarStack users={assignees} max={3} />
      </div>
    </article>
  );
});
