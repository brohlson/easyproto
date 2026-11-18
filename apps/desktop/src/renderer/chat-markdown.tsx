import { useId } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ children }) => <>{children}</>,
  img: ({ alt }) => alt,
  table: ({ children }) => (
    <div className="chat-markdown-table">
      <table>{children}</table>
    </div>
  ),
};

export function ChatMarkdown({ text }: { text: string }) {
  const id = useId();
  return (
    <div className="chat-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: `chat-${id}-` }}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
