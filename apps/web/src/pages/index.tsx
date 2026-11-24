import Head from "next/head";
import { homeDescription, homeTitle, homeUrl } from "../landing/content";
import { Landing } from "../landing/landing";

const application = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Easy Proto",
  url: homeUrl,
  description: homeDescription,
  applicationCategory: "DesignApplication",
  operatingSystem: "macOS",
  isAccessibleForFree: true,
};

export default function HomePage() {
  return (
    <>
      <Head>
        <title>{homeTitle}</title>
        <meta name="description" content={homeDescription} />
        <link rel="canonical" href={homeUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Easy Proto" />
        <meta property="og:url" content={homeUrl} />
        <meta property="og:title" content={homeTitle} />
        <meta property="og:description" content={homeDescription} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={homeTitle} />
        <meta name="twitter:description" content={homeDescription} />
        <script type="application/ld+json">
          {JSON.stringify(application).replaceAll("<", "\\u003c")}
        </script>
      </Head>
      <Landing />
    </>
  );
}
