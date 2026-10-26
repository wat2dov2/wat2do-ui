import { useCallback, useMemo, useReducer, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import { clubDirectoryQueryOptions } from "@/features/clubs";
import { useEventsStore } from "@/features/events/store/events.store";
import { parsePositionImage, submitPosition } from "@/features/positions/api/positions.api";
import { getCurrentSchool, resolveSchool } from "@/shared/constants/schools";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { uploadEventImageUnsigned } from "@/shared/services/uploadService";
import { useImageFile } from "@/shared/hooks/useImageFile";
import { useImageParse } from "@/shared/hooks/useImageParse";
import type { ApiPositionCreate } from "@/shared/generated";

interface SubmissionState {
  data: ApiPositionCreate;
  submittedByEmail: string;
  busy: boolean;
  error: string | null;
  submitted: boolean;
  /** The club's own team published it straight away; anyone else's waits for review. */
  published: boolean;
  /** The form opens once an image was read or the upload was skipped. */
  formOpen: boolean;
}
type Action = { type: "edit"; data: Partial<ApiPositionCreate> } | { type: "state"; value: Partial<Omit<SubmissionState, "data">> };
function reducer(state: SubmissionState, action: Action): SubmissionState {
  return action.type === "edit" ? { ...state, data: { ...state.data, ...action.data }, error: null } : { ...state, ...action.value };
}

export function usePositionSubmission() {
  const { t } = useTranslation();
  const { userEmail } = useAuthState();
  const schoolFilter = useEventsStore(state => state.schoolFilter);
  const school = resolveSchool(schoolFilter ?? getCurrentSchool());
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, {
    data: { club_id: 0, title: "", description: "", position_type: "general", requirements: [], source_url: "", is_paid: null },
    submittedByEmail: userEmail ?? "",
    busy: false, error: null, submitted: false, published: false, formOpen: false,
  });
  const clubs = useQuery({
    ...clubDirectoryQueryOptions(school),
    select: (directory) => directory.items,
  });
  const edit = useCallback((data: Partial<ApiPositionCreate>) => dispatch({ type: "edit", data }), []);
  const openForm = useCallback(() => dispatch({ type: "state", value: { formOpen: true } }), []);
  const image = useImageFile();
  const { resetImage } = image;
  const parse = useCallback(async (file: File) => {
    const { source_image_url: sourceImageUrl, ...details } = await parsePositionImage(file, school);
    edit(details);
    resetImage(sourceImageUrl ?? "");
  }, [edit, resetImage, school]);
  const parseCopy = useMemo(() => ({
    failedTitle: t("positions.imageParseFailed"),
    failedDescription: t("positions.imageParseFailedDescription"),
    extracted: t("positions.imageExtracted"),
  }), [t]);
  const imageParse = useImageParse({ active: !state.submitted, copy: parseCopy, parse, onSettled: openForm });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.busy || !clubs.data?.some(club => club.id === state.data.club_id)) return;
    dispatch({ type: "state", value: { busy: true, error: null } });
    try {
      const sourceImageUrl = image.imageFile ? await uploadEventImageUnsigned(image.imageFile) : image.imagePreview || null;
      const submission = await submitPosition({ ...state.data, source_image_url: sourceImageUrl, requirements: state.data.requirements?.map(value => value.trim()).filter(Boolean) }, state.submittedByEmail.trim());
      const published = submission.status === "approved";
      await queryClient.invalidateQueries({ queryKey: published ? queryKeys.positions.all : queryKeys.positionSubmissions.all });
      dispatch({ type: "state", value: { submitted: true, published } });
    } catch (error) {
      dispatch({ type: "state", value: { error: getApiErrorMessage(error) } });
    } finally {
      dispatch({ type: "state", value: { busy: false } });
    }
  };
  return { ...state, school, clubs, edit, image, imageParse, openForm, submit,
    setEmail: (submittedByEmail: string) => dispatch({ type: "state", value: { submittedByEmail } }),
  };
}
