import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "과제 서류 메일 정리 도우미",
  description: "메일로 받은 과제 제출 서류를 과제 목록에 맞춰 분류하고 엑셀 현황표와 과제별 폴더로 정리합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
