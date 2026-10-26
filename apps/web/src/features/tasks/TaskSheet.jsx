'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { TASK_STATUSES } from '@/lib/constants';
import { formatDate, formatDue } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal, Sheet, SheetClose, SheetTitle } from '@/components/ui/Dialog';
import { DueTag, PriorityTag, StatusChip } from '@/components/ui/Tags';
import { CommentThread } from './CommentThread';
import { TaskForm } from './TaskForm';
import './tasks.css';

/**
 * Task details in a side sheet: status for any member (TM-F-012), edit/delete for the
 * project lead or an admin (TM-F-011), comments (TM-F-032).
 */
export function TaskSheet({ task, members, canManage, open, onOpenChange, onStatusChange, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [task?.id]);

  if (!task) return null;
  const assignees = task.assigneeIds.map((id) => members.find((m) => m.id === id)).filter(Boolean);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.tasks.remove(task.id);
      toast.success('Task deleted.');
      setConfirmDelete(false);
      onDeleted(task.id);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <div className="sheet-head">
          <StatusChip status={task.status} />
          <div className="sheet-head-actions">
            {canManage && !editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button variant="ghost" size="sm" iconOnly aria-label="Delete task" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} />
                </Button>
              </>
            ) : null}
            <SheetClose render={<Button variant="ghost" size="sm" iconOnly aria-label="Close task details" />}>
              <X size={16} />
            </SheetClose>
          </div>
        </div>

        <div className="sheet-body">
          {editing ? (
            <>
              <SheetTitle className="sheet-title">Edit task</SheetTitle>
              <TaskForm
                initial={task}
                members={members}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (payload) => {
                  const updated = await api.tasks.update(task.id, payload);
                  onUpdated(updated);
                  setEditing(false);
                  toast.success('Task updated.');
                }}
              />
            </>
          ) : (
            <>
              <SheetTitle className="sheet-title">{task.title}</SheetTitle>

              <dl className="task-facts">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <label htmlFor="sheet-status" className="visually-hidden">
                      Status
                    </label>
                    <select id="sheet-status" className="select select-compact" value={task.status} onChange={(e) => onStatusChange(task.id, e.target.value)}>
                      {TASK_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>
                    <PriorityTag priority={task.priority} />
                  </dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{task.dueDate ? <DueTag task={task} /> : <span className="muted">{formatDue(null)}</span>}</dd>
                </div>
                <div>
                  <dt>Assignees</dt>
                  <dd>
                    {assignees.length ? (
                      <ul className="assignee-list">
                        {assignees.map((member) => (
                          <li key={member.id}>
                            <Avatar user={member} size="sm" />
                            <span>{member.name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">Unassigned</span>
                    )}
                  </dd>
                </div>
              </dl>

              {task.description ? <p className="task-description">{task.description}</p> : null}
              <p className="task-stamps">
                Created {formatDate(task.createdAt)} · Updated {formatDate(task.updatedAt)}
              </p>

              <CommentThread taskId={task.id} />
            </>
          )}
        </div>
      </Sheet>

      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description="Its comments and notifications are deleted too. This cannot be undone."
      >
        <p className="confirm-subject">{task.title}</p>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Keep task
          </Button>
          <Button variant="danger" loading={deleting} onClick={handleDelete}>
            Delete task
          </Button>
        </div>
      </Modal>
    </>
  );
}
