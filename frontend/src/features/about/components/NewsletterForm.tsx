/**
 * NewsletterForm Component
 * Handles newsletter subscription form with its own state
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

export function NewsletterForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement newsletter subscription
    setEmail("");
  };

  return (
    <div className="bg-card border border-border rounded-[12px] p-10">
      <h3 className="font-sans font-bold text-[22px] text-foreground mb-3">
        {t("about.stayUpdated")}
      </h3>
      <p className="font-sans text-[15px] text-muted-foreground mb-7">
        {t("about.newsletterDescription")}
      </p>
      
      <form onSubmit={handleSubscribe} className="flex gap-3">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("about.emailPlaceholder")}
          className="flex-1 h-12"
          required
        />
        <Button type="submit" size="lg" className="px-8">
          {t("about.subscribe")}
        </Button>
      </form>
    </div>
  );
}
