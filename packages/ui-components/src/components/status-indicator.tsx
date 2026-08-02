/**
 * @module StatusIndicator
 * Status dot + text component.
 */
import React from 'react';
import { cn } from '../utils/cn';

export interface StatusIndicatorProps {
  status: 'idle' | 'running' | 'success' | 'error';
  label: string;
  className?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, label, className }) => {
  // TODO: implement status indicator colors/icons
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={`status-dot-${status}`} />
      <span>{label}</span>
    </div>
  );
};
