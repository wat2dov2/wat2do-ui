import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AdminPosterPayoutDetail,
  PosterPayoutStatus,
} from "@/features/admin/api/admin.api";
import { PosterPayoutStatusBadge } from "@/features/admin/components/posters/PosterPayoutStatusBadge";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { FormActions, FormGrid, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { LoadingButton } from "@/shared/ui/loading-button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { TableCell, TableRow } from "@/shared/ui/table";
import { Textarea } from "@/shared/ui/textarea";

type ReviewAction = "hold" | "release" | "void" | "paid";

interface PayoutDetailDialogProps {
  payoutId: string | null;
  detail: AdminPosterPayoutDetail | undefined;
  isLoading: boolean;
  error: unknown;
  isTransitioning: boolean;
  onClose: () => void;
  onRetry: () => void;
  onTransition: (
    payoutId: string,
    status: PosterPayoutStatus,
    notes?: string,
  ) => Promise<void>;
  formatCurrency: (cents: number) => string;
  formatDate: (value: string | null) => string;
  formatDateTime: (value: string | null) => string;
}

const actionTargets: Record<ReviewAction, PosterPayoutStatus> = {
  hold: "held",
  release: "pending",
  void: "voided",
  paid: "paid",
};

function availableActions(status: PosterPayoutStatus): ReviewAction[] {
  if (status === "pending") return ["hold", "paid"];
  if (status === "held") return ["release", "void"];
  return [];
}

function requiresNotes(action: ReviewAction): boolean {
  return action === "hold" || action === "void";
}

function compareReviewEvents(
  left: AdminPosterPayoutDetail["review_history"][number],
  right: AdminPosterPayoutDetail["review_history"][number],
): number {
  const reviewedAtDifference =
    Date.parse(left.reviewed_at) - Date.parse(right.reviewed_at);
  return reviewedAtDifference || left.id.localeCompare(right.id);
}

export function PayoutDetailDialog({
  payoutId,
  detail,
  isLoading,
  error,
  isTransitioning,
  onClose,
  onRetry,
  onTransition,
  formatCurrency,
  formatDate,
  formatDateTime,
}: PayoutDetailDialogProps) {
  const { t } = useTranslation();
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [notes, setNotes] = useState("");

  const payout = detail?.payout;
  const actions = payout ? availableActions(payout.status) : [];
  const reviewHistory = detail
    ? [...detail.review_history].sort(compareReviewEvents)
    : [];
  const notesMissing = reviewAction !== null && requiresNotes(reviewAction) && !notes.trim();

  const handleTransition = async () => {
    if (!payout || !reviewAction || notesMissing) return;
    await onTransition(
      payout.id,
      actionTargets[reviewAction],
      requiresNotes(reviewAction) ? notes.trim() : undefined,
    );
    setReviewAction(null);
    setNotes("");
  };

  return (
    <Dialog open={payoutId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{t("admin.posterPayouts.detail.title")}</DialogTitle>
          <DialogDescription>
            {t("admin.posterPayouts.detail.description")}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <LoadingPage className="min-h-[360px]" />
        ) : error || !detail || !payout ? (
          <Stack align="center" gap={4} className="min-h-[280px] justify-center px-6 pb-6">
            <p className="text-sm text-destructive">
              {t("admin.posterPayouts.detail.loadError")}
            </p>
            <Button variant="outline" onClick={onRetry}>
              {t("admin.posterPayouts.retry")}
            </Button>
          </Stack>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-2">
            <Section variant="surface">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Stack gap={1}>
                  <p className="text-sm font-semibold text-foreground">
                    {payout.payout_email}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {payout.user_id}
                  </p>
                </Stack>
                <PosterPayoutStatusBadge status={payout.status} />
              </div>

              <FormGrid columns={3}>
                <DetailValue
                  label={t("admin.posterPayouts.columns.period")}
                  value={`${formatDate(detail.period_start.slice(0, 10))} - ${formatDate(detail.period_end.slice(0, 10))}`}
                />
                <DetailValue
                  label={t("admin.posterPayouts.columns.visitors")}
                  value={payout.scan_count.toLocaleString()}
                />
                <DetailValue
                  label={t("admin.posterPayouts.columns.amount")}
                  value={formatCurrency(payout.amount_cents)}
                />
                <DetailValue
                  label={t("admin.posterPayouts.columns.rate")}
                  value={formatCurrency(payout.rate_cents)}
                />
                <DetailValue
                  label={t("admin.posterPayouts.detail.createdAt")}
                  value={formatDateTime(payout.created_at)}
                />
                <DetailValue
                  label={t("admin.posterPayouts.detail.updatedAt")}
                  value={formatDateTime(payout.updated_at)}
                />
                {payout.paid_at ? (
                  <DetailValue
                    label={t("admin.posterPayouts.detail.paidAt")}
                    value={formatDateTime(payout.paid_at)}
                  />
                ) : null}
                <DetailValue
                  label={t("admin.posterPayouts.detail.notes")}
                  value={
                    payout.notes ?? t("admin.posterPayouts.detail.noNotes")
                  }
                />
              </FormGrid>
            </Section>

            <Section
              variant="surface"
              title={t("admin.posterPayouts.detail.contributions")}
              description={t("admin.posterPayouts.detail.contributionsDescription")}
            >
              {detail.contributions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("admin.posterPayouts.detail.noContributions")}
                </p>
              ) : (
                <AdminTable
                  headers={[
                    { label: t("admin.posterPayouts.detail.poster") },
                    { label: t("admin.posterPayouts.detail.template") },
                    {
                      label: t("admin.posterPayouts.columns.visitors"),
                      align: "right",
                    },
                    {
                      label: t("admin.posterPayouts.columns.amount"),
                      align: "right",
                    },
                  ]}
                >
                  {detail.contributions.map((contribution) => (
                    <TableRow key={contribution.qr_code_id}>
                      <TableCell>
                        <p className="text-sm font-medium text-foreground">
                          {contribution.name}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {contribution.qr_code_id}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {contribution.poster_template_id ??
                          t("admin.posterPayouts.detail.unknownTemplate")}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {contribution.scan_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatCurrency(contribution.amount_cents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </AdminTable>
              )}
            </Section>

            <Section
              variant="surface"
              title={t("admin.posterPayouts.detail.fraudReview")}
            >
              {detail.fraud_reasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("admin.posterPayouts.detail.noFraudReasons")}
                </p>
              ) : (
                <Stack gap={3}>
                  {detail.fraud_reasons.map((reason, index) => (
                    <div
                      key={`${reason.code}-${index}`}
                      className="rounded-xl border border-destructive/30 bg-destructive/10 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm font-semibold text-destructive">
                          {reason.code}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("admin.posterPayouts.detail.riskSummary", {
                            points: reason.points,
                            count: reason.affected_scan_count,
                          })}
                        </p>
                      </div>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-xs text-muted-foreground">
                        {JSON.stringify(reason.evidence, null, 2)}
                      </pre>
                    </div>
                  ))}
                </Stack>
              )}
            </Section>

            <Section
              variant="surface"
              title={t("admin.posterPayouts.detail.reviewHistory")}
            >
              {reviewHistory.length > 0 ? (
                <ol
                  aria-label={t("admin.posterPayouts.detail.reviewHistory")}
                  className="space-y-3"
                  data-testid="payout-review-history"
                >
                  {reviewHistory.map((review) => (
                    <li
                      key={review.id}
                      data-testid={`payout-review-event-${review.id}`}
                      className="rounded-xl border border-border bg-background p-4"
                    >
                      <Stack gap={3}>
                        <p className="text-sm font-semibold text-foreground">
                          {t(
                            `admin.posterPayouts.detail.reviewEvents.${review.from_status}_${review.to_status}`,
                          )}
                        </p>
                        <FormGrid columns={2}>
                          <DetailValue
                            label={t("admin.posterPayouts.detail.reviewedBy")}
                            value={review.reviewed_by}
                          />
                          <DetailValue
                            label={t("admin.posterPayouts.detail.reviewedAt")}
                            value={formatDateTime(review.reviewed_at)}
                          />
                          {review.notes ? (
                            <DetailValue
                              label={t("admin.posterPayouts.detail.notes")}
                              value={review.notes}
                            />
                          ) : null}
                        </FormGrid>
                      </Stack>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("admin.posterPayouts.detail.noReviewHistory")}
                </p>
              )}
            </Section>

            {actions.length > 0 ? (
              <Section
                variant="surface"
                title={t("admin.posterPayouts.detail.actions")}
              >
                <Stack direction="horizontal" gap={2} wrap>
                  {actions.map((action) => (
                    <Button
                      key={action}
                      variant={action === "void" ? "destructive" : "outline"}
                      selected={reviewAction === action}
                      onClick={() => {
                        setReviewAction(action);
                        setNotes("");
                      }}
                    >
                      {t(`admin.posterPayouts.actions.${action}`)}
                    </Button>
                  ))}
                </Stack>

                {reviewAction ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <Stack gap={4}>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {t(`admin.posterPayouts.confirm.${reviewAction}Title`)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t(`admin.posterPayouts.confirm.${reviewAction}Description`)}
                        </p>
                      </div>

                      {requiresNotes(reviewAction) ? (
                        <Textarea
                          aria-label={t("admin.posterPayouts.detail.notes")}
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                          placeholder={t("admin.posterPayouts.detail.notesPlaceholder")}
                          maxLength={10_000}
                        />
                      ) : null}

                      <FormActions>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setReviewAction(null);
                            setNotes("");
                          }}
                          disabled={isTransitioning}
                        >
                          {t("common.cancel")}
                        </Button>
                        <LoadingButton
                          variant={reviewAction === "void" ? "destructive" : "primary"}
                          isLoading={isTransitioning}
                          disabled={notesMissing}
                          onClick={handleTransition}
                        >
                          {t(`admin.posterPayouts.actions.${reviewAction}`)}
                        </LoadingButton>
                      </FormActions>
                    </Stack>
                  </div>
                ) : null}
              </Section>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm text-foreground">{value}</p>
    </div>
  );
}
