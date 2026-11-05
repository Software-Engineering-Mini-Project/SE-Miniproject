import { Button } from './Button';

export function RefreshNotice({ onRetry }) {
  return <div className="refresh-notice" role="status"><span>Couldn&apos;t refresh.</span> <Button size="sm" variant="ghost" onClick={onRetry}>Retry</Button></div>;
}
