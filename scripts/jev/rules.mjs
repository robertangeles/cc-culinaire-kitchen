/**
 * The semantic lint rules (from CLAUDE.md) and the thresholds, in one place so a human can
 * review every question and number. Edit here, never inline in a script.
 *
 * Each rule is a yes/no question about a diff. `threshold` is the noul above which the rule
 * is reported as violated (a signal for review, never a merge blocker).
 */
export const RULES = {
  business_logic_in_route:
    "The diff adds or changes business logic (calculations, decisions, database queries, multi-step domain rules) directly inside an Express route handler or controller, instead of in a service.",
  llm_called_from_route:
    "The diff calls an LLM or AI provider API (OpenRouter, Anthropic, OpenAI, fetch to a model endpoint) directly from a route or controller instead of through the aiService.",
  hardcoded_secret_or_config:
    "The diff hardcodes an API key, secret, password, token, or an environment-specific configuration value (URL, port, model name) in source code instead of reading it from configuration.",
  endpoint_without_permission:
    "The diff adds a new Express API route that exposes data or an action without any authentication or permission middleware such as authenticate or requirePermission.",
  fk_without_index:
    "The diff adds a database table or column that references another table (a foreign key) without adding an index on that referencing column.",
};
export const THRESHOLD = 0.5;
