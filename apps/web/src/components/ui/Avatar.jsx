import { initials } from '@/lib/format';

// Muted, high-contrast pairs; deterministic per user so a person keeps their colour.
const PALETTE = [
  ['#dfe6fb', '#1d3a8f'],
  ['#d9eee2', '#145230'],
  ['#fae6d3', '#7a2e0e'],
  ['#f4dede', '#7d1f1f'],
  ['#d8eef2', '#145d70'],
  ['#e9e6dc', '#433f39'],
  ['#e1ecd6', '#3d5f12'],
];

function colourFor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({ user, size = 'md', title, decorative = false }) {
  const [bg, ink] = colourFor(user?.id || user?.name);
  const label = title ?? user?.name ?? 'Unknown user';
  const a11y = decorative ? { 'aria-hidden': true } : { title: label, 'aria-label': label, role: 'img' };
  return (
    <span className="avatar" data-size={size} style={{ '--avatar-bg': bg, '--avatar-ink': ink }} {...a11y}>
      {initials(user?.name)}
    </span>
  );
}

// `decorative`: hide from assistive tech when the surrounding control already has a label
// (its visible initials would otherwise not match that label, WCAG 2.5.3).
export function AvatarStack({ users = [], max = 3, size = 'sm', decorative = false }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  if (users.length === 0) return null;
  const a11y = decorative ? { 'aria-hidden': true } : { 'aria-label': users.map((u) => u.name).join(', '), role: 'group' };
  return (
    <span className="avatar-stack" {...a11y}>
      {shown.map((user) => (
        <Avatar key={user.id} user={user} size={size} />
      ))}
      {extra > 0 ? (
        <span className="avatar" data-size={size} title={`${extra} more`} aria-label={`${extra} more`} role="img">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
