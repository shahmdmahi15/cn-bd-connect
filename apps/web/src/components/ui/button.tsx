import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'success';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]';

    const variants = {
      default:
        'bg-blue-600 text-white shadow-md hover:bg-blue-700 focus-visible:ring-blue-500',
      destructive:
        'bg-red-600 text-white shadow-md hover:bg-red-700 focus-visible:ring-red-500',
      success:
        'bg-emerald-600 text-white shadow-md hover:bg-emerald-700 focus-visible:ring-emerald-500',
      outline:
        'border border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 focus-visible:ring-slate-400',
      secondary:
        'bg-slate-800 text-slate-100 hover:bg-slate-700 focus-visible:ring-slate-500',
      ghost:
        'bg-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white',
    };

    const sizes = {
      default: 'h-11 px-5 py-2 text-sm',
      sm: 'h-9 px-3 text-xs rounded-lg',
      lg: 'h-13 px-8 text-base rounded-2xl',
      icon: 'h-12 w-12 rounded-full',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
