import { useTranslation } from "react-i18next";
import type { SocialSong } from "@/features/admin/lib/socialAccounts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

/** Each song the emulator added to our carousels, ranked by the likes those posts got. */
export function SocialSongsTable({ songs }: { songs: SocialSong[] }) {
  const { t, i18n } = useTranslation();
  const number = (value: number | null) => (value === null ? "-" : value.toLocaleString(i18n.language, { maximumFractionDigits: 1 }));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.socialAccounts.songs.track")}</TableHead>
          <TableHead>{t("admin.socialAccounts.songs.posts")}</TableHead>
          <TableHead>{t("admin.socialAccounts.songs.averageLikes")}</TableHead>
          <TableHead>{t("admin.socialAccounts.songs.averageComments")}</TableHead>
          <TableHead>{t("admin.socialAccounts.songs.accounts")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {songs.map(song => (
          <TableRow key={song.track}>
            <TableCell>{song.track}</TableCell>
            <TableCell>{song.posts.length.toLocaleString(i18n.language)}</TableCell>
            <TableCell>{number(song.averageLikes)}</TableCell>
            <TableCell>{number(song.averageComments)}</TableCell>
            <TableCell>{[...new Set(song.posts.map(post => `@${post.username}`))].join(", ")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
