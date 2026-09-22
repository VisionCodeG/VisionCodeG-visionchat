import React, { useMemo, useRef, useState } from 'react';
import { Drafty, Tinode } from 'tinode-sdk';
import { createTinodeClient, tinodeConfig } from './lib/tinode.js';

const P2P_MODE = 'JRWPS';
const MESSAGE_PAGE = 48;

function safeName(value, fallback = 'Без имени') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value.fn || value.name || fallback;
}

function messageToText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.txt === 'string') return content.txt;

  try {
    const preview = Drafty.preview(content, 500);
    if (typeof preview === 'string') return preview;
    if (preview && typeof preview.txt === 'string') return preview.txt;
  } catch {
    // Ignore malformed rich content and show a generic label below.
  }
  return 'Сообщение';
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function normalizeSearchQuery(raw) {
  let query = raw.trim();
  if (!query) return Tinode.DEL_CHAR;

  if (!/[\s,:]/.test(query)) {
    if (query.includes('@') && query.indexOf('@') > 0) {
      query = `${Tinode.TAG_EMAIL}${query.toLowerCase()}`;
    } else if (query.startsWith('+')) {
      query = `${Tinode.TAG_PHONE}${query.replace(/[^+\d]/g, '')}`;
    } else {
      if (query.startsWith('@')) query = query.slice(1);
      query = `${Tinode.TAG_ALIAS}${query.toLowerCase()},${query.toLowerCase()}`;
    }
  }

  return query;
}

