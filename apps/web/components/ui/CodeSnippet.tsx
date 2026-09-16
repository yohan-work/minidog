'use client';

import { useState } from 'react';
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

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
