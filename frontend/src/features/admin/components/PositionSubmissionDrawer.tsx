import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { reviewPositionSubmission } from "@/features/admin/api/admin.api";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Button } from "@/shared/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/shared/ui/drawer";
import { DrawerBody, Section, Stack } from "@/shared/layout";
import { FieldError } from "@/shared/ui/field";
import { Link } from "@/shared/ui/link";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import type { ApiPositionSubmissionResponse } from "@/shared/generated";
import { getClubById } from "@/features/clubs";


interface PositionSubmissionDrawerProps {
  submission: ApiPositionSubmissionResponse;
  onClose: () => void;
}

export function PositionSubmissionDrawer({ submission: selected, onClose }: PositionSubmissionDrawerProps) {
  const { t } = useTranslation();
  const data = selected.position_data;
  const club = useQuery({ queryKey: queryKeys.clubs.detail(data.club_id), queryFn: () => getClubById(data.club_id) });
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) => reviewPositionSubmission(id, status),
    onSuccess: async () => {
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.positionSubmissions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.positions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clubs.all }),
      ]);
    },
  });
  return (
      <Drawer open onOpenChange={open => { if (!open && !review.isPending) onClose(); }}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>{data.title}</DrawerTitle><DrawerDescription>{t("positions.submissions")}</DrawerDescription></DrawerHeader>
          <DrawerBody>
            <Stack gap={4}>
              <Section title={t("navigation.clubs")}>
                {club.isPending ? <p>{t("common.loading")}</p> : club.isError ? <Button variant="outline" onClick={() => void club.refetch()}>{t("common.tryAgain")}</Button> : <p>{club.data.club_name} ({club.data.school})</p>}
              </Section>
              <p>{data.description}</p>
              <p>{t(`positions.types.${data.position_type}`)}</p>
              <p>{t(data.is_paid == null ? "positions.unknown" : data.is_paid ? "positions.paid" : "positions.unpaid")}</p>
              {([['positions.commitmentLabel', data.commitment], ['positions.compensationLabel', data.compensation], ['positions.locationLabel', data.location], ['positions.contactLabel', data.contact_email], ['positions.deadlineLabel', data.deadline_at ?? data.deadline_date]] as const).map(([label, value]) => value ? <Section key={label} title={t(label)}><p>{value}</p></Section> : null)}
              <Section title={t("positions.requirements")}><ul>{data.requirements?.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></Section>
              <Link href={data.source_url} target="_blank" rel="noopener noreferrer">{t("forms.sourceUrl")}</Link>
              {data.source_image_url ? <Link href={data.source_image_url} target="_blank" rel="noopener noreferrer">{t("qrCode.posterPreview")}</Link> : null}
            </Stack>
            {review.error ? <FieldError role="alert">{getApiErrorMessage(review.error)}</FieldError> : null}
          </DrawerBody>
          {selected.status === "pending" && <DrawerFooter><Stack direction="horizontal" gap={2}>
              <Button disabled={review.isPending} onClick={() => review.mutate({ id: selected.id, status: "approved" })}>{t("admin.approve")}</Button>
              <Button variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: selected.id, status: "rejected" })}>{t("admin.reject")}</Button>
          </Stack></DrawerFooter>}
        </DrawerContent>
      </Drawer>
  );
}
