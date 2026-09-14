import { useReducer, type ChangeEvent, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import { getAllClubs } from "@/features/clubs";
import { useEventsStore } from "@/features/events/store/events.store";
import { parsePositionImage, submitPosition } from "@/features/positions/api/positions.api";
import { getCurrentSchool, resolveSchool } from "@/shared/constants/schools";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@/shared/constants/uploads";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import type { ApiPositionCreate } from "@/shared/generated";

interface SubmissionState {
  data: ApiPositionCreate;
  busy: boolean;
  error: string | null;
  submitted: boolean;
}
type Action = { type: "edit"; data: Partial<ApiPositionCreate> } | { type: "state"; value: Partial<Omit<SubmissionState, "data">> };
function reducer(state: SubmissionState, action: Action): SubmissionState {
  return action.type === "edit" ? { ...state, data: { ...state.data, ...action.data }, error: null } : { ...state, ...action.value };
}

export function usePositionSubmission() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const schoolFilter = useEventsStore(state => state.schoolFilter);
  const school = resolveSchool(schoolFilter ?? getCurrentSchool());
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, {
    data: { club_id: 0, title: "", description: "", position_type: "general", requirements: [], source_url: "", is_paid: null },
    busy: false, error: null, submitted: false,
  });
  const clubs = useQuery({
    queryKey: queryKeys.clubs.allForSchool(school),
    queryFn: () => getAllClubs(school),
    enabled: isAuthenticated,
  });
  const edit = (data: Partial<ApiPositionCreate>) => dispatch({ type: "edit", data });
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || state.busy) return;
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      dispatch({ type: "state", value: { error: t(file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES ? "qrCode.imageSizeError" : "qrCode.imageFileError") } });
      return;
    }
    dispatch({ type: "state", value: { busy: true, error: null } });
    try {
      edit(await parsePositionImage(file, school));
    } catch (error) {
      dispatch({ type: "state", value: { error: getApiErrorMessage(error) } });
    } finally {
      dispatch({ type: "state", value: { busy: false } });
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.busy || !clubs.data?.some(club => club.id === state.data.club_id)) return;
    dispatch({ type: "state", value: { busy: true, error: null } });
    try {
      await submitPosition({ ...state.data, requirements: state.data.requirements?.map(value => value.trim()).filter(Boolean) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.positionSubmissions.all });
      dispatch({ type: "state", value: { submitted: true } });
    } catch (error) {
      dispatch({ type: "state", value: { error: getApiErrorMessage(error) } });
    } finally {
      dispatch({ type: "state", value: { busy: false } });
    }
  };
  return { ...state, school, isAuthenticated, clubs, edit, upload, submit };
}
