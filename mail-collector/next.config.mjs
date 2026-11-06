/** @type {import('next').NextConfig} */
const nextConfig = {
  // 내부 서버 이관 시 Docker 이미지로 묶기 쉽도록 단독 실행 파일을 만든다
  output: "standalone",
};
export default nextConfig;
