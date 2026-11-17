import { UsersPageContent } from "@/components/pages/UsersPageContent";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <UsersPageContent base="" tab={tab} />;
}
