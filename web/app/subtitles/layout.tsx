import { Suspense } from "react";
import { SubtitlesNav } from "../components/SubtitlesNav";

export default function SubtitlesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Suspense fallback={<div style={{ minHeight: "2.75rem" }} />}>
        <SubtitlesNav />
      </Suspense>
      {children}
    </>
  );
}
