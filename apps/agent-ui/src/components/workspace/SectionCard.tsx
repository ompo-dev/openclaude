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
        'rounded-2xl border border-primary/10 bg-accent/60 p-5',
        className
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium uppercase text-primary">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default SectionCard
