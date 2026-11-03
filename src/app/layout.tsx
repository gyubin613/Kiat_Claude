import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "평가위원 섭외 및 일정조율 통합관리 (시제품)",
  description: "평가위원 섭외부터 일정 확정까지 하나의 웹 화면에서 관리하는 업무지원 시제품",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
