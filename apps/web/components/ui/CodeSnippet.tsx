'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import styles from './CodeSnippet.module.scss';

/** A copyable block of configuration: what to paste, and where it goes. */
export function CodeSnippet({ title, code }: { title: string; code: string }) {
  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <CopyButton value={code} />
      </div>
      <pre className={styles.snippet}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * The clipboard is unavailable over plain http to anything but localhost, which
 * is how minidog is reached on a home server — so say when copying failed
 * instead of throwing, and leave the text there to select.
 */
export function CopyButton({ value }: { value: string }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (outcome: 'copied' | 'failed') => {
    setResult(outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(null), 2000);
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      title={result === 'failed' ? 'Select the text and copy it with your keyboard.' : undefined}
      onClick={() => {
        const written = navigator.clipboard?.writeText(value);
        if (!written) return show('failed');
        void written.then(
          () => show('copied'),
          () => show('failed'),
        );
      }}
    >
      {result === 'copied' ? 'Copied' : result === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  );
}
