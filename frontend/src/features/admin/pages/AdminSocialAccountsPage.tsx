import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Music } from "lucide-react";
import {
  ACCOUNT_SORTS,
  POST_SORTS,
  sortAccounts,
  sortPosts,
  type AccountSort,
  type PostSort,
} from "@/features/admin/lib/socialAccounts";
import { useSocialAccounts } from "@/features/admin/hooks/useSocialAccounts";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { SocialAccountRow } from "@/features/admin/components/social/SocialAccountRow";
import { SocialPostTile } from "@/features/admin/components/social/SocialPostTile";
import { SocialSongsTable } from "@/features/admin/components/social/SocialSongsTable";
import { FormGrid, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { Button } from "@/shared/ui/button";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { formatRelativeTime } from "@/shared/utils/relativeTime";

/** Every wat2do Instagram account at once: followers, engagement, each post and its song, read daily. */
export function AdminSocialAccountsPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { query, readAt, accounts, posts, songs, summary, music, capturedAt } = useSocialAccounts();
  const [accountSort, setAccountSort] = useState<AccountSort>("followers");
  const [postSort, setPostSort] = useState<PostSort>("newest");
  const [postAccount, setPostAccount] = useState("all");
  const number = (value: number | null) => (value === null ? "-" : value.toLocaleString(i18n.language, { maximumFractionDigits: 1 }));

  const header = (
    <AdminPageHeader
      icon={BarChart3}
      title={t("admin.socialAccounts.title")}
      description={capturedAt ? t("admin.socialAccounts.updated", { time: formatRelativeTime(capturedAt, t) }) : t("admin.socialAccounts.description")}
      onBack={onBack}
    />
  );
  if (query.isError) {
    return <Stack gap={5}>{header}<Button variant="outline" onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button></Stack>;
  }
  if (query.isPending) return <Stack gap={5}>{header}<Skeleton className="h-96 w-full" /></Stack>;
  if (!capturedAt) {
    return (
      <Stack gap={5}>
        {header}
        <AdminEmptyState icon={BarChart3} title={t("admin.socialAccounts.emptyTitle")} description={t("admin.socialAccounts.emptyDescription")} />
      </Stack>
    );
  }

  const tiles = [
    { label: t("admin.socialAccounts.summary.accounts"), value: number(summary.accounts), detail: summary.needingAttention ? t("admin.socialAccounts.summary.needingAttention", { value: number(summary.needingAttention) }) : null },
    { label: t("admin.socialAccounts.summary.followers"), value: number(summary.followers), detail: summary.followerChange === null ? null : `${summary.followerChange > 0 ? "+" : ""}${number(summary.followerChange)}` },
    { label: t("admin.socialAccounts.summary.recentPosts"), value: number(summary.recentPosts), detail: null },
    { label: t("admin.socialAccounts.summary.averageLikes"), value: number(summary.averageLikes), detail: null },
  ];
  const shownPosts = sortPosts(postAccount === "all" ? posts : posts.filter(post => post.account_key === postAccount), postSort);

  return (
    <Stack gap={5}>
      {header}
      <FormGrid columns={4}>
        {tiles.map(tile => (
          <Item key={tile.label} variant="outline" size="sm">
            <ItemContent>
              <ItemDescription>{tile.label}</ItemDescription>
              <ItemTitle>{tile.value}</ItemTitle>
              {tile.detail ? <ItemDescription>{tile.detail}</ItemDescription> : null}
            </ItemContent>
          </Item>
        ))}
      </FormGrid>
      <Tabs defaultValue="accounts">
        <Stack gap={5}>
          <TabsList aria-label={t("admin.socialAccounts.tabs.label")}>
            <TabsTrigger value="accounts">{t("admin.socialAccounts.tabs.accounts")}</TabsTrigger>
            <TabsTrigger value="posts">{t("admin.socialAccounts.tabs.posts")}</TabsTrigger>
            <TabsTrigger value="songs">{t("admin.socialAccounts.tabs.songs")}</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts">
            <Stack gap={4}>
              <FilterBar>
                <Select value={accountSort} onValueChange={value => setAccountSort(value as AccountSort)}>
                  <SelectTrigger aria-label={t("admin.socialAccounts.sortLabel")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_SORTS.map(sort => <SelectItem key={sort} value={sort}>{t(`admin.socialAccounts.accountSorts.${sort}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterBar>
              {sortAccounts(accounts, accountSort).map(account => <SocialAccountRow key={account.account_key} account={account} readAt={readAt} />)}
            </Stack>
          </TabsContent>
          <TabsContent value="posts">
            <Stack gap={4}>
              <FilterBar>
                <Select value={postAccount} onValueChange={setPostAccount}>
                  <SelectTrigger aria-label={t("admin.socialAccounts.accountLabel")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    {accounts.map(account => <SelectItem key={account.account_key} value={account.account_key}>@{account.username}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={postSort} onValueChange={value => setPostSort(value as PostSort)}>
                  <SelectTrigger aria-label={t("admin.socialAccounts.sortLabel")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POST_SORTS.map(sort => <SelectItem key={sort} value={sort}>{t(`admin.socialAccounts.postSorts.${sort}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterBar>
              <FormGrid columns="thumbnails">
                {shownPosts.map(post => <SocialPostTile key={post.media_id} post={post} username={post.username} layout="gallery" />)}
              </FormGrid>
            </Stack>
          </TabsContent>
          <TabsContent value="songs">
            <Stack gap={4}>
              <p className="text-sm text-muted-foreground">{t("admin.socialAccounts.songs.summary", { added: music.added, failed: music.failed, pending: music.pending })}</p>
              {songs.length ? <SocialSongsTable songs={songs} /> : (
                <AdminEmptyState icon={Music} title={t("admin.socialAccounts.songs.emptyTitle")} description={t("admin.socialAccounts.songs.emptyDescription")} />
              )}
            </Stack>
          </TabsContent>
        </Stack>
      </Tabs>
    </Stack>
  );
}
