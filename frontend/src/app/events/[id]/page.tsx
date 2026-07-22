import { EventDetailsPageRoute } from "@/app/client-routes";

interface EventDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EventDetailsPage({ params }: EventDetailsPageProps) {
  const { id } = await params;
  return <EventDetailsPageRoute eventId={Number(id)} />;
}
