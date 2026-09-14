import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AdminPosterPayout,
  AdminPosterPayoutFilters,
  PosterPayoutFraudStatus,
  PosterPayoutStatus,
} from "@/features/admin/api/admin.api";
import { PayoutDetailDialog } from "@/features/admin/components/posters/PayoutDetailDialog";
import { PosterPayoutStatusBadge } from "@/features/admin/components/posters/PosterPayoutStatusBadge";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { useAdminPosterPayouts } from "@/features/admin/hooks/useAdminPosterPayouts";
import { FormGrid, Section, Stack } from "@/shared/layout";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { formatCadCents } from "@/shared/utils/currency";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { DatePicker } from "@/shared/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Download,
  ShieldAlert,
} from "@/shared/ui/doodle-icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { LoadingButton } from "@/shared/ui/loading-button";
import { LoadingPage } from "@/shared/ui/loading-page";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { TableCell, TableRow } from "@/shared/ui/table";

const PAYOUTS_PER_PAGE = 25;

interface DraftPayoutFilters {
  userId: string;
  payoutStatus: PosterPayoutStatus | "all";
  payoutEmail: string;
  periodFrom: string;
  periodTo: string;
  minAmount: string;
  maxAmount: string;
  fraudStatus: PosterPayoutFraudStatus | "all";
}

type AppliedPayoutFilters = Omit<
  AdminPosterPayoutFilters,
  "page" | "pageSize"
>;

const initialDraftFilters: DraftPayoutFilters = {
  userId: "",
  payoutStatus: "all",
  payoutEmail: "",
  periodFrom: "",
  periodTo: "",
  minAmount: "",
  maxAmount: "",
  fraudStatus: "all",
};

function dollarsToCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : undefined;
}

function downloadServerCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function AdminPayoutsPanel() {
  const { t, i18n } = useTranslation();
  const [draftFilters, setDraftFilters] =
    useState<DraftPayoutFilters>(initialDraftFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<AppliedPayoutFilters>({});
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedPayoutIds, setSelectedPayoutIds] = useState<Set<string>>(
    new Set(),
  );
  const [openPayoutId, setOpenPayoutId] = useState<string | null>(null);
  const [bulkPaidConfirmationOpen, setBulkPaidConfirmationOpen] =
    useState(false);

  const filters = useMemo<AdminPosterPayoutFilters>(
    () => ({
      ...appliedFilters,
      page: pageNumber,
      pageSize: PAYOUTS_PER_PAGE,
    }),
    [appliedFilters, pageNumber],
  );
  const {
    page,
    isLoading,
    isFetching,
    error,
    retry,
    detail,
    isDetailLoading,
    detailError,
    retryDetail,
    transitionPayout,
    bulkMarkPaid,
    exportPayouts,
    isTransitioning,
    isBulkMarkingPaid,
    isExporting,
  } = useAdminPosterPayouts(filters, openPayoutId);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [i18n.language],
  );
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    [i18n.language],
  );
  const periodFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "long",
      }),
    [i18n.language],
  );

  const formatCurrency = (cents: number) =>
    formatCadCents(cents, i18n.language);
  const formatDate = (value: string | null) => {
    if (!value) return t("admin.posterPayouts.notAvailable");
    const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? t("admin.posterPayouts.notAvailable")
      : dateFormatter.format(date);
  };
  const formatDateTime = (value: string | null) => {
    if (!value) return t("admin.posterPayouts.notAvailable");
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? t("admin.posterPayouts.notAvailable")
      : dateTimeFormatter.format(date);
  };
  const formatPeriod = (value: string) => {
    const date = new Date(`${value.slice(0, 7)}-01T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : periodFormatter.format(date);
  };

  const payouts = page?.items ?? [];
  const selectableIds = payouts
    .filter((payout) => payout.status === "pending")
    .map((payout) => payout.id);
  const allSelectableRowsChecked =
    selectableIds.length > 0 &&
    selectableIds.every((payoutId) => selectedPayoutIds.has(payoutId));
  const someSelectableRowsChecked =
    selectableIds.some((payoutId) => selectedPayoutIds.has(payoutId)) &&
    !allSelectableRowsChecked;

  const amountRangeInvalid = (() => {
    const minimum = dollarsToCents(draftFilters.minAmount);
    const maximum = dollarsToCents(draftFilters.maxAmount);
    return minimum !== undefined && maximum !== undefined && minimum > maximum;
  })();

  const applyFilters = () => {
    if (amountRangeInvalid) return;
    setAppliedFilters({
      userId: draftFilters.userId.trim() || undefined,
      payoutStatus:
        draftFilters.payoutStatus === "all"
          ? undefined
          : draftFilters.payoutStatus,
      payoutEmail: draftFilters.payoutEmail.trim() || undefined,
      periodFrom: draftFilters.periodFrom || undefined,
      periodTo: draftFilters.periodTo || undefined,
      minAmountCents: dollarsToCents(draftFilters.minAmount),
      maxAmountCents: dollarsToCents(draftFilters.maxAmount),
      fraudStatus:
        draftFilters.fraudStatus === "all"
          ? undefined
          : draftFilters.fraudStatus,
    });
    setPageNumber(1);
    setSelectedPayoutIds(new Set());
  };

  const resetFilters = () => {
    setDraftFilters(initialDraftFilters);
    setAppliedFilters({});
    setPageNumber(1);
    setSelectedPayoutIds(new Set());
  };

  const togglePayout = (payoutId: string, checked: boolean) => {
    setSelectedPayoutIds((current) => {
      const next = new Set(current);
      if (checked) next.add(payoutId);
      else next.delete(payoutId);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedPayoutIds((current) => {
      const next = new Set(current);
      selectableIds.forEach((payoutId) => {
        if (checked) next.add(payoutId);
        else next.delete(payoutId);
      });
      return next;
    });
  };

  const handleExport = async () => {
    try {
      const result = await exportPayouts([...selectedPayoutIds]);
      downloadServerCsv(result.filename, result.content);
      toast({
        title: t("admin.posterPayouts.bulk.exported"),
        variant: "success",
      });
    } catch (exportError) {
      toast({
        title: getApiErrorMessage(
          exportError,
          t("admin.posterPayouts.bulk.exportError"),
        ),
        variant: "destructive",
      });
    }
  };

  const handleBulkMarkPaid = async () => {
    try {
      await bulkMarkPaid([...selectedPayoutIds]);
      setBulkPaidConfirmationOpen(false);
      setSelectedPayoutIds(new Set());
      toast({
        title: t("admin.posterPayouts.bulk.markedPaid"),
        variant: "success",
      });
    } catch (bulkError) {
      toast({
        title: getApiErrorMessage(
          bulkError,
          t("admin.posterPayouts.bulk.markPaidError"),
        ),
        variant: "destructive",
      });
    }
  };

  const handleTransition = async (
    payoutId: string,
    status: PosterPayoutStatus,
    notes?: string,
  ) => {
    try {
      await transitionPayout({ payoutId, status, notes });
      if (status !== "pending") {
        setSelectedPayoutIds((current) => {
          if (!current.has(payoutId)) return current;
          const next = new Set(current);
          next.delete(payoutId);
          return next;
        });
      }
      toast({
        title: t("admin.posterPayouts.detail.updated"),
        variant: "success",
      });
    } catch (transitionError) {
      toast({
        title: getApiErrorMessage(
          transitionError,
          t("admin.posterPayouts.detail.updateError"),
        ),
        variant: "destructive",
      });
      throw transitionError;
    }
  };

  return (
    <Stack gap={5}>
      <Section
        variant="surface"
        title={t("admin.posterPayouts.filters.title")}
        description={t("admin.posterPayouts.filters.description")}
      >
        <FormGrid columns={3}>
          <FilterField
            htmlFor="payout-filter-user"
            label={t("admin.posterPayouts.filters.user")}
          >
            <Input
              id="payout-filter-user"
              value={draftFilters.userId}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  userId: event.target.value,
                }))
              }
              placeholder={t("admin.posterPayouts.filters.userPlaceholder")}
            />
          </FilterField>

          <FilterField
            htmlFor="payout-filter-status"
            label={t("admin.posterPayouts.filters.status")}
          >
            <Select
              value={draftFilters.payoutStatus}
              onValueChange={(value) =>
                setDraftFilters((current) => ({
                  ...current,
                  payoutStatus: value as DraftPayoutFilters["payoutStatus"],
                }))
              }
            >
              <SelectTrigger id="payout-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.posterPayouts.filters.allStatuses")}
                </SelectItem>
                {(["pending", "held", "paid", "voided"] as const).map(
                  (status) => (
                    <SelectItem key={status} value={status}>
                      {t(`admin.posterPayouts.status.${status}`)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField
            htmlFor="payout-filter-email"
            label={t("admin.posterPayouts.filters.email")}
          >
            <Input
              id="payout-filter-email"
              type="email"
              value={draftFilters.payoutEmail}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  payoutEmail: event.target.value,
                }))
              }
              placeholder={t("admin.posterPayouts.filters.emailPlaceholder")}
            />
          </FilterField>

          <FilterField
            htmlFor="payout-filter-fraud"
            label={t("admin.posterPayouts.filters.fraud")}
          >
            <Select
              value={draftFilters.fraudStatus}
              onValueChange={(value) =>
                setDraftFilters((current) => ({
                  ...current,
                  fraudStatus: value as DraftPayoutFilters["fraudStatus"],
                }))
              }
            >
              <SelectTrigger id="payout-filter-fraud">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.posterPayouts.filters.allFraudStates")}
                </SelectItem>
                <SelectItem value="flagged">
                  {t("admin.posterPayouts.filters.flagged")}
                </SelectItem>
                <SelectItem value="clear">
                  {t("admin.posterPayouts.filters.clear")}
                </SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField
            htmlFor="payout-filter-period-from"
            label={t("admin.posterPayouts.filters.periodFrom")}
          >
            <DatePicker
              id="payout-filter-period-from"
              value={draftFilters.periodFrom}
              onChange={(periodFrom) =>
                setDraftFilters((current) => ({
                  ...current,
                  periodFrom,
                }))
              }
              placeholder={t("forms.pickDate")}
            />
          </FilterField>

          <FilterField
            htmlFor="payout-filter-period-to"
            label={t("admin.posterPayouts.filters.periodTo")}
          >
            <DatePicker
              id="payout-filter-period-to"
              value={draftFilters.periodTo}
              onChange={(periodTo) =>
                setDraftFilters((current) => ({
                  ...current,
                  periodTo,
                }))
              }
              placeholder={t("forms.pickDate")}
            />
          </FilterField>

          <div className="grid grid-cols-2 gap-3">
            <FilterField
              htmlFor="payout-filter-min-amount"
              label={t("admin.posterPayouts.filters.minAmount")}
            >
              <Input
                id="payout-filter-min-amount"
                type="number"
                min="0"
                step="0.01"
                value={draftFilters.minAmount}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    minAmount: event.target.value,
                  }))
                }
              />
            </FilterField>
            <FilterField
              htmlFor="payout-filter-max-amount"
              label={t("admin.posterPayouts.filters.maxAmount")}
            >
              <Input
                id="payout-filter-max-amount"
                type="number"
                min="0"
                step="0.01"
                value={draftFilters.maxAmount}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    maxAmount: event.target.value,
                  }))
                }
              />
            </FilterField>
          </div>
        </FormGrid>

        {amountRangeInvalid ? (
          <p className="text-sm text-destructive">
            {t("admin.posterPayouts.filters.invalidAmountRange")}
          </p>
        ) : null}

        <Stack direction="horizontal" gap={2} justify="end">
          <Button variant="outline" onClick={resetFilters}>
            {t("admin.posterPayouts.filters.reset")}
          </Button>
          <Button onClick={applyFilters} disabled={amountRangeInvalid}>
            {t("admin.posterPayouts.filters.apply")}
          </Button>
        </Stack>
      </Section>

      {selectedPayoutIds.size > 0 ? (
        <Section variant="surface">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("admin.posterPayouts.bulk.selected", {
                  count: selectedPayoutIds.size,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("admin.posterPayouts.bulk.pendingOnly")}
              </p>
            </div>
            <Stack direction="horizontal" gap={2} wrap>
              <LoadingButton
                variant="outline"
                isLoading={isExporting}
                onClick={handleExport}
              >
                <Download className="size-4" />
                {t("admin.posterPayouts.bulk.exportCsv")}
              </LoadingButton>
              <Button onClick={() => setBulkPaidConfirmationOpen(true)}>
                {t("admin.posterPayouts.bulk.markPaid")}
              </Button>
            </Stack>
          </div>
        </Section>
      ) : null}

      {isLoading ? (
        <LoadingPage className="min-h-[360px]" />
      ) : error ? (
        <Section variant="surface" className="text-center">
          <Stack gap={4} align="center">
            <p className="text-sm text-destructive">
              {getApiErrorMessage(
                error,
                t("admin.posterPayouts.loadError"),
              )}
            </p>
            <Button variant="outline" onClick={() => retry()}>
              {t("admin.posterPayouts.retry")}
            </Button>
          </Stack>
        </Section>
      ) : payouts.length === 0 ? (
        <Section variant="surface" className="text-center">
          <p className="text-sm text-muted-foreground">
            {t("admin.posterPayouts.empty")}
          </p>
        </Section>
      ) : (
        <Stack gap={3}>
            <AdminTable count={page?.total ?? 0} label={t("admin.posterPayouts.tabs.payouts")}
              pagination={{
                currentPage: page?.page ?? 1,
                totalPages: page?.total_pages ?? 1,
                onPageChange: (nextPage) => {
                  setPageNumber(nextPage);
                  setSelectedPayoutIds(new Set());
                },
              }}
              headers={[
                {
                  label: (
                    <Checkbox
                      aria-label={t("admin.posterPayouts.bulk.selectAll")}
                      checked={
                        allSelectableRowsChecked
                          ? true
                          : someSelectableRowsChecked
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(checked) =>
                        toggleAllVisible(checked === true)
                      }
                      disabled={selectableIds.length === 0}
                    />
                  ),
                  className: "w-10",
                },
                { label: t("admin.posterPayouts.columns.promoter") },
                { label: t("admin.posterPayouts.columns.email") },
                { label: t("admin.posterPayouts.columns.period") },
                {
                  label: t("admin.posterPayouts.columns.visitors"),
                  align: "right",
                },
                {
                  label: t("admin.posterPayouts.columns.rate"),
                  align: "right",
                },
                {
                  label: t("admin.posterPayouts.columns.amount"),
                  align: "right",
                },
                { label: t("admin.posterPayouts.columns.status") },
                { label: t("admin.posterPayouts.columns.fraud") },
                {
                  label: t("admin.posterPayouts.columns.actions"),
                  align: "right",
                },
              ]}
            >
              {payouts.map((payout) => {
                const selectable = payout.status === "pending";
                return (
                  <TableRow
                    key={payout.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setOpenPayoutId(payout.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpenPayoutId(payout.id);
                      }
                    }}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={t("admin.posterPayouts.bulk.selectPayout", {
                          email: payout.payout_email,
                        })}
                        checked={selectedPayoutIds.has(payout.id)}
                        onCheckedChange={(checked) =>
                          togglePayout(payout.id, checked === true)
                        }
                        disabled={!selectable}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="max-w-52 break-all font-mono text-xs text-muted-foreground">
                        {payout.user_id}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {payout.payout_email}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatPeriod(payout.period)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {payout.scan_count.toLocaleString(i18n.language)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatCurrency(payout.rate_cents)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {formatCurrency(payout.amount_cents)}
                    </TableCell>
                    <TableCell>
                      <PosterPayoutStatusBadge status={payout.status} />
                    </TableCell>
                    <TableCell>
                      <FraudIndicator payout={payout} />
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpenPayoutId(payout.id)}
                      >
                        {t("admin.posterPayouts.actions.review")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </AdminTable>
          {isFetching ? (
            <p className="text-xs text-muted-foreground" role="status">
              {t("admin.posterPayouts.refreshing")}
            </p>
          ) : null}
        </Stack>
      )}

      <PayoutDetailDialog
        key={openPayoutId ?? "closed-payout"}
        payoutId={openPayoutId}
        detail={detail}
        isLoading={isDetailLoading}
        error={detailError}
        isTransitioning={isTransitioning}
        onClose={() => setOpenPayoutId(null)}
        onRetry={() => {
          void retryDetail();
        }}
        onTransition={handleTransition}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        formatDateTime={formatDateTime}
      />

      <Dialog
        open={bulkPaidConfirmationOpen}
        onOpenChange={setBulkPaidConfirmationOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.posterPayouts.bulk.confirmPaidTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.posterPayouts.bulk.confirmPaidDescription", {
                count: selectedPayoutIds.size,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
            {t("admin.posterPayouts.externalPaymentWarning")}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkPaidConfirmationOpen(false)}
              disabled={isBulkMarkingPaid}
            >
              {t("common.cancel")}
            </Button>
            <LoadingButton
              isLoading={isBulkMarkingPaid}
              onClick={handleBulkMarkPaid}
            >
              {t("admin.posterPayouts.bulk.confirmMarkPaid")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function FilterField({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function FraudIndicator({ payout }: { payout: AdminPosterPayout }) {
  const { t } = useTranslation();
  const fraudStatus =
    payout.fraud_status ??
    (payout.status === "held" ? "flagged" : "clear");
  if (fraudStatus !== "flagged") {
    return (
      <span className="text-xs text-muted-foreground">
        {t("admin.posterPayouts.fraudClear")}
      </span>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1 border-destructive/30 bg-destructive/10 text-destructive"
    >
      <ShieldAlert className="size-3.5" />
      {t("admin.posterPayouts.fraudFlagged")}
    </Badge>
  );
}
