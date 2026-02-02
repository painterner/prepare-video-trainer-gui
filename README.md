# LTX-2 Trim GUI

本项目提供一个本地 Astro GUI，用于读取 `dataset_meta.jsonl`，标记参考音频区间与视频裁剪区间，并输出 `dataset.jsonl`。

## 运行方式

```sh
npm install
npm run dev
```

默认在 `http://localhost:4321` 访问。

## 环境变量

- `LTX_ROOT`：允许访问的根路径，默认 `/home/ka/all-ref/MY_LTX-2`
- `DATASET_META_PATH`：默认 `dataset_meta.jsonl` 路径

## 输出

处理结果将写入 `dataset.jsonl`，并在 `dataset_processed/audio` 和 `dataset_processed/video` 下生成裁剪结果。
