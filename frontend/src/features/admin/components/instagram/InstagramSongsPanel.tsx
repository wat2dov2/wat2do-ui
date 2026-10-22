import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { useInstagramSongs } from "@/features/admin/hooks/useInstagramSongs";
import { Section, Stack } from "@/shared/layout";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { toast } from "@/shared/hooks/use-toast";
import { Button } from "@/shared/ui/button";
import { Trash2 } from "@/shared/ui/doodle-icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { LoadingButton } from "@/shared/ui/loading-button";
import { TableCell, TableRow } from "@/shared/ui/table";

/** The song list the Mac's emulator draws from after each carousel publishes. */
export function InstagramSongsPanel() {
  const { t, i18n } = useTranslation();
  const { songs, isLoading, error, retry, addSong, isAdding, deleteSong, deletingSongId } =
    useInstagramSongs();
  const [query, setQuery] = useState("");

  const submit = async () => {
    try {
      await addSong(query.trim());
      setQuery("");
    } catch (addError) {
      toast({
        title: t("admin.instagramPublishing.songs.addError"),
        description: getApiErrorMessage(addError),
        variant: "destructive",
      });
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSong(id);
    } catch (deleteError) {
      toast({
        title: t("admin.instagramPublishing.songs.deleteError"),
        description: getApiErrorMessage(deleteError),
        variant: "destructive",
      });
    }
  };

  if (error && !songs.length) {
    return (
      <Section variant="surface" className="text-center">
        <Stack gap={4} align="center">
          <p className="text-sm text-destructive">
            {getApiErrorMessage(error, t("admin.instagramPublishing.songs.loadError"))}
          </p>
          <Button variant="outline" onClick={() => retry()}>
            {t("admin.instagramPublishing.retry")}
          </Button>
        </Stack>
      </Section>
    );
  }

  return (
    <Stack gap={6}>
      <Section variant="surface">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) void submit();
          }}
        >
          <Stack gap={2}>
            <Label htmlFor="instagram-song-query">
              {t("admin.instagramPublishing.songs.query")}
            </Label>
            <Stack direction="horizontal" gap={2}>
              <Stack grow className="min-w-0">
                <Input
                  id="instagram-song-query"
                  value={query}
                  maxLength={200}
                  disabled={isAdding}
                  placeholder={t("admin.instagramPublishing.songs.placeholder")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Stack>
              <LoadingButton
                type="submit"
                disabled={!query.trim()}
                isLoading={isAdding}
                loadingText={t("common.pleaseWait")}
              >
                {t("admin.instagramPublishing.songs.add")}
              </LoadingButton>
            </Stack>
            <p className="text-sm text-muted-foreground">
              {t("admin.instagramPublishing.songs.help")}
            </p>
          </Stack>
        </form>
      </Section>

      <AdminTable
        isLoading={isLoading}
        count={songs.length}
        label={t("admin.instagramPublishing.songs.label")}
        headers={[
          { label: t("admin.instagramPublishing.songs.columns.song") },
          { label: t("admin.instagramPublishing.songs.columns.added") },
          { label: <span className="sr-only">{t("admin.instagramPublishing.songs.delete")}</span>, align: "right" },
        ]}
      >
        {songs.length === 0 ? (
          <TableRow>
            <TableCell colSpan={3} className="text-center text-muted-foreground">
              {t("admin.instagramPublishing.songs.empty")}
            </TableCell>
          </TableRow>
        ) : songs.map((song) => (
          <TableRow key={song.id}>
            <TableCell>{song.query}</TableCell>
            <TableCell>
              {new Date(song.created_at).toLocaleDateString(i18n.language || "en-US")}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("admin.instagramPublishing.songs.deleteSong", { song: song.query })}
                disabled={deletingSongId === song.id}
                onClick={() => void remove(song.id)}
              >
                <Trash2 />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </AdminTable>
    </Stack>
  );
}
