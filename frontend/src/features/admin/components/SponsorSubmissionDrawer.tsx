import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { reviewSponsorSubmission, type SponsorSubmission } from "@/features/admin/api/admin.api";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/shared/ui/drawer";
import { DrawerBody, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { FieldError } from "@/shared/ui/field";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";

export function SponsorSubmissionDrawer({ submission, onClose }: { submission: SponsorSubmission; onClose: () => void }) {
  const { t } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: (status: "approved" | "rejected") => reviewSponsorSubmission(submission.id, status),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.sponsorSubmissions.all });
    },
  });
  return (
    <Drawer open onOpenChange={open => { if (!open && !review.isPending) onClose(); }}>
      <DrawerContent>
        <DrawerHeader><DrawerTitle>{submission.business_name}</DrawerTitle><DrawerDescription>{t("admin.sponsors.submissions")}</DrawerDescription></DrawerHeader>
        <DrawerBody>
          <AdminStatusBadge status={submission.status} />
          <Section variant="divided" title={t("schools.school")}><p>{getSchoolName(submission.school)}</p></Section>
          <Section variant="divided" title={t("contact.businessSupport.fields.email.label")}><p>{submission.email}</p></Section>
          <p className="whitespace-pre-wrap break-words text-sm">{submission.message}</p>
          <p className="text-sm text-muted-foreground">{t("admin.sponsors.reviewHelp")}</p>
          {review.error ? <FieldError role="alert">{getApiErrorMessage(review.error)}</FieldError> : null}
        </DrawerBody>
        {submission.status === "pending" && <DrawerFooter><Stack direction="horizontal" gap={2}>
          <Button disabled={review.isPending} onClick={() => review.mutate("approved")}>{t("admin.approve")}</Button>
          <Button variant="outline" disabled={review.isPending} onClick={() => review.mutate("rejected")}>{t("admin.reject")}</Button>
        </Stack></DrawerFooter>}
      </DrawerContent>
    </Drawer>
  );
}
