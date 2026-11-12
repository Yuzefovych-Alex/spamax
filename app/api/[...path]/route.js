import Telegram from '../../../server/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_SCHEDULE_BODY_BYTES = 2 * 1024 * 1024;
const telegram = globalThis.axTelegramClient || new Telegram();
globalThis.axTelegramClient = telegram;

function isLoopbackHost(value) {
  if (!value) return false;
  const host = (value.startsWith('[')
    ? value.slice(1, value.indexOf(']'))
    : value.split(':')[0]).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function assertLocalRequest(request) {
  if (!isLoopbackHost(request.headers.get('host'))) {
    const error = new Error('This local API only accepts loopback requests.');
    error.statusCode = 403;
    throw error;
  }

  const origin = request.headers.get('origin');
  if (origin) {
    let originUrl;
    try {
      originUrl = new URL(origin);
    } catch {
      const error = new Error('Invalid request origin.');
      error.statusCode = 403;
      throw error;
    }
    if (!['http:', 'https:'].includes(originUrl.protocol) || !isLoopbackHost(originUrl.hostname)) {
      const error = new Error('This local API only accepts loopback origins.');
      error.statusCode = 403;
      throw error;
    }
  }
}

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!request.body) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 });
  }
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    }
    chunks.push(value);
  }

  let value;
  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 });
  }
  return value;
}

async function handle(request, context) {
  try {
    assertLocalRequest(request);
    const { path = [] } = await context.params;
    const url = new URL(request.url);
    const requestedMethod = request.method.toUpperCase();

    if (requestedMethod === 'GET' && path.join('/') === 'telegram/logs') {
      const requestedLimit = Number(url.searchParams.get('limit') || 200);
      return jsonResponse(await telegram.listActivityLogs({ limit: requestedLimit }));
    }
    if (requestedMethod === 'GET' && path.join('/') === 'telegram/accounts') {
      return jsonResponse(await telegram.list());
    }
    if (requestedMethod === 'GET' && path.length === 4 && path[0] === 'telegram' && path[1] === 'accounts' && path[3] === 'groups') {
      return jsonResponse(await telegram.listGroups(path[2]));
    }
    if (requestedMethod === 'GET' && path.length === 4 && path[0] === 'telegram' && path[1] === 'accounts' && path[3] === 'saved-messages') {
      return jsonResponse(await telegram.listSavedMessages(path[2]));
    }
    if (requestedMethod === 'GET' && path.join('/') === 'telegram/schedules') {
      return jsonResponse(await telegram.listNotificationSchedules());
    }

    if (requestedMethod === 'POST' && path.join('/') === 'telegram/send') {
      return jsonResponse(await telegram.sendNotification(await readJson(request)));
    }
    if (requestedMethod === 'POST' && path.join('/') === 'telegram/schedules') {
      return jsonResponse(await telegram.addNotificationSchedule(
        await readJson(request, MAX_SCHEDULE_BODY_BYTES),
      ), 201);
    }
    if (requestedMethod === 'POST' && path.length === 4 && path[0] === 'telegram' && path[1] === 'schedules' && ['start', 'stop'].includes(path[3])) {
      const result = path[3] === 'start'
        ? await telegram.startNotificationSchedule(path[2])
        : await telegram.stopNotificationSchedule(path[2]);
      return jsonResponse(result);
    }
    if (requestedMethod === 'POST' && path.join('/') === 'telegram/accounts') {
      return jsonResponse(await telegram.login(await readJson(request)));
    }
    if (requestedMethod === 'POST' && path.length === 4 && path[0] === 'telegram' && path[1] === 'accounts' && path[3] === 'reconnect') {
      return jsonResponse(await telegram.login({ ...await readJson(request), accountId: path[2] }));
    }
    if (requestedMethod === 'POST' && path.join('/') === 'telegram/verify') {
      return jsonResponse(telegram.submitInput((await readJson(request)).value));
    }
    if (requestedMethod === 'POST' && path.join('/') === 'telegram/cancel') {
      return jsonResponse(await telegram.cancelLogin());
    }
    if (requestedMethod === 'POST' && path.length === 4 && path[0] === 'telegram' && path[1] === 'accounts' && path[3] === 'disconnect') {
      return jsonResponse(await telegram.disconnect(path[2]));
    }

    if (requestedMethod === 'DELETE' && path.length === 3 && path[0] === 'telegram' && path[1] === 'schedules') {
      return jsonResponse(await telegram.removeNotificationSchedule(path[2]));
    }
    if (requestedMethod === 'DELETE' && path.length === 3 && path[0] === 'telegram' && path[1] === 'accounts') {
      return jsonResponse(await telegram.remove(path[2]));
    }

    return jsonResponse({ error: 'Not found.' }, 404);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Telegram API request failed:', error.name || 'Error', error.message);
    }
    return jsonResponse({
      error: statusCode === 500 ? 'Internal server error.' : error.message,
    }, statusCode);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
