"use client"

import ScrollContainer from 'react-indiana-drag-scroll'

export function DragScrollContainer({ children, className = "" }: { children: React.ReactNode, className?: string }) {
  return (
    <ScrollContainer className={`cursor-grab active:cursor-grabbing overflow-x-auto select-none ${className}`} hideScrollbars={false}>
      {children}
    </ScrollContainer>
  )
}
