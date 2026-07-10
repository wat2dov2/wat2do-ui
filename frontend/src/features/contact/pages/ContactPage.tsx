import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import {
  EMPTY_FILTER_STATE,
} from "@/features/search";
import { useSearchStore } from "@/features/search/store/search.store";
import { ROUTES } from "@/shared/constants/routes";
import { EXTERNAL_LINKS } from "@/shared/constants/links";
import { useTranslation } from "react-i18next";
import imgSlefLogo from "@/assets/slef_logo.png";
import imgMeetHero from "@/assets/meet_wat2do_hero.png";

const CornerMask = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path d="M0 0C0 35.35 28.65 64 64 64H0V0Z" fill="currentColor" />
  </svg>
);

export function ContactPage() {
  const router = useRouter();
  const { t } = useTranslation();

  const handleSearchClick = (query: string, isClub: boolean = false) => {
    if (isClub) {
      router.push(ROUTES.ORGANIZATIONS);
      return;
    }

    useSearchStore.getState().setFilterState({
      ...EMPTY_FILTER_STATE,
      searchQuery: query,
    });
    router.push(ROUTES.HOME);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[800px] mx-auto px-0 py-12 sm:px-6 md:py-20 pb-32 space-y-16">
        
        <m.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative w-full h-[280px] sm:h-[360px] md:h-[440px] rounded-3xl overflow-hidden bg-muted"
        >
          <img
            src={imgMeetHero.src}
            alt={t("contact.heroAlt")}
            className="w-full h-full object-cover select-none pointer-events-none"
          />
          
          <div className="absolute bottom-0 left-0 flex flex-col items-start z-10 select-none">
            <div className="relative bg-background pl-4 pr-5 pt-3 pb-1 md:pl-6 md:pr-8 md:pt-4 md:pb-1 rounded-tr-[16px] md:rounded-tr-[24px] w-fit">
              <CornerMask className="absolute left-0 bottom-full size-4 md:size-6 text-background pointer-events-none" />
              
              <h1 className="font-sans font-bold text-3xl sm:text-5xl text-foreground leading-none tracking-tight uppercase">
                {t("contact.hero.meet")}
              </h1>
              
              <CornerMask className="absolute left-full bottom-0 size-4 md:size-6 text-background pointer-events-none" />
            </div>

            <div className="relative bg-background pl-4 pr-6 pt-2 pb-4 md:pl-6 md:pr-10 md:pt-3 md:pb-6 rounded-tr-[16px] md:rounded-tr-[24px] w-fit">
              <h1 className="font-sans font-bold text-3xl sm:text-5xl text-foreground leading-none tracking-tight uppercase">
                {t("contact.hero.wat2do")}
              </h1>
              
              <CornerMask className="absolute left-full bottom-0 size-4 md:size-6 text-background pointer-events-none" />
            </div>
          </div>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="space-y-10 text-foreground/90 animate-fade-in"
        >
          <div className="space-y-4">
            <h2 className="text-3xl font-extrabold text-foreground tracking-tight font-sans">
              {t("contact.about.title")}
            </h2>
            <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
              {t("contact.about.welcome")}
              <span
                onMouseDown={() => handleSearchClick("hip-hop")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.hipHop")}
              </span>
              {t("contact.about.remoteCarPrefix")}
              <span
                onMouseDown={() => handleSearchClick("remote-controlled")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.remoteCar")}
              </span>
              , 🍽️{" "}
              <span
                onMouseDown={() => handleSearchClick("cooking")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.cooking")}
              </span>
              {t("contact.about.cookingSuffix")}
              <span
                onMouseDown={() => handleSearchClick("curling")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.curling")}
              </span>
              {t("contact.about.boatCruisePrefix")}
              <span
                onMouseDown={() => handleSearchClick("harbour boat")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.boatCruise")}
              </span>
              {t("contact.about.stratfordPrefix")}
              <span
                onMouseDown={() => handleSearchClick("Stratford")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.stratford")}
              </span>
              {t("contact.about.anniePrefix")}
              <span className="italic">{t("contact.about.annie")}</span>, 🎢{" "}
              <span
                onMouseDown={() => handleSearchClick("Wonderland")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.wonderland")}
              </span>
              {t("contact.about.networkingPrefix")}
              <span
                onMouseDown={() => handleSearchClick("networking")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.networking")}
              </span>
              {t("contact.about.builtPrefix")}
              <span
                onMouseDown={() => handleSearchClick("August 2025")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                {t("contact.about.builtDate")}
              </span>
              {t("contact.about.builtSuffix")}
            </p>
            <p className="font-semibold text-foreground text-sm font-sans pt-2">
              {t("contact.about.signature")}
            </p>
          </div>

          <div className="space-y-6 pt-4">
            <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
              {t("contact.funding.text")}
              <a
                href={EXTERNAL_LINKS.SLEF_INFO}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
              >
                {t("contact.funding.slef")}
              </a>
              {t("contact.funding.wusa")}
            </p>
            <div className="flex justify-start pt-2">
              <img
                src={imgSlefLogo.src}
                alt={t("contact.funding.logoAlt")}
                className="h-28 sm:h-32 object-contain select-none"
              />
            </div>
          </div>

          <hr className="border-t border-border/85 my-10" />

          <div className="space-y-8">
            <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans italic">
              {t("contact.tips.intro")}
            </p>

            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                {t("contact.tips.networking.title")}
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                {t("contact.tips.networking.desc")}
                <a
                  href={EXTERNAL_LINKS.ATLASSIAN}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
                >
                  {t("contact.tips.networking.atlassian")}
                </a>
                ,{" "}
                <a
                  href={EXTERNAL_LINKS.BLOOMBERG}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
                >
                  {t("contact.tips.networking.bloomberg")}
                </a>
                {t("contact.tips.networking.and")}
                <a
                  href={EXTERNAL_LINKS.POINT72}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
                >
                  {t("contact.tips.networking.point72")}
                </a>{" "}
                {t("contact.tips.networking.suffix")}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                {t("contact.tips.random.title")}
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                {t("contact.tips.random.desc")}
                <span
                  onMouseDown={() => handleSearchClick("Repair Club", true)}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  {t("contact.tips.random.repair")}
                </span>
                {t("contact.tips.random.repairSuffix")}
                <span
                  onMouseDown={() => handleSearchClick("Zumba")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  {t("contact.tips.random.zumba")}
                </span>
                {t("contact.tips.random.zumbaSuffix")}
                <span
                  onMouseDown={() => handleSearchClick("Barbells")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  {t("contact.tips.random.barbells")}
                </span>
                .
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                {t("contact.tips.search.title")}
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                {t("contact.tips.search.desc")}
              </p>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans mt-4">
                {t("contact.tips.search.friendsIntro")}
                <span
                  onMouseDown={() => handleSearchClick("Pho Night")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  {t("contact.tips.search.pho")}
                </span>
                ,{" "}
                <span
                  onMouseDown={() => handleSearchClick("Campfire Jam")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  {t("contact.tips.search.campfire")}
                </span>
                {t("contact.tips.search.or")}
                <span
                  onMouseDown={() => handleSearchClick("Global Games Night")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  {t("contact.tips.search.global")}
                </span>{" "}
                .
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                {t("contact.tips.explore.title")}
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                {t("contact.tips.explore.desc")}
              </p>
              <p className="text-sm sm:text-base text-foreground/80 leading-relaxed font-sans mt-4">
                {t("contact.tips.explore.ps")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-6">
            <button
              onMouseDown={() => router.push(ROUTES.HOME)}
              className="px-5 py-2.5 bg-background border border-border text-foreground hover:bg-muted font-semibold text-sm rounded-xl shadow-xs transition-all cursor-pointer"
            >
              {t("contact.actions.browse")}
            </button>
            <button
              onMouseDown={() => router.push(ROUTES.ORGANIZATIONS)}
              className="px-5 py-2.5 bg-background border border-border text-foreground hover:bg-muted font-semibold text-sm rounded-xl shadow-xs transition-all cursor-pointer"
            >
              {t("contact.actions.explore")}
            </button>
          </div>
        </m.div>

        <footer className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[500px]">
            {t("contact.footer.about")}
          </p>
          <span className="text-xs text-muted-foreground font-sans">
            {t("contact.footer.copyright", { year: new Date().getFullYear() })}
          </span>
        </footer>

      </div>
    </div>
  );
}
