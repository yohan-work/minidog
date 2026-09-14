import { cx } from '@/lib/cx';
import styles from './Skeleton.module.scss';

interface SkeletonProps {
  /** CSS length; defaults to the full width of the parent. */
  width?: string;
  /** CSS length; match the text or element being replaced. */
  height?: string;
  className?: string;
}

/** Placeholder sized like the content it replaces, so loading causes no layout shift. */
export function Skeleton({ width, height, className }: SkeletonProps) {
  return <span aria-hidden className={cx(styles.skeleton, className)} style={{ width, height }} />;
}
