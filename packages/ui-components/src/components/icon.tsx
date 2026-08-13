import { cn } from '../utils/cn.js';

export type IconName =
  'chevron-down' | 'chevron-right' | 'circle' | 'error' | 'info' | 'success' | 'warning';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  label?: string;
}

const paths: Record<IconName, string> = {
  'chevron-down': 'M4 6l4 4 4-4',
  'chevron-right': 'M6 4l4 4-4 4',
  circle: 'M8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  error: 'M8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-7v3m0 2h.01',
  info: 'M8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-5v3m0-5h.01',
  success: 'm4 8 2.5 2.5L12 5',
  warning: 'M8 3 2.5 13h11L8 3Zm0 3.5v3m0 1.5h.01',
};

export function Icon({ name, size = 16, className, label }: IconProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('inline-block shrink-0 fill-none stroke-current', className)}
      height={size}
      role={label ? 'img' : undefined}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}
