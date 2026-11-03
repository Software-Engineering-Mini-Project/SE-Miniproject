import { Skeleton } from '@/components/ui/States';

export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton width="28%" height={28} />
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        <Skeleton height={72} radius="var(--radius-lg)" />
        <Skeleton height={72} radius="var(--radius-lg)" />
        <Skeleton height={72} radius="var(--radius-lg)" />
      </div>
    </div>
  );
}
