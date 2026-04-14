#!/usr/bin/env node
/**
 * gemini.mjs — Call Gemini Flash from NanoClaw containers
 *
 * Usage:
 *   node gemini.mjs "<prompt>"
 *   node gemini.mjs "<prompt>" --context-file <path>
 *   node gemini.mjs "<prompt>" --context-dir <dir>   (loads all .md/.txt/.json/.csv files)
 *   node gemini.mjs "<prompt>" --context "<inline text>"
 *   node gemini.mjs "<prompt>" --system "<system instruction>"
 *
 * Context caching is applied automatically when context exceeds 32K tokens.
 * Progress messages go to stderr; the response goes to stdout.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-001';
const CACHE_THRESHOLD_TOKENS = 32_000;
const MAX_CONTEXT_BYTES = 8 * 1024 * 1024; // 8 MB hard cap
const BASE_HOST = 'generativelanguage.googleapis.com';

// ---------- Arg parsing ----------

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    prompt: null,
    context: null,
    contextFile: null,
    contextDir: null,
    system: null,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--context' || a === '-c') && args[i + 1]) {
      opts.context = args[++i];
    } else if ((a === '--context-file' || a === '-f') && args[i + 1]) {
      opts.contextFile = args[++i];
    } else if ((a === '--context-dir' || a === '-d') && args[i + 1]) {
      opts.contextDir = args[++i];
    } else if ((a === '--system' || a === '-s') && args[i + 1]) {
      opts.system = args[++i];
    } else if (!a.startsWith('-') && opts.prompt === null) {
      opts.prompt = a;
    }
  }

  return opts;
}

// ---------- Context loading ----------

function walkDir(dir, exts) {
  const results = [];
  let totalBytes = 0;

  function walk(d) {
    if (totalBytes >= MAX_CONTEXT_BYTES) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
        try {
          const stat = fs.statSync(full);
          if (totalBytes + stat.size > MAX_CONTEXT_BYTES) continue;
          results.push(full);
          totalBytes += stat.size;
        } catch {
          /* skip unreadable */
        }
      }
    }
  }

  walk(dir);
  return results;
}

function loadContext(opts) {
  if (opts.contextFile) {
    return fs.readFileSync(opts.contextFile, 'utf8');
  }

  if (opts.contextDir) {
    const files = walkDir(opts.contextDir, ['.md', '.txt', '.json', '.csv']);
    if (files.length === 0) return '';
    const base = opts.contextDir;
    return files
      .map((f) => {
        const rel = path.relative(base, f);
        const content = fs.readFileSync(f, 'utf8');
        return `=== ${rel} ===\n${content}`;
      })
      .join('\n\n');
  }

  return opts.context || '';
}

// ---------- Token estimation ----------
// Korean/CJK characters ~2 tokens each, Latin ~0.25 tokens each

function estimateTokens(text) {
  let t = 0;
  for (const ch of text) {
    t += ch.codePointAt(0) > 127 ? 2 : 0.25;
  }
  return Math.ceil(t);
}

// ---------- HTTP helpers ----------

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: BASE_HOST,
        path: `${urlPath}?key=${API_KEY}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            reject(
              new Error(
                `Non-JSON response (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function del(urlPath) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: BASE_HOST,
        path: `${urlPath}?key=${API_KEY}`,
        method: 'DELETE',
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', () => resolve());
    req.end();
  });
}

// ---------- Gemini API ----------

async function generateDirect(prompt, context, system) {
  const userText = context ? `${context}\n\n${prompt}` : prompt;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return post(`/v1beta/models/${MODEL}:generateContent`, body);
}

async function generateWithCache(prompt, context, system) {
  const cacheBody = {
    model: `models/${MODEL}`,
    contents: [{ role: 'user', parts: [{ text: context }] }],
    ttl: '3600s',
  };
  if (system) cacheBody.systemInstruction = { parts: [{ text: system }] };

  process.stderr.write(
    `[gemini] Creating context cache (~${estimateTokens(context).toLocaleString()} tokens)...\n`,
  );
  const cache = await post('/v1beta/cachedContents', cacheBody);

  if (cache.error) {
    // Cache creation failed (e.g. below minimum token count) — fall back to inline
    process.stderr.write(
      `[gemini] Cache unavailable (${cache.error.message}), using inline context\n`,
    );
    return generateDirect(prompt, context, system);
  }

  process.stderr.write(`[gemini] Cache ready: ${cache.name}\n`);

  try {
    return await post(`/v1beta/models/${MODEL}:generateContent`, {
      cachedContent: cache.name,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
  } finally {
    await del(`/v1beta/${cache.name}`);
  }
}

function extractText(response) {
  if (response.error) {
    throw new Error(
      `Gemini API error (${response.error.code}): ${response.error.message}`,
    );
  }
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(
      `No text in response: ${JSON.stringify(response).slice(0, 400)}`,
    );
  }
  return text;
}

// ---------- Main ----------

async function main() {
  if (!API_KEY) {
    process.stderr.write(
      'Error: GEMINI_API_KEY not set. Add GEMINI_API_KEY=... to your .env file.\n',
    );
    process.exit(1);
  }

  const opts = parseArgs(process.argv);

  if (!opts.prompt) {
    process.stderr.write(
      'Usage: gemini.mjs "<prompt>" [--context-file <path>] [--context-dir <dir>] [--context "<text>"] [--system "<text>"]\n',
    );
    process.exit(1);
  }

  const context = loadContext(opts);
  const ctxTokens = context ? estimateTokens(context) : 0;
  const useCache = ctxTokens >= CACHE_THRESHOLD_TOKENS;

  process.stderr.write(
    `[gemini] model=${MODEL} context≈${ctxTokens.toLocaleString()} tokens cache=${useCache}\n`,
  );

  const response =
    context && useCache
      ? await generateWithCache(opts.prompt, context, opts.system)
      : await generateDirect(opts.prompt, context, opts.system);

  process.stdout.write(extractText(response));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(`[gemini] Error: ${err.message}\n`);
  process.exit(1);
});
