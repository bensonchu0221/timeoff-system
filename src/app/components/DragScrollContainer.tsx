"use client"

import { forwardRef } from 'react'
import ScrollContainer from 'react-indiana-drag-scroll'

export const DragScrollContainer = forwardRef<any, { children: React.ReactNode, className?: string }>(
  ({ children, className = "" }, ref) => {
    return (
      <ScrollContainer 
        innerRef={ref}
        className={`cursor-grab active:cursor-grabbing overflow-x-auto select-none ${className}`} 
        hideScrollbars={false}
      >
        {children}
      </ScrollContainer>
    )
  }
)

DragScrollContainer.displayName = "DragScrollContainer"
