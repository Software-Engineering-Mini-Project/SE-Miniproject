'use client';

import { forwardRef } from 'react';
import { ListChecks, Zap } from 'lucide-react';
import { AvatarStack } from '@/components/ui/Avatar';
import { DueTag, EpicProgress, LabelList, PointsBadge, PriorityTag, RiskTag, TaskKey, TypeIcon } from '@/components/ui/Tags';
import { isOverdue } from '@/lib/format';
import { checklistProgress } from '@/features/tasks/Checklist';
import { useWorkItems } from '@/features/tasks/work-item-context';

export const TaskCard = forwardRef(function TaskCard({ task, assignees = [], risk, placeholder, overlay, ...rest }, ref) {
  const progress = checklistProgress(task.checklist);
  const workItems = useWorkItems();
  const epic = task.epicId ? workItems.byId.get(task.epicId) : null;
  const isEpic = task.type === 'Epic';
  return (
    <article
      ref={ref}
      className="task-card"
      data-type={(task.type || 'Task').toLowerCase()}
      data-placeholder={placeholder || undefined}
      data-overlay={overlay || undefined}
      data-done={task.status === 'Done' || undefined}
      data-overdue={isOverdue(task) || undefined}
      {...rest}
    >
      <div className="task-card-top">
        <TypeIcon type={task.type} />
        {task.key ? <TaskKey value={task.key} /> : null}
        <PriorityTag priority={task.priority} />
        <RiskTag risk={risk} />
      </div>
      <h3 className="task-card-title">{task.title}</h3>
      {epic ? (
        <p className="task-card-epic">
          <Zap size={12} aria-hidden="true" />
          <span className="visually-hidden">In epic </span>
          <span className="task-card-epic-name">{epic.title}</span>
        </p>
      ) : null}
      {isEpic ? <EpicProgress progress={workItems.progress.get(task.id)} compact /> : null}
      <LabelList labels={task.labels} max={3} />
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
          <PointsBadge points={task.storyPoints} />
        </div>
        <AvatarStack users={assignees} max={3} />
      </div>
    </article>
  );
});
