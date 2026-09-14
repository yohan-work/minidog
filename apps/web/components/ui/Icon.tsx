// One line-icon system (16px grid, 1.5 stroke). Icons support a label; they
// never carry meaning on their own.
const PATHS = {
  'chevron-down': 'M4 6l4 4 4-4',
  'arrow-left': 'M13 8H3m4-4L3 8l4 4',
  'arrow-right': 'M3 8h10M9 4l4 4-4 4',
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: 12 | 14 | 16;
  /** Accessible name; omit for decorative icons next to visible text. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 16, label, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
