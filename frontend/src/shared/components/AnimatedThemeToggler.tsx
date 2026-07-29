import { useCallback, useEffect, useRef, useState } from "react"
import { Moon, Sun } from "@/shared/ui/doodle-icons"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/shared/lib/utils"
import { saveTheme } from "@/shared/services/preferencesStorage"

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  checked,
  onCheckedChange,
  ...props
}: AnimatedThemeTogglerProps) => {
  const { t } = useTranslation()
  const [isDark, setIsDark] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const displayedIsDark = checked ?? isDark

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"))
    }
    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  const toggleTheme = useCallback(async () => {
    if (!buttonRef.current) return

    const newTheme = !displayedIsDark
    const applyNewTheme = () => {
      if (onCheckedChange) {
        onCheckedChange(newTheme)
        return
      }
      setIsDark(newTheme)
      document.documentElement.classList.toggle("dark", newTheme)
      saveTheme(newTheme ? "dark" : "light")
    }

    if (!document.startViewTransition) {
      applyNewTheme()
      return
    }

    await document.startViewTransition(() => {
      flushSync(() => {
        applyNewTheme()
      })
    }).ready

    const { top, left, width, height } = buttonRef.current.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const maxRadius = Math.hypot(
      Math.max(left, window.innerWidth - left),
      Math.max(top, window.innerHeight - top)
    )

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    )
  }, [displayedIsDark, duration, onCheckedChange])

  return (
    <button
      ref={buttonRef}
      onMouseDown={toggleTheme}
      className={cn(
        "flex size-8 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-secondary-hover",
        className
      )}
      {...props}
    >
      {displayedIsDark ? <Sun size={16} /> : <Moon size={16} />}
      <span className="sr-only">{t("theme.toggleTheme")}</span>
    </button>
  )
}
