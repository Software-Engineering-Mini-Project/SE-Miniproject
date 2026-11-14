'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownToLine, ArrowUpToLine, CircleCheck, Flag, GripVertical, Inbox, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { formatDate, parseDueDate } from '@/lib/format';
import { SPRINT_STATE_LABELS, byRank, nextSprintDefaults, orderSprints, sprintTotals } from '@/lib/sprints';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { LabelList, PointsBadge, StatusChip, TaskKey, TypeIcon } from '@/components/ui/Tags';
import { CompleteSprintDialog, DeleteSprintDialog, SprintFormDialog } from './SprintDialogs';
import './sprints.css';

const BACKLOG = 'backlog';
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "14 Oct – 27 Oct 2026". */
export function formatSprintDates(sprint) {
  if (!sprint?.startDate || !sprint?.endDate) return '';
  return `${shortDate.format(parseDueDate(sprint.startDate))} – ${formatDate(parseDueDate(sprint.endDate))}`;
}

function daysLeft(sprint, today) {
  const days = Math.round((parseDueDate(sprint.endDate) - parseDueDate(today)) / 86_400_000);
  if (days < 0) return `Ended ${plural(-days, 'day')} ago`;
  if (days === 0) return 'Ends today';
  return `${plural(days, 'day')} left`;
}

function TotalsText({ tasks }) {
  const totals = sprintTotals(tasks);
  return (
    <>
      {plural(totals.count, 'item')}
      {totals.points ? ` · ${plural(totals.points, 'point')}` : ''}
      {totals.count ? ` · ${totals.done} done` : ''}
    </>
  );
}

function SortableRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id, data: { container: props.container }, disabled: !props.canPlan });
  return (
    <BacklogRow
      {...props}
      rowRef={setNodeRef}
      handleProps={{ ...attributes, ...listeners }}
      dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    />
  );
}

