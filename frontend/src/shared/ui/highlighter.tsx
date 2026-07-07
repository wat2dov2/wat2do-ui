import { useEffect, useRef } from "react"
import type React from "react"
import { useInView } from "framer-motion"
import { cn } from "@/shared/lib/utils"

type AnnotationAction =
  | "highlight"
  | "underline"
  | "box"
  | "circle"
  | "strike-through"
  | "crossed-off"
  | "bracket"

interface HighlighterProps {
  children: React.ReactNode
  action?: AnnotationAction
  color?: string
  strokeWidth?: number
  animationDuration?: number
  iterations?: number
  padding?: number
  multiline?: boolean
  isView?: boolean
  /** Extra classes for the annotated wrapper (e.g. to bound its width so a
   * truncating child keeps the annotation aligned to the visible text). */
  className?: string
}

export function Highlighter({
  children,
  action = "highlight",
  color = "var(--muted)",
  strokeWidth = 1.5,
  animationDuration = 600,
  iterations = 2,
  padding = 2,
  multiline = true,
  isView = false,
  className,
}: HighlighterProps) {
  const elementRef = useRef<HTMLSpanElement>(null)
  const annotationRef = useRef<import("rough-notation/lib/model").RoughAnnotation | null>(null)

  const isInView = useInView(elementRef, {
    once: true,
    margin: "-10%",
  })

  // If isView is false, always show. If isView is true, wait for inView
  const shouldShow = !isView || isInView

  useEffect(() => {
    if (!shouldShow) return

    const element = elementRef.current
    if (!element) return

    const annotationConfig = {
      type: action,
      color,
      strokeWidth,
      animationDuration,
      iterations,
      padding,
      multiline,
    }

    let isObsolete = false
    let resizeObserver: ResizeObserver | null = null

    import("rough-notation").then(({ annotate }) => {
      if (isObsolete) return

      const annotation = annotate(element, annotationConfig)
      annotationRef.current = annotation
      annotationRef.current.show()

      resizeObserver = new ResizeObserver(() => {
        annotation.hide()
        annotation.show()
      })

      resizeObserver.observe(element)
      resizeObserver.observe(document.body)
    }).catch(err => {
      console.error("Failed to load rough-notation dynamically:", err)
    })

    return () => {
      isObsolete = true
      if (annotationRef.current) {
        try {
          annotationRef.current.remove()
        } catch {
          console.warn("annotation remove failed")
        }
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [
    shouldShow,
    action,
    color,
    strokeWidth,
    animationDuration,
    iterations,
    padding,
    multiline,
  ])

  return (
    <span ref={elementRef} className={cn("relative inline-block bg-transparent", className)}>
      {children}
    </span>
  )
}