export default function App() {
  const tinodeRef = useRef(null);
  const currentUserRef = useRef(null);
  const selectedRef = useRef(null);

  const [serverState, setServerState] = useState('offline');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authStep, setAuthStep] = useState('form');
  const [authError, setAuthError] = useState('');
  const [pendingAuth, setPendingAuth] = useState(null);

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');

  const [currentUserId, setCurrentUserId] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [chats, setChats] = useState([]);
  const [chatFilter, setChatFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');

  const authorized = serverState === 'authorized';

  const visibleChats = useMemo(() => {
    const needle = chatFilter.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) =>
      chat.name.toLowerCase().includes(needle) ||
      chat.topic.toLowerCase().includes(needle),
    );
  }, [chats, chatFilter]);

  const activeChat = useMemo(
    () => chats.find((item) => item.topic === selected) || null,
    [chats, selected],
  );

  function ensureClient() {
    if (!tinodeRef.current) {
      const client = createTinodeClient();

      client.onDisconnect = (err) => {
        if (currentUserRef.current) {
          setServerState('offline');
        }
        if (err?.message) {
          setAuthError(err.message);
        }
      };

      tinodeRef.current = client;
    }

    return tinodeRef.current;
  }

  async function connect() {
    const client = ensureClient();

    if (!client.isConnected()) {
      setServerState('connecting');
      await client.connect();
    }

    if (!client.isAuthenticated()) {
      setServerState('online');
    }

    return client;
  }

  function syncTopicMessages(topic) {
    if (!topic) return;

    const ownId = currentUserRef.current;
    const next = [];

    topic.messages((msg) => {
      if (!msg || msg.head?.webrtc) return;
      next.push({
        seq: msg.seq,
        from: msg.from,
        mine: msg.from === ownId,
        text: messageToText(msg.content),
        time: formatTime(msg.ts),
      });
    });

    setMessages((current) => ({
      ...current,
      [topic.name]: next,
    }));
  }

  function refreshChats(client = tinodeRef.current) {
    if (!client || !client.isAuthenticated()) return;

    const me = client.getMeTopic();
    const next = [];

    me.contacts((contact) => {
      const topicName = contact.topic || contact.user || contact.name;
      if (!topicName || topicName === 'me' || topicName === 'fnd') return;

      const topic = client.getTopic(topicName);
      const publicData = contact.public || topic?.public;
      const touched = contact.touched || contact.updated || topic?.touched || null;

      next.push({
        topic: topicName,
        name: safeName(publicData, topicName),
        unread: contact.unread || 0,
        online: Boolean(contact.online),
        touched,
      });
    });

    next.sort((a, b) => {
      const left = a.touched ? new Date(a.touched).getTime() : 0;
      const right = b.touched ? new Date(b.touched).getTime() : 0;
      return right - left;
    });

    setChats(next);
  }

  async function finishAuthentication(client) {
    const userId = client.getCurrentUserID();
    currentUserRef.current = userId;
    setCurrentUserId(userId);
    setServerState('authorized');
    setAuthError('');

    const me = client.getMeTopic();

    me.onMetaDesc = (desc) => {
      if (desc?.public) {
        setProfileName(safeName(desc.public, userId));
      }
    };
    me.onContactUpdate = () => refreshChats(client);
    me.onSubsUpdated = () => refreshChats(client);

    if (!me.isSubscribed()) {
      await me.subscribe(
        me.startMetaQuery()
          .withLaterSub()
          .withDesc()
          .withTags()
          .build(),
      );
    }

    setProfileName(safeName(me.public, userId));
    refreshChats(client);

    setAuthOpen(false);
    setAuthStep('form');
    setPassword('');
    setVerifyCode('');
    setPendingAuth(null);
  }

  function attachTopicCallbacks(topic) {
    topic.onData = () => {
      syncTopicMessages(topic);
      refreshChats();
    };
    topic.onMetaDesc = () => {
      refreshChats();
      syncTopicMessages(topic);
    };
    topic.onSubsUpdated = () => refreshChats();
  }

  async function subscribeTopic(topic, createP2P = false) {
    if (topic.isSubscribed()) {
      try {
        await topic.getMeta(
          topic.startMetaQuery()
            .withLaterDesc()
            .withLaterData(MESSAGE_PAGE)
            .build(),
        );
      } catch {
        // Existing local data is still usable if a refresh fails.
      }
      return topic.name;
    }

    let getQuery = topic.startMetaQuery()
      .withLaterDesc()
      .withLaterSub()
      .withLaterData(MESSAGE_PAGE);

    const setQuery = createP2P
      ? {
          sub: { mode: P2P_MODE },
          desc: { defacs: { auth: P2P_MODE } },
        }
      : undefined;

    const ctrl = await topic.subscribe(getQuery.build(), setQuery);
    return ctrl?.topic || topic.name;
  }

  async function openChat(topicName, createP2P = false) {
    if (!authorized || !topicName) return;

    setBusy(true);
    setAuthError('');

    try {
      const client = tinodeRef.current;
      const topic = client.getTopic(topicName);
      attachTopicCallbacks(topic);

      const actualName = await subscribeTopic(topic, createP2P);
      const actualTopic = client.getTopic(actualName);
      attachTopicCallbacks(actualTopic);

      selectedRef.current = actualName;
      setSelected(actualName);
      syncTopicMessages(actualTopic);
      refreshChats(client);

      if (!chats.some((chat) => chat.topic === actualName)) {
        setChats((current) => [
          {
            topic: actualName,
            name: safeName(actualTopic.public, actualName),
            unread: 0,
            online: false,
            touched: new Date(),
          },
          ...current.filter((chat) => chat.topic !== actualName),
        ]);
      }
    } catch (err) {
      setAuthError(err?.message || 'Не удалось открыть чат');
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setAuthError('');

    try {
      const client = await connect();
      const ctrl = await client.loginBasic(login.trim(), password);

      if (ctrl?.code >= 300 && ctrl?.text === 'validate credentials') {
        setPendingAuth({
          mode: 'login',
          login: login.trim(),
          password,
          method: ctrl.params?.cred?.[0] || 'email',
          token: ctrl.params?.token || null,
        });
        setAuthStep('verify');
        return;
      }

      await finishAuthentication(client);
    } catch (err) {
      setAuthError(err?.message || 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  }

  async function register(event) {
    event.preventDefault();
    setBusy(true);
    setAuthError('');

    try {
      const cleanLogin = login.trim().toLowerCase();
      const cleanName = fullName.trim();
      const cleanEmail = email.trim().toLowerCase();

      if (cleanLogin.length < 4) {
        throw new Error('Логин должен содержать минимум 4 символа');
      }
      if (password.length < 6) {
        throw new Error('Пароль должен содержать минимум 6 символов');
      }
      if (!cleanName) {
        throw new Error('Укажи имя');
      }
      if (!cleanEmail.includes('@')) {
        throw new Error('Укажи корректный email');
      }

      const client = await connect();
      const ctrl = await client.createAccountBasic(cleanLogin, password, {
        public: { fn: cleanName },
        tags: [`${Tinode.TAG_ALIAS}${cleanLogin}`],
        cred: Tinode.credential('email', cleanEmail),
      });

      if (ctrl?.code >= 300 && ctrl?.text === 'validate credentials') {
        setPendingAuth({
          mode: 'register',
          login: cleanLogin,
          password,
          method: ctrl.params?.cred?.[0] || 'email',
          token: ctrl.params?.token || null,
        });
        setAuthStep('verify');
        return;
      }

      await finishAuthentication(client);
    } catch (err) {
      setAuthError(err?.message || 'Ошибка регистрации');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCredential(event) {
    event.preventDefault();
    if (!pendingAuth) return;

    setBusy(true);
    setAuthError('');

    try {
      const client = await connect();
      const cred = Tinode.credential({
        meth: pendingAuth.method,
        resp: verifyCode.trim(),
      });

      let ctrl;
      if (pendingAuth.token) {
        ctrl = await client.loginToken(pendingAuth.token, cred);
      } else {
        ctrl = await client.loginBasic(
          pendingAuth.login,
          pendingAuth.password,
          cred,
        );
      }

      if (ctrl?.code >= 300) {
        throw new Error(ctrl.text || 'Код подтверждения не принят');
      }

      await finishAuthentication(client);
    } catch (err) {
      setAuthError(err?.message || 'Неверный код подтверждения');
    } finally {
      setBusy(false);
    }
  }

  async function searchUsers(event) {
    event.preventDefault();
    if (!authorized) return;

    setSearchBusy(true);
    setSearchError('');
    setUserResults([]);

    try {
      const client = tinodeRef.current;
      const fnd = client.getFndTopic();

      const collect = () => {
        const found = [];
        fnd.contacts((sub) => {
          const user = sub.user || sub.topic || sub.name;
          if (!user || user === currentUserRef.current) return;
          found.push({
            user,
            name: safeName(sub.public, user),
          });
        });
        setUserResults(found);
      };

      fnd.onSubsUpdated = collect;

      if (!fnd.isSubscribed()) {
        await fnd.subscribe(fnd.startMetaQuery().withSub().build());
      }

      const query = normalizeSearchQuery(userQuery);
      await fnd.setMeta({ desc: { public: query } });
      await fnd.getMeta(fnd.startMetaQuery().withSub().build());
      collect();
    } catch (err) {
      setSearchError(err?.message || 'Поиск не выполнен');
    } finally {
      setSearchBusy(false);
    }
  }

  async function startChatWith(user) {
    setNewChatOpen(false);
    setUserQuery('');
    setUserResults([]);
    await openChat(user, true);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected || !authorized) return;

    setBusy(true);

    try {
      const client = tinodeRef.current;
      const topic = client.getTopic(selected);
      attachTopicCallbacks(topic);

      if (!topic.isSubscribed()) {
        await subscribeTopic(topic, false);
      }

      await topic.publish(text);
      setDraft('');
      syncTopicMessages(topic);
      refreshChats(client);
    } catch (err) {
      setAuthError(err?.message || 'Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    if (tinodeRef.current) {
      try {
        tinodeRef.current.disconnect();
      } catch {
        // Ignore disconnect errors during logout.
      }
    }

    tinodeRef.current = null;
    currentUserRef.current = null;
    selectedRef.current = null;

    setCurrentUserId(null);
    setProfileName('');
    setChats([]);
    setSelected(null);
    setMessages({});
    setServerState('offline');
    setAuthError('');
    setNewChatOpen(false);
  }

  async function copyMyId() {
    if (!currentUserId) return;
    try {
      await navigator.clipboard.writeText(currentUserId);
    } catch {
      // Clipboard may be unavailable on insecure origins.
    }
  }

  function openAuth(mode = 'login') {
    setAuthMode(mode);
    setAuthStep('form');
    setAuthError('');
    setAuthOpen(true);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>VisionChat</strong>
            <span>{authorized ? 'подключён к своему серверу' : 'private messenger'}</span>
          </div>
        </div>

        <div className="search-box">
          ⌕
          <input
            value={chatFilter}
            onChange={(event) => setChatFilter(event.target.value)}
            placeholder="Поиск по чатам"
            disabled={!authorized}
          />
        </div>

        <div className="sidebar-actions">
          <button
            className="new-chat-button"
            disabled={!authorized}
            onClick={() => {
              setSearchError('');
              setNewChatOpen(true);
            }}
          >
            ＋ Новый чат
          </button>
        </div>

        <div className="section-title">Чаты</div>

        <div className="chat-list">
          {!authorized && (
            <div className="sidebar-empty">
              Войди или создай аккаунт, чтобы увидеть реальные чаты.
            </div>
          )}

          {authorized && visibleChats.length === 0 && (
            <div className="sidebar-empty">
              Чатов пока нет. Нажми «Новый чат».
            </div>
          )}

          {visibleChats.map((chat) => (
            <button
              className={selected === chat.topic ? 'chat-item active' : 'chat-item'}
              key={chat.topic}
              onClick={() => openChat(chat.topic, false)}
            >
              <div className="avatar">{chat.name.slice(0, 1).toUpperCase()}</div>
              <div className="chat-copy">
                <div className="chat-row">
                  <strong>{chat.name}</strong>
                  <time>{chat.online ? 'online' : ''}</time>
                </div>
                <div className="chat-row secondary">
                  <span>{chat.topic}</span>
                  {chat.unread > 0 && <b className="badge">{chat.unread}</b>}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer profile-footer">
          <span className={'status-dot ' + serverState} />

          <div className="profile-summary">
            <strong>{authorized ? profileName || 'VisionChat user' : 'Не авторизован'}</strong>
            <span>
              {authorized
                ? currentUserId
                : serverState === 'connecting'
                  ? 'Подключение…'
                  : serverState === 'online'
                    ? 'Сервер доступен'
                    : 'Сервер не подключён'}
            </span>
          </div>

          {authorized ? (
            <div className="profile-actions">
              <button onClick={copyMyId} title="Скопировать мой ID">ID</button>
              <button onClick={logout} title="Выйти">↪</button>
            </div>
          ) : (
            <button onClick={() => openAuth('login')}>Войти</button>
          )}
        </div>
      </aside>

      <main className="conversation">
        {activeChat ? (
          <>
            <header className="conversation-header">
              <div>
                <h1>{activeChat.name}</h1>
                <span>{activeChat.online ? 'в сети' : activeChat.topic}</span>
              </div>
              <div className="header-actions">
                <button disabled title="Аудиозвонок — следующий этап">☎</button>
                <button disabled title="Видеозвонок — следующий этап">◫</button>
                <button title="ID чата" onClick={() => navigator.clipboard?.writeText(activeChat.topic)}>i</button>
              </div>
            </header>

            <section className="messages">
              <div className="day-pill">VisionChat</div>

              {(messages[selected] || []).length === 0 && (
                <div className="empty-conversation">
                  <div className="empty-icon">✦</div>
                  <h2>Начни разговор</h2>
                  <p>Сообщения здесь уже отправляются через Tinode, а не через демонстрационный массив.</p>
                </div>
              )}

              {(messages[selected] || []).map((message) => (
                <div
                  className={message.mine ? 'message mine' : 'message'}
                  key={message.seq ?? `${message.from}-${message.time}-${message.text}`}
                >
                  <p>{message.text}</p>
                  <time>{message.time}</time>
                </div>
              ))}
            </section>

            <form className="composer" onSubmit={sendMessage}>
              <button type="button" className="attach" disabled title="Вложения — следующий этап">＋</button>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Написать сообщение…"
                disabled={busy}
              />
              <button className="send" type="submit" disabled={busy || !draft.trim()}>➤</button>
            </form>
          </>
        ) : (
          <section className="welcome-screen">
            <div className="welcome-logo">V</div>
            <h1>VisionChat</h1>

            {authorized ? (
              <>
                <p>Сервер подключён. Создай новый чат или выбери существующий слева.</p>
                <button className="welcome-primary" onClick={() => setNewChatOpen(true)}>
                  Найти пользователя
                </button>
              </>
            ) : (
              <>
                <p>Свой сервер, свои аккаунты и реальные сообщения на базе Tinode.</p>
                <div className="welcome-actions">
                  <button className="welcome-primary" onClick={() => openAuth('login')}>Войти</button>
                  <button className="welcome-secondary" onClick={() => openAuth('register')}>Создать аккаунт</button>
                </div>
              </>
            )}

            {authError && <div className="global-error">{authError}</div>}
          </section>
        )}
      </main>

      {authOpen && (
        <div className="modal-backdrop" onMouseDown={() => !busy && setAuthOpen(false)}>
          <div className="auth-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="auth-logo">V</div>
            <h2>VisionChat</h2>
            <p>Сервер: {tinodeConfig.host}</p>

            {authStep === 'verify' ? (
              <form onSubmit={verifyCredential}>
                <div className="auth-step-title">Подтверждение</div>
                <div className="auth-note">
                  Введи код подтверждения для {pendingAuth?.method || 'email'}.
                  В локальной dev-конфигурации Tinode обычно используется тестовый код <b>123456</b>.
                </div>

                <label>
                  Код
                  <input
                    value={verifyCode}
                    onChange={(event) => setVerifyCode(event.target.value)}
                    inputMode="numeric"
                    autoFocus
                  />
                </label>

                {authError && <div className="auth-error">{authError}</div>}

                <button className="primary" type="submit" disabled={busy || !verifyCode.trim()}>
                  {busy ? 'Проверяем…' : 'Подтвердить'}
                </button>
                <button
                  className="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAuthStep('form');
                    setVerifyCode('');
                    setAuthError('');
                  }}
                >
                  Назад
                </button>
              </form>
            ) : (
              <>
                <div className="auth-tabs">
                  <button
                    className={authMode === 'login' ? 'active' : ''}
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError('');
                    }}
                  >
                    Вход
                  </button>
                  <button
                    className={authMode === 'register' ? 'active' : ''}
                    onClick={() => {
                      setAuthMode('register');
                      setAuthError('');
                    }}
                  >
                    Регистрация
                  </button>
                </div>

                <form onSubmit={authMode === 'login' ? signIn : register}>
                  {authMode === 'register' && (
                    <>
                      <label>
                        Имя
                        <input
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                          placeholder="Например, Alex"
                          autoFocus
                        />
                      </label>

                      <label>
                        Email
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="alex@example.com"
                        />
                      </label>
                    </>
                  )}

                  <label>
                    Логин
                    <input
                      value={login}
                      onChange={(event) => setLogin(event.target.value)}
                      autoFocus={authMode === 'login'}
                      placeholder="минимум 4 символа"
                    />
                  </label>

                  <label>
                    Пароль
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="минимум 6 символов"
                    />
                  </label>

                  {authError && <div className="auth-error">{authError}</div>}

                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || !login.trim() || !password}
                  >
                    {busy
                      ? 'Подключение…'
                      : authMode === 'login'
                        ? 'Войти'
                        : 'Создать аккаунт'}
                  </button>

                  <button
                    className="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => setAuthOpen(false)}
                  >
                    Отмена
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {newChatOpen && (
        <div className="modal-backdrop" onMouseDown={() => setNewChatOpen(false)}>
          <div className="auth-card user-search-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="auth-logo">＋</div>
            <h2>Новый чат</h2>
            <p>Найди пользователя по логину, email или ID.</p>

            <form onSubmit={searchUsers}>
              <label>
                Поиск
                <input
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="например alex"
                  autoFocus
                />
              </label>
              <button className="primary" type="submit" disabled={searchBusy || !userQuery.trim()}>
                {searchBusy ? 'Ищем…' : 'Найти'}
              </button>
            </form>

            {searchError && <div className="auth-error">{searchError}</div>}

            <div className="search-results">
              {userResults.map((user) => (
                <button key={user.user} className="search-result" onClick={() => startChatWith(user.user)}>
                  <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.user}</span>
                  </div>
                </button>
              ))}

              {!searchBusy && userQuery && userResults.length === 0 && !searchError && (
                <div className="search-placeholder">Нажми «Найти» для поиска по серверу.</div>
              )}
            </div>

            <button className="ghost" type="button" onClick={() => setNewChatOpen(false)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
