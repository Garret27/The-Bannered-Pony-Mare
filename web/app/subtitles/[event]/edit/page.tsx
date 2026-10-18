import { notFound } from "next/navigation";

import { SubtitleEditor } from "@/app/components/SubtitleEditor";

import { isEvent } from "@/lib/paths";



type PageProps = {

  params: Promise<{ event: string }>;

};



export default async function SubtitleEditPage({ params }: PageProps) {

  const { event } = await params;



  if (!isEvent(event)) {

    notFound();

  }



  return <SubtitleEditor event={event} />;

}


