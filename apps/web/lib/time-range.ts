'use client';

import { DEFAULT_TIME_RANGE, isTimeRange, type TimeRange } from '@minidog/types';
import { useSearchParams } from 'next/navigation';

export { withRange } from './range-href';

/** The time range is shared across screens through the `?range=` query parameter. */
export function useTimeRange(): TimeRange {
  const value = useSearchParams().get('range');
  return isTimeRange(value) ? value : DEFAULT_TIME_RANGE;
}
