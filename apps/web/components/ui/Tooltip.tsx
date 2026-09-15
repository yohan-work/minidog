'use client';

import { cloneElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import styles from './Tooltip.module.scss';

interface TooltipProps {
  content: ReactNode;
  /** A focusable element; it receives `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom';
}

/** Shows on hover and keyboard focus; Escape dismisses. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens to events bubbling from the focusable child; the wrapper itself is not interactive.
    <span
      className={styles.anchor}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className={styles.tooltip} data-side={side} data-open={open || undefined}>
        {content}
      </span>
    </span>
  );
}
