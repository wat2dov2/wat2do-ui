import { OrganizationDetailsRoute } from "@/app/client-routes";

interface OrganizationDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function OrganizationDetailsPage({
  params,
}: OrganizationDetailsPageProps) {
  const { id } = await params;
  return <OrganizationDetailsRoute organizationId={Number(id)} />;
}
