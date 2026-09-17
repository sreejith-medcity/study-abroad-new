import { redirect } from "next/navigation";

export default async function StudentIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/students/${id}/profile`);
}
