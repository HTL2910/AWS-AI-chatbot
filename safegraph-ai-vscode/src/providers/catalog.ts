import { HAIKU_45_MODEL_ID } from "../config/bedrock";

export const DEFAULT_OPENAI_BASE_URL = "http://localhost:20128/v1";
export const DEFAULT_OPENAI_MODEL = "9router/auto";
export const NINE_ROUTER_ORIGIN = "http://localhost:20128";

export const OPENAI_MODEL_SUGGESTIONS = [
  "9router/auto",
  "cc/claude-sonnet-4-6",
  "openai/gpt-4.1",
  "openai/gpt-4o-mini",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash",
  "openrouter/auto"
];

export const BEDROCK_MODEL_SUGGESTIONS = [
  HAIKU_45_MODEL_ID,
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0"
];

export type OpenAIPreset = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
};

export const OPENAI_PRESETS: OpenAIPreset[] = [
  { id: "9router", label: "9Router", baseUrl: DEFAULT_OPENAI_BASE_URL, model: "9router/auto" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
  { id: "litellm", label: "LiteLLM", baseUrl: "http://localhost:4000/v1", model: "gpt-4o" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" }
];
