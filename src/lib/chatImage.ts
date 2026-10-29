// Imagens do chat viajam dentro da mensagem de broadcast do Supabase Realtime, que tem limite
// de tamanho por mensagem. Por isso a imagem é reduzida e recomprimida no navegador antes do envio.

/** Tamanho máximo da data URL (caracteres), com folga para o resto da mensagem. */
export const MAX_IMAGE_DATA_URL = 180_000;
const MAX_SIDE = 1600;
const QUALITIES = [0.85, 0.72, 0.6, 0.48];
const SAFE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export class ImageTooLargeError extends Error {}

function encode(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality);
  // Safari não codifica WebP e devolve PNG; nesse caso usa JPEG.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
}

/** Reduz e comprime a imagem até caber em MAX_IMAGE_DATA_URL. GIF animado vira o primeiro quadro. */
export async function compressImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas indisponível');

    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.fillStyle = '#ffffff'; // fundo para o caso JPEG (sem transparência)
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of QUALITIES) {
        const url = encode(canvas, q);
        if (url.length <= MAX_IMAGE_DATA_URL) return url;
      }
      scale *= 0.7;
    }
    throw new ImageTooLargeError('Imagem grande demais para enviar.');
  } finally {
    bitmap.close();
  }
}

/** Só aceita data URLs de imagem raster em base64 (nada de SVG, que pode conter script). */
export function isSafeImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_IMAGE_DATA_URL && SAFE_DATA_URL.test(value);
}

/** Primeira imagem de um clipboard/drag-and-drop, se houver. */
export function imageFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}
