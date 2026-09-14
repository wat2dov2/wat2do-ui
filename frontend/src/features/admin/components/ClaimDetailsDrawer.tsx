import { useTranslation } from "react-i18next";
import type { ClubClaim } from "@/features/admin/api/admin.api";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { SUBMISSION_STATUSES } from "@/shared/constants/statuses";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/shared/ui/drawer";
import { DrawerBody, Section } from "@/shared/layout";
import { Link } from "@/shared/ui/link";

export function ClaimDetailsDrawer({ claim, onClose }: { claim: ClubClaim; onClose: () => void }) {
  const { t } = useTranslation();
  const status = SUBMISSION_STATUSES.find(value => value === claim.status);
  return (
    <Drawer open onOpenChange={open => { if (!open) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("admin.claimRequests")}</DrawerTitle>
          <DrawerDescription>{claim.clubs?.club_name ?? claim.executive_role}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {status && <AdminStatusBadge status={status} />}
          {claim.clubs && <Section title={t("navigation.clubs")}><p>{claim.clubs.club_name} ({claim.clubs.school})</p></Section>}
          {claim.users && <Section title={t("admin.submittedBy")}><p>{claim.users.full_name}</p><p>{claim.users.email}</p></Section>}
          <Section title={t("admin.executiveRole")}><p>{claim.executive_role}</p></Section>
          <Section title={t("admin.proofUrl")}>
            {claim.proof_url ? <Link href={claim.proof_url} target="_blank" rel="noopener noreferrer">{t("admin.viewProof")}</Link> : <p>{t("admin.noProofProvided")}</p>}
          </Section>
          {claim.rejection_reason && <Section title={t("admin.rejectionReason")}><p>{claim.rejection_reason}</p></Section>}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
