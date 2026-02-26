import type { APIRoute } from "astro";
import { readFile, writeFile } from "fs/promises";
import path from "path";

// 默认数据集路径
const DATASET_PATH = process.env.DATASET_META_PATH || path.join(process.cwd(), '../data', "dataset.jsonl");
const OUTPUT_PATH = path.join(path.dirname(DATASET_PATH), "dataset_post_processed.jsonl");

export const POST: APIRoute = async () => {
  try {
    const raw = await readFile(DATASET_PATH, "utf-8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const processed = lines.map((line) => {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        return null;
      }
      const role = obj.role || "";
      const caption = obj.caption || "";
      obj.caption = `<ROLES>${role}<ROLES>    ${caption}`;
      return JSON.stringify(obj);
    }).filter(Boolean);
    await writeFile(OUTPUT_PATH, processed.join("\n") + "\n", "utf-8");
    return new Response(JSON.stringify({ success: true, count: processed.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
