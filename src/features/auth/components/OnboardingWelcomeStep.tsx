/**
 * Welcome step component for onboarding
 */

import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { useTranslation } from "react-i18next";

const GOOSE_IMAGE_URL =
  "https://lh3.googleusercontent.com/rd-gg-dl/ABS2GSnULbbntBOQGWx17qUnha4hcyKXW4asH7zxR0zV3dANdBEYPEagYhHMszDOKX9O5kdpGZzZIFkeec9LyOLiy1zV2IvIbdipr-2UrDPSBEmaOUGefddFgFNJWzaLGire29cPMIU0ypmBaj88c5EJ8EJyZt6fv3xo0Y-LV-R7d96pf6Ig6GCvFgAkIpFOZqGQ0z6wpSfun0c8OZi-4oQJziK2vs3gVWP7UN_aeImAe_lWlxpy47iTUzRShknBpGNPtDEMk9x3RZdzYuU21tbT4lQZHL2pdA6oAwppje-Id8aceQu0b4Legme-nb60_-0oQJHJ0bWVgfu3lMwQ_tZjGQBFF8UNt92y17hbrE92eIyFLnxxHGVR43X9aeIukNwVlx-zIZXzWSkv2Xe0CGkViJ2MmCOHEWwAQoaIDi86f7uMn97bg-i7_7cO4cR5snB574v-s94b3KSg-XoqNUxiAkZgRqITK9Rx8YaRxZMuqfRb0nBjaA1iWhP8ln24wKfrugS5X8dJFpExxq-wQhh7zvjFcbVjdI-G9dUaBtji5UjCJUu5Y_HYMu9BfNTvAMAC6KRimkLHoue_biInFKWdwpr77m6t48XH3Psohdg11Jx-d5zaTjASWfUgm_pSqDADN0EJnRqkVZiDCJgmk1zWpkdmWbpq_iFfTQE7kLv5xKEQw9QIGlfBISP98XHpcK_A4JyTd20pKASFWjfGD1zK6S3HfznvUW3qqpbjdE15rDZa0qsGqaImOVLjIAXEehfcl-o-w6EWMXcpPS283P3S3mkh7J7X2J0bL3hE3z6kPt81SHPuZzifLqQmR237Q9DjtsUoLZpHY-u_um2-JpdGbygK6m5geh_c4Gxm-4FQ75ksSSh12c0gGI9n6Wtbt0dclDyno-RgNzEinsI1bt_5UYQyvsxtGo98BEWwYzfc70_2JGyElBxCVuM_SU2Jva19sKtekc1SoDAQgOixWsmchfnna83xk64CQ-TGm_AgB97ZjxqbpDlRYAL-CNa7bzGecRhhoZVOb840TJ-62vulNL2CPFG0fG5e2uaNGMo6q6WAa20K6fmY4_fPYBOTm3DGryIPPWMAatdv3Pp6BhjZJuWsLkxInyyy_ixin38D53OXfzg9ZCEqIJRudGCgF-VrtwW1V4SeP3PMch0dAzCqL4NUe2p29STX1Xeh-Ypvzs0kjqSNQaRPq9g=s1024-rj";

interface OnboardingWelcomeStepProps {
  onNext: () => void;
}

export function OnboardingWelcomeStep({ onNext }: OnboardingWelcomeStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-24 h-24 rounded-full overflow-hidden mb-4 bg-muted">
        <img
          src={GOOSE_IMAGE_URL}
          alt="Goose mascot"
          className="w-full h-full object-cover"
        />
      </div>

      <DialogHeader className="space-y-2 mb-6 text-center">
        <DialogTitle className="text-xl text-center">{t("modals.welcome.title")}</DialogTitle>
        <DialogDescription className="text-center">
          {t("modals.welcome.description")}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button onClick={onNext} className="w-full">
          {t("modals.getStarted")}
        </Button>
      </DialogFooter>
    </div>
  );
}
