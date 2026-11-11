import Participant from "@/components/Participant";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { code } = await params;
  return <Participant code={code} />;
}
