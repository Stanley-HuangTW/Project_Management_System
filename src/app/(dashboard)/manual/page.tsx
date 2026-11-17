import { ManualPageContent } from "@/components/pages/ManualPageContent";

export default async function ManualPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  return <ManualPageContent base="" q={q} />;
}
