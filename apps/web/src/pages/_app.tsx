import type { AppProps } from "next/app";
import Head from "next/head";
import fold from "@easy-proto/ui/fold.svg";
import "@easy-proto/ui/theme.css";
import "../base.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" href={fold.src} />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
