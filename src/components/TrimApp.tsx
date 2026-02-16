import { useState, useEffect, useRef } from 'react';
import HighlightedEditor from './HighlightedEditor';

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
	processed_video_crop?: { x: number; y: number; w: number; h: number } | null;
	processed_waveform_path?: string | null;
	role?: string | null;
	tag?: string;
	speech?: string;
	separateSpeechTag?: string;
}

interface TrimAppProps {
	defaultMetaPath: string;
}

// Simple syntax highlighting for prompt text
function HighlightedText({ text }: { text: string }) {
	// Highlight patterns: [brackets], {braces}, <angles>, "quotes", numbers
	const parts = text.split(/(\[[^\]]*\]|\{[^}]*\}|<[^>]*>|"[^"]*"|\b\d+\.?\d*\b)/g);
	return (
		<>
			{parts.map((part, i) => {
				if (part.startsWith('[') && part.endsWith(']')) {
					return <span key={i} className="text-[#f1c40f]">{part}</span>;
				}
				if (part.startsWith('{') && part.endsWith('}')) {
					return <span key={i} className="text-[#e74c3c]">{part}</span>;
				}
				if (part.startsWith('<') && part.endsWith('>')) {
					return <span key={i} className="text-[#9b59b6]">{part}</span>;
				}
				if (part.startsWith('"') && part.endsWith('"')) {
					return <span key={i} className="text-[#2ecc71]">{part}</span>;
				}
				if (/^\d+\.?\d*$/.test(part)) {
					return <span key={i} className="text-[#3498db]">{part}</span>;
				}
				return <span key={i}>{part}</span>;
			})}
		</>
	);
}

