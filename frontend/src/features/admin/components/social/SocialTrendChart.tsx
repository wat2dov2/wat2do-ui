import { useTranslation } from "react-i18next";
import { Line, LineChart, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/features/admin/lib/socialAccounts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/shared/ui/chart";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";

/** A named measure: its current value and detail above a line of how it moved day by day. */
export function SocialTrendChart({ title, value, detail, trend }: { title: string; value: string; detail?: string | null; trend: TrendPoint[] }) {
  const { i18n } = useTranslation();
  const config = { value: { label: title, color: "var(--primary)" } } satisfies ChartConfig;
  const dayLabel = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" });
  // A day is a calendar day; read it at noon so no time zone moves it.
  const data = trend.map(point => ({ day: dayLabel.format(new Date(`${point.day}T12:00:00`)), value: Math.round(point.value * 10) / 10 }));

  return (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemDescription>{title}</ItemDescription>
        <ItemTitle>{value}</ItemTitle>
        {detail ? <ItemDescription>{detail}</ItemDescription> : null}
        <ChartContainer config={config} aspect="strip">
          <LineChart data={data} margin={{ top: 4, left: 4, right: 4 }}>
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} width={36} domain={["auto", "auto"]} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {/* A lone day has no line to draw, so it shows as a dot. */}
            <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={data.length < 2} />
          </LineChart>
        </ChartContainer>
      </ItemContent>
    </Item>
  );
}
