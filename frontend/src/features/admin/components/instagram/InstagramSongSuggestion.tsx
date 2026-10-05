import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Card, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card";
import { Link } from "@/shared/ui/link";

/** A saved recommendation, shown consistently across draft and published batches. */
export function InstagramSongSuggestion({ song }: {
  song: ApiInstagramPublishBatchResponse["suggested_song"];
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.instagramPublishing.suggestedSong")}</CardTitle>
        <CardDescription>
          {song ? <Stack gap={2}>
            <span>{song.title} · {song.artist}</span>
            <Link href={song.chart_url} target="_blank" rel="noopener noreferrer">
              {t("admin.instagramPublishing.songChart", { chart: song.chart_name, date: song.checked_on })}
            </Link>
            <span>{t("admin.instagramPublishing.songInstructions")}</span>
          </Stack> : t("admin.instagramPublishing.noSuggestedSong")}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
