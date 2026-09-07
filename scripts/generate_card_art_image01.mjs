#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const workspace = "/Users/caiqing/Documents/agents/github/creative-games/sanguo-kill";
const promptFile = path.join(workspace, "docs/card-art-prompts.md");
const model = process.env.IMAGE_MODEL || "image-01";
const outputDir = path.join(workspace, process.env.IMAGE_OUTPUT_DIR || `assets/cards/${model}`);
const authFile = "/Users/caiqing/.codex/auth.json";
const baseUrl = "https://modelhub.wuhancloud.cn/v1";
const size = "1024x1536";
const variants = 4;
const quality = process.env.IMAGE_QUALITY || "auto";
const concurrency = Math.max(1, Number(process.env.IMAGE_CONCURRENCY || 3));
const maxRetries = 3;

const styleSuffix = [
  "ancient Chinese Three Kingdoms era card game illustration",
  "ink-wash painting blended with fine gongbi line art",
  "dark lacquered background with aged parchment texture",
  "ornate gold filigree border",
  "dramatic rim lighting",
  "rich vermilion and antique gold palette",
  "highly detailed",
  "centered composition",
  "vertical portrait",
].join(", ");

const layoutConstraints = [
  "keep the main subject within the central 70 percent",
  "leave the top-left area empty for UI suit and rank overlays",
  "reserve the bottom 15 percent as a dark subdued area for the card name",
  "no readable text, letters, numbers, symbols, watermark, signature, or logo",
].join(", ");

const negative = [
  "modern objects",
  "photography",
  "3d render",
  "anime chibi",
  "western fantasy",
  "low quality",
  "blurry",
  "deformed hands",
  "extra fingers",
  "oversaturated colors",
  "flat colors",
].join(", ");

function parsePrompts(markdown) {
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let heading = "未命名卡牌";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^#{3,4}\s+/.test(line)) {
      heading = line.replace(/^#{3,4}\s+/, "").replace(/\s+×\d+.*$/, "").trim();
    } else if (/^\*\*[^*]+\*\*$/.test(line)) {
      heading = line.replace(/^\*\*|\*\*$/g, "").trim();
    }
    if (line !== "```text") continue;
    const block = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "```") {
      block.push(lines[i]);
      i += 1;
    }
    const promptIndex = block.findIndex((value) => value.trim() === "PROMPT =");
    if (promptIndex === -1) continue;
    const rawPrompt = block.slice(promptIndex + 1).join(" ").replace(/\s+/g, " ").trim();
    if (!rawPrompt) continue;
    const prompt = rawPrompt
      .replace(/\{STYLE_SUFFIX\}/g, styleSuffix)
      .replace(/,\s*$/, "") + `, ${layoutConstraints}, avoid ${negative}`;
    entries.push({ index: entries.length + 1, name: heading, prompt });
  }
  return entries;
}

function safeName(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[·。！？、，（）()]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "card";
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestImages(apiKey, entry) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: entry.prompt,
          size,
          quality,
          n: variants,
          response_format: "b64_json",
        }),
        signal: AbortSignal.timeout(180000),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 800)}`);
      const payload = JSON.parse(body);
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw new Error("接口返回中没有图片数据");
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) await sleep(attempt * 3000);
    }
  }
  throw lastError;
}

async function saveImage(item, filename) {
  let buffer;
  let extension = "jpg";
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const response = await fetch(item.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`下载图片失败 HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    throw new Error("图片条目既没有 b64_json 也没有 url");
  }
  if (buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") extension = "png";
  const finalPath = `${filename}.${extension}`;
  await fs.writeFile(finalPath, buffer);
  return finalPath;
}

async function main() {
  const auth = JSON.parse(await fs.readFile(authFile, "utf8"));
  const apiKey = auth.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Codex 本地认证文件中没有 OPENAI_API_KEY");
  const markdown = await fs.readFile(promptFile, "utf8");
  const entries = parsePrompts(markdown);
  if (entries.length !== 34) {
    throw new Error(`预期解析 34 条 Prompt，实际得到 ${entries.length} 条`);
  }

  await fs.mkdir(path.join(outputDir, "variants"), { recursive: true });
  const manifest = {
    model,
    size,
    variants,
    generatedAt: new Date().toISOString(),
    source: promptFile,
    entries: entries.map(({ index, name, prompt }) => ({ index, name, prompt, files: [], status: "pending" })),
  };
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= entries.length) return;
      const entry = entries[current];
      const prefix = `${String(entry.index).padStart(2, "0")}-${safeName(entry.name)}`;
      try {
        const images = await requestImages(apiKey, entry);
        const files = [];
        for (let i = 0; i < images.length; i += 1) {
          const file = await saveImage(images[i], path.join(outputDir, "variants", `${prefix}-v${i + 1}`));
          files.push(path.relative(workspace, file));
        }
        manifest.entries[current].files = files;
        manifest.entries[current].status = "done";
        completed += 1;
        console.log(`[${completed}/${entries.length}] ${entry.name}: ${files.length} 张`);
      } catch (error) {
        manifest.entries[current].status = "error";
        manifest.entries[current].error = String(error?.message || error);
        console.error(`[ERROR] ${entry.name}: ${manifest.entries[current].error}`);
      }
      await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  const errors = manifest.entries.filter((entry) => entry.status === "error");
  console.log(`完成：${completed}/${entries.length} 条 Prompt，错误：${errors.length} 条`);
  if (errors.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