// Available tags for classification
const AVAILABLE_TAGS = ['人物', '风景', '动物', '产品', '动画', '其他'];
const SEPARATE_SPEECH_TAGS = ['分离', '不分离'];

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
	const [videoEndManuallySet, setVideoEndManuallySet] = useState(false);
	const [videoDuration, setVideoDuration] = useState(0);
	const [previewInterval, setPreviewInterval] = useState<NodeJS.Timeout | null>(null);
	const [captionInput, setCaptionInput] = useState('');
	const [speechInput, setSpeechInput] = useState('');
	const [roleInput, setRoleInput] = useState('');
	const [currentTag, setCurrentTag] = useState('');
	const [currentSeparateSpeechTag, setCurrentSeparateSpeechTag] = useState('');
	const [showCaptionEditor, setShowCaptionEditor] = useState(false);
	const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [batchRange, setBatchRange] = useState('');
	const [isBatchProcessing, setIsBatchProcessing] = useState(false);
	const [batchProgress, setBatchProgress] = useState('');
	const [isRetrimming, setIsRetrimming] = useState(false);
	const [retrimProgress, setRetrimProgress] = useState('');
	const [isGeneratingWaveforms, setIsGeneratingWaveforms] = useState(false);
	const [waveformProgress, setWaveformProgress] = useState('');
	const [showWaveformModal, setShowWaveformModal] = useState(false);
	const editorRef = useRef<HTMLDivElement>(null);
	const videoContainerRef = useRef<HTMLDivElement>(null);
	const listContainerRef = useRef<HTMLDivElement>(null);
	
	// Crop selection state
	const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
	const [isDrawing, setIsDrawing] = useState(false);
	const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
	const [videoSize, setVideoSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

	const currentItem = currentIndex >= 0 && currentIndex < items.length ? items[currentIndex] : null;

	const loadMeta = async (restoreIndex?: number) => {
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
			const loadedItems = data.items || [];
			setItems(loadedItems);
			setLoadStatus(`已加载 ${loadedItems.length || 0} 条`);
			localStorage.setItem('ltx-meta-path', metaPath);
			
			// Determine which index to select
			let targetIndex = 0;
			if (typeof restoreIndex === 'number' && restoreIndex >= 0 && restoreIndex < loadedItems.length) {
				targetIndex = restoreIndex;
			}
			
			// Auto-select item and load its data
			if (loadedItems.length > 0) {
				const item = loadedItems[targetIndex];
				setCurrentIndex(targetIndex);
				localStorage.setItem('ltx-current-index', String(targetIndex));
				setCaptionInput(item.caption || '');
				setSpeechInput(item.speech || '');
				setCurrentTag(item.tag || '');
				setCurrentSeparateSpeechTag(item.separateSpeechTag || '');
				setCropRect(null);
				setVideoStartManuallySet(false);
				setVideoEndManuallySet(false);
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
						setVideoEndManuallySet(true);
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
			} else {
				setCurrentIndex(-1);
			}
		} catch (error: any) {
			setLoadStatus(error.message || '加载失败');
		}
	};

	const selectIndex = (index: number) => {
		if (index < 0 || index >= items.length) return;
		setCurrentIndex(index);
		localStorage.setItem('ltx-current-index', String(index));
		setVideoStartManuallySet(false);
		setVideoEndManuallySet(false);
		setShowWaveformModal(false);

		const item = items[index];
		setCaptionInput(item.caption || '');
		setSpeechInput((item as any).speech || '');
		setCurrentTag(item.tag || '');
		setCurrentSeparateSpeechTag(item.separateSpeechTag || '');
		setRoleInput(item.role || '');
		
		if (item.processed) {
			setSaveStatus('已处理 - 显示处理后媒体');
			// Load crop if exists
			if (item.processed_video_crop) {
				setCropRect(item.processed_video_crop);
			} else {
				setCropRect(null);
			}
			if (item.processed_audio_pos && Array.isArray(item.processed_audio_pos)) {
				setRefStart(item.processed_audio_pos[0].toFixed(2));
				setRefEnd(item.processed_audio_pos[1].toFixed(2));
			}
			if (item.processed_video_pos && Array.isArray(item.processed_video_pos)) {
				setVideoStart(item.processed_video_pos[0].toFixed(2));
				setVideoEnd(item.processed_video_pos[1].toFixed(2));
				setVideoStartManuallySet(true);
				setVideoEndManuallySet(true);
			} else {
				setVideoStart('');
				setVideoEnd('');
			}
		} else {
			setSaveStatus('就绪');
			setCropRect(null);
			setRefStart('0');
			setRefEnd('');
			setVideoStart('');
			setVideoEnd('');
		}
	};

	// Auto-load on mount if metaPath exists
	useEffect(() => {
		const savedPath = localStorage.getItem('ltx-meta-path');
		const savedIndex = localStorage.getItem('ltx-current-index');
		if (savedPath) {
			setMetaPath(savedPath);
			// Need to call loadMeta after metaPath is set
			setTimeout(() => {
				const restoreIdx = savedIndex ? parseInt(savedIndex, 10) : 0;
				loadMetaWithPath(savedPath, restoreIdx);
			}, 0);
		}
	}, []);

	// Helper to load with specific path (for initial load)
	const loadMetaWithPath = async (path: string, restoreIndex?: number) => {
		if (!path.trim()) return;
		setLoadStatus('加载中...');
		try {
			const response = await fetch(`/api/meta.json?path=${encodeURIComponent(path)}`);
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '加载失败');
			}
			const loadedItems = data.items || [];
			setItems(loadedItems);
			setLoadStatus(`已加载 ${loadedItems.length || 0} 条`);
			
			let targetIndex = 0;
			if (typeof restoreIndex === 'number' && restoreIndex >= 0 && restoreIndex < loadedItems.length) {
				targetIndex = restoreIndex;
			}
			
			if (loadedItems.length > 0) {
				const item = loadedItems[targetIndex];
				setCurrentIndex(targetIndex);
				setCaptionInput(item.caption || '');
				setSpeechInput(item.speech || '');
				setCurrentTag(item.tag || '');
				setCurrentSeparateSpeechTag(item.separateSpeechTag || '');
				setRoleInput(item.role || '');
				setVideoStartManuallySet(false);
				setVideoEndManuallySet(false);
				if (item.processed) {
					setSaveStatus('已处理 - 显示处理后媒体');
					// Load crop if exists
					if (item.processed_video_crop) {
						setCropRect(item.processed_video_crop);
					} else {
						setCropRect(null);
					}
					if (item.processed_audio_pos && Array.isArray(item.processed_audio_pos)) {
						setRefStart(item.processed_audio_pos[0].toFixed(2));
						setRefEnd(item.processed_audio_pos[1].toFixed(2));
					}
					if (item.processed_video_pos && Array.isArray(item.processed_video_pos)) {
						setVideoStart(item.processed_video_pos[0].toFixed(2));
						setVideoEnd(item.processed_video_pos[1].toFixed(2));
						setVideoStartManuallySet(true);
						setVideoEndManuallySet(true);
					} else {
						setVideoStart('');
						setVideoEnd('');
					}
				} else {
					setSaveStatus('就绪');
					setCropRect(null);
					setRefStart('0');
					setRefEnd('');
					setVideoStart('');
					setVideoEnd('');
				}
				// Scroll to the selected item after render
				setTimeout(() => scrollToIndex(targetIndex), 100);
			} else {
				setCurrentIndex(-1);
			}
		} catch (error: any) {
			setLoadStatus(error.message || '加载失败');
		}
	};

	const scrollToIndex = (index: number) => {
		if (listContainerRef.current) {
			const items = listContainerRef.current.children;
			if (items[index]) {
				(items[index] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}
	};

	const handleVideoLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
		const video = e.currentTarget;
		setVideoDuration(video.duration);
		setVideoSize({ width: video.videoWidth, height: video.videoHeight });
		// Only set videoEnd to duration if not manually set (i.e., when loading a non-processed item)
		if (!videoEndManuallySet && video.duration && Number.isFinite(video.duration)) {
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
			const payload: Record<string, unknown> = {
				metaPath,
				index: currentIndex,
				refStart: Number(refStart),
				refEnd: Number(refEnd),
				videoStart: Number(videoStart || 0),
				videoEnd: videoEnd ? Number(videoEnd) : null,
			};
			// Add crop info if set
			if (cropRect && videoSize.width > 0 && videoSize.height > 0) {
				payload.crop = {
					x: Math.round(cropRect.x),
					y: Math.round(cropRect.y),
					w: Math.round(cropRect.w),
					h: Math.round(cropRect.h),
				};
			}
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
			const timestamp = Date.now();
			const newItems = [...items];
			newItems[currentIndex] = {
				...newItems[currentIndex],
				processed: true,
				processed_audio_path: data.audioPath ? `${data.audioPath}?t=${timestamp}` : undefined,
				processed_video_path: data.videoPath ? `${data.videoPath}?t=${timestamp}` : undefined,
				processed_audio_pos: [Number(refStart), Number(refEnd)],
				processed_video_pos: videoEnd ? [Number(videoStart), Number(videoEnd)] : null,
			};
			setItems(newItems);
		} catch (error: any) {
			setSaveStatus(error.message || '裁剪失败');
		}
	};

	const handleViewWaveform = () => {
		if (!currentItem?.processed_waveform_path) return;
		setShowWaveformModal(true);
	};

	const handleClear = () => {
		setRefStart('0');
		setRefEnd('');
		setVideoStart('');
		setVideoEnd(videoDuration && Number.isFinite(videoDuration) ? videoDuration.toFixed(2) : '');
		setVideoStartManuallySet(false);
		setVideoEndManuallySet(false);
		setCropRect(null);
		setSaveStatus('已清空');
	};

	// Crop drawing handlers
	const getVideoCoords = (e: React.MouseEvent<HTMLDivElement>) => {
		const container = videoContainerRef.current;
		const video = document.getElementById('main-video') as HTMLVideoElement;
		if (!container || !video) return null;
		
		const rect = video.getBoundingClientRect();
		const scaleX = videoSize.width / rect.width;
		const scaleY = videoSize.height / rect.height;
		
		const x = (e.clientX - rect.left) * scaleX;
		const y = (e.clientY - rect.top) * scaleY;
		
		return { x: Math.max(0, Math.min(x, videoSize.width)), y: Math.max(0, Math.min(y, videoSize.height)) };
	};

	const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
		if (e.button !== 0) return; // Only left click
		const coords = getVideoCoords(e);
		if (!coords) return;
		setIsDrawing(true);
		setDrawStart(coords);
		setCropRect(null);
	};

	const handleCropMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
		if (!isDrawing || !drawStart) return;
		const coords = getVideoCoords(e);
		if (!coords) return;
		
		const x = Math.min(drawStart.x, coords.x);
		const y = Math.min(drawStart.y, coords.y);
		const w = Math.abs(coords.x - drawStart.x);
		const h = Math.abs(coords.y - drawStart.y);
		
		setCropRect({ x, y, w, h });
	};

	const handleCropMouseUp = () => {
		setIsDrawing(false);
		setDrawStart(null);
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
					speech: speechInput,
					tag: currentTag || undefined,
					separateSpeechTag: currentSeparateSpeechTag || undefined,
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '保存失败');
			}
			const newItems = [...items];
			newItems[currentIndex] = { 
				...newItems[currentIndex], 
				caption: captionInput, 
				tag: currentTag || undefined,
				separateSpeechTag: currentSeparateSpeechTag || undefined,
			};
			(newItems[currentIndex] as any).speech = speechInput;
			setItems(newItems);
			setSaveStatus('Caption 已保存');
		} catch (error: any) {
			setSaveStatus(error.message || '保存 caption 失败');
		}
	};

	const handleTagClick = async (tag: string) => {
		const newTag = currentTag === tag ? '' : tag; // Toggle if same tag
		setCurrentTag(newTag);
		
		if (currentIndex < 0) return;
		try {
			const response = await fetch('/api/caption.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					metaPath,
					index: currentIndex,
					caption: captionInput,
					speech: speechInput,
					tag: newTag || undefined,
					separateSpeechTag: currentSeparateSpeechTag || undefined,
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '保存失败');
			}
			const newItems = [...items];
			newItems[currentIndex] = { ...newItems[currentIndex], tag: newTag || undefined };
			setItems(newItems);
			setSaveStatus(`标签 "${newTag || '无'}" 已保存`);
		} catch (error: any) {
			setSaveStatus(error.message || '保存标签失败');
		}
	};

	const handleSeparateSpeechTagClick = async (tag: string) => {
		const newTag = currentSeparateSpeechTag === tag ? '' : tag; // Toggle if same tag
		setCurrentSeparateSpeechTag(newTag);
		
		if (currentIndex < 0) return;
		try {
			const response = await fetch('/api/caption.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					metaPath,
					index: currentIndex,
					caption: captionInput,
					speech: speechInput,
					tag: currentTag || undefined,
					separateSpeechTag: newTag || undefined,
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '保存失败');
			}
			const newItems = [...items];
			newItems[currentIndex] = { ...newItems[currentIndex], separateSpeechTag: newTag || undefined };
			setItems(newItems);
			setSaveStatus(`语音分离 "${newTag || '无'}" 已保存`);
		} catch (error: any) {
			setSaveStatus(error.message || '保存标签失败');
		}
	};

	const handleRoleSave = async () => {
		if (currentIndex < 0 || !currentItem?.processed) {
			setSaveStatus('请先处理条目');
			return;
		}
		try {
			const response = await fetch('/api/update-role.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					metaPath,
					index: currentIndex,
					role: roleInput.trim(),
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '保存失败');
			}
			setSaveStatus('角色已保存');
		} catch (error: any) {
			setSaveStatus(error.message || '保存失败');
		}
	};

	const handleDelete = async (index: number, e: React.MouseEvent) => {
		e.stopPropagation();
		if (!confirm('确定删除此条目？')) return;
		try {
			const response = await fetch('/api/delete.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ metaPath, index }),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '删除失败');
			}
			const newItems = items.filter((_, i) => i !== index);
			setItems(newItems);
			if (currentIndex >= newItems.length) {
				setCurrentIndex(newItems.length - 1);
			} else if (currentIndex === index) {
				selectIndex(Math.min(index, newItems.length - 1));
			}
			setSaveStatus('已删除');
		} catch (error: any) {
			setSaveStatus(error.message || '删除失败');
		}
	};

	const handleGenerateCaption = async () => {
		if (!currentItem?.processed_video_path) {
			setSaveStatus('请先处理视频');
			return;
		}
		setIsGeneratingCaption(true);
		setSaveStatus('AI 正在生成 caption...');
		try {
			const response = await fetch('/api/generate-caption.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					videoPath: currentItem.processed_video_path.split('?')[0], // Remove timestamp
					metaPath,
					index: currentIndex,
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '生成失败');
			}
			setCaptionInput(data.caption);
			// Update local state
			const newItems = [...items];
			newItems[currentIndex] = { ...newItems[currentIndex], caption: data.caption };
			setItems(newItems);
			setSaveStatus('AI caption 已生成并保存');
		} catch (error: any) {
			setSaveStatus(error.message || '生成 caption 失败');
		} finally {
			setIsGeneratingCaption(false);
		}
	};

	const handleWhisperTranscribe = async () => {
		if (!currentItem?.processed_video_path) {
			setSaveStatus('请先处理视频');
			return;
		}
		setIsTranscribing(true);
		setSaveStatus('Whisper 正在转录...');
		try {
			const response = await fetch('/api/whisper-transcribe.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					videoPath: currentItem.processed_video_path.split('?')[0],
					metaPath,
					index: currentIndex,
				}),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '转录失败');
			}
			// Set transcription to speech input
			setSpeechInput(data.transcription);
			// Update local state
			const newItems = [...items];
			(newItems[currentIndex] as any).speech = data.transcription;
			setItems(newItems);
			setSaveStatus('Whisper 转录完成');
		} catch (error: any) {
			setSaveStatus(error.message || '转录失败');
		} finally {
			setIsTranscribing(false);
		}
	};

	const handleCopy = async (index: number, e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			const response = await fetch('/api/copy.json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ metaPath, index }),
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || '复制失败');
			}
			// Reload to get new items and select the newly copied item
			await loadMetaWithPath(metaPath, data.newIndex);
			setSaveStatus(`已复制到 #${data.newIndex}`);
		} catch (error: any) {
			setSaveStatus(error.message || '复制失败');
		}
	};

	// Parse batch range string like "1,3,5-10,12"
	const parseBatchRange = (rangeStr: string): number[] => {
		const indices: Set<number> = new Set();
		const parts = rangeStr.split(',').map(s => s.trim()).filter(Boolean);
		for (const part of parts) {
			if (part.includes(':')) {
				const [start, end] = part.split(':').map(s => parseInt(s.trim(), 10));
				if (!isNaN(start) && !isNaN(end)) {
					for (let i = start; i <= end; i++) {
						if (i >= 0 && i < items.length) indices.add(i);
					}
				}
			} else if (part.includes('-')) {
				const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
				if (!isNaN(start) && !isNaN(end)) {
					for (let i = start; i <= end; i++) {
						if (i >= 0 && i < items.length) indices.add(i);
					}
				}
			} else {
				const idx = parseInt(part, 10);
				if (!isNaN(idx) && idx >= 0 && idx < items.length) {
					indices.add(idx);
				}
			}
		}
		return Array.from(indices).sort((a, b) => a - b);
	};

	const handleBatchProcess = async () => {
		const indices = parseBatchRange(batchRange);
		if (indices.length === 0) {
			setBatchProgress('无效范围');
			return;
		}

		setIsBatchProcessing(true);
		setBatchProgress(`0/${indices.length} 开始...`);

		for (let i = 0; i < indices.length; i++) {
			const idx = indices[i];
			const item = items[idx];
			
			if (!item.processed_video_path) {
				setBatchProgress(`${i + 1}/${indices.length} #${idx}跳过(无视频)`);
				continue;
			}

			setBatchProgress(`${i + 1}/${indices.length} #${idx} Caption...`);
			
			try {
				// Generate caption
				const captionRes = await fetch('/api/generate-caption.json', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						videoPath: item.processed_video_path.split('?')[0],
						metaPath,
						index: idx,
					}),
				});
				const captionData = await captionRes.json();
				if (!captionRes.ok) {
					setBatchProgress(`${i + 1}/${indices.length} #${idx} Caption失败`);
					continue;
				}

				setBatchProgress(`${i + 1}/${indices.length} #${idx} Whisper...`);

				// Whisper transcribe
				const whisperRes = await fetch('/api/whisper-transcribe.json', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						videoPath: item.processed_video_path.split('?')[0],
						metaPath,
						index: idx,
					}),
				});
				const whisperData = await whisperRes.json();
				if (!whisperRes.ok) {
					setBatchProgress(`${i + 1}/${indices.length} #${idx} Whisper失败`);
					continue;
				}

				// Update local state immediately after each item
				setItems(prevItems => {
					const newItems = [...prevItems];
					newItems[idx] = { 
						...newItems[idx], 
						caption: captionData.caption,
					};
					(newItems[idx] as any).speech = whisperData.transcription;
					return newItems;
				});

				// If this is the currently selected item, update the input fields too
				if (idx === currentIndex) {
					setCaptionInput(captionData.caption || '');
					setSpeechInput(whisperData.transcription || '');
				}
				
				setBatchProgress(`${i + 1}/${indices.length} #${idx} ✓`);

			} catch (error: any) {
				setBatchProgress(`${i + 1}/${indices.length} #${idx} 错误`);
			}
		}

		setBatchProgress(`完成 ${indices.length}条`);
		setIsBatchProcessing(false);
	};

	// Batch re-trim all processed items to ensure stereo audio
	const handleBatchRetrim = async () => {
		if (!metaPath) {
			setRetrimProgress('请先加载 dataset_meta.jsonl');
			return;
		}

		setIsRetrimming(true);
		setRetrimProgress('加载最新数据...');

		// Fetch latest data to get current audio/video positions
		let latestItems: MetaItem[];
		try {
			const res = await fetch(`/api/meta.json?path=${encodeURIComponent(metaPath)}`);
			const data = await res.json();
			latestItems = data.items || [];
		} catch (error) {
			setRetrimProgress('加载数据失败');
			setIsRetrimming(false);
			return;
		}

		const processedItems = latestItems.filter(item => item.processed);
		if (processedItems.length === 0) {
			setRetrimProgress('没有已处理的记录');
			setIsRetrimming(false);
			return;
		}

		setRetrimProgress(`0/${processedItems.length} 开始...`);

		let successCount = 0;
		for (let i = 0; i < latestItems.length; i++) {
			const item = latestItems[i];
			if (!item.processed) continue;

			setRetrimProgress(`${successCount + 1}/${processedItems.length} #${i} 重新裁剪...`);

			try {
				const audioPos = item.processed_audio_pos as number[] | undefined;
				const videoPos = item.processed_video_pos as number[] | undefined;
				console.log(`Retrim #${i}: audioPos=`, audioPos, 'videoPos=', videoPos);

				const res = await fetch('/api/trim.json', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						metaPath,
						index: i,
						refStart: audioPos ? audioPos[0] : 0,
						refEnd: audioPos ? audioPos[1] : null,
						videoStart: videoPos ? videoPos[0] : 0,
						videoEnd: videoPos ? videoPos[1] : null,
					}),
				});

				if (res.ok) {
					successCount++;
					setRetrimProgress(`${successCount}/${processedItems.length} #${i} ✓`);
				} else {
					setRetrimProgress(`${successCount}/${processedItems.length} #${i} 失败`);
				}
			} catch (error) {
				setRetrimProgress(`${successCount}/${processedItems.length} #${i} 错误`);
			}
		}

		setRetrimProgress(`完成 ${successCount}/${processedItems.length}`);
		setIsRetrimming(false);
		// Reload to refresh timestamps
		await loadMeta();
	};

	// Batch generate waveforms for all processed items
	const handleBatchWaveform = async () => {
		if (!metaPath) {
			setWaveformProgress('请先加载 dataset_meta.jsonl');
			return;
		}

		setIsGeneratingWaveforms(true);
		setWaveformProgress('加载数据...');

		// Fetch latest data
		let latestItems: MetaItem[];
		try {
			const res = await fetch(`/api/meta.json?path=${encodeURIComponent(metaPath)}`);
			const data = await res.json();
			latestItems = data.items || [];
		} catch (error) {
			setWaveformProgress('加载数据失败');
			setIsGeneratingWaveforms(false);
			return;
		}

		const processedItems = latestItems.filter(item => item.processed);
		if (processedItems.length === 0) {
			setWaveformProgress('没有已处理的记录');
			setIsGeneratingWaveforms(false);
			return;
		}

		setWaveformProgress(`0/${processedItems.length}`);

		let successCount = 0;
		let skippedCount = 0;
		for (let i = 0; i < latestItems.length; i++) {
			const item = latestItems[i];
			if (!item.processed) continue;

			setWaveformProgress(`${successCount + skippedCount + 1}/${processedItems.length} #${i}`);

			try {
				const res = await fetch('/api/batch-waveform.json', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ index: i }),
				});

				const data = await res.json();
				if (res.ok) {
					if (data.skipped) {
						skippedCount++;
					} else {
						successCount++;
					}
					setWaveformProgress(`${successCount + skippedCount}/${processedItems.length} #${i} ✓`);
				} else {
					setWaveformProgress(`${successCount + skippedCount}/${processedItems.length} #${i} 失败`);
				}
			} catch (error) {
				setWaveformProgress(`${successCount + skippedCount}/${processedItems.length} #${i} 错误`);
			}
		}

		setWaveformProgress(`完成 ${successCount}新/${skippedCount}跳`);
		setIsGeneratingWaveforms(false);
	};

	// Close popover when clicking outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (editorRef.current && !editorRef.current.contains(e.target as Node)) {
				setShowCaptionEditor(false);
			}
		};
		if (showCaptionEditor) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [showCaptionEditor]);

	useEffect(() => {
		const stored = localStorage.getItem('ltx-meta-path');
		if (stored) setMetaPath(stored);
	}, []);

	return (
		<div className="flex gap-4 h-[calc(100vh-80px)] p-4">
			{/* Left Panel - Controls */}
			<div className="w-[340px] bg-[#141a26] border border-[#2a3244] rounded-xl p-3 flex flex-col gap-2 overflow-hidden">
				<div className="text-xs text-[#a9b2c3]">参考音频区间 (秒)</div>
				<div className="grid grid-cols-2 gap-1.5">
					<input
						type="number"
						step="0.01"
						placeholder="Start"
						value={refStart}
						onChange={(e) => setRefStart(e.target.value)}
						className="w-full px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					/>
					<input
						type="number"
						step="0.01"
						placeholder="End"
						value={refEnd}
						onChange={(e) => handleRefEndChange(e.target.value)}
						className="w-full px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					/>
				</div>
				<div className="flex gap-1.5">
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) setRefStart(video.currentTime.toFixed(2));
						}}
						className="flex-1 px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-xs"
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
						className="flex-1 px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-xs"
					>
						设为当前终点
					</button>
				</div>

				<div className="text-xs text-[#a9b2c3] mt-2">视频裁剪区间 (秒)</div>
				<div className="grid grid-cols-2 gap-1.5">
					<input
						type="number"
						step="0.01"
						placeholder="Start"
						value={videoStart}
						onChange={(e) => {
							setVideoStart(e.target.value);
							if (e.target.value) setVideoStartManuallySet(true);
						}}
						className="w-full px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					/>
					<input
						type="number"
						step="0.01"
						placeholder="End"
						value={videoEnd}
						onChange={(e) => setVideoEnd(e.target.value)}
						className="w-full px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					/>
				</div>
				<div className="flex gap-1.5">
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) {
								setVideoStart(video.currentTime.toFixed(2));
								setVideoStartManuallySet(true);
							}
						}}
						className="flex-1 px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-xs"
					>
						设为当前起点
					</button>
					<button
						onClick={() => {
							const video = document.getElementById('main-video') as HTMLVideoElement;
							if (video) setVideoEnd(video.currentTime.toFixed(2));
						}}
						className="flex-1 px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-xs"
					>
						设为当前终点
					</button>
				</div>

				<div className="flex gap-1.5 mt-2">
					<button onClick={handleSave} className="flex-1 px-2 py-1.5 rounded-lg bg-[#4f8cff] text-white text-xs">
						裁剪并保存
					</button>
					<button onClick={handleClear} className="flex-1 px-2 py-1.5 rounded-lg bg-transparent border border-[#2a3244] text-[#e7ecf3] text-xs">
						清空区间
					</button>
				</div>
				<div className="text-xs text-[#a9b2c3]">{saveStatus}</div>

				<div className="flex gap-1.5 mt-2">
					<input
						type="text"
						placeholder="dataset_meta.jsonl 路径"
						value={metaPath}
						onChange={(e) => setMetaPath(e.target.value)}
						className="flex-1 px-2 py-1.5 rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-sm"
					/>
					<button onClick={loadMeta} className="px-2 py-1.5 rounded-lg bg-[#4f8cff] text-white text-xs">
						加载
					</button>
				</div>
				<div className="text-xs text-[#a9b2c3]">{loadStatus}</div>

				<div className="flex gap-1 mt-1">
					<input
						type="text"
						placeholder="范围 (0:5, 7, 10-15)"
						value={batchRange}
						onChange={(e) => setBatchRange(e.target.value)}
						className="flex-1 px-1.5 py-1 rounded border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-xs"
					/>
					<button 
						onClick={() => {
							const indices = parseBatchRange(batchRange);
							if (indices.length === 0) {
								setBatchProgress('无效');
							} else {
								setBatchProgress(`[${indices.join(',')}] (${indices.length}条)`);
							}
						}}
						disabled={items.length === 0}
						className="px-1.5 py-1 rounded border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3] text-[10px]"
						title="预览"
					>
						👁
					</button>
					<button 
						onClick={handleBatchProcess}
						disabled={isBatchProcessing || items.length === 0}
						className={`px-1.5 py-1 rounded text-[10px] ${
							isBatchProcessing || items.length === 0
								? 'bg-[#2a3244] text-[#666] cursor-not-allowed'
								: 'bg-[#9b59b6] text-white'
						}`}
					>
						{isBatchProcessing ? '...' : '批量caption'}
					</button>
				</div>
				{batchProgress && <div className="text-[10px] text-[#a9b2c3] truncate">{batchProgress}</div>}

				<div ref={listContainerRef} className="flex-1 overflow-y-auto pr-1">
					{items.map((item, index) => (
						<div
							key={index}
							onClick={() => selectIndex(index)}
							className={`p-2 rounded-lg border mb-1.5 cursor-pointer ${
								index === currentIndex
									? 'border-[#4f8cff] bg-[#4f8cff]/10'
									: 'border-transparent bg-[#1b2232]'
							}`}
						>
							<div className="flex justify-between items-start">
								<div className="text-xs truncate flex-1">{item.caption || item.media_path || '未命名条目'}</div>
								<div className="flex gap-1.5 ml-1.5">
									<button
										onClick={(e) => handleCopy(index, e)}
										className="text-[#4f8cff] text-[10px] hover:text-[#3d7ae8]"
									>
										复制
									</button>
									<button
										onClick={(e) => handleDelete(index, e)}
										className="text-[#ff6b6b] text-[10px] hover:text-[#ff4757]"
									>
										删除
									</button>
								</div>
							</div>
							<div className="text-[10px] text-[#a9b2c3]">
								#{index}{item.caption && item.media_path ? ` ${item.media_path}` : ''}{(item as any).copied_from !== undefined ? ` (复制自 #${(item as any).copied_from})` : ''}
							</div>
							<span
								className={`inline-block px-1 py-0.5 rounded-full text-[10px] ${
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
			<div className="flex-1 bg-[#141a26] border border-[#2a3244] rounded-xl p-4 overflow-hidden relative">
				{/* Batch buttons in top right corner */}
				<div className="absolute top-2 right-2 z-10 flex items-center gap-2">
					{waveformProgress && <span className="text-[10px] text-[#a9b2c3]">{waveformProgress}</span>}
					<button
						onClick={handleBatchWaveform}
						disabled={isGeneratingWaveforms || items.length === 0}
						className={`px-2 py-1 text-[10px] rounded border ${
							isGeneratingWaveforms || items.length === 0
								? 'border-[#2a3244] bg-[#1b2232] text-[#666] cursor-not-allowed'
								: 'border-[#2a3244] bg-[#9b59b6] text-white hover:bg-[#8e44ad] cursor-pointer'
						}`}
						title="批量生成波形图"
					>
						{isGeneratingWaveforms ? '处理中...' : '📊 批量波形'}
					</button>
					{retrimProgress && <span className="text-[10px] text-[#a9b2c3]">{retrimProgress}</span>}
					<button
						onClick={handleBatchRetrim}
						disabled={isRetrimming || items.length === 0}
						className={`px-2 py-1 text-[10px] rounded border ${
							isRetrimming || items.length === 0
								? 'border-[#2a3244] bg-[#1b2232] text-[#666] cursor-not-allowed'
								: 'border-[#2a3244] bg-[#e74c3c] text-white hover:bg-[#c0392b] cursor-pointer'
						}`}
						title="重新裁剪所有已处理记录（确保双声道）"
					>
						{isRetrimming ? '处理中...' : '🔄 批量重裁'}
					</button>
				</div>
				<div className="grid grid-cols-[1fr_320px] gap-4 h-full">
					<div className="flex flex-col h-full overflow-hidden items-center">
						<div 
							ref={videoContainerRef}
							className="relative flex-1 min-h-0 flex items-center justify-center"
							onMouseDown={handleCropMouseDown}
							onMouseMove={handleCropMouseMove}
							onMouseUp={handleCropMouseUp}
							onMouseLeave={handleCropMouseUp}
						>
							<video
								id="main-video"
								controls
								preload="metadata"
								onLoadedMetadata={handleVideoLoaded}
								src={currentItem?.resolved_media_path ? `/api/media?path=${encodeURIComponent(currentItem.resolved_media_path)}` : ''}
								className="max-w-full max-h-full rounded-xl bg-black"
							/>
							{/* Crop overlay */}
							{cropRect && videoSize.width > 0 && (
								<div 
									className="absolute pointer-events-none"
									style={{
										top: 0,
										left: 0,
										right: 0,
										bottom: 0,
									}}
								>
									{(() => {
										const video = document.getElementById('main-video') as HTMLVideoElement;
										if (!video) return null;
										const rect = video.getBoundingClientRect();
										const containerRect = videoContainerRef.current?.getBoundingClientRect();
										if (!containerRect) return null;
										
										const scaleX = rect.width / videoSize.width;
										const scaleY = rect.height / videoSize.height;
										const offsetX = rect.left - containerRect.left;
										const offsetY = rect.top - containerRect.top;
										
										return (
											<div
												className="absolute border-2 border-[#4f8cff] bg-[#4f8cff]/20"
												style={{
													left: offsetX + cropRect.x * scaleX,
													top: offsetY + cropRect.y * scaleY,
													width: cropRect.w * scaleX,
													height: cropRect.h * scaleY,
												}}
											/>
										);
									})()}
								</div>
							)}
						</div>
						<div className="text-xs text-[#a9b2c3] mt-3 flex-shrink-0">
							#{currentIndex} {currentItem?.processed ? '[已处理]' : ''} {currentItem?.media_path ?? '未选择条目'}
							{cropRect && ` | 裁剪区域: ${Math.round(cropRect.x)},${Math.round(cropRect.y)} ${Math.round(cropRect.w)}x${Math.round(cropRect.h)}`}
						</div>

						<div className="text-xs text-[#a9b2c3] mt-2 flex-shrink-0 line-clamp-5 break-all">
							<HighlightedText text={currentItem?.caption || '无 caption'} />
						</div>

						<div className="flex gap-2 mt-3 flex-shrink-0 relative">
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
							<button
								onClick={() => setShowCaptionEditor(!showCaptionEditor)}
								className="px-3 py-2 cursor-pointer rounded-lg border border-[#2a3244] bg-[#1b2232] text-[#e7ecf3]"
								title="编辑 Caption"
							>
								✎
							</button>
							<button
								onClick={handleGenerateCaption}
								disabled={isGeneratingCaption || !currentItem?.processed_video_path}
								className={`px-3 py-2 cursor-pointer rounded-lg border border-[#2a3244] text-sm ${
									isGeneratingCaption || !currentItem?.processed_video_path
										? 'bg-[#1b2232] text-[#666] cursor-not-allowed'
										: 'bg-[#9b59b6] text-white hover:bg-[#8e44ad]'
								}`}
								title="AI 生成 Caption"
							>
								{isGeneratingCaption ? '...' : 'AI'}
							</button>
							{showCaptionEditor && (
								<div
									ref={editorRef}
									className="fixed bg-[#1b2232] border border-[#2a3244] rounded-xl p-3 shadow-2xl"
									style={{ 
										width: '600px', 
										zIndex: 9999,
										bottom: 'auto',
										left: '50%',
										top: '50%',
										transform: 'translate(-50%, -50%)'
									}}
								>
									<div className="flex justify-between items-center mb-2">
										<div className="text-xs text-[#a9b2c3]">Caption 编辑器 (Ctrl+Enter 保存)</div>
										<div className="flex gap-2">
											<div className="flex gap-1">
												{AVAILABLE_TAGS.map((tag) => (
													<button
														key={tag}
														onClick={() => handleTagClick(tag)}
														className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
															currentTag === tag
																? 'bg-[#4f8cff] border-[#4f8cff] text-white'
																: 'bg-[#1b2232] border-[#2a3244] text-[#a9b2c3] hover:border-[#4f8cff]'
														}`}
													>
														{tag}
													</button>
												))}
											</div>
											<div className="border-l border-[#2a3244] mx-1" />
											<div className="flex gap-1">
												{SEPARATE_SPEECH_TAGS.map((tag) => (
													<button
														key={tag}
														onClick={() => handleSeparateSpeechTagClick(tag)}
														className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
															currentSeparateSpeechTag === tag
																? 'bg-[#e67e22] border-[#e67e22] text-white'
																: 'bg-[#1b2232] border-[#2a3244] text-[#a9b2c3] hover:border-[#e67e22]'
														}`}
													>
														{tag}
													</button>
												))}
											</div>
										</div>
									</div>
									<div className="relative bg-[#0b0f17] rounded-lg border border-[#2a3244] overflow-auto" style={{ height: '270px' }}>
										<HighlightedEditor
											value={captionInput}
											onChange={setCaptionInput}
											onKeyDown={(e) => {
												if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
													e.preventDefault();
													handleCaptionSave();
													setShowCaptionEditor(false);
												}
											}}
											className="w-full h-full px-3 py-2 text-[#e7ecf3] text-sm font-mono outline-none"
											placeholder="输入 caption..."
										/>
									</div>
									<div className="text-xs text-[#a9b2c3] mt-3 mb-2">Speech (Whisper 转录)</div>
									<div className="relative" style={{ height: '90px' }}>
										<textarea
											value={speechInput}
											onChange={(e) => setSpeechInput(e.target.value)}
											className="w-full h-full px-3 py-2 rounded-lg border border-[#2a3244] bg-[#0b0f17] text-[#e7ecf3] text-sm font-mono resize-none"
											placeholder="Whisper 转录结果..."
										/>
									</div>
									<div className="flex justify-between mt-2">
										<div className="text-xs text-[#a9b2c3]">
											<span className="text-[#f1c40f]">[方括号]</span>{' '}
											<span className="text-[#e74c3c]">{'{花括号}'}</span>{' '}
											<span className="text-[#9b59b6]">{'<尖括号>'}</span>{' '}
											<span className="text-[#2ecc71]">"引号"</span>{' '}
											<span className="text-[#3498db]">数字</span>
										</div>
										<div className="flex gap-2">
											<button
												onClick={handleWhisperTranscribe}
												disabled={isTranscribing || !currentItem?.processed_video_path}
												className={`px-3 py-1 rounded-lg text-sm ${
													isTranscribing || !currentItem?.processed_video_path
														? 'bg-[#2a3244] text-[#666] cursor-not-allowed'
														: 'bg-[#27ae60] text-white hover:bg-[#219a52]'
												}`}
											>
												{isTranscribing ? '转录中...' : 'Whisper'}
											</button>
											<button
												onClick={() => {
													handleCaptionSave();
													setShowCaptionEditor(false);
												}}
												className="px-3 py-1 rounded-lg bg-[#4f8cff] text-white text-sm"
											>
												保存
											</button>
										</div>
									</div>
								</div>
							)}
						</div>
					</div>

					<div className="flex flex-col gap-3 h-full overflow-hidden">
						<div className="bg-[#1b2232] rounded-lg p-2.5 flex flex-col gap-2 flex-shrink-0">
							<div className="text-xs text-[#a9b2c3]">处理后音频</div>
							{currentItem?.processed && currentItem.processed_audio_path ? (
							<>
								<div className="text-xs text-[#a9b2c3] break-all">{currentItem.processed_audio_path}</div>
								<audio controls src={`/api/media?path=${encodeURIComponent(currentItem.processed_audio_path)}`} className="w-full rounded-lg" />
								<div className="flex gap-1.5 mt-1">
									{currentItem.processed_waveform_path && (
										<button
											onClick={handleViewWaveform}
											className="px-2 py-1 rounded text-xs bg-[#2a3244] text-[#a9b2c3] hover:bg-[#3d4a63] hover:text-white"
										>
											📊 查看波形
										</button>
									)}
								</div>
								<div className="flex gap-1.5 mt-1">
									<input
										type="text"
										placeholder="角色名称 (回车保存)"
										value={roleInput}
										onChange={(e) => setRoleInput(e.target.value)}
										onKeyDown={(e) => e.key === 'Enter' && handleRoleSave()}
										className="flex-1 px-2 py-1 rounded text-xs border border-[#2a3244] bg-[#0b0f17] text-[#e7ecf3]"
									/>
									<button
										onClick={handleRoleSave}
										className="px-2 py-1 rounded text-xs bg-[#4f8cff] text-white hover:bg-[#3d7ce6]"
									>
										确定
									</button>
								</div>
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

			{/* Waveform Modal */}
			{showWaveformModal && currentItem?.processed_waveform_path && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
					onClick={() => setShowWaveformModal(false)}
				>
					<div
						className="relative bg-[#1b2232] rounded-xl shadow-2xl border border-[#2a3244] p-4 max-w-2xl w-full mx-4"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-3">
							<div className="text-sm text-[#e7ecf3] font-medium">📊 处理后音频波形</div>
							<button
								onClick={() => setShowWaveformModal(false)}
								className="px-2 py-1 rounded text-xs bg-[#2a3244] text-[#a9b2c3] hover:bg-[#3d4a63] hover:text-white"
							>
								✕ 关闭
							</button>
						</div>
						<div className="rounded-lg overflow-hidden border border-[#2a3244]">
							<img
								src={`/api/media?path=${encodeURIComponent(currentItem.processed_waveform_path)}`}
								alt="处理后音频波形"
								className="w-full h-auto bg-black"
							/>
						</div>
						<div className="mt-2 text-xs text-[#6b7a90] break-all">{currentItem.processed_waveform_path}</div>
					</div>
				</div>
			)}
		</div>
	);
}
