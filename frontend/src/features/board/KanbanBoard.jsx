'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { STATUS_META, TASK_STATUSES } from '@/lib/constants';
import { TaskCard } from './TaskCard';
import './board.css';

// Keyboard: Space picks a card up, Left/Right jump a whole column, Space/Enter drops, Escape cancels.
const keyboardCodes = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };

function columnCoordinates(event, { context }) {
  const { active, collisionRect, droppableRects, over } = context;
  if (!active || !collisionRect) return undefined;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return undefined;
  event.preventDefault();
  const current = TASK_STATUSES.indexOf(over?.id ?? active.data.current?.status);
  const step = event.code === 'ArrowRight' || event.code === 'ArrowDown' ? 1 : -1;
  const target = TASK_STATUSES[Math.min(TASK_STATUSES.length - 1, Math.max(0, current + step))];
  const rect = droppableRects.get(target);
  if (!rect) return undefined;
  return { x: rect.left + rect.width / 2 - collisionRect.width / 2, y: rect.top + 56 };
}

const dropAnimation = { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' };

function DraggableCard({ task, assignees, onOpen, canDrag }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status, title: task.title },
    disabled: !canDrag,
  });

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      assignees={assignees}
      placeholder={isDragging}
      {...attributes}
      {...listeners}
      aria-roledescription={canDrag ? 'draggable task' : undefined}
      aria-describedby={canDrag ? 'board-dnd-help' : undefined}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        if (event.key === 'Enter' && !event.defaultPrevented) onOpen(task.id);
      }}
    />
  );
}

function Column({ status, tasks, membersById, onOpen, canCreate, onCreate, canDrag }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = STATUS_META[status];
  const headingId = `column-${meta.key}`;

  return (
    <section className="board-column" data-over={isOver || undefined} aria-labelledby={headingId}>
      <header className="board-column-head">
        <h2 id={headingId} className="board-column-title">
          <span className="board-column-dot" data-status={meta.key} aria-hidden="true" />
          {meta.label}
          <span className="board-column-count tabular" aria-label={`${tasks.length} tasks`}>
            {tasks.length}
          </span>
        </h2>
        {canCreate ? (
          <button type="button" className="btn" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Add task to ${meta.label}`} onClick={() => onCreate(status)}>
            <span className="btn-label">
              <Plus size={16} />
            </span>
          </button>
        ) : null}
      </header>
      <div ref={setNodeRef} className="board-column-body">
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            assignees={task.assigneeIds.map((id) => membersById.get(id)).filter(Boolean)}
            onOpen={onOpen}
            canDrag={canDrag}
          />
        ))}
        {tasks.length === 0 ? <p className="board-column-empty">{isOver ? 'Drop to move here' : 'No tasks'}</p> : null}
      </div>
    </section>
  );
}

/**
 * Three-column board (TM-F-023). Columns are driven only by persisted status; `onMove`
 * is responsible for the optimistic update and rollback.
 */
export function KanbanBoard({ tasks, members, onMove, onOpen, canCreate, onCreate, canDrag = true }) {
  const [activeId, setActiveId] = useState(null);
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const byStatus = useMemo(() => {
    const groups = Object.fromEntries(TASK_STATUSES.map((s) => [s, []]));
    tasks.forEach((task) => groups[task.status]?.push(task));
    return groups;
  }, [tasks]);
  const activeTask = tasks.find((t) => t.id === activeId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates, keyboardCodes }),
  );

  const titleOf = (id) => tasks.find((t) => t.id === id)?.title ?? 'task';
  const announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}. Use left and right arrows to change column, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${over.id}.` : `${titleOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${titleOf(active.id)} moved to ${over.id}.` : `${titleOf(active.id)} dropped. No change.`),
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements, screenReaderInstructions: { draggable: '' } }}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        const from = active.data.current?.status;
        if (over && over.id !== from) onMove(active.id, over.id);
      }}
    >
      <p id="board-dnd-help" className="visually-hidden">
        Press Enter to open the task. Press Space to pick it up, then use the left and right arrow keys to move it between columns and Space to drop it.
      </p>
      <div className="board">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={byStatus[status]}
            membersById={membersById}
            onOpen={onOpen}
            canCreate={canCreate}
            onCreate={onCreate}
            canDrag={canDrag}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeTask ? (
          <TaskCard task={activeTask} assignees={activeTask.assigneeIds.map((id) => membersById.get(id)).filter(Boolean)} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
