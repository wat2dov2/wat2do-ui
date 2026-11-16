import { Fragment, useState, type ReactNode } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Section } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemLink, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { IconTile } from "@/shared/ui/tile";

/** How many rows a profile list shows before "Show all". */
const PREVIEW_ROWS = 5;

export interface ProfileListEmpty {
  icon: LucideIcon;
  /** What the list will hold once there is something to show. */
  text: string;
  /** Where to go find something to add to it. */
  action: { label: string; href: string };
}

interface ProfileListSectionProps<Row> {
  /** Its heading; it shows its first few rows until the visitor asks for all of them. */
  title: string;
  rows: Row[];
  isPending: boolean;
  empty: ProfileListEmpty;
  rowKey: (row: Row) => string | number;
  renderRow: (row: Row) => ReactNode;
}

/**
 * One of the profile's lists: its rows on one bordered surface, hairlines
 * between them. An empty list keeps the same surface and says how to fill it.
 */
export function ProfileListSection<Row>({ title, rows, isPending, empty, rowKey, renderRow }: ProfileListSectionProps<Row>) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <Section
      title={title}
      actions={
        rows.length > PREVIEW_ROWS ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? t("profile.showFewer") : t("profile.showAll", { count: rows.length })}
          </Button>
        ) : undefined
      }
    >
      <ItemGroup>
        {isPending ? (
          <ProfileRowsSkeleton />
        ) : rows.length === 0 ? (
          <Item size="sm">
            <ItemMedia>
              <IconTile icon={empty.icon} />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>{empty.text}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button asChild variant="ghost" size="sm">
                <NextLink href={empty.action.href}>{empty.action.label}</NextLink>
              </Button>
            </ItemActions>
          </Item>
        ) : (
          visible.map((row) => <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>)
        )}
      </ItemGroup>
    </Section>
  );
}

/** What a row opens: a page (on this site or another school's), or something on this one, such as a drawer. */
export type ProfileRowTarget = { href: string } | { onOpen: () => void };

interface ProfileRowProps {
  /** Its image tile. */
  media: ReactNode;
  title: string;
  description?: ReactNode;
  /** Null for a row that opens nothing, such as a submission still in review. */
  target: ProfileRowTarget | null;
  /** Its own controls, which keep their clicks; a row without any shows a chevron when it opens something. */
  actions?: ReactNode;
}

/** One row of a profile list: a click anywhere on it opens its target. */
export function ProfileRow({ media, title, description, target, actions }: ProfileRowProps) {
  return (
    <Item size="sm">
      <ItemMedia>{media}</ItemMedia>
      <ItemContent>
        <ItemTitle>
          {target === null ? (
            title
          ) : "href" in target ? (
            <ItemLink asChild>
              <NextLink href={target.href}>{title}</NextLink>
            </ItemLink>
          ) : (
            <ItemLink type="button" onClick={target.onOpen}>
              {title}
            </ItemLink>
          )}
        </ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      {actions ? (
        <ItemActions>{actions}</ItemActions>
      ) : target ? (
        // Under the row's link, unlike its actions, so a click on it opens the row.
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
      ) : null}
    </Item>
  );
}

/** Two rows' worth of the list while it loads, each the height of a real row. */
export function ProfileRowsSkeleton() {
  return (
    <>
      {[0, 1].map((index) => (
        <Item key={index} size="sm" aria-hidden="true">
          <ItemMedia>
            <Skeleton className="size-10 rounded-xl" />
          </ItemMedia>
          <ItemContent>
            <span className="w-2/3 text-sm leading-snug"><SkeletonLine /></span>
            <span className="w-1/2 text-sm"><SkeletonLine /></span>
          </ItemContent>
        </Item>
      ))}
    </>
  );
}
