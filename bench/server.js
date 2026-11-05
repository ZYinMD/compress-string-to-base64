// Serve stable local snapshots of archive DB payloads and save browser benchmark results without exposing source contents in logs.
/*
 * Run npm run benchmark -- "/path/to/db_videos.js" "/path/to/another-db.js" with Node 24 or later, supplying one to four archive DB JavaScript files.
 * Open the printed localhost URL in Chrome and keep the tab visible until it reports completion; adding ?seed=90210 changes the method execution order.
 * The source archives are read only, and stable local gzip/Base64 snapshots, provenance, and result JSON are saved in the printed temporary directory.
 * Use --out to choose another output directory and --port to change the listening port; stop the server with Ctrl+C when finished.
 * The package.json files allowlist excludes bench/ and test/ from the published npm package, so these commands are for working from the source repository.
 */
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, gzipSync } from 'node:zlib';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const maxResultBytes = 10 * 1024 * 1024;

function parseArguments(args) {
  const options = { port: 18025, out: path.join(os.tmpdir(), 'base64-benchmark-' + new Date().toISOString().slice(0, 10)), files: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--port') options.port = Number(args[++index]);
    else if (argument === '--out') {
      const output = args[++index];
      if (!output) throw new Error('--out requires a directory.');
      options.out = path.resolve(output);
    } else if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(path.resolve(argument));
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 to 65535.');
  if (!options.files.length || options.files.length > 4) throw new Error('Usage: node bench/server.js [--port 18025] [--out OUTPUT_DIRECTORY] FILE.js [FILE.js ...] (one to four files).');
  return options;
}

function sameFile(before, after) {
  return before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.ino === after.ino && before.dev === after.dev;
}

async function uncompressedSize(bytes) {
  let size = 0;
  for await (const chunk of Readable.from([bytes]).pipe(createGunzip())) size += chunk.length;
  return size;
}

async function prepareSample(sourcePath, index, out) {
  const handle = await open(sourcePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`Source is not a regular file: ${sourcePath}`);
    const text = await handle.readFile({ encoding: 'utf8' });
    const compressed = /^\s*window\.([A-Za-z_$][\w$]*)_base64\s*=\s*"([A-Za-z0-9+/]*={0,2})";?\s*$/.exec(text);
    const plain = compressed ? null : /^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*String\.raw`([\s\S]*)`;?\s*$/.exec(text);
    let sourceFormat;
    let bytes;
    let base64;
    let jsonBytes;
    if (compressed) {
      base64 = compressed[2];
      if (!base64.length || base64.length % 4 !== 0) throw new Error(`Invalid Base64 wrapper: ${sourcePath}`);
      bytes = Buffer.from(base64, 'base64');
      if (bytes.toString('base64') !== base64) throw new Error(`Noncanonical Base64 payload: ${sourcePath}`);
      jsonBytes = await uncompressedSize(bytes);
      sourceFormat = 'compressed';
    } else if (plain) {
      const json = plain[2];
      jsonBytes = Buffer.byteLength(json, 'utf8');
      bytes = gzipSync(json);
      base64 = bytes.toString('base64');
      sourceFormat = 'plain';
    } else throw new Error(`Unsupported DB JavaScript wrapper: ${sourcePath}`);

    const after = await handle.stat();
    const currentPath = await stat(sourcePath);
    if (!sameFile(before, after) || !sameFile(before, currentPath)) throw new Error(`Source changed while preparing its snapshot: ${sourcePath}`);
    const id = `sample-${index + 1}`;
    const bytesPath = path.join(out, `${id}.gz`);
    const base64Path = path.join(out, `${id}-base64.txt`);
    await writeFile(bytesPath, bytes, { mode: 0o600 });
    await writeFile(base64Path, base64, { mode: 0o600 });
    return {
      id,
      label: `${path.basename(sourcePath)} (${path.basename(path.dirname(path.dirname(path.dirname(sourcePath))))})`,
      sourceFormat,
      sourceBytes: before.size,
      gzipBytes: bytes.length,
      base64Chars: base64.length,
      uncompressedBytes: jsonBytes,
      sourcePath,
      sourceModifiedAt: before.mtime.toISOString(),
      sourceCheckedAt: new Date().toISOString(),
      payloadPreparation: compressed ? 'Original compressed payload, validated without parsing JSON.' : 'Original plain JSON text compressed once with node:zlib for benchmark input.',
      bytesPath,
      base64Path,
    };
  } finally {
    await handle.close();
  }
}

function publicSample(sample) {
  const { id, label, sourceFormat, sourceBytes, gzipBytes, base64Chars, uncompressedBytes } = sample;
  return { id, label, sourceFormat, sourceBytes, gzipBytes, base64Chars, uncompressedBytes };
}

