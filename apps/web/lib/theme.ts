export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'minidog-theme';
/** Dark is the product's primary theme (docs/phase-01.md §19). */
export const DEFAULT_THEME: ThemePreference = 'dark';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Browser toolbar color per theme (--background-primary). */
export const THEME_COLORS: Record<Theme, string> = { light: '#ffffff', dark: '#0a0a0a' };

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Browser storage can be missing or blocked; the default applies then. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisted; the choice still applies to this page.
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

/**
 * Switches the tokens (every color is a CSS variable keyed on <html data-theme>)
 * and the browser toolbar color, which follows the chosen theme, not the OS.
 */
export function applyThemePreference(preference: ThemePreference): void {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  themeColorTag().content = THEME_COLORS[theme];
}

/**
 * Created by script rather than rendered by React: React would hydrate a
 * rendered tag back to its server content after the theme script retinted it.
 */
function themeColorTag(): HTMLMetaElement {
  let tag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = 'theme-color';
    document.head.append(tag);
  }
  return tag;
}

/** Calls `onChange` when the OS switches between light and dark. */
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(LIGHT_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * Inline in <head>: applies the saved theme before the first paint, so a page
 * never flashes dark before turning light (or the other way round).
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');if(p!=='system'&&p!=='light'&&p!=='dark')p='${DEFAULT_THEME}';var t=p==='system'?(matchMedia('${LIGHT_QUERY}').matches?'light':'dark'):p;document.documentElement.dataset.theme=t;var m=document.createElement('meta');m.name='theme-color';m.content=t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}';document.head.appendChild(m);}catch(e){}})();`;
