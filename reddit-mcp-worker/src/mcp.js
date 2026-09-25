/**
 * MCP protocol layer — JSON-RPC 2.0 over Streamable HTTP, stateless mode.
 *
 * Implemented directly rather than through the TypeScript SDK: the stateless
 * server half of Streamable HTTP is a request/response exchange, so the SDK
 * would add a dependency, a build step, and a Durable Object requirement
 * without doing anything this file doesn't.
 */

import { RedditFetchError, RedditInputError } from './reddit.js';
import { TOOLS_BY_NAME, toolDescriptors } from './tools.js';

export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

export const SERVER_INFO = {
  name: 'reddit-rss-mcp',
  title: 'Reddit (public RSS)',
  version: '1.0.0',
};

const SERVER_INSTRUCTIONS = [
  'Read-only access to Reddit through its public RSS feeds.',
  '',
  'Typical flow: find_subreddits to locate a community, browse_subreddit or',
  'search_reddit to find threads, then get_thread to read the discussion.',
  '',
  'These feeds carry no vote scores and no comment counts, and comment lists',
  'are flat rather than threaded. Do not describe a comment as "top voted" or',
  'infer consensus from ordering — that information is not in the data. Report',
  'what people said, and attribute claims to the commenter rather than to the',
  'subreddit as a whole.',
].join('\n');

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
};

/**
 * @param {string|number|null} id
 * @param {object} result
 */
function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {unknown} [data]
 */
function fail(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

/**
 * @param {unknown} requested
 * @returns {string}
 */
export function negotiateProtocolVersion(requested) {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

/**
 * Run one tool and shape the result. Tool failures come back as a successful
 * JSON-RPC result carrying isError, so the model can read the message and
 * correct itself rather than seeing an opaque transport failure.
 *
 * @param {object} params
 * @param {object} env
 * @param {object} [ctx]
 */
async function callTool(params, env, ctx) {
  const name = params?.name;
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    const known = [...TOOLS_BY_NAME.keys()].join(', ');
    const error = new Error(`Unknown tool "${name}". Available tools: ${known}.`);
    error.code = ErrorCode.InvalidParams;
    throw error;
  }

  const args = params.arguments ?? {};

  try {
    const { text, structured } = await tool.handler(args, env, ctx);
    const result = { content: [{ type: 'text', text }] };
    if (tool.outputSchema) result.structuredContent = structured;
    return result;
  } catch (cause) {
    const isExpected = cause instanceof RedditInputError || cause instanceof RedditFetchError;
    const message = isExpected
      ? cause.message
      : `${tool.name} failed: ${cause?.message || 'unknown error'}`;
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}

/**
 * Dispatch a single JSON-RPC message.
 *
 * @param {object} message
 * @param {object} env
 * @param {object} [ctx]
 * @returns {Promise<object|null>} null for notifications, which take no reply
 */
export async function handleRpc(message, env, ctx) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return fail(null, ErrorCode.InvalidRequest, 'Request must be a JSON-RPC object.');
  }
  if (message.jsonrpc !== '2.0') {
    return fail(message.id ?? null, ErrorCode.InvalidRequest, 'Only JSON-RPC 2.0 is supported.');
  }

  const { method, id } = message;
  const isNotification = id === undefined || id === null;

  if (typeof method !== 'string') {
    return isNotification ? null : fail(id, ErrorCode.InvalidRequest, 'Missing method.');
  }

  // Notifications never get a response body.
  if (isNotification) return null;

  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: negotiateProtocolVersion(message.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        });

      case 'ping':
        return reply(id, {});

      case 'tools/list':
        return reply(id, { tools: toolDescriptors() });

      case 'tools/call':
        return reply(id, await callTool(message.params, env, ctx));

      // Declared unsupported in capabilities, but answer politely if asked.
      case 'resources/list':
        return reply(id, { resources: [] });
      case 'prompts/list':
        return reply(id, { prompts: [] });

      default:
        return fail(id, ErrorCode.MethodNotFound, `Unsupported method "${method}".`);
    }
  } catch (cause) {
    const code = typeof cause?.code === 'number' ? cause.code : ErrorCode.InternalError;
    return fail(id, code, cause?.message || 'Internal error.');
  }
}

/**
 * Handle a parsed request body, which may be one message or a batch.
 *
 * @param {object|object[]} body
 * @param {object} env
 * @param {object} [ctx]
 * @returns {Promise<object|object[]|null>}
 */
export async function handleMessage(body, env, ctx) {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return fail(null, ErrorCode.InvalidRequest, 'Batch must not be empty.');
    }
    const results = await Promise.all(body.map((entry) => handleRpc(entry, env, ctx)));
    const responses = results.filter((entry) => entry !== null);
    return responses.length > 0 ? responses : null;
  }
  return handleRpc(body, env, ctx);
}
