import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Clock,
  DollarSign,
  Instagram,
  Mail,
  MapPin,
} from "@/shared/ui/doodle-icons";
import type { LucideIcon } from "@/shared/ui/doodle-icons";
import { PositionCardImage } from "@/features/positions/components/PositionCardImage";
import { formatPositionDeadline } from "@/features/positions/lib/positionDates";
import { Button } from "@/shared/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/item";
import { Link } from "@/shared/ui/link";
import { Separator } from "@/shared/ui/separator";
import { DrawerBody, FormGrid, Section, Stack } from "@/shared/layout";
import { organizationPagePath } from "@/shared/constants/routes";
import { sanitizeHref } from "@/shared/utils/url";
import type { Position } from "@/shared/types";

interface PositionDetailsDrawerProps {
  position: Position | null;
  onClose: () => void;
}

interface PositionDetailItemProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

function PositionDetailItem({
  icon: Icon,
  label,
  value,
}: PositionDetailItemProps) {
  return (
    <Item className="flex-col items-start">
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent className="w-full">
        <ItemTitle>{label}</ItemTitle>
        <ItemDescription className="line-clamp-none">{value}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

export function PositionDetailsDrawer({
  position,
  onClose,
}: PositionDetailsDrawerProps) {
  const { t, i18n } = useTranslation();
  const deadline = useMemo(
    () => (position ? formatPositionDeadline(position, i18n.language) : null),
    [i18n.language, position],
  );
  const sourceHref = sanitizeHref(position?.source_url ?? "");

  return (
    <Drawer
      open={position !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="overflow-hidden p-0 [&_[data-slot=drawer-handle]]:hidden data-[vaul-drawer-direction=bottom]:max-w-screen-lg">
        {position ? (
          <>
            <DrawerHeader className="text-left">
              <Stack direction="horizontal" justify="end" gap={2} wrap>
                {sourceHref ? (
                  <Button asChild>
                    <a
                      href={sourceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Instagram />
                      {t("positions.viewSource")}
                    </a>
                  </Button>
                ) : null}
              </Stack>
            </DrawerHeader>

            <Separator />

            <DrawerBody>
              <DrawerDescription className="sr-only">
                {t("positions.drawerDescription", {
                  title: position.title,
                  organization: position.organization_name,
                })}
              </DrawerDescription>

              <FormGrid columns={2}>
                <PositionCardImage
                  position={position}
                  variant="detail"
                  onOrganizationFilterSelect={onClose}
                />

                <Stack gap={6}>
                  <Stack gap={2} align="start">
                    <DrawerTitle className="text-left text-2xl font-bold leading-tight sm:text-3xl">
                      {position.title}
                    </DrawerTitle>
                    <Link
                      href={organizationPagePath(position.organization_id)}
                      variant="muted"
                    >
                      {position.organization_name}
                    </Link>
                  </Stack>

                  <FormGrid columns={2} collapse={false}>
                    {deadline ? (
                      <PositionDetailItem
                        icon={CalendarDays}
                        label={t("positions.deadlineLabel")}
                        value={deadline}
                      />
                    ) : null}
                    {position.commitment ? (
                      <PositionDetailItem
                        icon={Clock}
                        label={t("positions.commitmentLabel")}
                        value={position.commitment}
                      />
                    ) : null}
                    {position.location ? (
                      <PositionDetailItem
                        icon={MapPin}
                        label={t("positions.locationLabel")}
                        value={position.location}
                      />
                    ) : null}
                    {position.compensation ? (
                      <PositionDetailItem
                        icon={DollarSign}
                        label={t("positions.compensationLabel")}
                        value={position.compensation}
                      />
                    ) : null}
                    {position.contact_email ? (
                      <PositionDetailItem
                        icon={Mail}
                        label={t("positions.contactLabel")}
                        value={position.contact_email}
                      />
                    ) : null}
                  </FormGrid>

                  <Section title={t("positions.aboutPosition")}>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {position.description}
                    </p>
                  </Section>

                  {position.requirements.length > 0 ? (
                    <Section title={t("positions.requirements")}>
                      <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                        {position.requirements.map((requirement) => (
                          <li key={requirement}>{requirement}</li>
                        ))}
                      </ul>
                    </Section>
                  ) : null}
                </Stack>
              </FormGrid>
            </DrawerBody>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
