import { useState, useEffect } from 'react';

interface MetaItem {
	meta_index: number;
	media_path?: string;
	caption?: string;
	processed?: boolean;
	resolved_media_path?: string;
	processed_video_path?: string;
	processed_audio_path?: string;
	processed_audio_pos?: [number, number];
	processed_video_pos?: [number, number] | null;
}

interface TrimAppProps {
	defaultMetaPath: string;
}

export default function TrimApp({ defaultMetaPath }: TrimAppProps) {
	const [metaPath, setMetaPath] = useState(defaultMetaPath);
	const [items, setItems] = useState<MetaItem[]>([]);
	const [currentIndex, setCurrentIndex] = useState(-1);
	const [loadStatus, setLoadStatus] = useState('等待加载');
	const [saveStatus, setSaveStatus] = useState('尚未保存');
	const [refStart, setRefStart] = useState('0');
	const [refEnd, setRefEnd] = useState('');
	const [videoStart, setVideoStart] = useState('');
	const [videoEnd, setVideoEnd] = useState('');
	const [videoStartManuallySet, setVideoStartManuallySet] = useState(false);
	const [videoDuration, setVideoDuration] = useState(0);
	const [previewInterval, setPreviewInterval] = useState<NodeJS.Timeout | null>(null);
	const [captionInput, setCaptionInput] = useState('');

	const currentItem = currentIndex >= 0 && currentIndex < items.length ? items[currentIndex] : null;

	const loadMeta = async () => {
		if (!metaPath.trim()) {
			setLoadStatus('请输入 dataset_meta.jsonl 路径');
			return;
		}
		setLoadStatus('加载中...');
		try {
			const response = await fetch(`/api/meta.json?path=${encodeURIComponent(metaPath)}`);
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '加载失败');
			}
			setItems(data.items || []);
			setCurrentIndex(data.items?.length > 0 ? 0 : -1);
			setLoadStatus(`已加载 ${data.items?.length || 0} 条`);
			localStorage.setItem('ltx-meta-path', metaPath);
		} catch (error: any) {
			setLoadStatus(error.message || '加载失败');
		}
	};

	const selectIndex = (index: number) => {
		if (index < 0 || index >= items.length) return;
		setCurrentIndex(index);
		setVideoStartManuallySet(false);

		const item = items[index];
		setCaptionInput(item.caption || '');
		if (item.processed) {
			setSaveStatus('已处理 - 显示处理后媒体');
			if (item.processed_audio_pos && Array.isArray(item.processed_audio_pos)) {
				setRefStart(item.processed_audio_pos[0].toFixed(2));
				setRefEnd(item.processed_audio_pos[1].toFixed(2));
			}
			if (item.processed_video_pos && Array.isArray(item.processed_video_pos)) {
				setVideoStart(item.processed_video_pos[0].toFixed(2));
				setVideoEnd(item.processed_video_pos[1].toFixed(2));
				setVideoStartManuallySet(true);
			} else {
				setVideoStart('');
				setVideoEnd('');
			}
		} else {
			setSaveStatus('就绪');
			setRefStart('0');
			setRefEnd('');
			setVideoStart('');
			setVideoEnd('');
		}
	};

	const handleVideoLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
		const video = e.currentTarget;
		setVideoDuration(video.duration);
		if (video.duration && Number.isFinite(video.duration)) {
			setVideoEnd(video.duration.toFixed(2));
		}
	};

	const handleRefEndChange = (value: string) => {
		setRefEnd(value);
		if (!videoStartManuallySet && value) {
			setVideoStart(value);
		}
	};

	const handleSave = async () => {
		if (currentIndex < 0) {
			setSaveStatus('请先选择条目');
			return;
		}
		setSaveStatus('正在裁剪...');
		try {
			const payload = {
				metaPath,
				index: currentIndex,
				refStart: Number(refStart),
				refEnd: Number(refEnd),
				videoStart: Number(videoStart || 0),
				videoEnd: videoEnd ? Number(videoEnd) : null,
			};
			const response = await fetch('/api/trim.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '裁剪失败');
			}
			const savedPaths = [data.audio, data.video].filter(Boolean).join(' | ');
			setSaveStatus(`已保存: ${savedPaths}`);
			const newItems = [...items];
			newItems[currentIndex] = {
				...newItems[currentIndex],
				processed: true,
				processed_audio_path: data.audioPath,
				processed_video_path: data.videoPath || undefined,
				processed_audio_pos: [Number(refStart), Number(refEnd)],
				processed_video_pos: videoEnd ? [Number(videoStart), Number(videoEnd)] : null,
			};
			setItems(newItems);
		} catch (error: any) {
			setSaveStatus(error.message || '裁剪失败');
		}
	};

	const handleClear = () => {
		setRefStart('0');
		setRefEnd('');
		setVideoStart('');
		setVideoEnd(videoDuration && Number.isFinite(videoDuration) ? videoDuration.toFixed(2) : '');
		setVideoStartManuallySet(false);
		setSaveStatus('已清空');
	};

	const handleCaptionSave = async () => {
		if (currentIndex < 0) return;
		try {
			const response = await fetch('/api/caption.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					metaPath,
					index: currentIndex,
					caption: captionInput,
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '保存失败');
			}
			const newItems = [...items];
			newItems[currentIndex] = { ...newItems[currentIndex], caption: captionInput };
			setItems(newItems);
			setSaveStatus('Caption 已保存');
		} catch (error: any) {
			setSaveStatus(error.message || '保存 caption 失败');
		}
	};

	useEffect(() => {
		const stored = localStorage.getItem('ltx-meta-path');
		if (stored) setMetaPath(stored);
	}, []);

	return (
		<div className="flex gap-4 h-[calc(100vh-80px)] p-4">
			{/* Left Panel - Controls */}
			<div className="w-[360px] bg-[#141a26] border border-[#2a3244] rounded-xl p-4 flex flex-col gap-3 overflow-hidden">
				<div className="text-xs text-[#a9b2c3]">参考音频区间 (秒)</div>
				<div className="grid grid-cols-2 gap-2">
					<input
						type="number"
						step="0.01"
						placeholder="Start"
						value={refStart}
						onChange={(e) => setRefStart(e.target.value)}
						className="w-full px-2.5 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]"
					/>
					<input
						type="number"
						step="0.01"
						placeholder="End"
						value={refEnd}
						onChange={(e) => handleRefEndChange(e.target.value)}
						className="w-full px-2.5 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]"
					/>
				</div>
				<div className="flex gap-2">
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) setRefStart(video.currentTime.toFixed(2));
						}}
						className="flex-1 px-3 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					>
						设为当前起点
					</button>
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) {
								handleRefEndChange(video.currentTime.toFixed(2));
							}
						}}
						className="flex-1 px-3 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					>
						设为当前终点
					</button>
				</div>

				<div className="text-xs text-[#a9b2c3] mt-3">视频裁剪区间 (秒)</div>
				<div className="grid grid-cols-2 gap-2">
					<input
						type="number"
						step="0.01"
						placeholder="Start"
						value={videoStart}
						onChange={(e) => {
							setVideoStart(e.target.value);
							if (e.target.value) setVideoStartManuallySet(true);
						}}
						className="w-full px-2.5 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]"
					/>
					<input
						type="number"
						step="0.01"
						placeholder="End"
						value={videoEnd}
						onChange={(e) => setVideoEnd(e.target.value)}
						className="w-full px-2.5 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]"
					/>
				</div>
				<div className="flex gap-2">
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) {
								setVideoStart(video.currentTime.toFixed(2));
								setVideoStartManuallySet(true);
							}
						}}
						className="flex-1 px-3 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					>
						设为当前起点
					</button>
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) setVideoEnd(video.currentTime.toFixed(2));
						}}
						className="flex-1 px-3 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					>
						设为当前终点
					</button>
				</div>

				<div className="flex gap-2 mt-2">
					<button onClick={handleSave} className="flex-1 px-3 py-2 rounded-lg bg-[#4f8cff] text-white text-sm">
						裁剪并保存
					</button>
					<button onClick={handleClear} className="flex-1 px-3 py-2 rounded-lg bg-transparent border border-[#2a3244] text-[#e7ecf3] text-sm">
						清空区间
					</button>
				</div>
				<div className="text-xs text-[#a9b2c3]">{saveStatus}</div>

				<div className="flex gap-2 mt-4">
					<input
						type="text"
						placeholder="dataset_meta.jsonl 路径"
						value={metaPath}
						onChange={(e) => setMetaPath(e.target.value)}
						className="flex-1 px-2.5 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]"
					/>
					<button onClick={loadMeta} className="px-3 py-2 rounded-lg bg-[#4f8cff] text-white">
						加载
					</button>
				</div>
				<div className="text-xs text-[#a9b2c3]">{loadStatus}</div>

				<div className="flex-1 overflow-y-auto pr-1.5">
					{items.map((item, index) => (
						<div
							key={index}
							onClick={() => selectIndex(index)}
							className={`p-2.5 rounded-lg border mb-2 cursor-pointer ${
								index === currentIndex
									? 'border-[#4f8cff] bg-[#4f8cff]/10'
									: 'border-transparent bg-[#1b2232]'
							}`}
						>
							<div className="text-sm truncate">{item.caption || item.media_path || '未命名条目'}</div>
							<div className="text-xs text-[#a9b2c3]">
								#{index}{item.caption && item.media_path ? ` ${item.media_path}` : ''}
							</div>
							<span
								className={`inline-block px-1.5 py-0.5 rounded-full text-[11px] ml-1.5 ${
									item.processed ? 'bg-[#48c78e]/20 text-[#48c78e]' : 'bg-[#ffcd56]/20 text-[#ffcd56]'
								}`}
							>
								{item.processed ? '已处理' : '未处理'}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* Right Panel - Media */}
			<div className="flex-1 bg-[#141a26] border border-[#2a3244] rounded-xl p-4 overflow-hidden">
				<div className="grid grid-cols-[1fr_320px] gap-4 h-full">
					<div className="flex flex-col h-full overflow-hidden">
						<video
							id="main-video"
							controls
							preload="metadata"
							onLoadedMetadata={handleVideoLoaded}
							src={currentItem?.resolved_media_path ? `/api/media?path=${encodeURIComponent(currentItem.resolved_media_path)}` : ''}
							className="w-full flex-1 min-h-0 rounded-xl bg-black object-contain"
						/>
						<div className="text-xs text-[#a9b2c3] mt-3 flex-shrink-0">
							#{currentIndex} {currentItem?.processed ? '[已处理]' : ''} {currentItem?.media_path ?? '未选择条目'}
						</div>

						<div className="text-xs text-[#a9b2c3] mt-2 flex-shrink-0 line-clamp-5 break-all">
							{currentItem?.caption || '无 caption'}
						</div>

						<div className="flex gap-2 mt-3 flex-shrink-0">
							<button onClick={() => selectIndex(currentIndex - 1)} className="px-3 py-2 cursor-pointer rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]">
								上一个
							</button>
							<button onClick={() => selectIndex(currentIndex + 1)} className="px-3 py-2 cursor-pointer rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]">
								下一个
							</button>
							<input
								type="text"
								placeholder="Caption (回车保存)"
								value={captionInput}
								onChange={(e) => setCaptionInput(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleCaptionSave()}
								className="flex-1 px-2.5 py-2 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
							/>
						</div>
					</div>

					<div className="flex flex-col gap-3 h-full overflow-hidden">
						<div className="bg-[#1b2232] rounded-lg p-2.5 flex flex-col gap-2 flex-shrink-0">
							<div className="text-xs text-[#a9b2c3]">处理后音频</div>
							{currentItem?.processed && currentItem.processed_audio_path ? (
							<>
								<div className="text-xs text-[#a9b2c3] break-all">{currentItem.processed_audio_path}</div>
								<audio controls src={`/api/media?path=${encodeURIComponent(currentItem.processed_audio_path)}`} className="w-full rounded-lg" />
							</>
							) : (
								<div className="text-xs text-[#a9b2c3]">无</div>
							)}
						</div>
						<div className="flex-1 bg-[#1b2232] rounded-lg p-2.5 flex flex-col gap-2 min-h-0 overflow-hidden">
							<div className="text-xs text-[#a9b2c3] flex-shrink-0">处理后视频</div>
							{currentItem?.processed && currentItem.processed_video_path ? (
							<>
								<div className="text-xs text-[#a9b2c3] break-all flex-shrink-0">{currentItem.processed_video_path}</div>
								<video controls preload="metadata" src={`/api/media?path=${encodeURIComponent(currentItem.processed_video_path)}`} className="w-full flex-1 min-h-0 rounded-lg bg-black object-contain" />
							</>
							) : (
								<div className="text-xs text-[#a9b2c3]">无</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
