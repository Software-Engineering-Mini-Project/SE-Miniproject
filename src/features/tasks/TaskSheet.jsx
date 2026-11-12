'use client';

import { useState } from 'react';
import { Link2, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { TASK_STATUSES } from '@/lib/constants';
import { formatDate, formatDue } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal, Sheet, SheetClose, SheetTitle } from '@/components/ui/Dialog';
import { DueTag, PriorityTag, RiskTag, StatusChip, TaskKey } from '@/components/ui/Tags';
import { Checklist } from './Checklist';
import { CommentThread } from './CommentThread';
import { TaskForm } from './TaskForm';
import './tasks.css';

/**
 * Task details in a side sheet: status for owners, managers and members (TM-F-012), edit/delete
 * for owners, managers and admins (TM-F-011), comments for everyone in the project (TM-F-032).
 * `permissions` comes from src/lib/permissions.js; `assignable` excludes viewers.
 */
const READ_ONLY = { edit: false, remove: false, status: false, comment: false, moderate: false };

export function TaskSheet({ task, members, assignable = members, permissions = READ_ONLY, risk, open, onOpenChange, onStatusChange, onUpdated, onDeleted, onChecklistChange }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!task) return null;
  const assignees = task.assigneeIds.map((id) => members.find((m) => m.id === id)).filter(Boolean);

  // The link uses the key (/browse/ALPHA-12), which keeps working if the project key changes.
  async function copyLink() {
    const url = `${window.location.origin}/browse/${encodeURIComponent(task.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link to ${task.key} copied.`);
    } catch {
      toast.error('Could not copy the link. Copy it from the address bar instead.');
    }
  }

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
          <div className="sheet-head-id">
            {task.key ? (
              <button type="button" className="task-key-copy" onClick={copyLink} title="Copy a link to this task">
                <TaskKey value={task.key} />
                <Link2 size={13} aria-hidden="true" />
                <span className="visually-hidden">Copy link to {task.key}</span>
              </button>
            ) : null}
            <StatusChip status={task.status} />
          </div>
          <div className="sheet-head-actions">
            {permissions.edit && !editing ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Edit
              </Button>
            ) : null}
            {permissions.remove && !editing ? (
              <Button variant="ghost" size="sm" iconOnly aria-label="Delete task" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </Button>
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
                members={[...assignable, ...members.filter((m) => task.assigneeIds.includes(m.id) && !assignable.includes(m))]}
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
                    {permissions.status ? (
                      <>
                        <label htmlFor="sheet-status" className="visually-hidden">
                          Status
                        </label>
                        <select id="sheet-status" className="select select-compact" value={task.status} onChange={(e) => onStatusChange(task.id, e.target.value)}>
                          {TASK_STATUSES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <StatusChip status={task.status} />
                    )}
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
                {risk ? (
                  <div>
                    <dt>Forecast</dt>
                    <dd className="task-forecast">
                      <span className="tabular">{Math.round(risk.probability * 100)}%</span> chance of finishing by the due date
                      <RiskTag risk={risk} />
                    </dd>
                  </div>
                ) : null}
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
              <Checklist
                task={task}
                canTick={permissions.status}
                canEdit={permissions.edit}
                onChange={(checklist, updatedAt) => onChecklistChange?.(task.id, checklist, updatedAt)}
              />
              <p className="task-stamps">
                Created {formatDate(task.createdAt)} · Updated {formatDate(task.updatedAt)}
              </p>

              <CommentThread taskId={task.id} canComment={permissions.comment} canModerate={permissions.moderate} />
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
