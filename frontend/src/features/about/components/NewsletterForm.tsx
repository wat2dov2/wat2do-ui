import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";
import { subscribeToNewsletter } from "@/features/about/api/about.api";

export function NewsletterForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    try {
      await subscribeToNewsletter(email.trim());
      setStatus("success");
      setEmail("");
    } catch (err) {
      console.error("Newsletter subscribe failed:", err);
      setStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-10">
      <h3 className="font-sans font-bold text-[22px] text-foreground mb-3">
        {t("about.stayUpdated")}
      </h3>
      <p className="font-sans text-[15px] text-muted-foreground mb-7">
        {t("about.newsletterDescription")}
      </p>

      {status === "success" ? (
        <p className="text-sm text-green-600 dark:text-green-400 font-medium">
          {t("about.subscribeSuccess") || "Thanks for subscribing!"}
        </p>
      ) : (
        <>
          {status === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-3">
              {t("about.subscribeError") || "Something went wrong. Please try again."}
            </p>
          )}
          <form onSubmit={handleSubscribe} className="flex gap-3">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("about.emailPlaceholder")}
              className="flex-1 h-12"
              required
            />
            <LoadingButton
              type="submit"
              size="lg"
              className="px-8"
              isLoading={isSubmitting}
              loadingText={t("common.pleaseWait") || "Please wait..."}
            >
              {t("about.subscribe")}
            </LoadingButton>
          </form>
        </>
      )}
    </div>
  );
}
