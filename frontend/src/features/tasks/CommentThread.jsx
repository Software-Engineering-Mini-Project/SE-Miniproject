'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { formatRelative } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ErrorState, Skeleton } from '@/components/ui/States';

/** Task comments (TM-F-032). Text is rendered as text, never as HTML. */
export function CommentThread({ taskId }) {
  const comments = useQuery(`comments:${taskId}`, () => api.comments.list(taskId));
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);
  const remaining = LIMITS.commentMax - text.length;

  async function post() {
    if (!text.trim()) {
      setError('Write something before posting.');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const created = await api.comments.create(taskId, text.trim());
      comments.setData((list) => [...(list || []), created]);
      setText('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h3 id="comments-title" className="sheet-section-title">
        Comments{comments.data ? <span className="tabular"> · {comments.data.length}</span> : null}
      </h3>

      {comments.loading && !comments.data ? (
        <div className="comment-list">
          {[0, 1].map((i) => (
            <div key={i} className="comment">
              <Skeleton width={28} height={28} radius="50%" />
              <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                <Skeleton width="40%" height={12} />
                <Skeleton width="85%" height={12} />
              </div>
            </div>
          ))}
        </div>
      ) : comments.error ? (
        <ErrorState error={comments.error} title="Comments did not load" onRetry={comments.reload} />
      ) : comments.data.length === 0 ? (
        <p className="comments-empty">
          <MessageSquare size={16} aria-hidden="true" />
          No comments yet. Start the conversation.
        </p>
      ) : (
        <ol className="comment-list">
          {comments.data.map((comment) => (
            <li key={comment.id} className="comment">
              <Avatar user={comment.author} size="sm" />
              <div className="comment-body">
                <p className="comment-meta">
                  <span className="comment-author">{comment.author?.name || 'Former member'}</span>
                  <time dateTime={comment.createdAt}>{formatRelative(comment.createdAt)}</time>
                </p>
                <p className="comment-text">{comment.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form
        className="comment-composer"
        onSubmit={(event) => {
          event.preventDefault();
          post();
        }}
      >
        <label htmlFor={`comment-${taskId}`} className="visually-hidden">
          Add a comment
        </label>
        <textarea
          id={`comment-${taskId}`}
          className="textarea"
          rows={2}
          placeholder="Add a comment…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`comment-help-${taskId}`}
        />
        <div className="comment-composer-foot">
          <p id={`comment-help-${taskId}`} className={error || remaining < 0 ? 'field-error' : 'field-hint'} aria-live="polite">
            {error || (remaining < 100 ? `${remaining} characters left` : 'Ctrl + Enter to post')}
          </p>
          <Button type="submit" variant="primary" size="sm" loading={posting} disabled={remaining < 0}>
            Post
          </Button>
        </div>
      </form>
    </section>
  );
}
