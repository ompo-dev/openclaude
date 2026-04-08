import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1f6feb] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-[#2f6f3e] bg-[#238636] text-white hover:bg-[#2ea043]',
        destructive:
          'border border-[#da3633] bg-[#da3633] text-white hover:bg-[#f85149]',
        outline:
          'border border-[#30363d] bg-[#161b22] text-[#e6edf3] hover:border-[#3d444d] hover:bg-[#21262d]',
        secondary:
          'border border-[#30363d] bg-[#21262d] text-[#e6edf3] hover:border-[#3d444d] hover:bg-[#30363d]',
        ghost:
          'rounded-lg border border-transparent bg-transparent text-[#7d8590] hover:bg-[#21262d] hover:text-[#e6edf3]',
        codex:
          'rounded-lg border border-[#30363d] bg-[#161b22] text-[#e6edf3] hover:border-[#3d444d] hover:bg-[#21262d]',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-8',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
