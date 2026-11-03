import type { Metadata } from "next";
import RespondForm from "./RespondForm";

export const metadata: Metadata = {
  title: "평가위원 참석 여부 회신",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RespondForm token={token} />;
}
