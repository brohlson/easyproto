import Head from "next/head";
import { useEffect, useState } from "react";
import { LockedPreview } from "../shared-viewer/locked-preview";
import type { SharedPage } from "../shared-viewer/page";
import { SharedCanvas } from "../shared-viewer/shared-viewer";

type Preview = SharedPage | { kind: "locked-preview"; id: string };

export default function SharedPreviewPage() {
  const [view, setView] = useState<Preview>();
  useEffect(() => {
    // The Worker adds this payload after it checks access to the requested share.
    const payload = document.getElementById("page-data");
    if (payload?.textContent) setView(JSON.parse(payload.textContent) as Preview);
    payload?.remove();
  }, []);

  return (
    <>
      <Head>
        <title>
          {view?.kind === "page-preview" ? `${view.projectName} - ${view.pageName}` : "Easy Proto"}
        </title>
      </Head>
      {view?.kind === "locked-preview" && <LockedPreview id={view.id} />}
      {view?.kind === "page-preview" && <SharedCanvas view={view} />}
    </>
  );
}
