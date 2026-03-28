import React, { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { Highlighter } from "@/shared/ui/highlighter";
import { availableSchools } from "@/features/events/data/events";

interface SchoolComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

export function SchoolCombobox({ value, onChange }: SchoolComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredSchools = availableSchools.filter((school) =>
    school.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background/80 px-3 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.75)_inset] transition-colors hover:bg-background"
          aria-expanded={open}
        >
          <Highlighter action="highlight" color="#f48c76">
            {value ? value : "University of Waterloo"}
          </Highlighter>
          <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0 bg-popover border-border"
        align="start"
      >
        {/* Search input */}
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

        {/* School list */}
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filteredSchools.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No school found.
            </div>
          ) : (
            filteredSchools.map((school) => (
              <button
                key={school}
                onClick={() => {
                  onChange(school);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                  value === school
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary text-foreground"
                )}
              >
                <Check
                  className={cn(
                    "w-4 h-4 shrink-0",
                    value === school ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{school}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default SchoolCombobox;
