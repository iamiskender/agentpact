import React, { ReactNode } from 'react';
import { clsx } from 'clsx';

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-2xl border bg-white/90 backdrop-blur-sm shadow-sm',
        className
      )}
      style={{ borderColor: 'var(--border)' }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={clsx('px-5 pt-5 pb-3', className)}>
      {children}
    </div>
  );
}

export function CardBody({ children, className, style }: CardProps) {
  return (
    <div className={clsx('px-5 pb-5', className)} style={style}>
      {children}
    </div>
  );
}
