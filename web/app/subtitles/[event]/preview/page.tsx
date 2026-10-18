import { Suspense } from "react";

import { notFound } from "next/navigation";

import { SubtitlePreview } from "@/app/components/SubtitlePreview";

import { isEvent } from "@/lib/paths";



type PageProps = {

  params: Promise<{ event: string }>;

};



export default async function SubtitlePreviewPage({ params }: PageProps) {

  const { event } = await params;



  if (!isEvent(event)) {

    notFound();

  }



  return (

    <Suspense

      fallback={

        <main style={{ padding: "4rem", textAlign: "center", color: "var(--muted)" }}>

          Loading…

        </main>

      }

    >

      <SubtitlePreview event={event} />

    </Suspense>

  );

}