function jsonResponse(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readResult(request) {
  return new Promise(function receiveResult(resolve, reject) {
    let size = 0;
    let rejected = false;
    const chunks = [];
    request.on('data', function receiveChunk(chunk) {
      if (rejected) return;
      size += chunk.length;
      if (size > maxResultBytes) {
        rejected = true;
        chunks.length = 0;
        const error = new Error('Result body exceeds the 10 MiB limit.');
        error.status = 413;
        reject(error);
      } else chunks.push(chunk);
    });
    request.once('end', function finishResult() {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const error = new Error('Result body is not valid JSON.');
        error.status = 400;
        reject(error);
      }
    });
    request.once('error', reject);
    request.once('aborted', function resultAborted() { reject(new Error('Result upload was interrupted.')); });
  });
}

async function serveFile(response, filename, contentType) {
  const info = await stat(filename);
  response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' });
  await pipeline(createReadStream(filename), response);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  const environment = { nodeVersion: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model };
  const samples = [];
  for (const [index, sourcePath] of options.files.entries()) {
    console.log(`Preparing sample ${index + 1}/${options.files.length}: ${path.basename(sourcePath)}`);
    const sample = await prepareSample(sourcePath, index, options.out);
    samples.push(sample);
    console.log(`Prepared ${sample.id}: ${sample.sourceFormat}, ${sample.sourceBytes} source bytes, ${sample.gzipBytes} gzip bytes, ${sample.uncompressedBytes} uncompressed bytes.`);
  }
  const manifest = { preparedAt: new Date().toISOString(), environment, samples };
  await writeFile(path.join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  let latest;
  let resultSequence = 0;
  const server = createServer(async function handleRequest(request, response) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    try {
      const url = new URL(request.url, `http://localhost:${options.port}`);
      if (request.method === 'GET') {
        if (url.pathname === '/api/samples') return jsonResponse(response, 200, { samples: samples.map(publicSample), environment });
        if (url.pathname === '/api/results/latest') return jsonResponse(response, latest ? 200 : 404, latest ?? { error: 'No benchmark results have been saved.' });
        const payload = /^\/api\/samples\/(sample-\d+)\/(bytes|base64)$/.exec(url.pathname);
        if (payload) {
          const sample = samples.find(function matchingSample(candidate) { return candidate.id === payload[1]; });
          if (!sample) return jsonResponse(response, 404, { error: 'Unknown sample.' });
          return await serveFile(response, payload[2] === 'bytes' ? sample.bytesPath : sample.base64Path, payload[2] === 'bytes' ? 'application/octet-stream' : 'text/plain; charset=utf-8');
        }
        const assets = {
          '/': [path.join(packageRoot, 'bench/index.html'), 'text/html; charset=utf-8'],
          '/benchmark.js': [path.join(packageRoot, 'bench/benchmark.js'), 'text/javascript; charset=utf-8'],
          '/modules.js': [path.join(packageRoot, 'modules.js'), 'text/javascript; charset=utf-8'],
        };
        if (Object.hasOwn(assets, url.pathname)) return await serveFile(response, ...assets[url.pathname]);
      } else if (request.method === 'POST' && url.pathname === '/api/results') {
        if (request.headers.origin && request.headers.origin !== `http://localhost:${options.port}`) return jsonResponse(response, 403, { error: 'Unrelated origins cannot submit benchmark results.' });
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return jsonResponse(response, 415, { error: 'Use Content-Type: application/json.' });
        const results = await readResult(request);
        const createdAt = new Date().toISOString();
        const report = { createdAt, manifest, results };
        const filename = `results-${createdAt.replace(/[:.]/g, '-')}-${++resultSequence}.json`;
        const resultPath = path.join(options.out, filename);
        await writeFile(resultPath, JSON.stringify(report, null, 2), { mode: 0o600 });
        latest = { path: resultPath, ...report };
        console.log(`Saved benchmark results: ${filename}`);
        return jsonResponse(response, 200, { ok: true, path: resultPath, samples: samples.length });
      }
      jsonResponse(response, request.method === 'GET' ? 404 : 405, { error: 'Route not found or method not allowed.' });
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else jsonResponse(response, error.status ?? (error.code === 'ENOENT' ? 404 : 500), { error: error.message });
    }
  });
  await new Promise(function listen(resolve, reject) {
    server.once('error', reject);
    server.listen(options.port, 'localhost', resolve);
  });
  function stop() {
    server.close();
    server.closeIdleConnections();
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`Benchmark ready: http://localhost:${options.port}/`);
  console.log(`Local artifacts: ${options.out}`);
}

main().catch(function startupFailed(error) {
  console.error(error.message);
  process.exitCode = 1;
});
