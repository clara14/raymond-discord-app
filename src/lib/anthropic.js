// ============================================================
// anthropic.js (lib) — Anthropic Messages API client.
// Supports plain completions and the TOOL-USE LOOP: the model
// can ask to call our functions mid-reply; we execute them,
// hand the results back, and it continues with real data.
// ============================================================

import { CHAT } from '../config.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Pure function: converts chat history rows into the Messages API format.
 * Rows arrive oldest-first as { role, username, content }.
 * Rules the API requires / that keep the model coherent:
 *  - user messages get "username: " prefixed so the model can tell people apart
 *  - consecutive same-role messages are merged into one (the API expects
 *    alternating user/assistant turns)
 *  - the conversation must START with a user turn, so leading assistant
 *    messages are dropped
 */
export function buildMessages(rows) {
  const messages = [];
  for (const row of rows) {
    const text =
      row.role === 'user' && row.username
        ? `${row.username}: ${row.content}`
        : row.content;

    const last = messages[messages.length - 1];
    if (last && last.role === row.role && typeof last.content === 'string') {
      // Merge consecutive same-role messages into a single turn.
      last.content += `\n${text}`;
    } else {
      messages.push({ role: row.role, content: text });
    }
  }

  // The API requires the first message to be from the user.
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }
  return messages;
}

// One raw call to the Messages API. Throws on HTTP errors.
async function callApi(body) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

// Concatenates the text blocks of a response.
function textOf(data) {
  return data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * Calls the Messages API and returns the assistant's reply text.
 * Options:
 *   system      — override the system prompt (default: CHAT.systemPrompt)
 *   tools       — Anthropic tool schemas the model may call
 *   executeTool — async (name, input) => string; runs a requested tool
 *   maxRounds   — cap on tool round-trips (default CHAT.maxToolRounds)
 *
 * Without tools this is a single call (the /bribe path). With tools it
 * loops: if the model stops to use tools, we run them, append the results
 * as a tool_result turn, and call again until it produces a final text.
 */
export async function chatCompletion(messages, options = {}) {
  const {
    system = CHAT.systemPrompt,
    tools = null,
    executeTool = null,
    maxRounds = CHAT.maxToolRounds,
  } = options;

  const body = {
    model: CHAT.model,
    max_tokens: CHAT.maxTokens,
    system,
    messages: [...messages],
  };
  if (tools) body.tools = tools;

  let data = await callApi(body);

  // The tool-use loop. Each round: run every tool the model requested,
  // then send back the assistant turn + a user turn of tool_results.
  let rounds = 0;
  while (tools && executeTool && data.stop_reason === 'tool_use' && rounds < maxRounds) {
    rounds += 1;

    const toolUses = data.content.filter((block) => block.type === 'tool_use');

    // Execute all requested tools; a tool that throws becomes an error
    // string the model can react to, not a crash.
    const results = await Promise.all(
      toolUses.map(async (tu) => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: await executeTool(tu.name, tu.input).catch(
          (err) => `Tool error: ${err.message}`,
        ),
      })),
    );

    body.messages.push({ role: 'assistant', content: data.content });
    body.messages.push({ role: 'user', content: results });
    data = await callApi(body);
  }

  return textOf(data);
}
