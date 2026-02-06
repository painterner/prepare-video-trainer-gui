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
	{ pattern: /(&lt;[^&]*&gt;)/g, color: '#9b59b6' },   // <angles> - purple
	{ pattern: /("[^"]*")/g, color: '#2ecc71' },         // "quotes" - green
	{ pattern: /\b(\d+\.?\d*)\b/g, color: '#3498db' },   // numbers - blue
];

export default function HighlightedEditor({
	value,
	onChange,
	placeholder,
	className,
	onKeyDown,
}: HighlightedEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null);
	const lastValueRef = useRef(value);

	// Apply highlighting to text
	const getHighlightedHtml = (text: string): string => {
		if (!text) return '';
		let html = text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\n/g, '<br>');

		for (const rule of defaultHighlightRules) {
			html = html.replace(rule.pattern, `<span style="color:${rule.color}">$1</span>`);
		}
		return html;
	};

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
	const saveCursor = () => {
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
		if (!editorRef.current) return;
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
			className={className}
			style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
			data-placeholder={placeholder}
			suppressContentEditableWarning
		/>
	);
}
