import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Stack } from "@/shared/layout";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

interface StatCardProps {
  label: ReactNode;
  icon: LucideIcon;
  /** Null while the number loads. */
  value: ReactNode | null;
  /** A short line under the number, such as how often it updates. */
  note?: ReactNode;
}

/** One headline number on a dashboard, with its label and icon. */
export function StatCard({ label, icon: Icon, value, note }: StatCardProps) {
  return (
    <Card data-slot="stat-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className="size-5 text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={1}>
          {value === null ? (
            <Skeleton className="h-8 w-24" aria-busy />
          ) : (
            <p className="text-2xl font-semibold text-foreground">{value}</p>
          )}
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
