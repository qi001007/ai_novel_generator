export type Novel = {
  id: number;
  title: string;
  description: string;
  target_chapters: number;
  style_constraints: string;
};

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
  identity: string;
  goals: string;
  behavior_constraints: string;
  current_status: string;
  expected_start_chapter: number | null;
  expected_end_chapter: number | null;
};

export type PlanningBlueprint = {
  id: number;
  version: number;
  is_active: boolean;
  main_line: string;
  ending: string;
  core_conflicts: string;
  themes: string;
  constraints: string;
};

export type TocEntry = {
  id: number;
  chapter_number: number;
  title: string;
  plot_function: string;
  notes: string;
  is_active: boolean;
};

export type ArcPlan = {
  id: number;
  title: string;
  start_chapter: number;
  end_chapter: number;
  objective: string;
  conflict: string;
  resolution: string;
  status: string;
  planned_chapters: Record<string, unknown>;
};

export type PlotFeedback = {
  id: number;
  content: string;
  impact_levels: string[];
  suggestions: Record<string, unknown>;
  status: string;
  applied_at: string | null;
  created_at: string;
};
