'use client'

import { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SectionCardProps {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

const SectionCard = ({
  title,
  description,
  action,
  children,
  className
}: SectionCardProps) => {
  return (
    <section
      className={cn(
        'rounded-xl border border-[#30363d] bg-[#161b22] p-5 shadow-none',
        className
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#58a6ff]">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-sm text-[#7d8590]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default SectionCard
