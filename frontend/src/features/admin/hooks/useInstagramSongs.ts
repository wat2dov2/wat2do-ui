import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addInstagramSong,
  deleteInstagramSong,
  getInstagramSongs,
} from "@/features/admin/api/admin.api";
import { queryKeys } from "@/shared/lib/queryKeys";

/** The songs the Mac's emulator tries, in random order, on each newly published carousel. */
export function useInstagramSongs() {
  const queryClient = useQueryClient();
  const songsQuery = useQuery({
    queryKey: queryKeys.instagramPublishing.songs(),
    queryFn: getInstagramSongs,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.instagramPublishing.songs() });
  const addMutation = useMutation({
    mutationFn: addInstagramSong,
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteInstagramSong,
    onSuccess: refresh,
  });

  return {
    songs: songsQuery.data ?? [],
    isLoading: songsQuery.isLoading,
    error: songsQuery.error,
    retry: songsQuery.refetch,
    addSong: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    deleteSong: deleteMutation.mutateAsync,
    deletingSongId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  };
}
