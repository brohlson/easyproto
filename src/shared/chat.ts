export const chatPromptLimit = 1000;

export type ChatRequest = { artboardId: string; expectedRevision: number; prompt: string };
export type ChatDecision = "apply" | "discard" | "stop";
export type ChatTurn = {
  id: string;
  artboardName: string;
  baseRevision: number;
  prompt: string;
  response: string;
  phase:
    | "streaming"
    | "proposal"
    | "applying"
    | "applied"
    | "stopped"
    | "discarded"
    | "stale"
    | "failed";
  proposal?: { before: string; after: string };
  appliedRevision?: number;
  error?: string;
};
export type ChatMessage = Pick<ChatTurn, "id" | "prompt" | "response" | "artboardName">;
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
