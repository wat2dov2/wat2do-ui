import { useState } from "react";
import { ImageWithFallback } from "@/components/figma/ImageWithFallback";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AboutPage() {
  const [email, setEmail] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Subscribe:", email);
    setEmail("");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[680px] mx-auto px-6 py-20 pb-32">
        
        {/* Opening */}
        <div className="mb-32">
          <p className="font-sans text-[11px] tracking-wider uppercase text-muted-foreground mb-3">
            SOMEWHERE ON UW CAMPUS · JUNE 2025
          </p>
          <h1 className="font-sans font-bold text-[32px] text-foreground mb-6 leading-tight">
            Stumbling Upon the Underrated
          </h1>
          <div className="font-sans text-[16px] text-foreground leading-relaxed space-y-4">
            <p>
              We were the students who kept missing out.
            </p>
            <p>
              Tony found an Instagram story about <strong>Italian cooking lessons for $5</strong>. 
              It was posted 3 days ago. The event was already over.
            </p>
            <p>
              Erica heard about <strong>Man Dancing: Hip-Hop Edition</strong> from a poster in the 
              hallway. 30 minutes before it started. She showed up, and it was packed.
            </p>
            <p>
              The next week, she found out about a <strong>Mechanical Arm curling competition</strong> in 
              a random Discord. That's when we realized: all the coolest events are hidden.
            </p>
          </div>
        </div>

        {/* Evidence Photo 1 */}
        <div className="mb-32">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?w=800&q=80"
            alt="Campus events"
            className="w-full h-[360px] object-cover rounded-[12px] mb-4"
          />
          <p className="font-sans text-[13px] text-muted-foreground italic">
            One of the dozens of events we found out about too late.
          </p>
        </div>

        {/* Phase 2: The Build */}
        <div className="mb-32">
          <p className="font-sans text-[11px] tracking-wider uppercase text-muted-foreground mb-3">
            AUGUST 2025
          </p>
          <h2 className="font-sans font-bold text-[28px] text-foreground mb-6 leading-tight">
            Building for Ourselves
          </h2>
          <div className="font-sans text-[16px] text-foreground leading-relaxed space-y-4">
            <p>
              We were sitting in the SLC, complaining about missing <em>yet another event</em> (this time 
              it was free Chipotle at a Women in Engineering mixer), when Erica said: 
              <strong> "Why isn't there just... one place for all of this?"</strong>
            </p>
            <p>
              So we built it.
            </p>
            <p>
              Tony handled the backend—scraping club Instagrams, linking up with WUSA feeds, building 
              the filter logic. Erica designed everything: the illustrations, the hand-drawn icons, 
              the color palette.
            </p>
            <p className="italic text-muted-foreground">
              The first version was rough. But it worked.
            </p>
          </div>
        </div>

        {/* Evidence Photo 2 */}
        <div className="mb-32">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80"
            alt="Building together"
            className="w-full h-[360px] object-cover rounded-[12px] mb-4"
          />
          <p className="font-sans text-[13px] text-muted-foreground italic">
            Late nights in the SLC. Tony on backend, Erica on design.
          </p>
        </div>

        {/* Phase 3: The Launch */}
        <div className="mb-32">
          <p className="font-sans text-[11px] tracking-wider uppercase text-muted-foreground mb-3">
            OCTOBER 2025
          </p>
          <h2 className="font-sans font-bold text-[28px] text-foreground mb-6 leading-tight">
            Sharing It With Campus
          </h2>
          <div className="font-sans text-[16px] text-foreground leading-relaxed space-y-4">
            <p>
              We posted the link in a few group chats. Then we made a poster (ironic, we know) and 
              stuck it in the SLC. Within a week, people were texting us screenshots.
            </p>
            <p>
              <em>"Wait, there's a Repair Club? I can actually fix my bike there?"</em>
            </p>
            <p>
              Someone found the <strong>Gatka Club</strong> (Sikh martial arts) through Wat2Do and 
              said it was the highlight of their term. Another person discovered <strong>Retro Rollers</strong> 
              (roller skating meetups) and made six new friends in one night.
            </p>
            <p>
              That's when we realized: this isn't just a calendar. It's a way to discover the version 
              of campus life you didn't know existed.
            </p>
          </div>
        </div>

        {/* Evidence Photo 3 */}
        <div className="mb-32">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80"
            alt="Community discovery"
            className="w-full h-[360px] object-cover rounded-[12px] mb-4"
          />
          <p className="font-sans text-[13px] text-muted-foreground italic">
            People started discovering events they never knew existed.
          </p>
        </div>

        {/* Today */}
        <div className="mb-40">
          <p className="font-sans text-[11px] tracking-wider uppercase text-muted-foreground mb-3">
            DECEMBER 2025
          </p>
          <h2 className="font-sans font-bold text-[28px] text-foreground mb-6 leading-tight">
            You're Here Now
          </h2>
          <div className="font-sans text-[16px] text-foreground leading-relaxed space-y-4">
            <p>
              Wat2Do is used by hundreds of students to discover events they'd otherwise miss. 
              From <strong>Bloomberg networking panels</strong> to <strong>Motor Boat cruises</strong> to 
              <strong> Video Game tournaments</strong>.
            </p>
            <p>
              We don't run ads. We don't sell your data. We just think campus life should be easier 
              to navigate.
            </p>
            <p className="font-sans font-bold text-[17px] text-foreground">
              If you find this useful, tell a friend.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-40" />

        {/* Guide Section */}
        <div className="mb-40">
          <div className="mb-16">
            <h2 className="font-sans font-bold text-[28px] text-foreground mb-4">
              How to Actually Use This
            </h2>
            <p className="font-sans text-[16px] text-muted-foreground">
              Here's what we've learned about making the most of campus events.
            </p>
          </div>

          <div className="space-y-16">
            {/* Meeting People in Industry */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-[20px]">💼</span>
                </div>
                <h3 className="font-sans font-bold text-[22px] text-foreground">
                  Meeting People in Industry
                </h3>
              </div>
              <div className="font-sans text-[15px] text-foreground leading-relaxed space-y-3 ml-13">
                <p>
                  <strong>WiE × Bloomberg Panel:</strong> Real engineers who actually answer questions honestly. 
                  Plus, they usually bring snacks.
                </p>
                <p>
                  <strong>Atlassian Coffee Chats:</strong> Way less intimidating than a career fair booth. 
                  You can actually have a conversation.
                </p>
                <p>
                  <strong>Startup Career Fair:</strong> Skip the big corporate booths. Go straight to startups 
                  where you can talk to actual founders.
                </p>
              </div>
            </section>

            {/* Random Stuff */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-success/10 dark:bg-success/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-[20px]">✨</span>
                </div>
                <h3 className="font-sans font-bold text-[22px] text-foreground">
                  Random Stuff Worth Checking Out
                </h3>
              </div>
              <div className="font-sans text-[15px] text-foreground leading-relaxed space-y-3 ml-13">
                <p>
                  <strong>Repair Club:</strong> Broke your laptop charger? These folks have tools and 
                  will teach you how to fix it yourself. Completely free.
                </p>
                <p>
                  <strong>Gatka Club:</strong> Sikh martial arts with wooden sticks. No experience needed. 
                  Underrated.
                </p>
                <p>
                  <strong>Retro Rollers:</strong> Roller skating at local rinks. Great for de-stressing 
                  during midterms.
                </p>
              </div>
            </section>

            {/* Going With Friends */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-warning/10 dark:bg-warning/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-[20px]">🍕</span>
                </div>
                <h3 className="font-sans font-bold text-[22px] text-foreground">
                  Going With Friends
                </h3>
              </div>
              <div className="font-sans text-[15px] text-foreground leading-relaxed space-y-3 ml-13">
                <p>
                  <strong>Free Food Events:</strong> Sort by "Food Provided" in the filters. 
                  Pro tip: show up 15 minutes early.
                </p>
                <p>
                  <strong>Game Nights:</strong> Perfect low-key hangout. Most clubs provide the games.
                </p>
                <p>
                  <strong>Canada's Wonderland Trips:</strong> Various clubs organize discounted group trips. 
                  Way cheaper than going solo.
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* Newsletter */}
        <div className="mb-32">
          <div className="bg-card border border-border rounded-[12px] p-10">
            <h3 className="font-sans font-bold text-[22px] text-foreground mb-3">
              Stay Updated
            </h3>
            <p className="font-sans text-[15px] text-muted-foreground mb-7">
              Get a weekly digest of the best events. No spam, just the good stuff.
            </p>
            
            <form onSubmit={handleSubscribe} className="flex gap-3">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@uwaterloo.ca"
                className="flex-1 h-12"
                required
              />
              <Button type="submit" size="lg" className="px-8">
                Subscribe
              </Button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <footer className="pt-12 border-t border-border space-y-6">
          <p className="font-sans text-[14px] text-muted-foreground leading-relaxed">
            <strong className="text-muted-foreground">P.S.</strong> We don't run ads. Everything runs out of our own pockets. 
            No data selling. Just students helping students.
          </p>
          <p className="font-sans text-[13px] text-muted-foreground">
            © 2025 Wat2Do · Built by Tony & Erica
          </p>
        </footer>
      </div>
    </div>
  );
}
