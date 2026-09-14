import type { InputHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import styles from './Input.module.scss';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Technical values (URLs, status codes) use Geist Mono. */
  mono?: boolean;
  invalid?: boolean;
}

export function Input({ mono, invalid, className, ...rest }: InputProps) {
  return (
    <input className={cx(styles.input, mono && styles.mono, className)} aria-invalid={invalid || undefined} {...rest} />
  );
}
