import { Users, ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
import { LazyImage } from "@/shared/ui/lazy-image";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LightRays } from "@/shared/ui/light-rays";

interface PreviewEvent {
  title: string;
  org: string;
  category: string;
  image: string;
  date: string;
  time: string;
  location: string;
  badges: Array<{ text: string; bgClass: string; textClass: string }>;
}

const PREVIEW_EVENTS: PreviewEvent[] = [
  {
    title: "Professional Photoshoots",
    org: "Student Union",
    category: "Clubs",
    image: "https://images.unsplash.com/photo-1529543544282-ea69407b3656?w=400&h=200&fit=crop",
    date: "Saturday Jan 17",
    time: "12:30 PM to 3:30 PM",
    location: "E5 Bridge",
    badges: [
      { text: "Free", bgClass: "bg-success/20", textClass: "text-success" },
      { text: "Registration", bgClass: "bg-purple-500/20", textClass: "text-purple-500" },
    ],
  },
  {
    title: "Tech Career Fair",
    org: "Career Centre",
    category: "Career",
    image: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=400&h=200&fit=crop",
    date: "Tuesday Feb 4",
    time: "10:00 AM to 4:00 PM",
    location: "SLC Great Hall",
    badges: [
      { text: "Free", bgClass: "bg-success/20", textClass: "text-success" },
    ],
  },
  {
    title: "Welcome Week BBQ",
    org: "Residence Life",
    category: "Social & Games",
    image: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=200&fit=crop",
    date: "Monday Sep 1",
    time: "5:00 PM to 8:00 PM",
    location: "Village Green",
    badges: [
      { text: "Free", bgClass: "bg-success/20", textClass: "text-success" },
      { text: "Free Food", bgClass: "bg-warning/20", textClass: "text-warning" },
    ],
  },
  {
    title: "Research Symposium",
    org: "Graduate Studies",
    category: "Academic",
    image: "https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=400&h=200&fit=crop",
    date: "Friday Mar 14",
    time: "9:00 AM to 5:00 PM",
    location: "DC 1302",
    badges: [
      { text: "Registration", bgClass: "bg-purple-500/20", textClass: "text-purple-500" },
    ],
  },
];

export function AuthHeroPanel() {
  return (
    <section className="hidden lg:flex flex-1 min-h-full bg-muted/30 border-l border-border px-8 py-10 justify-center items-center overflow-y-auto">
      <div className="w-full max-w-[480px]">
        <div className="grid grid-cols-2 gap-3">
          {PREVIEW_EVENTS.map((event) => {
            const catClasses = getCategoryClasses(event.category);

            return (
              <div
                key={event.title}
                className="rounded-xl overflow-hidden flex flex-col bg-card"
              >
                <div className="relative overflow-hidden" style={{ height: 140 }}>
                  <LazyImage
                    src={event.image}
                    alt={event.title}
                    className="absolute inset-0 w-full h-full"
                    fallback={
                      <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 flex items-center justify-center">
                        <ImageOff className="w-8 h-8 text-muted-foreground/40" />
                      </div>
                    }
                    placeholder={
                      <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 animate-pulse" />
                    }
                  />

                  <BadgeMask variant="top-left">
                    <span
                      className={cn(
                        "font-bold text-[10px] px-2 py-0.5 block rounded-full",
                        catClasses.bg,
                        catClasses.text
                      )}
                    >
                      {translateCategory(event.category, (k) => k.split(".").pop() ?? k)}
                    </span>
                  </BadgeMask>

                  <BadgeMask variant="bottom-left">
                    <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-background border border-foreground text-foreground flex items-center gap-1.5">
                      <Users className="w-3 h-3" strokeWidth={2} />
                      <span className="truncate max-w-[80px]">{event.org}</span>
                    </span>
                  </BadgeMask>
                </div>

                <div className="relative flex flex-col flex-1 px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
                  <LightRays />
                  <div className="flex items-start gap-3 h-full flex-1">
                    <div className="flex-1 min-w-0 flex flex-col h-full gap-3">
                      <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground">
                        {event.title}
                      </h3>
                      <div className="space-y-0.5 mt-auto">
                        <span className="text-[11px] text-muted-foreground block">{event.date}</span>
                        <span className="text-[11px] text-muted-foreground block">{event.time}</span>
                        <span className="text-[11px] text-muted-foreground block truncate">{event.location}</span>
                      </div>
                    </div>

                    {event.badges.length > 0 && (
                      <div className="flex flex-col gap-1.5 items-end shrink-0">
                        {event.badges.map((badge) => (
                          <span
                            key={badge.text}
                            className={`font-medium text-[10px] px-2 py-0.5 rounded-xl ${badge.bgClass} ${badge.textClass}`}
                          >
                            {badge.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
