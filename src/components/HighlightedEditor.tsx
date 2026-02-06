import { useRef, useEffect } from 'react';

interface HighlightedEditorProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	onKeyDown?: (e: React.KeyboardEvent) => void;
}

// Default highlight rules for prompt syntax
const defaultHighlightRules = [
	{ pattern: /(\[[^\]]*\])/g, color: '#f1c40f' },      // [brackets] - yellow
	{ pattern: /(\{[^}]*\})/g, color: '#e74c3c' },       // {braces} - red
	{ pattern: /(<[^>]*>)/g, color: '#9b59b6' },         // <angles> - purple (match original text, not escaped)
	{ pattern: /("[^"]*")/g, color: '#2ecc71' },         // "quotes" - green
	{ pattern: /\b(\d+\.?\d*)\b/g, color: '#3498db' },   // numbers - blue
];

// Escape HTML special characters
const escapeHtml = (text: string): string => {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
};

// Apply highlighting to text (for display only)
const getHighlightedHtml = (text: string): string => {
	if (!text) return '';
	
	// First, find all matches and their positions
	const matches: { start: number; end: number; color: string; text: string }[] = [];
	
	for (const rule of defaultHighlightRules) {
		let match;
		const regex = new RegExp(rule.pattern.source, 'g');
		while ((match = regex.exec(text)) !== null) {
			matches.push({
				start: match.index,
				end: match.index + match[0].length,
				color: rule.color,
				text: match[0],
			});
		}
	}
	
	// Sort by start position
	matches.sort((a, b) => a.start - b.start);
	
	// Remove overlapping matches (keep first)
	const filtered: typeof matches = [];
	for (const m of matches) {
		if (filtered.length === 0 || m.start >= filtered[filtered.length - 1].end) {
			filtered.push(m);
		}
	}
	
	// Build HTML
	let html = '';
	let lastEnd = 0;
	for (const m of filtered) {
		if (m.start > lastEnd) {
			html += escapeHtml(text.slice(lastEnd, m.start));
		}
		html += `<span style="color:${m.color}">${escapeHtml(m.text)}</span>`;
		lastEnd = m.end;
	}
	if (lastEnd < text.length) {
		html += escapeHtml(text.slice(lastEnd));
	}
	
	return html.replace(/\n/g, '<br>');
};

export default function HighlightedEditor({
	value,
	onChange,
	placeholder,
	className,
	onKeyDown,
}: HighlightedEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null);
	const lastValueRef = useRef(value);
	const isComposingRef = useRef(false);

	// Get plain text from contenteditable
	const getPlainText = (element: HTMLElement): string => {
		let text = '';
		element.childNodes.forEach((node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				text += node.textContent;
			} else if (node.nodeName === 'BR') {
				text += '\n';
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				text += getPlainText(node as HTMLElement);
			}
		});
		return text;
	};

	// Save cursor position
	const saveCursor = (): number | null => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorRef.current) return null;
		const range = sel.getRangeAt(0);
		const preRange = range.cloneRange();
		preRange.selectNodeContents(editorRef.current);
		preRange.setEnd(range.startContainer, range.startOffset);
		return preRange.toString().length;
	};

	// Restore cursor position
	const restoreCursor = (pos: number | null) => {
		if (pos === null || !editorRef.current) return;
		const sel = window.getSelection();
		if (!sel) return;

		let charCount = 0;
		const walker = document.createTreeWalker(
			editorRef.current,
			NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
		);
		let node: Node | null = walker.nextNode();

		while (node) {
			if (node.nodeType === Node.TEXT_NODE) {
				const len = node.textContent?.length || 0;
				if (charCount + len >= pos) {
					const range = document.createRange();
					range.setStart(node, pos - charCount);
					range.collapse(true);
					sel.removeAllRanges();
					sel.addRange(range);
					return;
				}
				charCount += len;
			} else if (node.nodeName === 'BR') {
				charCount += 1;
				if (charCount >= pos) {
					const range = document.createRange();
					range.setStartAfter(node);
					range.collapse(true);
					sel.removeAllRanges();
					sel.addRange(range);
					return;
				}
			}
			node = walker.nextNode();
		}
	};

	const handleInput = () => {
		if (!editorRef.current || isComposingRef.current) return;
		const newValue = getPlainText(editorRef.current);
		if (newValue !== lastValueRef.current) {
			lastValueRef.current = newValue;
			onChange(newValue);
		}
	};

	// Update HTML when value changes externally
	useEffect(() => {
		if (!editorRef.current) return;
		const currentText = getPlainText(editorRef.current);
		if (currentText !== value) {
			const cursorPos = saveCursor();
			editorRef.current.innerHTML = getHighlightedHtml(value);
			lastValueRef.current = value;
			restoreCursor(cursorPos);
		}
	}, [value]);

	// Re-highlight on blur for clean display
	const handleBlur = () => {
		if (!editorRef.current) return;
		editorRef.current.innerHTML = getHighlightedHtml(value);
	};

	return (
		<div
			ref={editorRef}
			contentEditable
			onInput={handleInput}
			onBlur={handleBlur}
			onKeyDown={onKeyDown}
			onCompositionStart={() => { isComposingRef.current = true; }}
			onCompositionEnd={() => { isComposingRef.current = false; handleInput(); }}
			className={className}
			style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
			data-placeholder={placeholder}
			suppressContentEditableWarning
		/>
	);
}
