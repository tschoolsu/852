import type { ComponentProps } from 'react';
import { Button as SharedButton } from 'tpass-ui';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
type Size = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
type Props = Omit<ComponentProps<typeof SharedButton>, 'variant' | 'size'> & {
  variant?: Variant;
  size?: Size;
};

const sharedVariant = {
  default: 'primary',
  outline: 'default',
  secondary: 'default',
  ghost: 'ghost',
  destructive: 'destructive',
  link: 'ghost',
} as const;

const sizes: Record<Size, string> = {
  default: 'min-h-8',
  xs: 'min-h-6 text-xs',
  sm: 'min-h-7 text-sm',
  lg: 'min-h-9',
  icon: 'size-8 !p-0',
  'icon-xs': 'size-6 !p-0',
  'icon-sm': 'size-7 !p-0',
  'icon-lg': 'size-9 !p-0',
};

export function Button({ variant = 'default', size = 'default', className, ...props }: Props) {
  return (
    <SharedButton
      data-slot="button"
      variant={sharedVariant[variant]}
      size={size === 'xs' || size === 'sm' || size.startsWith('icon') ? 'sm' : 'md'}
      className={cn(sizes[size], variant === 'link' && 'underline-offset-4 hover:underline', className)}
      {...props}
    />
  );
}
