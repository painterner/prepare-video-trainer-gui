import { useState, useCallback } from 'react';

interface WaveformModalProps {
	waveformPath: string;
	onClose: () => void;
}

/**
 * Decode a 24-bit RGB waveform image back into audio samples.
 * Encoding (Python): sample [-1,1] → (s+1)/2 → *16777215 → R,G,B
 * Decoding (here):    R,G,B → int24 → /16777215 → *2-1 → sample [-1,1]
 */
function decodeWaveformImage(imageData: ImageData): Float32Array {
	const { data: pixels, width, height } = imageData;
	const totalPixels = width * height;
	const samples = new Float32Array(totalPixels);
	const MAX24 = (1 << 24) - 1; // 16777215

	for (let i = 0; i < totalPixels; i++) {
		const r = pixels[i * 4];
		const g = pixels[i * 4 + 1];
		const b = pixels[i * 4 + 2];
		const int24 = (r << 16) | (g << 8) | b;
		samples[i] = (int24 / MAX24) * 2.0 - 1.0;
	}

	return samples;
}

/** Build a WAV file (16-bit PCM, mono) in memory and return a Blob. */
function samplesToWavBlob(samples: Float32Array, sampleRate: number): Blob {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = samples.length * (bitsPerSample / 8);
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const writeStr = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
	};

	// RIFF header
	writeStr(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeStr(8, 'WAVE');
	writeStr(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeStr(36, 'data');
	view.setUint32(40, dataSize, true);

	// Write samples as 16-bit PCM
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
	}

	return new Blob([buffer], { type: 'audio/wav' });
}

export default function WaveformModal({ waveformPath, onClose }: WaveformModalProps) {
	const [decodedAudioUrl, setDecodedAudioUrl] = useState<string | null>(null);
	const [isDecoding, setIsDecoding] = useState(false);

	const handleClose = useCallback(() => {
		if (decodedAudioUrl) {
			URL.revokeObjectURL(decodedAudioUrl);
		}
		onClose();
	}, [decodedAudioUrl, onClose]);

	const handleDecode = useCallback(() => {
		setIsDecoding(true);

		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				const imageData = ctx.getImageData(0, 0, img.width, img.height);

				const samples = decodeWaveformImage(imageData);
				const blob = samplesToWavBlob(samples, 16000);

				if (decodedAudioUrl) URL.revokeObjectURL(decodedAudioUrl);
				setDecodedAudioUrl(URL.createObjectURL(blob));
			} catch (err: any) {
				alert('反转失败: ' + (err.message || '未知错误'));
			} finally {
				setIsDecoding(false);
			}
		};
		img.onerror = () => {
			alert('波形图片加载失败');
			setIsDecoding(false);
		};
		img.src = `/api/media?path=${encodeURIComponent(waveformPath)}`;
	}, [waveformPath, decodedAudioUrl]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
			onClick={handleClose}
		>
			<div
				className="relative bg-[#1b2232] rounded-xl shadow-2xl border border-[#2a3244] p-4 max-w-2xl w-full mx-4"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-3">
					<div className="text-sm text-[#e7ecf3] font-medium">📊 处理后音频波形</div>
					<button
						onClick={handleClose}
						className="px-2 py-1 rounded text-xs bg-[#2a3244] text-[#a9b2c3] hover:bg-[#3d4a63] hover:text-white"
					>
						✕ 关闭
					</button>
				</div>
				<div className="rounded-lg overflow-hidden border border-[#2a3244]">
					<img
						src={`/api/media?path=${encodeURIComponent(waveformPath)}`}
						alt="处理后音频波形"
						className="w-full h-auto bg-black"
					/>
				</div>
				<div className="flex items-center gap-2 mt-3">
					<button
						onClick={handleDecode}
						disabled={isDecoding}
						className="px-3 py-1.5 rounded text-xs bg-[#4f8cff] text-white hover:bg-[#3d7ce6] disabled:opacity-50"
					>
						{isDecoding ? '反转中...' : '🔄 反转为音频'}
					</button>
					<span className="text-xs text-[#6b7a90]">（仅内存中测试，不生成文件）</span>
				</div>
				{decodedAudioUrl && (
					<div className="mt-2 bg-[#0b0f17] rounded-lg p-2 border border-[#2a3244]">
						<div className="text-xs text-[#a9b2c3] mb-1">🔊 反转音频 (16kHz mono 16-bit PCM)</div>
						<audio controls src={decodedAudioUrl} className="w-full rounded" />
					</div>
				)}
				<div className="mt-2 text-xs text-[#6b7a90] break-all">{waveformPath}</div>
			</div>
		</div>
	);
}
