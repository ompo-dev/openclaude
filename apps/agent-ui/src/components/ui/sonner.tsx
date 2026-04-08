'use client'

import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:border-[#30363d] group-[.toaster]:bg-[#161b22] group-[.toaster]:text-[#e6edf3] group-[.toaster]:shadow-[0_18px_50px_rgba(0,0,0,0.35)]',
          description: 'group-[.toast]:text-[#7d8590]',
          actionButton:
            'group-[.toast]:border group-[.toast]:border-[#2f6f3e] group-[.toast]:bg-[#238636] group-[.toast]:text-white',
          cancelButton:
            'group-[.toast]:border group-[.toast]:border-[#30363d] group-[.toast]:bg-[#21262d] group-[.toast]:text-[#e6edf3]'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
