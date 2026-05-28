import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useSearchStore } from "@/features/search/store/search.store";
import { ROUTES } from "@/shared/constants/routes";
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
  const navigate = useNavigate();

  const handleSearchClick = (query: string, isClub: boolean = false) => {
    // Clear all filters first, then set the query
    const store = useSearchStore.getState();
    store.clearAllFilters();
    store.setSearchQuery(query);
    navigate(isClub ? ROUTES.CLUBS : ROUTES.HOME);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[800px] mx-auto px-6 py-12 md:py-20 pb-32 space-y-16">
        
        {/* HERO SECTION (First Screenshot Concept with Custom Double-Step BadgeMask cutout) */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative w-full h-[280px] sm:h-[360px] md:h-[440px] rounded-3xl overflow-hidden bg-muted"
        >
          <img
            src={imgMeetHero}
            alt="Meet Wat2Do Workspace"
            className="w-full h-full object-cover select-none pointer-events-none"
          />
          
          {/* Double-step bottom-left cutout */}
          <div className="absolute bottom-0 left-0 flex flex-col items-start z-10 select-none">
            {/* Top Step ("MEET") */}
            <div className="relative bg-background pl-4 pr-5 pt-3 pb-1 md:pl-6 md:pr-8 md:pt-4 md:pb-1 rounded-tr-[16px] md:rounded-tr-[24px] w-fit">
              {/* Inner corner curve on the top-left (left container edge to top edge of MEET) */}
              <CornerMask className="absolute left-0 bottom-full size-4 md:size-6 text-background pointer-events-none" />
              
              <h1 className="font-sans font-bold text-3xl sm:text-5xl text-foreground leading-none tracking-tight uppercase">
                MEET
              </h1>
              
              {/* Inner corner curve on the right, resting on the bottom step */}
              <CornerMask className="absolute left-full bottom-0 size-4 md:size-6 text-background pointer-events-none" />
            </div>

            {/* Bottom Step ("WAT2DO") */}
            <div className="relative bg-background pl-4 pr-6 pt-2 pb-4 md:pl-6 md:pr-10 md:pt-3 md:pb-6 rounded-tr-[16px] md:rounded-tr-[24px] w-fit">
              <h1 className="font-sans font-bold text-3xl sm:text-5xl text-foreground leading-none tracking-tight uppercase">
                WAT2DO
              </h1>
              
              {/* Inner corner curve on the right, resting on the bottom of the container */}
              <CornerMask className="absolute left-full bottom-0 size-4 md:size-6 text-background pointer-events-none" />
            </div>
          </div>
        </motion.div>

        {/* CONTENT UNDER HERO SECTION */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="space-y-10 text-foreground/90 animate-fade-in"
        >
          {/* About Wat2Do */}
          <div className="space-y-4">
            <h2 className="text-3xl font-extrabold text-foreground tracking-tight font-sans">
              About Wat2Do
            </h2>
            <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
              Welcome to Wat2Do! We created this platform after stumbling upon way too many underrated events by sheer coincidence. We found ourselves at 🕺{" "}
              <span
                onClick={() => handleSearchClick("hip-hop")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                hip-hop dance tutorials
              </span>
              , a 🎮{" "}
              <span
                onClick={() => handleSearchClick("remote-controlled")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                remote-controlled car hackathon
              </span>
              , 🍽️{" "}
              <span
                onClick={() => handleSearchClick("cooking")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                Italian cooking lessons
              </span>{" "}
              at a culinary school, a free two-hour{" "}
              <span
                onClick={() => handleSearchClick("curling")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                curling lesson
              </span>
              , a $20 🛳️{" "}
              <span
                onClick={() => handleSearchClick("harbour boat")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                harbour boat cruise
              </span>
              , a $30{" "}
              <span
                onClick={() => handleSearchClick("Stratford")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                trip to the Stratford Festival
              </span>{" "}
              to watch 🎭 <span className="italic">Annie</span>, 🎢{" "}
              <span
                onClick={() => handleSearchClick("Wonderland")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                visiting Canada's Wonderland
              </span>{" "}
              (then missing the bus back to Waterloo), and meeting tons of great company at 🤝{" "}
              <span
                onClick={() => handleSearchClick("networking")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                networking events
              </span>
              . We didn't want to miss other cool things happening on campus, so we built this for ourselves in{" "}
              <span
                onClick={() => handleSearchClick("August 2025")}
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
              >
                August 2025
              </span>
              . Two months later, and we're extraordinarily excited to be sharing it with the rest of you!
            </p>
            <p className="font-semibold text-foreground text-sm font-sans pt-2">— Tony & Erica</p>
          </div>

          {/* Funding Support */}
          <div className="space-y-6 pt-4">
            <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
              We are extremely grateful for funding support from the{" "}
              <a
                href="https://wusa.ca/services/student-life-endowment-fund-slef/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
              >
                Student Life Endowment Fund (SLEF)
              </a>{" "}
              of the Waterloo Undergraduate Student Association (WUSA).
            </p>
            <div className="flex justify-start pt-2">
              <img
                src={imgSlefLogo}
                alt="Student Life Endowment Fund Logo"
                className="h-28 sm:h-32 object-contain select-none"
              />
            </div>
          </div>

          <hr className="border-t border-border/85 my-10" />

          {/* Tips Section */}
          <div className="space-y-8">
            <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans italic">
              To make the most out of this site, here are some of our helpful tips, depending on your goals.
            </p>

            {/* Expanding Your Professional Network */}
            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                Expanding Your Professional Network
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                A lot of company-sponsored events might fly under your radar, making it easy to miss out on crucial networking opportunities. We've met recruiters from{" "}
                <a
                  href="https://www.atlassian.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
                >
                  Atlassian
                </a>
                ,{" "}
                <a
                  href="https://www.bloomberg.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
                >
                  Bloomberg
                </a>
                , and{" "}
                <a
                  href="https://www.point72.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors font-semibold"
                >
                  Point72
                </a>{" "}
                from events we just found about the day before.
              </p>
            </div>

            {/* Random Events You Didn't Know Existed */}
            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                Random Events You Didn't Know Existed
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                Honestly, the best part about building this project was discovering clubs we had no idea were on campus. There's a{" "}
                <span
                  onClick={() => handleSearchClick("Repair Club", true)}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  Repair Club
                </span>{" "}
                where you can fix your broken electronics, the Iranian Students' Association's{" "}
                <span
                  onClick={() => handleSearchClick("Zumba")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  Persian Zumba
                </span>{" "}
                class, and Strength Club's{" "}
                <span
                  onClick={() => handleSearchClick("Barbells")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  Battle of the Barbells
                </span>
                .
              </p>
            </div>

            {/* Search Tips */}
            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                Search Tips
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                Category filters can help you find events that you are interested in. "Food," "Price," and "Registration Required" tags let you know what to expect. Try searching for what you are looking for, and see what comes up!
              </p>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans mt-4">
                If you're with your friends, try{" "}
                <span
                  onClick={() => handleSearchClick("Pho Night")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  Pho Night
                </span>
                ,{" "}
                <span
                  onClick={() => handleSearchClick("Campfire Jam")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  Campfire Jam
                </span>
                , or{" "}
                <span
                  onClick={() => handleSearchClick("Global Games Night")}
                  className="underline decoration-1 underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                >
                  Global Games Night
                </span>{" "}
                .
              </p>
            </div>

            {/* Start Exploring */}
            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight text-foreground font-sans">
                Start Exploring
              </h3>
              <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-sans">
                Check Wat2Do regularly for new events as events are added (almost) live! Or, subscribe to our newsletter for daily updates. Don't be afraid to attend events alone! The best connections happen when you just show up.
              </p>
              <p className="text-sm sm:text-base text-foreground/80 leading-relaxed font-sans mt-4">
                (P.S. You can enter "random" in the search bar to generate a random upcoming event!)
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-4 pt-6">
            <button
              onClick={() => navigate(ROUTES.HOME)}
              className="px-5 py-2.5 bg-background border border-border text-foreground hover:bg-muted font-semibold text-sm rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Browse Events
            </button>
            <button
              onClick={() => navigate(ROUTES.CLUBS)}
              className="px-5 py-2.5 bg-background border border-border text-foreground hover:bg-muted font-semibold text-sm rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Explore Clubs
            </button>
          </div>
        </motion.div>

        {/* Footer */}
        <footer className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[500px]">
            We built Wat2Do to connect Waterloo students to underrated campus life events. For suggestions or feedback, get in touch.
          </p>
          <span className="text-xs text-muted-foreground font-sans">
            © {new Date().getFullYear()} Wat2Do
          </span>
        </footer>

      </div>
    </div>
  );
}
