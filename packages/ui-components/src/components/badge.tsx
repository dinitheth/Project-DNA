/**
 * @module Badge
 * Small badge/tag component.
 */
import React from 'react';
import { cn } from '../utils/cn';

export interface BadgeProps {
  label: string;
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'neutral', className }) => {
  // TODO: implement badge variants
  return <span className={cn('badge', `badge-${variant}`, className)}>{label}</span>;
};
