export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxSizeBytes?: number;
  mimeType?: 'image/webp' | 'image/jpeg';
  initialQuality?: number;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  maxSizeBytes: 500 * 1024,
  mimeType: 'image/webp',
  initialQuality: 0.85
};

export async function compressImage(file: File, options: CompressionOptions = {}): Promise<File> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!file.type.startsWith('image/')) {
    return file;
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const { width, height } = fitDimensions(image.naturalWidth, image.naturalHeight, opts.maxWidth, opts.maxHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(image, 0, 0, width, height);

  let quality = opts.initialQuality;
  let blob = await canvasToBlob(canvas, opts.mimeType, quality);

  while (blob && blob.size > opts.maxSizeBytes && quality > 0.4) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, opts.mimeType, quality);
  }

  if (!blob) return file;

  const extension = opts.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const compressedName = `${baseName}.${extension}`;
  return new File([blob], compressedName, { type: opts.mimeType, lastModified: Date.now() });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function fitDimensions(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) return { width, height };
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}