function BacklogRow({ task, container, membersById, canPlan, moveItems, onOpen, overlay = false, rowRef, handleProps, dragging, style }) {
  const name = task.key ?? task.title;
  const assignees = task.assigneeIds.map((id) => membersById.get(id)).filter(Boolean);
  return (
    <li ref={rowRef} className="backlog-row" data-dragging={dragging || undefined} data-overlay={overlay || undefined} style={style}>
      {canPlan ? (
        <button type="button" className="backlog-handle" {...handleProps} aria-label={`Reorder ${name}`} aria-describedby={overlay ? undefined : 'backlog-dnd-help'} tabIndex={overlay ? -1 : handleProps?.tabIndex}>
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}
      <TypeIcon type={task.type} />
      <TaskKey value={task.key} />
      <button type="button" className="backlog-title" onClick={() => onOpen(task.id)}>
        {task.title}
      </button>
      <span className="backlog-row-meta">
        <LabelList labels={task.labels} max={2} />
        <StatusChip status={task.status} />
        <PointsBadge points={task.storyPoints} />
        {assignees.length ? <AvatarStack users={assignees} max={2} /> : null}
      </span>
      {canPlan && !overlay ? (
        <Menu trigger={<Button iconOnly size="sm" variant="ghost" aria-label={`Plan ${name}`} />} triggerContent={<MoreHorizontal size={16} />} items={moveItems(task, container)} />
      ) : null}
    </li>
  );
}

function PlanSection({ id, title, headingLevelBadge, meta, goal, actions, tasks, membersById, canPlan, moveItems, onOpen, empty, state }) {
  const { setNodeRef, isOver } = useDroppable({ id: `container:${id}`, data: { container: id } });
  const headingId = `plan-${id}`;
  return (
    <section className="backlog-section" data-state={state} aria-labelledby={headingId}>
      <header className="backlog-section-head">
        <div className="backlog-section-title">
          <h2 id={headingId}>
            {title}
            {headingLevelBadge}
          </h2>
          {meta ? <p className="backlog-section-meta">{meta}</p> : null}
          {goal ? (
            <p className="backlog-goal">
              <Flag size={14} aria-hidden="true" />
              <span>
                <span className="visually-hidden">Sprint goal: </span>
                {goal}
              </span>
            </p>
          ) : null}
        </div>
        {actions ? <div className="backlog-section-actions">{actions}</div> : null}
      </header>
      <SortableContext id={id} items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="backlog-list" data-over={isOver || undefined} aria-labelledby={headingId}>
          {tasks.map((task) => (
            <SortableRow key={task.id} task={task} container={id} membersById={membersById} canPlan={canPlan} moveItems={moveItems} onOpen={onOpen} />
          ))}
          {tasks.length === 0 ? <li className="backlog-empty">{empty}</li> : null}
        </ol>
      </SortableContext>
    </section>
  );
}

function SprintRecord({ sprint, tasksById, sprintsById }) {
  const report = sprint.report ?? { completed: { taskIds: [], count: 0, points: 0 }, unfinished: { taskIds: [], count: 0, points: 0 }, movedTo: null };
  const total = report.completed.count + report.unfinished.count;
  const movedTo = report.movedTo ? sprintsById.get(report.movedTo)?.name ?? 'another sprint' : 'the backlog';
  return (
    <details className="sprint-record">
      <summary>
        <span className="sprint-record-name">{sprint.name}</span>
        <span className="sprint-record-meta">
          {formatSprintDates(sprint)} · Finished {report.completed.count} of {plural(total, 'item')}
          {report.completed.points || report.unfinished.points ? ` · ${report.completed.points} of ${plural(report.completed.points + report.unfinished.points, 'point')}` : ''}
        </span>
      </summary>
      <div className="sprint-record-body">
        {sprint.goal ? (
          <p className="backlog-goal">
            <Flag size={14} aria-hidden="true" />
            <span>
              <span className="visually-hidden">Sprint goal: </span>
              {sprint.goal}
            </span>
          </p>
        ) : null}
        {report.completed.count ? (
          <ul className="sprint-record-list" aria-label={`Finished in ${sprint.name}`}>
            {report.completed.taskIds.map((taskId) => {
              const task = tasksById.get(taskId);
              return (
                <li key={taskId}>
                  <CircleCheck size={14} aria-hidden="true" />
                  {task ? (
                    <>
                      <TaskKey value={task.key} /> {task.title}
                    </>
                  ) : (
                    <span className="muted">A task that was deleted later</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Nothing was finished in this sprint.</p>
        )}
        {report.unfinished.count ? (
          <p className="muted">
            {plural(report.unfinished.count, 'unfinished item')} moved to {movedTo}.
          </p>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The Backlog view (issue #76): the active and planned sprints above the ranked backlog, then the
 * record of completed sprints. Drag rows (or use each row's menu) to rank work and plan it into
 * sprints; Owners and Managers create, start, edit, complete and delete sprints.
 */
export function BacklogView({ project, tasks, allTasks, sprints, members, today, canPlan, canManage, onPlan, onOpen, onSprintsChange, filtered = false }) {
  const [activeId, setActiveId] = useState(null);
  const [form, setForm] = useState(null); // 'new' | sprint
  const [completing, setCompleting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const { open, completed } = useMemo(() => {
    const ordered = orderSprints(sprints);
    return { open: ordered.filter((sprint) => sprint.state !== 'completed'), completed: ordered.filter((sprint) => sprint.state === 'completed') };
  }, [sprints]);
  const sprintsById = useMemo(() => new Map(sprints.map((sprint) => [sprint.id, sprint])), [sprints]);
  const tasksById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
  const active = open.find((sprint) => sprint.state === 'active');

  // Each open sprint's tasks and the backlog, in rank order. Finished work outside sprints is
  // hidden from the backlog (it is on the board and in the list); completed sprints keep theirs.
  const { lists, hiddenDone } = useMemo(() => {
    const result = new Map([...open.map((sprint) => [sprint.id, []]), [BACKLOG, []]]);
    let hidden = 0;
    for (const task of byRank(tasks)) {
      const sprint = task.sprintId ? sprintsById.get(task.sprintId) : null;
      if (sprint?.state === 'completed') continue;
      const key = sprint ? sprint.id : BACKLOG;
      if (key === BACKLOG && task.status === 'Done') {
        hidden += 1;
        continue;
      }
      result.get(key)?.push(task);
    }
    return { lists: result, hiddenDone: hidden };
  }, [tasks, open, sprintsById]);

  const containerOf = (taskId) => [...lists].find(([, list]) => list.some((task) => task.id === taskId))?.[0] ?? null;
  const nameOf = (container) => (container === BACKLOG ? 'the backlog' : sprintsById.get(container)?.name ?? 'a sprint');

  /** Puts `taskId` at `index` of `container` and saves where that is between its neighbours. */
  function place(taskId, container, index) {
    const list = (lists.get(container) ?? []).filter((task) => task.id !== taskId);
    const at = Math.max(0, Math.min(index, list.length));
    const placement = { previousId: list[at - 1]?.id ?? null, nextId: list[at]?.id ?? null };
    if (container !== containerOf(taskId)) placement.sprintId = container === BACKLOG ? null : container;
    onPlan(taskId, placement);
  }

  function moveItems(task, container) {
    const list = lists.get(container) ?? [];
    const index = list.findIndex((item) => item.id === task.id);
    const items = [
      { label: 'Move to top', icon: ArrowUpToLine, disabled: index === 0, onSelect: () => place(task.id, container, 0) },
      { label: 'Move to bottom', icon: ArrowDownToLine, disabled: index === list.length - 1, onSelect: () => place(task.id, container, list.length) },
    ];
    const targets = [...open.map((sprint) => sprint.id), BACKLOG].filter((id) => id !== container);
    if (targets.length) items.push({ separator: true });
    for (const target of targets) {
      // Into a sprint at its bottom; back to the backlog at its top (the next thing to plan).
      const targetList = lists.get(target) ?? [];
      items.push({
        label: target === BACKLOG ? 'Move to the backlog' : `Move to ${sprintsById.get(target)?.name}`,
        onSelect: () => place(task.id, target, target === BACKLOG ? 0 : targetList.length),
      });
    }
    return items;
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const titleOf = (id) => {
    const task = tasksById.get(id);
    return task ? task.key ?? task.title : 'task';
  };
  const overContainer = (over) => over?.data.current?.container ?? null;
  const announcements = {
    onDragStart: ({ active: dragged }) => `Picked up ${titleOf(dragged.id)}. Use the up and down arrows to move it, Space to drop, Escape to cancel.`,
    onDragOver: ({ active: dragged, over }) => (over ? `${titleOf(dragged.id)} is in ${nameOf(overContainer(over))}${over.id !== `container:${overContainer(over)}` ? `, at ${titleOf(over.id)}` : ''}.` : `${titleOf(dragged.id)} is not over a list.`),
    onDragEnd: ({ active: dragged, over }) => (over ? `${titleOf(dragged.id)} dropped in ${nameOf(overContainer(over))}.` : `${titleOf(dragged.id)} dropped. No change.`),
    onDragCancel: ({ active: dragged }) => `Moving ${titleOf(dragged.id)} was cancelled.`,
  };

  function handleDragEnd({ active: dragged, over }) {
    setActiveId(null);
    if (!over) return;
    const from = containerOf(dragged.id);
    const to = overContainer(over);
    if (!from || !to) return;
    const target = lists.get(to) ?? [];
    if (over.id === `container:${to}`) {
      if (from !== to) place(dragged.id, to, target.length);
      return;
    }
    if (from === to) {
      const oldIndex = target.findIndex((task) => task.id === dragged.id);
      const newIndex = target.findIndex((task) => task.id === over.id);
      if (oldIndex === newIndex) return;
      const reordered = arrayMove(target, oldIndex, newIndex);
      const at = reordered.findIndex((task) => task.id === dragged.id);
      onPlan(dragged.id, { previousId: reordered[at - 1]?.id ?? null, nextId: reordered[at + 1]?.id ?? null });
      return;
    }
    place(dragged.id, to, target.findIndex((task) => task.id === over.id));
  }

  async function run(action, success) {
    try {
      await action();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(describeError(error));
      throw error;
    }
  }

  const sprintActions = (sprint) => {
    if (!canManage) return null;
    const list = lists.get(sprint.id) ?? [];
    const menu = [
      { label: 'Edit sprint', icon: Pencil, onSelect: () => setForm(sprint) },
      ...(sprint.state === 'planned' ? [{ separator: true }, { label: 'Delete sprint', icon: Trash2, tone: 'danger', onSelect: () => setDeleting(sprint) }] : []),
    ];
    return (
      <>
        {sprint.state === 'active' ? (
          <Button size="sm" variant="primary" onClick={() => setCompleting(sprint)}>
            <CircleCheck size={15} aria-hidden="true" /> Complete sprint
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => run(async () => {
              const started = await api.sprints.start(sprint.id);
              onSprintsChange((current) => current.map((item) => (item.id === started.id ? started : item)));
            }, `${sprint.name} started with ${plural(list.length, 'item')}.`).catch(() => {})}
          >
            <Play size={15} aria-hidden="true" /> Start sprint
          </Button>
        )}
        <Menu trigger={<Button iconOnly size="sm" variant="ghost" aria-label={`${sprint.name} options`} />} triggerContent={<MoreHorizontal size={16} />} items={menu} />
      </>
    );
  };

  const draggedTask = activeId ? tasksById.get(activeId) : null;
  const backlog = lists.get(BACKLOG) ?? [];

  return (
    <div className="backlog">
      {filtered ? <p className="backlog-note muted">Filters are on: only matching tasks are shown. Dropping a task places it between the visible ones.</p> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{ announcements, screenReaderInstructions: { draggable: '' } }}
        onDragStart={({ active: dragged }) => setActiveId(dragged.id)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <p id="backlog-dnd-help" className="visually-hidden">
          Press Space to pick the task up, the up and down arrow keys to move it within and between lists, and Space to drop it. Or use the task&apos;s Plan menu.
        </p>
        {open.map((sprint) => {
          const list = lists.get(sprint.id) ?? [];
          return (
            <PlanSection
              key={sprint.id}
              id={sprint.id}
              state={sprint.state}
              title={sprint.name}
              headingLevelBadge={<span className="sprint-state" data-state={sprint.state}>{SPRINT_STATE_LABELS[sprint.state]}</span>}
              meta={
                <>
                  {formatSprintDates(sprint)}
                  {sprint.state === 'active' ? ` · ${daysLeft(sprint, today)}` : ''} · <TotalsText tasks={list} />
                </>
              }
              goal={sprint.goal}
              actions={sprintActions(sprint)}
              tasks={list}
              membersById={membersById}
              canPlan={canPlan}
              moveItems={moveItems}
              onOpen={onOpen}
              empty={canPlan ? 'Drag tasks here from the backlog, or use a task’s Plan menu.' : 'No tasks planned yet.'}
            />
          );
        })}
        <PlanSection
          id={BACKLOG}
          state="backlog"
          title="Backlog"
          meta={
            <>
              <TotalsText tasks={backlog} />
              {hiddenDone ? ` · ${plural(hiddenDone, 'finished task')} not in a sprint hidden` : ''}
            </>
          }
          actions={canManage ? (
            <Button size="sm" onClick={() => setForm('new')}>
              <Plus size={15} aria-hidden="true" /> Create sprint
            </Button>
          ) : null}
          tasks={backlog}
          membersById={membersById}
          canPlan={canPlan}
          moveItems={moveItems}
          onOpen={onOpen}
          empty={
            <span className="backlog-empty-inner">
              <Inbox size={16} aria-hidden="true" /> The backlog is empty. New tasks land here.
            </span>
          }
        />
        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
          {draggedTask ? (
            <ul className="backlog-list backlog-overlay">
              <BacklogRow task={draggedTask} container={containerOf(draggedTask.id)} membersById={membersById} canPlan={canPlan} moveItems={() => []} onOpen={() => {}} overlay />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>

      {completed.length ? (
        <section className="backlog-completed" aria-labelledby="completed-sprints">
          <h2 id="completed-sprints">Completed sprints</h2>
          {completed.map((sprint) => (
            <SprintRecord key={sprint.id} sprint={sprint} tasksById={tasksById} sprintsById={sprintsById} />
          ))}
        </section>
      ) : null}

      <SprintFormDialog
        open={Boolean(form)}
        onOpenChange={(isOpen) => !isOpen && setForm(null)}
        sprint={form === 'new' ? null : form}
        defaults={nextSprintDefaults({ sprints, projectKey: project.key, projectName: project.name, today })}
        onSubmit={async (input) => {
          if (form === 'new') {
            const created = await api.sprints.create(project.id, input);
            onSprintsChange((current) => [...current, created]);
            toast.success(`${created.name} created. Drag tasks into it from the backlog.`);
          } else {
            const updated = await api.sprints.update(form.id, input);
            onSprintsChange((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            toast.success('Sprint updated.');
          }
        }}
      />
      <CompleteSprintDialog
        sprint={completing}
        tasks={completing ? lists.get(completing.id) ?? [] : []}
        plannedSprints={open.filter((sprint) => sprint.state === 'planned')}
        onOpenChange={(isOpen) => !isOpen && setCompleting(null)}
        onComplete={async (moveTo) => {
          const done = await api.sprints.complete(completing.id, moveTo);
          onSprintsChange((current) => current.map((item) => (item.id === done.id ? done : item)));
          toast.success(`${done.name} completed: ${done.report.completed.count} finished, ${done.report.unfinished.count} moved to ${nameOf(done.report.movedTo ?? BACKLOG)}.`);
        }}
      />
      <DeleteSprintDialog
        sprint={deleting}
        count={deleting ? (lists.get(deleting.id) ?? []).length : 0}
        onOpenChange={(isOpen) => !isOpen && setDeleting(null)}
        onDelete={() => run(async () => {
          await api.sprints.remove(deleting.id);
          onSprintsChange((current) => current.filter((item) => item.id !== deleting.id));
        }, 'Sprint deleted. Its tasks are back in the backlog.')}
      />
    </div>
  );
}
