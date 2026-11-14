#!/usr/bin/env bun
// Run with Bun: reuses the user's trusted, local Toonflow TypeScript providers.
import { readFile, mkdir, writeFile, lstat, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const settingsPath = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'video-talkcraft/settings.json');
const digest = source => createHash('sha256').update(source).digest('hex');

export async function loadSettings(path = settingsPath()) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function saveSettings(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function inspectProvider(path, kind) {
  const source = await readFile(path, 'utf8');
  if (/^\s*import\s/m.test(source)) throw new Error('此入口只支持无外部依赖的本地 Toonflow 适配器');
  const endpoint = source.match(/const\s+(?:COMFY_BASE|BASE_URL)\s*=\s*["'](https?:\/\/[^"']+)["']/)?.[1];
  if (!endpoint) throw new Error('适配器未声明可识别的 ComfyUI 地址');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) throw new Error('服务地址不能包含凭据或查询参数');
  const provider = (await import(pathToFileURL(resolve(path)).href)).default;
  const method = kind === 'image' ? 'generateImage' : 'generateVideo';
  if (typeof provider?.[method] !== 'function') throw new Error('适配器缺少 ' + method);
  const models = (provider.models || []).filter(model => model.type === kind);
  if (!models.length) throw new Error('适配器没有对应模型');
  const classes = [...new Set([...source.matchAll(/class_type\s*:\s*["']([^"']+)["']|["']class_type["']\s*:\s*["']([^"']+)["']/g)].map(m => m[1] || m[2]))];
  return { provider, endpoint: endpoint.replace(/\/+$/, ''), models, classes, sha256: digest(source) };
}

export async function configure(root, path = settingsPath()) {
  const settings = await loadSettings(path);
  const specs = { image: ['flux3Klein.ts', 'flux3-klein-t2i'], video: ['comfyMinimaxH3.ts', 'minimaxH3'] };
  for (const [kind, [file, model]] of Object.entries(specs)) {
    const providerPath = resolve(root, file);
    const info = await inspectProvider(providerPath, kind);
    if (!info.models.some(item => item.id === model)) throw new Error('配置模型不在适配器中：' + model);
    settings[kind] = {
      ...settings[kind], choice: 'existing', provider: info.provider.id, model,
      endpoint: info.endpoint, providerPath, providerSha256: info.sha256,
      credentialRef: null, authMode: 'private-comfyui-network',
      enabled: false, validation: { status: 'unverified' }, updatedAt: new Date().toISOString(),
    };
  }
  await saveSettings(path, settings);
  return { configured: true, enabled: false, settings: path };
}

export async function probeCapability(entry, kind, fetcher = fetch) {
  const checkedAt = new Date().toISOString();
  try {
    const info = await inspectProvider(entry.providerPath, kind);
    if (entry.providerSha256 !== info.sha256) throw new Error('Toonflow 适配器已变化，请先重新配置并核对');
    if (info.endpoint !== entry.endpoint) throw new Error('配置地址与适配器不一致');
    const get = async path => {
      const response = await fetcher(info.endpoint + path, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new Error('只读预检 HTTP ' + response.status);
      return response.json();
    };
    const stats = await get('/system_stats');
    if (!stats?.system || !Array.isArray(stats.devices)) throw new Error('不是有效的 ComfyUI 状态响应');
    const nodes = await get('/object_info');
    const missing = info.classes.filter(name => !nodes[name]);
    if (missing.length) return { status: 'unavailable', checkedAt, missingNodes: missing, reason: '工作流节点缺失' };
    // Node availability alone does not establish model files, execution, or output quality.
    return { status: 'unverified', checkedAt, connectivity: true, nodesAvailable: true,
      reason: '只读连通与节点检查通过，尚未验证目标模型执行和产物', requiredNodes: info.classes };
  } catch (error) {
    return { status: 'unavailable', checkedAt, reason: error.name === 'TimeoutError' ? 'ComfyUI 连接超时' : error.message };
  }
}

export async function probe(path = settingsPath()) {
  const settings = await loadSettings(path);
  const result = {};
  for (const kind of ['image', 'video']) {
    const entry = settings[kind];
    if (!entry || entry.choice === 'skip') { result[kind] = { status: 'disabled' }; continue; }
    const validation = await probeCapability(entry, kind);
    entry.validation = validation;
    entry.enabled = false;
    result[kind] = validation;
  }
  await saveSettings(path, settings);
  return result;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function acquireResource(endpoint, configPath, fetcher = fetch) {
  const key = digest(new URL(endpoint).origin).slice(0, 24);
  const lock = join(dirname(configPath), 'resources', key + '.lock');
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
        try { process.kill(owner.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') throw new Error('前次生成进程已停止，资源锁保留；先按任务日志核对远端状态，禁止直接重提：' + lock); }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await pause(3000);
    }
  }
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, endpoint, acquiredAt: new Date().toISOString() }), { mode: 0o600 });
  let safe = true;
  return { lock, uncertain() { safe = false; }, terminal() { safe = true; },
    async release() { if (safe) await rm(lock, { recursive: true }); } };
}

export async function generate(kind, request, output, path = settingsPath()) {
  for (const file of [output, output + '.source.json', output + '.task.json']) {
    try { await lstat(file); throw new Error('输出或任务记录已存在，拒绝重复提交：' + file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const settings = await loadSettings(path);
  const entry = settings[kind];
  if (!entry || entry.choice === 'skip') throw new Error('对应能力未配置或已跳过');
  const info = await inspectProvider(entry.providerPath, kind);
  if (entry.providerSha256 !== info.sha256 || entry.endpoint !== info.endpoint) throw new Error('适配器或地址已变化，请重新核对配置');
  if (!info.models.some(model => model.id === (request.model || entry.model))) throw new Error('不支持的模型');
  const resource = await acquireResource(entry.endpoint, path);
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('已停止本地等待，任务与资源锁保留；远端可能继续，请按编号恢复'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const origin = new URL(entry.endpoint).origin;
  const taskLog = output + '.task.json';
  let promptId;
  let graph;
  const safeFetch = async (url, options = {}) => {
    const target = new URL(typeof url === 'string' ? url : url.url);
    if (target.origin !== origin) throw new Error('拒绝访问配置以外的服务；参考图请使用本地二进制');
    if (/\/(interrupt|free)$/.test(target.pathname)) throw new Error('禁止中断或释放共享 ComfyUI 服务');
    // Bun's transport timer and provider timers are deliberately not inherited.
    return fetch(url, { ...options, signal: controller.signal, timeout: false, redirect: 'error' });
  };
  const jsonFetch = async (url, options) => {
    const response = await safeFetch(url, options);
    if (!response.ok) throw new Error('ComfyUI HTTP ' + response.status);
    return response.json();
  };
  try {
    // Share one local lock across images/videos and wait for external ComfyUI tasks too.
    for (;;) {
      const queue = await jsonFetch(entry.endpoint + '/queue');
      if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('队列响应无效');
      if (!queue.queue_running.length && !queue.queue_pending.length) break;
      await pause(3000);
    }
    const validation = await probeCapability(entry, kind, safeFetch);
    if (validation.status === 'unavailable') throw new Error(validation.reason);
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(taskLog, JSON.stringify({ status: 'preparing', kind, model: request.model || entry.model }), { flag: 'wx', mode: 0o600 });
    const captureFetch = async (url, options = {}) => {
      if (new URL(url).pathname === '/prompt' && options.method === 'POST') {
        graph = JSON.parse(options.body);
        // Capture the unchanged Toonflow workflow; never enter its timed polling loop.
        throw new Error('TALKCRAFT_WORKFLOW_CAPTURED');
      }
      return safeFetch(url, options);
    };
    const method = kind === 'image' ? 'generateImage' : 'generateVideo';
    try {
      await info.provider[method].call({ config: {}, signal: controller.signal,
        tool: { fetch: captureFetch, errorMessage: value => value instanceof Error ? value.message : JSON.stringify(value) } },
        { ...request, model: request.model || entry.model });
    } catch (error) { if (!graph) throw error; }
    controller.signal.throwIfAborted();
    if (!graph?.prompt) throw new Error('未取得 Toonflow 工作流');
    resource.uncertain();
    await writeFile(taskLog, JSON.stringify({ status: 'submitting', kind, model: request.model || entry.model, endpoint: entry.endpoint }));
    const submitted = await jsonFetch(entry.endpoint + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph) });
    if (submitted.error || Object.keys(submitted.node_errors || {}).length) { resource.terminal(); throw new Error('ComfyUI 拒绝工作流：' + JSON.stringify(submitted).slice(0, 1200)); }
    promptId = submitted.prompt_id;
    if (typeof promptId !== 'string' || !promptId) throw new Error('未返回任务编号，保留资源锁以防重复提交');
    await writeFile(taskLog, JSON.stringify({ status: 'submitted', promptId, kind, model: request.model || entry.model, endpoint: entry.endpoint }));
    console.error('任务已提交，串行等待完成（无超时）：' + promptId);
    let task;
    for (;;) {
      const history = await jsonFetch(entry.endpoint + '/history/' + encodeURIComponent(promptId));
      task = history[promptId];
      const failure = task?.status?.messages?.find(item => ['execution_error', 'execution_interrupted'].includes(item[0]));
      if (task?.status?.status_str === 'error' || failure) {
        resource.terminal();
        await writeFile(taskLog, JSON.stringify({ status: 'failed', promptId, kind, error: failure || task.status }));
        throw new Error('生成失败：' + JSON.stringify(failure || task.status).slice(0, 1500));
      }
      if (task?.status?.completed === true && task.status.status_str === 'success') { resource.terminal(); break; }
      await pause(3000);
    }
    const extensions = kind === 'image' ? /\.(png|jpe?g|webp)$/i : /\.(mp4|webm|mkv|mov)$/i;
    const files = Object.values(task.outputs || {}).flatMap(value => [...(value.images || []), ...(value.videos || []), ...(value.gifs || [])]);
    const file = files.find(item => extensions.test(item.filename || ''));
    if (!file) throw new Error('任务完成但缺少对应媒体产物');
    const response = await safeFetch(entry.endpoint + '/view?' + new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' }));
    if (!response.ok) throw new Error('下载产物失败');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('生成结果为空');
    await writeFile(output, bytes, { flag: 'wx' });
    await writeFile(output + '.source.json', JSON.stringify({ kind, provider: entry.provider, model: request.model || entry.model,
      providerSha256: info.sha256, createdAt: new Date().toISOString(), request, promptId, remoteFile: file, output: resolve(output),
      bytes: bytes.length, execution: { serial: true, timeout: null }, needsMediaReview: true }, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(taskLog, JSON.stringify({ status: 'downloaded', promptId, kind, output: resolve(output), remoteFile: file }));
    return { output: resolve(output), bytes: bytes.length, needsMediaReview: true };
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await resource.release();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'configure' && args[0]) console.log(JSON.stringify(await configure(args[0]), null, 2));
  else if (command === 'probe') console.log(JSON.stringify(await probe(), null, 2));
  else if (command === 'generate' && ['image', 'video'].includes(args[0]) && args[1] && args[2] && args.includes('--allow-generation')) {
    const request = JSON.parse(await readFile(args[1], 'utf8'));
    console.log(JSON.stringify(await generate(args[0], request, args[2]), null, 2));
  } else throw new Error('用法：bun scripts/toonflow_media.mjs configure <Toonflow providers目录> | probe | generate image|video <请求.json> <输出文件> --allow-generation');
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
