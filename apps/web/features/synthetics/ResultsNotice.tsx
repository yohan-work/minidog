import type { ApiErrorBody } from '@minidog/types';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';

/** Metadata loaded, but check results could not be queried. */
export function ResultsNotice({ error, onRetry }: { error: ApiErrorBody | null | undefined; onRetry: () => void }) {
  if (!error) return null;
  return (
    <Notice
      tone="error"
      title="Unable to query check results."
      action={
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {error.message} Monitor status is shown as Unknown until results are available.
    </Notice>
  );
}
