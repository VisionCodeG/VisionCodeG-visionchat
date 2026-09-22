import React, { useMemo, useRef, useState } from 'react';
import { createTinodeClient, tinodeConfig } from './lib/tinode.js';

const demoChats = [
  { id: 'team', name: 'Команда VisionChat', preview: 'Первый запуск готов', time: 'сейчас', unread: 2 },
  { id: 'dev', name: 'Разработка', preview: 'Docker + PostgreSQL подключены', time: '13:42', unread: 0 },
  { id: 'design', name: 'Дизайн', preview: 'Новый интерфейс вместо Tinode UI', time: '12:18', unread: 0 },
];

const seedMessages = {
  team: [
    { mine: false, text: 'Добро пожаловать в VisionChat 👋', time: '13:58' },
    { mine: false, text: 'Это уже отдельный интерфейс. Tinode используется как сервер сообщений.', time: '13:59' },
  ],
  dev: [
    { mine: false, text: 'Backend запускается через Docker Compose.', time: '13:41' },
    { mine: true, text: 'Отлично. Дальше подключаем реальные чаты.', time: '13:42' },
  ],
  design: [
    { mine: false, text: 'Брендинг Tinode в интерфейсе не используется.', time: '12:17' },
  ],
};

export default function App() {
  const tinodeRef = useRef(null);
  const [selected, setSelected] = useState('team');
  const [messages, setMessages] = useState(seedMessages);
  const [draft, setDraft] = useState('');
  const [serverState, setServerState] = useState('offline');
  const [authOpen, setAuthOpen] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const activeChat = useMemo(
    () => demoChats.find((item) => item.id === selected) || demoChats[0],
    [selected],
  );

  async function connect() {
    try {
      setServerState('connecting');
      if (!tinodeRef.current) {
        tinodeRef.current = createTinodeClient();
      }
      if (!tinodeRef.current.isConnected()) {
        await tinodeRef.current.connect();
      }
      setServerState('online');
      setAuthError('');
      return tinodeRef.current;
    } catch (err) {
      setServerState('offline');
      setAuthError(err?.message || 'Не удалось подключиться к серверу');
      throw err;
    }
  }

  async function signIn(event) {
    event.preventDefault();
    try {
      const client = await connect();
      await client.loginBasic(login.trim(), password);
      setAuthOpen(false);
      setPassword('');
      setServerState('authorized');
    } catch (err) {
      setAuthError(err?.message || 'Ошибка входа');
    }
  }

  function sendDemoMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => ({
      ...current,
      [selected]: [
        ...(current[selected] || []),
        { mine: true, text, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) },
      ],
    }));
    setDraft('');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>VisionChat</strong>
            <span>private messenger</span>
          </div>
        </div>

        <div className="search-box">⌕ <input placeholder="Поиск" /></div>

        <div className="section-title">Чаты</div>
        <div className="chat-list">
          {demoChats.map((chat) => (
            <button
              className={selected === chat.id ? 'chat-item active' : 'chat-item'}
              key={chat.id}
              onClick={() => setSelected(chat.id)}
            >
              <div className="avatar">{chat.name.slice(0, 1)}</div>
              <div className="chat-copy">
                <div className="chat-row">
                  <strong>{chat.name}</strong>
                  <time>{chat.time}</time>
                </div>
                <div className="chat-row secondary">
                  <span>{chat.preview}</span>
                  {chat.unread > 0 && <b className="badge">{chat.unread}</b>}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className={'status-dot ' + serverState} />
          <span>
            {serverState === 'authorized'
              ? 'Авторизован'
              : serverState === 'online'
                ? 'Сервер доступен'
                : serverState === 'connecting'
                  ? 'Подключение…'
                  : 'Не подключено'}
          </span>
          <button onClick={() => setAuthOpen(true)}>Войти</button>
        </div>
      </aside>

      <main className="conversation">
        <header className="conversation-header">
          <div>
            <h1>{activeChat.name}</h1>
            <span>{serverState === 'authorized' ? 'в сети' : 'локальное превью интерфейса'}</span>
          </div>
          <div className="header-actions">
            <button title="Аудиозвонок">⌕</button>
            <button title="Видеозвонок">◫</button>
            <button title="Информация">i</button>
          </div>
        </header>

        <section className="messages">
          <div className="day-pill">Сегодня</div>
          {(messages[selected] || []).map((message, index) => (
            <div className={message.mine ? 'message mine' : 'message'} key={index}>
              <p>{message.text}</p>
              <time>{message.time}</time>
            </div>
          ))}
        </section>

        <form className="composer" onSubmit={sendDemoMessage}>
          <button type="button" className="attach">＋</button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Написать сообщение…"
          />
          <button className="send" type="submit">➤</button>
        </form>
      </main>

      {authOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAuthOpen(false)}>
          <form className="auth-card" onSubmit={signIn} onMouseDown={(event) => event.stopPropagation()}>
            <div className="auth-logo">V</div>
            <h2>VisionChat</h2>
            <p>Вход на сервер {tinodeConfig.host}</p>
            <label>
              Логин
              <input value={login} onChange={(event) => setLogin(event.target.value)} autoFocus />
            </label>
            <label>
              Пароль
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {authError && <div className="auth-error">{authError}</div>}
            <button className="primary" type="submit">Войти</button>
            <button className="ghost" type="button" onClick={() => setAuthOpen(false)}>Отмена</button>
          </form>
        </div>
      )}
    </div>
  );
}
