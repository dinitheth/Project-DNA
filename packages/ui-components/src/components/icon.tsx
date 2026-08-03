/**
 * @module Icon
 * Wrapper for VS Code codicon icons.
 */
import React from 'react';
import { cn } from '../utils/cn';

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, className }) => {
  // TODO: map name to codicon class
  return <i className={cn('codicon', `codicon-${name}`, className)} style={{ fontSize: size }} />;
};
