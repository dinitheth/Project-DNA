/**
 * @module SectionHeader
 * Section header with optional action button.
 */
import React from 'react';
import { cn } from '../utils/cn';

export interface SectionHeaderProps {
  title: string;
  action?: React.ReactNode;
  onAction?: () => void;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, action, onAction, className }) => {
  // TODO: implement section header layout
  return (
    <div className={cn("flex justify-between items-center", className)}>
      <h3>{title}</h3>
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  );
};
