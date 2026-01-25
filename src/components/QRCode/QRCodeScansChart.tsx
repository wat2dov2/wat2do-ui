import React from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
  conversionsData: ChartData[];
  conversionRateData: ChartData[];
}

const primaryBlue = "hsl(216 100% 42%)";

const totalScansConfig = {
  scans: {
    label: "Total Scans",
    theme: {
      light: primaryBlue,
      dark: primaryBlue,
    },
  },
} satisfies ChartConfig;

const uniqueScansConfig = {
  scans: {
    label: "Unique Scans",
    theme: {
      light: primaryBlue,
      dark: primaryBlue,
    },
  },
} satisfies ChartConfig;

const conversionsConfig = {
  conversions: {
    label: "Conversions",
    theme: {
      light: primaryBlue,
      dark: primaryBlue,
    },
  },
} satisfies ChartConfig;

const conversionRateConfig = {
  rate: {
    label: "Conversion Rate",
    theme: {
      light: primaryBlue,
      dark: primaryBlue,
    },
  },
} satisfies ChartConfig;

export function QRCodeScansChart({
  timeRange,
  onTimeRangeChange,
  totalScansData,
  uniqueScansData,
  conversionsData,
  conversionRateData,
}: QRCodeScansChartProps) {
  const { t } = useTranslation();

  if (totalScansData.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">{t("admin.performanceTrends")}</h3>
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
      </div>

      {/* Total Scans Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.totalScansOverTime")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={totalScansConfig} className="h-[250px] w-full">
            <BarChart
              data={totalScansData}
              margin={{
                left: 12,
                right: 12,
              }}
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

      {/* Unique Scans Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.uniqueScansOverTime")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={uniqueScansConfig} className="h-[250px] w-full">
            <BarChart
              data={uniqueScansData}
              margin={{
                left: 12,
                right: 12,
              }}
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

      {/* Conversions Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.conversionsOverTime")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={conversionsConfig} className="h-[250px] w-full">
            <BarChart
              data={conversionsData}
              margin={{
                left: 12,
                right: 12,
              }}
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
                      const item = conversionsData.find((d) => d.dateLabel === value);
                      return item?.dateLabel || value;
                    }}
                  />
                }
              />
              <Bar dataKey="conversions" fill="var(--color-conversions)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Conversion Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.conversionRateOverTime")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={conversionRateConfig} className="h-[250px] w-full">
            <BarChart
              data={conversionRateData}
              margin={{
                left: 12,
                right: 12,
              }}
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
                      const item = conversionRateData.find((d) => d.dateLabel === value);
                      return item?.dateLabel || value;
                    }}
                  />
                }
              />
              <Bar dataKey="rate" fill="var(--color-rate)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
