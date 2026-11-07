import { AlertCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertAction, AlertDescription } from "@/shared/ui/alert"
import { LoadingButton } from "@/shared/ui/loading-button"

type LoadFailureNoticeProps = {
  message: string
  onRetry: () => void
  /** A retry is under way. */
  retrying: boolean
}

/**
 * A load that failed, shown over the loading placeholder that was waiting for
 * it, with a way to try again. It lies on top of the placeholder, which keeps
 * its box, instead of taking room of its own, so nothing on the page moves when
 * it appears or goes. The placeholder's own container must be positioned.
 */
function LoadFailureNotice({ message, onRetry, retrying }: LoadFailureNoticeProps) {
  const { t } = useTranslation()
  return (
    <div
      data-slot="load-failure-notice"
      className="absolute inset-x-0 top-0 z-10 flex justify-center p-3"
    >
      <Alert placement="overlay">
        <AlertCircle />
        <AlertDescription>{message}</AlertDescription>
        <AlertAction>
          <LoadingButton
            variant="outline"
            size="sm"
            isLoading={retrying}
            loadingText={t("common.tryAgain")}
            onClick={onRetry}
          >
            {t("common.tryAgain")}
          </LoadingButton>
        </AlertAction>
      </Alert>
    </div>
  )
}

export { LoadFailureNotice }
export type { LoadFailureNoticeProps }
