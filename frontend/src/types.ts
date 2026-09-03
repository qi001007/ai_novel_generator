export type Novel = {
  id: number;
  title: string;
  description: string;
  target_chapters: number;
  style_constraints: string;
  cover_image: string;
};

export type NovelUpdatePayload = Partial<
  Omit<Novel, "id" | "created_at" | "updated_at">
>;

export type ChapterBrief = {
  id: number;
  novel_id: number;
  arc_plan_id: number | null;
  chapter_number: number;
  goal: string;
  events: string;
  pov: string;
  characters: string[];
  conflict: string;
  hook: string;
  required_facts: string[];
  status: string;
};

export type Chapter = {
  id: number;
  novel_id: number;
  brief_id: number | null;
  chapter_number: number;
  title: string;
  content: string;
  word_count: number;
  status: string;
  final_decision: string;
  final_comment: string;
};

export type MachineCheckIssue = {
  type: string;
  message: string;
};

export type MachineCheckResult = {
  passed: boolean;
  word_count: number;
  issues: MachineCheckIssue[];
};

export type GenerationRun = {
  id: number;
  chapter_id: number | null;
  task_type: string;
  model: string;
  prompt_version: string;
  input_summary: string;
  output: string;
  token_input: number;
  token_output: number;
  cost_estimate: number;
  status: string;
  created_at: string;
};

export type ContextManifestBlock = {
  kind: string;
  label: string;
  ref: string;
  tier?: string;
  chars: number;
  excerpt?: string;
  injected?: boolean;
  index?: number;
  reason?: string;
};

export type ContextManifest = {
  budget: number;
  used: number;
  blocks: ContextManifestBlock[];
};

export type ChapterGenerationResponse = {
  chapter: Chapter;
  generation_run: GenerationRun;
  machine_check: MachineCheckResult;
};

export type Review = {
  id: number;
  chapter_id: number;
  reviewer: string;
  decision: string;
  comments: string;
  scores: Record<string, number>;
  evidence: Record<string, string[]>;
  created_at: string;
};

export type Setting = {
  id: number;
  category: string;
  name: string;
  content: string;
  current_state: string;
  is_confirmed: boolean;
  source_chapter: number | null;
};

export type Character = {
  id: number;
  name: string;
  level: string;
  portrait: string;
  identity: string;
  goals: string;
  behavior_constraints: string;
  current_status: string;
  expected_start_chapter: number | null;
  expected_end_chapter: number | null;
};

export type LLMStatus = {
  provider: string;
  configured: boolean;
  models: Record<string, boolean>;
  available_models: string[];
};

export type ChatMode = "plan" | "write";

export type ChatReference = {
  kind: string;
  label: string;
  ref: string;
};

export type ChatContextItem = ChatReference & { mention: string };

// A write the agent offered inside a stored reply. The server re-derives
// it from the message body, so a reload can put the review card back.
export type StoredProposal = {
  path: string;
  text: string;
  valid: boolean;
  error: string;
};

export type StoredChatMessage = {
  id: number;
  novel_id: number;
  role: "user" | "assistant";
  content: string;
  mode: string;
  model: string;
  mentions: string[];
  context_refs: ChatReference[];
  token_input: number;
  token_output: number;
  created_at: string;
  proposals?: StoredProposal[];
};

export type StreamChatPayload = {
  content: string;
  mode: ChatMode;
  chapter_id?: number | null;
  model?: string | null;
};

export type ChatContextPayload = {
  items: (ChatReference & { score: number })[];
  unknown_mentions: string[];
  mode: string;
  temperature: number;
};

export type ChatStreamEvent =
  | { event: "context"; data: ChatContextPayload }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { message: StoredChatMessage } }
  | { event: "error"; data: { message: string; partial: string } }
  | { event: "proposal"; data: { path: string; text: string; valid: boolean; error: string } }
  | { event: "end"; data: unknown };

export type GenerationStreamEvent =
  | { event: "context"; data: { manifest: ContextManifest } }
  | { event: "delta"; data: { text: string } }
  | {
      event: "done";
      data: {
        chapter: Chapter;
        generation_run: GenerationRun;
        machine_check: MachineCheckResult;
      };
    }
  | { event: "error"; data: { message?: string; partial?: string } }
  | { event: "end"; data: unknown };

export type PlotFeedback = {
  id: number;
  content: string;
  impact_levels: string[];
  suggestions: Record<string, unknown>;
  status: string;
  applied_at: string | null;
  created_at: string;
};

export type FileMeta = { path: string; kind: string; layer: string; label: string };

export type FileDoc = {
  path: string;
  kind: string;
  layer: string;
  label: string;
  text: string;
  ai_fields: string[];
  revision: string;
};

export type FileWriteResult = { path: string; changed: string[]; revision: string };

// A ```markdown @path block the agent offered. It is a proposal, never a write:
// only the human clicking "应用" sends it, with actor=ai.
export type FileProposal = {
  id: number;
  path: string;
  text: string;
  valid: boolean;
  error: string;
  baseText: string;
  baseRevision: string;
};

export type JumpSource = { fromPath: string; chapter: number; field: string };
