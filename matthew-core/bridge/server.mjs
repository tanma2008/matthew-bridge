import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MATTHEW_PORT ?? 8788);
const HOST = process.env.MATTHEW_HOST ?? '127.0.0.1';
const API_BASE = process.env.MATTHEW_API_BASE ?? 'https://matthew.cmu.ac.th';
const MAX_BODY = 8 * 1024 * 1024;
const clients = new Set();
const jobs = new Map();

const MODELS = [
  ['gpt-5.5', true], ['gpt-5.4', true], ['gpt-5.4-mini', true],
  ['gpt-5.2', true], ['gpt-5-mini', true], ['gpt-4.1', false],
  ['gpt-4o', false], ['gpt-4o-mini', false],
];

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args); }
function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}
function error(res, status, message, type = 'invalid_request_error') {
  return json(res, status, { error: { message, type } });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function pickClient() {
  return clients.size ? [...clients][0] : null;
}
function dispatch(job) {
  const client = pickClient();
  if (!client) return false;
  job.client = client;
  sse(client.res, 'job', job.payload);
  return true;
}
function completionChunk(id, created, model, delta, finish_reason = null) {
  return { id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason }] };
}
function conversationText(messages = []) {
  return messages.map(m => {
    const content = Array.isArray(m.content)
      ? m.content.map(p => p?.type === 'text' ? p.text : '').filter(Boolean).join('\n')
      : String(m.content ?? '');
    if (!content) return '';
    if (m.role === 'system') return `Instructions: ${content}`;
    if (m.role === 'assistant') return `Assistant: ${content}`;
    return `User: ${content}`;
  }).filter(Boolean).join('\n\n');
}
async function handleChat(req, res) {
  log(`CHAT ${req.method} ${req.url}`);
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return error(res, 400, 'Invalid JSON body'); }
  if (!Array.isArray(body.messages) || !body.messages.length) return error(res, 400, 'messages is required');

  const model = String(body.model ?? 'gpt-5.5').replace(/^matthew\//, '');
  const prompt = conversationText(body.messages);
  if (!prompt.trim()) return error(res, 400, 'No usable message content');
  const id = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  const stream = body.stream !== false;

  if (!clients.size) return error(res, 503, 'Matthew extension is not connected. Open matthew.cmu.ac.th and load the extension.', 'unavailable');

  res.writeHead(200, {
    'content-type': stream ? 'text/event-stream; charset=utf-8' : 'application/json',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-matthew-bridge': '1',
  });

  const job = { id: randomUUID(), res, stream, model, completionId: id, created,
    payload: { jobId: null, kind: 'chat', model, prompt } };
  job.payload.jobId = job.id;
  jobs.set(job.id, job);
  log(`JOB ${job.id} dispatch model=${model} prompt=${JSON.stringify(prompt.slice(0, 120))}`);
  if (!dispatch(job)) { jobs.delete(job.id); return error(res, 503, 'No Matthew extension connected', 'unavailable'); }

  const finish = (reason = 'stop') => {
    if (!jobs.has(job.id)) return;
    jobs.delete(job.id);
    if (stream) {
      res.write(`data: ${JSON.stringify(completionChunk(id, created, model, {}, reason))}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    res.end();
  };
  job.onChunk = parts => {
    for (const part of parts ?? []) {
      if (!part || !part.text) continue;
      if (part.kind === 'status' || part.kind === 'reasoning') continue;
      if (stream) res.write(`data: ${JSON.stringify(completionChunk(id, created, model, { content: part.text }))}\n\n`);
      else job.output = (job.output ?? '') + part.text;
    }
  };
  job.onDone = () => {
    clearJobTimer();
    if (!stream) return json(res, 200, { id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: job.output ?? '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    finish('stop');
  };
  job.onError = message => {
    clearJobTimer();
    if (stream) { res.write(`data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); jobs.delete(job.id); }
    else error(res, 502, message, 'upstream_error');
  };
  // Never leave a CLI/client hanging forever if the browser side dies silently.
  job.timeout = setTimeout(() => job.onError?.('Matthew extension timed out without a response after 30s.'), 30000);
  const clearJobTimer = () => clearTimeout(job.timeout);
  // Do not delete the job on normal request completion; the extension may still be streaming.
  req.on('aborted', () => jobs.delete(job.id));
  res.on('close', () => { if (!res.writableEnded) jobs.delete(job.id); });
}
function extensionEvents(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const client = { res };
  clients.add(client);
  log(`Matthew extension connected (${clients.size})`);
  sse(res, 'ready', { connected: true, apiBase: API_BASE });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping); clients.delete(client);
    for (const job of jobs.values()) if (job.client === client) job.client = null;
    log(`Matthew extension disconnected (${clients.size})`);
  });
}
async function extensionPost(req, res, kind) {
  log(`EXT ${kind} ${req.method} ${req.url}`);
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false }); }
  const job = jobs.get(body.jobId);
  if (!job) return json(res, 200, { ok: false, reason: 'unknown job' });
  if (kind === 'debug') { log(`EXT DEBUG job=${body.jobId} ${body.message ?? ''}`); }
  else if (kind === 'chunk') job.onChunk?.(body.parts);
  else if (kind === 'done') job.onDone?.(body.finishReason);
  else job.onError?.(body.message ?? 'Matthew extension error');
  return json(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { status: 'ok', service: 'matthew-bridge', connected: clients.size > 0, clients: clients.size, jobs: jobs.size, apiBase: API_BASE });
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return json(res, 200, { object: 'list', data: MODELS.map(([id, reasoning]) => ({ id, object: 'model', created: 0, owned_by: 'cmu-matthew', reasoning })) });
    }
    if (req.method === 'GET' && url.pathname === '/models') return json(res, 200, { object: 'list', data: MODELS.map(([id]) => ({ id, object: 'model', created: 0, owned_by: 'cmu-matthew' })) });
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' }); return res.end(); }
    if (req.method === 'GET' && (url.pathname === '/matthew/events' || url.pathname === '/ext/events')) return extensionEvents(req, res);
    if (req.method === 'POST' && url.pathname === '/ext/debug') return extensionPost(req, res, 'debug');
    if (req.method === 'POST' && url.pathname === '/ext/chunk') return extensionPost(req, res, 'chunk');
    if (req.method === 'POST' && url.pathname === '/ext/done') return extensionPost(req, res, 'done');
    if (req.method === 'POST' && url.pathname === '/ext/error') return extensionPost(req, res, 'error');
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) return handleChat(req, res);
    return error(res, 404, 'Not found');
  } catch (err) {
    if (!res.headersSent) error(res, 500, err instanceof Error ? err.message : 'Internal error', 'server_error');
  }
});

server.listen(PORT, HOST, () => log(`matthew-bridge listening on http://${HOST}:${PORT}`));
