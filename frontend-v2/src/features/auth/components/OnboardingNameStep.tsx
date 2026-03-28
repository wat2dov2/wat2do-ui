import { useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { availableSchools } from "@/features/events/data/events";

interface OnboardingSchoolStepProps {
  school: string;
  onSchoolChange: (value: string) => void;
}

export function OnboardingNameStep({
  school,
  onSchoolChange,
}: OnboardingSchoolStepProps) {
  const [search, setSearch] = useState("");

  const filteredSchools = availableSchools.filter((s) =>
    s.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center border-b border-border px-3">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search schools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-2 py-2.5 text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[240px] overflow-y-auto p-1">
          {filteredSchools.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No school found.
            </div>
          ) : (
            filteredSchools.map((s) => (
              <button
                key={s}
                onClick={() => onSchoolChange(s)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                  school === s
                    ? "bg-primary/20 dark:bg-primary/30 text-primary"
                    : "hover:bg-gray-200 text-foreground"
                )}
              >
                <Check
                  className={cn(
                    "w-4 h-4 shrink-0",
                    school === s ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{s}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
