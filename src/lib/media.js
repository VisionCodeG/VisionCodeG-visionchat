import { Drafty } from 'tinode-sdk';
import { tinodeConfig } from './tinode.js';

export function contentText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.txt === 'string') {
    return content.txt.replace(/\uFFFC/g, ' ').trim();
  }
  try {
    const preview = Drafty.preview(content, 500);
    if (typeof preview === 'string') return preview;
    if (preview && typeof preview.txt === 'string') return preview.txt.trim();
  } catch {
    // Ignore malformed Drafty content.
  }
  return '';
}

export function contentAttachments(content) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.ent)) return [];
  return content.ent
    .filter((entity) => entity && ['IM', 'AU', 'EX'].includes(entity.tp) && entity.data)
    .map((entity, index) => ({
      id: `${entity.tp}-${index}`,
      type: entity.tp,
      data: entity.data,
    }));
}

export function attachmentLabel(content) {
  const parts = contentAttachments(content);
  if (parts.some((part) => part.type === 'IM')) return '📷 Фото';
  if (parts.some((part) => part.type === 'AU')) return '🎤 Голосовое сообщение';
  if (parts.some((part) => part.type === 'EX')) return '📎 Файл';
  return contentText(content) || 'Сообщение';
}

export function dataUrl(data) {
  if (!data?.val || !data?.mime) return null;
  return `data:${data.mime};base64,${data.val}`;
}

export function absoluteTinodeUrl(ref) {
  if (!ref) return null;
  try {
    return new URL(ref, tinodeConfig.httpBase).toString();
  } catch {
    return null;
  }
}

function authHeaders(client) {
  const headers = {
    'X-Tinode-APIKey': tinodeConfig.apiKey,
  };
  const token = client?.getAuthToken?.()?.token;
  if (token) {
    headers['X-Tinode-Auth'] = `Token ${token}`;
  }
  return headers;
}

export async function loadAttachmentBlob(client, data) {
  if (data?.val && data?.mime) {
    const response = await fetch(dataUrl(data));
    return response.blob();
  }

  const url = absoluteTinodeUrl(data?.ref);
  if (!url) {
    throw new Error('У вложения нет доступного URL');
  }

  const response = await fetch(url, {
    headers: authHeaders(client),
  });

  if (!response.ok) {
    throw new Error(`Не удалось загрузить вложение: HTTP ${response.status}`);
  }

  return response.blob();
}

export async function downloadAttachment(client, data) {
  const blob = await loadAttachmentBlob(client, data);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = data?.name || 'visionchat-file';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    });
    img.src = url;
    await loaded;
    return {
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
