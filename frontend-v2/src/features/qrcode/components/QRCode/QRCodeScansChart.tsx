import React from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  CartesianGrid,
} from "recharts";

interface ChartData {
  date: string;
  dateLabel: string;
  scans?: number;
  unique?: number;
  conversions?: number;
  rate?: number;
}

interface QRCodeScansChartProps {
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  totalScansData: ChartData[];
  uniqueScansData: ChartData[];
  /** When true, hides the interactive time range selector (useful for view-only modals). */
  hideTimeRangeSelector?: boolean;
}

const primaryBlue = "hsl(216 100% 42%)";

// Chart configs are created inside component to use translations

export function QRCodeScansChart({
  timeRange,
  onTimeRangeChange,
  totalScansData,
  uniqueScansData,
  hideTimeRangeSelector = false,
}: QRCodeScansChartProps) {
  const { t } = useTranslation();

  if (totalScansData.length === 0) {
    return null;
  }

  const totalScansConfig = {
    scans: {
      label: t("admin.totalScans"),
      theme: { light: primaryBlue, dark: primaryBlue },
    },
  } satisfies ChartConfig;

  const uniqueScansConfig = {
    scans: {
      label: t("admin.uniqueScans"),
      theme: { light: primaryBlue, dark: primaryBlue },
    },
  } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">{t("admin.performanceTrends")}</h3>
        {!hideTimeRangeSelector && (
          <Select value={timeRange} onValueChange={onTimeRangeChange}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="w-3.5 h-3.5 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("qrCode.last7Days")}</SelectItem>
              <SelectItem value="14">{t("qrCode.last14Days")}</SelectItem>
              <SelectItem value="30">{t("admin.last30Days")}</SelectItem>
              <SelectItem value="all">{t("admin.allTime")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.totalScansOverTime")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={totalScansConfig} className="h-[250px] w-full">
              <BarChart
                data={totalScansData}
                margin={{ left: 12, right: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        const item = totalScansData.find((d) => d.dateLabel === value);
                        return item?.dateLabel || value;
                      }}
                    />
                  }
                />
                <Bar dataKey="scans" fill="var(--color-scans)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.uniqueScansOverTime")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={uniqueScansConfig} className="h-[250px] w-full">
              <BarChart
                data={uniqueScansData}
                margin={{ left: 12, right: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        const item = uniqueScansData.find((d) => d.dateLabel === value);
                        return item?.dateLabel || value;
                      }}
                    />
                  }
                />
                <Bar dataKey="scans" fill="var(--color-scans)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
