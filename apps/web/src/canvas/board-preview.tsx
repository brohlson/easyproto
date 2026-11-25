import { EdgeRunner } from "@easy-proto/ui";
import { useState } from "react";
import styles from "./board-preview.module.css";

export function BoardPreview({
  src,
  title,
  width,
  height,
  className,
}: {
  src: string;
  title: string;
  width: number;
  height: number;
  className: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`${styles.preview} ${className}`} data-loaded={loaded}>
      <iframe
        src={src}
        title={title}
        width={width}
        height={height}
        sandbox=""
        tabIndex={-1}
        aria-hidden={!loaded}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <div className={styles.loading} role="status" aria-label={`Loading ${title}`}>
          <EdgeRunner className={styles.icon} animated />
        </div>
      )}
    </div>
  );
}
