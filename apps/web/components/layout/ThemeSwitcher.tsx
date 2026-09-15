'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';
import {
  applyThemePreference,
  DEFAULT_THEME,
  readThemePreference,
  saveThemePreference,
  THEME_PREFERENCES,
  watchSystemTheme,
  type ThemePreference,
} from '@/lib/theme';
import styles from './ThemeSwitcher.module.scss';

const LABELS: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp']);
const NEXT = new Set(['ArrowRight', 'ArrowDown']);

/** System · Light · Dark, as a radio group (arrow keys move the choice). */
export function ThemeSwitcher() {
  // The server cannot know the saved choice; it is read after mounting.
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  useEffect(() => setPreference(readThemePreference()), []);

  useEffect(() => {
    if (preference !== 'system') return;
    return watchSystemTheme(() => applyThemePreference('system'));
  }, [preference]);

  const choose = (next: ThemePreference) => {
    setPreference(next);
    saveThemePreference(next);
    applyThemePreference(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!PREVIOUS.has(event.key) && !NEXT.has(event.key)) return;
    event.preventDefault();
    const count = THEME_PREFERENCES.length;
    const index = THEME_PREFERENCES.indexOf(preference ?? DEFAULT_THEME);
    const next = THEME_PREFERENCES[(index + (PREVIOUS.has(event.key) ? -1 : 1) + count) % count]!;
    choose(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-option="${next}"]`)?.focus();
  };

  const current = preference ?? DEFAULT_THEME;
  return (
    <div className={styles.switcher} role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown}>
      {THEME_PREFERENCES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          data-option={option}
          aria-checked={preference === option}
          tabIndex={current === option ? 0 : -1}
          className={cx(styles.option, preference === option && styles.selected)}
          onClick={() => choose(option)}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
