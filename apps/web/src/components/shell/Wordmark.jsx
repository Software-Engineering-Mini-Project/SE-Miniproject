import { APP_NAME } from '@/lib/brand';

/** The mark is three bars of different lengths: the three board columns. */
export function Wordmark({ size = 22 }) {
  return (
    <span className="wordmark">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="3" width="5" height="18" rx="1.5" fill="var(--ink)" />
        <rect x="9.5" y="3" width="5" height="12" rx="1.5" fill="var(--accent)" />
        <rect x="17" y="3" width="5" height="7" rx="1.5" fill="var(--ink)" opacity="0.35" />
      </svg>
      <span className="wordmark-text">{APP_NAME}</span>
    </span>
  );
}
