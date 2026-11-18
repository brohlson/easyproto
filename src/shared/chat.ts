export const chatPromptLimit = 4000;

export type ChatRequest = {
  pageId?: string;
  expectedRevision: number;
  prompt: string;
};
export type ChatDecision = "apply" | "discard" | "stop" | "allow_source";
export type ChatTurn = {
  id: string;
  artboardName?: string;
  baseRevision: number;
  prompt: string;
  response: string;
  phase:
    | "streaming"
    | "source"
    | "proposal"
    | "applying"
    | "applied"
    | "answered"
    | "stopped"
    | "discarded"
    | "stale"
    | "failed";
  proposal?: { before: string; after: string };
  sourceRequest?: { artboard: string; page?: string };
  change?: { summary: string; details?: string; html?: string; css?: string };
  appliedRevision?: number;
  error?: string;
};
export type ChatMessage = Pick<ChatTurn, "id" | "prompt" | "response">;
export type ChatState = {
  sequence: number;
  backend: "demo" | "codex" | "chatgpt" | "claude";
  agentId?: string;
  history: ChatMessage[];
  turn?: ChatTurn;
};
export type ChatUpdate = ChatState & { generation: number };

export type ChatAccountState = {
  available: boolean;
  connected: boolean;
  plan: boolean;
  email?: string;
  welcome: boolean;
  pending?: "connecting" | "signing-out";
  message?: string;
};
