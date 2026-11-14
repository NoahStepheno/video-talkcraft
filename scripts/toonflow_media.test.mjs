import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectProvider, configure, probeCapability, generate } from './toonflow_media.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'talkcraft-toonflow-'));
  const source = kind => `
    const BASE_URL = 'http://127.0.0.1:8188';
    const graph = { '1': {class_type: 'SaveImage', inputs: {}} };
    export default {id: '${kind}-provider', models: [{id:'${kind === 'image' ? 'flux3-klein-t2i' : 'minimaxH3'}',type:'${kind}'}],
      async ${kind === 'image' ? 'generateImage' : 'generateVideo'}(request) {
        const response = await this.tool.fetch(BASE_URL + '/prompt', {method:'POST', body:JSON.stringify({prompt:graph, client_id:'${kind}'})});
        if (!response.ok) throw new Error('submit failed');
        return [{mediaType:'${kind}', type:'binary', data:new Uint8Array([1,2,3])}];
      }};`;
  await writeFile(join(dir, 'flux3Klein.ts'), source('image'));
  await writeFile(join(dir, 'comfyMinimaxH3.ts'), source('video'));
  const configPath = join(dir, 'settings.json');
  try { await run({ dir, configPath }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('configuration preserves other preferences and leaves both capabilities disabled', async () => fixture(async ({ dir, configPath }) => {
  await writeFile(configPath, JSON.stringify({ music: { mode: 'library' } }));
  await configure(dir, configPath);
  const settings = JSON.parse(await readFile(configPath));
  expect(settings.music.mode).toBe('library');
  for (const kind of ['image', 'video']) {
    expect(settings[kind].enabled).toBe(false);
    expect(settings[kind].choice).toBe('existing');
    expect(settings[kind].validation.status).toBe('unverified');
  }
}));

test('read-only probe never submits tasks and does not claim generation success', async () => fixture(async ({ dir, configPath }) => {
  await configure(dir, configPath);
  const { image } = JSON.parse(await readFile(configPath));
  const calls = [];
  const result = await probeCapability(image, 'image', async (url, options) => {
    calls.push(url);
    expect(options.method).toBeUndefined();
    return Response.json(url.endsWith('/system_stats') ? { system: {}, devices: [] } : { SaveImage: {} });
  });
  expect(calls.length).toBe(2);
  expect(result.status).toBe('unverified');
  expect(result.nodesAvailable).toBe(true);
}));

test('missing workflow nodes and changed provider files disable the capability', async () => fixture(async ({ dir, configPath }) => {
  await configure(dir, configPath);
  const { video } = JSON.parse(await readFile(configPath));
  const result = await probeCapability(video, 'video', async url => Response.json(url.endsWith('/system_stats') ? { system: {}, devices: [] } : {}));
  expect(result.status).toBe('unavailable');
  expect(result.missingNodes).toContain('SaveImage');
  await writeFile(video.providerPath, (await readFile(video.providerPath, 'utf8')) + '\n// changed');
  const changed = await probeCapability(video, 'video', () => { throw new Error('must not fetch'); });
  expect(changed.status).toBe('unavailable');
  expect(changed.reason).toContain('已变化');
}));

test('explicit generation logs the task, saves output, and prevents duplicate submission', async () => fixture(async ({ dir, configPath }) => {
  await configure(dir, configPath);
  const originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    if (url.endsWith('/system_stats')) return Response.json({ system: {}, devices: [] });
    if (url.endsWith('/object_info')) return Response.json({ SaveImage: {} });
    if (url.endsWith('/prompt')) { submissions++; return Response.json({ prompt_id: 'test-task' }); }
    if (url.includes('/history/')) return Response.json({ 'test-task': { status: { completed: true, status_str: 'success' }, outputs: { '1': { images: [{ filename: 'test.png', type: 'output' }] } } } });
    if (url.includes('/view?')) return new Response(new Uint8Array([1,2,3]));
    throw new Error('unexpected request');
  };
  try {
    const output = join(dir, 'test.png');
    const result = await generate('image', { prompt: 'test' }, output, configPath);
    expect(result.needsMediaReview).toBe(true);
    expect((await readFile(output)).length).toBe(3);
    expect(JSON.parse(await readFile(output + '.task.json')).promptId).toBe('test-task');
    await expect(generate('image', { prompt: 'test' }, output, configPath)).rejects.toThrow();
    expect(submissions).toBe(1);
  } finally { globalThis.fetch = originalFetch; }
}));

test('images and videos serialize and use unlimited transport without inherited provider deadlines', async () => fixture(async ({ dir, configPath }) => {
  await configure(dir, configPath);
  const originalFetch = globalThis.fetch;
  let running = 0, peak = 0, completed = 0;
  const order = [];
  globalThis.fetch = async (url, options = {}) => {
    expect(options.timeout).toBe(false);
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    if (url.endsWith('/system_stats')) return Response.json({ system: {}, devices: [] });
    if (url.endsWith('/object_info')) return Response.json({ SaveImage: {} });
    if (url.endsWith('/prompt')) {
      running++; peak = Math.max(peak, running);
      const id = JSON.parse(options.body).client_id; order.push(id);
      return Response.json({ prompt_id: id });
    }
    if (url.includes('/history/')) {
      const id = url.split('/').pop();
      await new Promise(resolve => setTimeout(resolve, 30));
      running--; completed++;
      return Response.json({ [id]: { status: { completed: true, status_str: 'success' }, outputs: { '1': { images: [{ filename: id === 'image' ? 'test.png' : 'test.mp4', type: 'output' }] } } } });
    }
    if (url.includes('/view?')) return new Response(new Uint8Array([1,2,3]));
    throw new Error('unexpected request');
  };
  try {
    await Promise.all([
      generate('image', { prompt: 'test' }, join(dir, 'serial.png'), configPath),
      generate('video', { prompt: 'test' }, join(dir, 'serial.mp4'), configPath),
    ]);
    expect(peak).toBe(1);
    expect(completed).toBe(2);
    expect(order.length).toBe(2);
  } finally { globalThis.fetch = originalFetch; }
}));

test('an uncertain submitted job retains the lock and task id on network failure', async () => fixture(async ({ dir, configPath }) => {
  await configure(dir, configPath);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    if (url.endsWith('/system_stats')) return Response.json({ system: {}, devices: [] });
    if (url.endsWith('/object_info')) return Response.json({ SaveImage: {} });
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'uncertain-job' });
    throw new Error('network disconnected');
  };
  try {
    const output = join(dir, 'lost.png');
    await expect(generate('image', { prompt: 'test' }, output, configPath)).rejects.toThrow('network disconnected');
    expect(JSON.parse(await readFile(output + '.task.json')).promptId).toBe('uncertain-job');
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(join(dir, 'resources'))).length).toBe(1);
  } finally { globalThis.fetch = originalFetch; }
}));

test('installed TypeScript inspection returns supported models without network calls', async () => fixture(async ({ dir }) => {
  const info = await inspectProvider(join(dir, 'flux3Klein.ts'), 'image');
  expect(info.models[0].id).toBe('flux3-klein-t2i');
  expect(info.classes).toContain('SaveImage');
  expect(info.sha256.length).toBe(64);
}));

test('an existing output without a task log is protected before any network request', async () => fixture(async ({ dir, configPath }) => {
  await configure(dir, configPath);
  const output = join(dir, 'existing.png');
  await writeFile(output, 'original');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  try {
    await expect(generate('image', { prompt: 'test' }, output, configPath)).rejects.toThrow('拒绝重复提交');
    expect(calls).toBe(0);
    expect(await readFile(output, 'utf8')).toBe('original');
  } finally { globalThis.fetch = originalFetch; }
}));
