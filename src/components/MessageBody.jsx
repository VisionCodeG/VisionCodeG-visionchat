import React, { useEffect, useMemo, useState } from 'react';
import {
  contentAttachments,
  contentText,
  downloadAttachment,
  formatBytes,
  loadAttachmentBlob,
} from '../lib/media.js';

function RichAttachment({ client, item, onError }) {
  const { type, data } = item;
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading, setLoading] = useState(type !== 'EX');

  useEffect(() => {
    let cancelled = false;
    let localUrl = null;

    if (type === 'EX') {
      setLoading(false);
      return undefined;
    }

    loadAttachmentBlob(client, data)
      .then((blob) => {
        if (cancelled) return;
        localUrl = URL.createObjectURL(blob);
        setObjectUrl(localUrl);
      })
      .catch((err) => {
        if (!cancelled) onError?.(err?.message || 'Не удалось загрузить вложение');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [client, data, onError, type]);

  if (type === 'IM') {
    if (loading) return <div className="media-loading">Загрузка фото…</div>;
    return objectUrl ? (
      <img
        className="message-image"
        src={objectUrl}
        alt={data?.name || 'Фото'}
        loading="lazy"
      />
    ) : (
      <div className="media-error">Фото недоступно</div>
    );
  }

  if (type === 'AU') {
    if (loading) return <div className="media-loading">Загрузка голосового…</div>;
    return objectUrl ? (
      <div className="voice-message">
        <div className="voice-icon">🎤</div>
        <audio controls preload="metadata" src={objectUrl} />
      </div>
    ) : (
      <div className="media-error">Голосовое недоступно</div>
    );
  }

  return (
    <button
      type="button"
      className="file-attachment"
      onClick={() => downloadAttachment(client, data).catch((err) => onError?.(err?.message || 'Ошибка скачивания'))}
    >
      <span className="file-icon">📎</span>
      <span className="file-copy">
        <strong>{data?.name || 'Файл'}</strong>
        <small>{formatBytes(data?.size)}</small>
      </span>
      <span className="file-download">↓</span>
    </button>
  );
}

export default function MessageBody({ content, client, onError }) {
  const attachments = useMemo(() => contentAttachments(content), [content]);
  const text = useMemo(() => contentText(content), [content]);

  return (
    <div className="message-body">
      {attachments.map((item) => (
        <RichAttachment
          key={item.id}
          client={client}
          item={item}
          onError={onError}
        />
      ))}
      {text && <p>{text}</p>}
    </div>
  );
}
