import React, { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import {
  Download,
  Eye,
  Users,
  TrendingUp,
  CheckCircle,
  Calendar,
  Edit,
  X,
  ImagePlus,
  Megaphone,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./ui/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "./ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  CartesianGrid,
} from "recharts";
import type { QRCode, QRCodeScan, Event } from "@/types";
import {
  getScansForQRCode,
  saveQRCode,
} from "@/utils/qrRedirect";
import { generateQRCodeUrl, downloadQRCodeAsPNG } from "@/utils/qrGenerator";

interface QRCodeDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
  events: Event[];
  userEmail: string;
  onUpdate: () => void;
}

export function QRCodeDetailsModal({
  isOpen,
  onClose,
  qrCode,
  events,
  userEmail,
  onUpdate,
}: QRCodeDetailsModalProps) {
  const { t } = useTranslation();
  const [scans, setScans] = useState<QRCodeScan[]>([]);
  const [timeRange, setTimeRange] = useState<string>("30"); // days
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(qrCode.name);
  const [editedDescription, setEditedDescription] = useState(qrCode.description || "");
  const [editedImageUrl, setEditedImageUrl] = useState(qrCode.imageUrl || "");
  const [imagePreview, setImagePreview] = useState(qrCode.imageUrl || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadScans();
      setEditedName(qrCode.name);
      setEditedDescription(qrCode.description || "");
      setEditedImageUrl(qrCode.imageUrl || "");
      setImagePreview(qrCode.imageUrl || "");
      setIsEditing(false);
    }
  }, [isOpen, qrCode]);

  const loadScans = () => {
    const loadedScans = getScansForQRCode(qrCode.id);
    setScans(loadedScans);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setEditedImageUrl(dataUrl);
      setImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setEditedImageUrl("");
    setImagePreview("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSave = () => {
    const updated: QRCode = {
      ...qrCode,
      name: editedName,
      description: editedDescription || undefined,
      imageUrl: editedImageUrl || undefined,
    };
    saveQRCode(updated);
    onUpdate();
    setIsEditing(false);
  };

  // Filter scans based on time range
  const filteredScans = useMemo(() => {
    if (timeRange === "all") return scans;
    
    const days = parseInt(timeRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return scans.filter(scan => new Date(scan.scannedAt) >= cutoffDate);
  }, [scans, timeRange]);

  const handleDownload = () => {
    const qrUrl = generateQRCodeUrl(qrCode.id);
    // Simple download - create a data URL from the QR code
    // In production, you'd properly render QRCodeSVG to canvas
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 512, 512);
    const dataUrl = canvas.toDataURL("image/png");
    downloadQRCodeAsPNG(dataUrl, qrCode.name);
  };

  // Calculate stats and time series data
  const stats = useMemo(() => {
    const totalScans = filteredScans.length;
    const uniqueScansSet = new Set(
      filteredScans.map((s) => s.sessionId || s.userId || s.id)
    );
    const uniqueScans = uniqueScansSet.size;
    const conversions = filteredScans.filter((s) => s.conversionActions.length > 0)
      .length;
    const conversionRate =
      totalScans > 0 ? ((conversions / totalScans) * 100).toFixed(1) : "0.0";

    // Group scans by date for time series charts
    const scansByDate = filteredScans.reduce((acc, scan) => {
      const scanDate = new Date(scan.scannedAt);
      const dateKey = scanDate.toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = {
          total: 0,
          unique: new Set<string>(),
          conversions: 0,
        };
      }
      acc[dateKey].total += 1;
      acc[dateKey].unique.add(scan.sessionId || scan.userId || scan.id);
      if (scan.conversionActions.length > 0) {
        acc[dateKey].conversions += 1;
      }
      return acc;
    }, {} as Record<string, { total: number; unique: Set<string>; conversions: number }>);

    // Generate chart data for each metric
    const allDates = Object.keys(scansByDate).sort();
    const totalScansData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        scans: scansByDate[dateKey].total,
      };
    });

    const uniqueScansData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        scans: scansByDate[dateKey].unique.size,
      };
    });

    const conversionsData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        conversions: scansByDate[dateKey].conversions,
      };
    });

    const conversionRateData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      const dayData = scansByDate[dateKey];
      const rate = dayData.total > 0 
        ? ((dayData.conversions / dayData.total) * 100).toFixed(1)
        : "0.0";
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rate: parseFloat(rate),
      };
    });

    return {
      totalScans,
      uniqueScans,
      conversions,
      conversionRate,
      totalScansData,
      uniqueScansData,
      conversionsData,
      conversionRateData,
    };
  }, [filteredScans]);

  // Get destination info
  const destinationInfo = useMemo(() => {
    if (qrCode.destinationType === "event") {
      const event = events.find((e) => e.id === qrCode.destinationId);
      return event ? { type: t("qrCode.event"), name: event.title } : null;
    } else if (qrCode.destinationType === "events-list") {
      return { type: t("qrCode.eventsList"), name: t("admin.filteredEvents") };
    } else {
      return {
        type: t("qrCode.customUrlType"),
        name: qrCode.destinationId as string,
      };
    }
  }, [qrCode, events]);

  const qrUrl = generateQRCodeUrl(qrCode.id);

  // Chart configurations - all using primary blue
  const primaryBlue = "hsl(216 100% 42%)"; // Primary blue from CSS
  
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="p-0 max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{t("admin.qrCodeAnalytics")}</DialogTitle>
          <DialogDescription>
            {qrCode.name} - {t("admin.performanceMetrics")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="space-y-6">
          {/* QR Code Info Section */}
          <div className="flex items-start gap-6">
            {/* QR Code */}
            <div className="flex-shrink-0">
              <div className="p-4 bg-white rounded-lg border border-border">
                <QRCodeSVG value={qrUrl} size={200} />
              </div>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="w-full"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  {t("admin.downloadQrCode")}
                </Button>
              </div>
            </div>

            {/* Poster Image */}
            <div className="flex-shrink-0">
              <div className="w-64 h-64 rounded-lg overflow-hidden border border-border bg-gradient-to-br from-primary/20 to-primary/5">
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt={qrCode.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Megaphone className="w-16 h-16 text-muted-foreground/30" />
                  </div>
                )}
              </div>
            </div>

            {/* Info and Edit Section */}
            <div className="flex-1">
              {isEditing ? (
                <form>
                  <FieldGroup>
                    <FieldSet>
                      <FieldLegend>Edit QR Code</FieldLegend>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="edit-name" className="text-sm font-medium text-foreground">
                            {t("forms.name")}
                          </FieldLabel>
                          <Input
                            id="edit-name"
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="w-full text-sm"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="edit-description" className="text-sm font-medium text-foreground">
                            {t("forms.description")}
                          </FieldLabel>
                          <Textarea
                            id="edit-description"
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            className="w-full text-sm min-h-[80px]"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-sm font-medium text-foreground">
                            {t("qrCode.posterImage")}
                          </FieldLabel>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="hidden"
                          />
                          {imagePreview ? (
                            <div className="relative">
                              <div className="relative w-full h-48 rounded-xl overflow-hidden border border-border">
                                <img
                                  src={imagePreview}
                                  alt={t("qrCode.posterPreview")}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleRemoveImage}
                                className="absolute top-2 right-2"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="w-full border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer bg-muted/50 hover:bg-muted"
                            >
                              <ImagePlus className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                              <p className="text-sm font-medium text-foreground mb-1">
                                {t("forms.clickToUploadImage")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("qrCode.imageFormat")}
                              </p>
                            </button>
                          )}
                        </Field>
                        <Field orientation="horizontal">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(false)}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button type="button" size="sm" onClick={handleSave}>
                            {t("forms.saveChanges")}
                          </Button>
                        </Field>
                      </FieldGroup>
                    </FieldSet>
                  </FieldGroup>
                </form>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg text-gray-900 mb-1">
                        {qrCode.name}
                      </h3>
                      {qrCode.description && (
                        <p className="text-sm text-muted-foreground mb-3">
                          {qrCode.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(true)}
                    >
                      <Edit className="w-3.5 h-3.5 mr-1.5" />
                      {t("common.edit")}
                    </Button>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        qrCode.isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {qrCode.isActive ? t("common.active") : t("common.inactive")}
                    </span>
                    {destinationInfo && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span>{destinationInfo.type}: {destinationInfo.name}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{t("admin.totalScans")}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats.totalScans}
              </div>
            </div>
            <div className="bg-muted rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{t("admin.uniqueScans")}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats.uniqueScans}
              </div>
            </div>
            <div className="bg-muted rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{t("admin.conversions")}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats.conversions}
              </div>
            </div>
            <div className="bg-muted rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{t("admin.conversionRate")}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats.conversionRate}%
              </div>
            </div>
          </div>

          {/* Charts Section */}
          {stats.totalScansData.length > 0 && (
            <div className="space-y-6">
              {/* Time Range Selector */}
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{t("admin.performanceTrends")}</h3>
                <Select value={timeRange} onValueChange={setTimeRange}>
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
                      data={stats.totalScansData}
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
                              const item = stats.totalScansData.find((d) => d.dateLabel === value);
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
                      data={stats.uniqueScansData}
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
                              const item = stats.uniqueScansData.find((d) => d.dateLabel === value);
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
                  <CardTitle>{t("admin.conversions")} Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={conversionsConfig} className="h-[250px] w-full">
                    <BarChart
                      data={stats.conversionsData}
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
                              const item = stats.conversionsData.find((d) => d.dateLabel === value);
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
                      data={stats.conversionRateData}
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
                              const item = stats.conversionRateData.find((d) => d.dateLabel === value);
                              return item?.dateLabel || value;
                            }}
                            formatter={(value: number) => `${value.toFixed(1)}%`}
                          />
                        }
                      />
                      <Bar dataKey="rate" fill="var(--color-rate)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {stats.totalScansData.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border border-border rounded-xl">
              <Eye className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-1">{t("qrCode.noScanData")}</p>
              <p className="text-sm">{t("qrCode.noScanDataDesc")}</p>
            </div>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
