import { redirect } from "next/navigation";
import { ROUTES } from "@/shared/constants/routes";

export default function ClubPanelCatchAllRedirectPage() {
  redirect(ROUTES.ORGANIZATION_PANEL);
}
