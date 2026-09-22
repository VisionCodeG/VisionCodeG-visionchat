import React, { useMemo, useRef, useState } from 'react';
import { Drafty, Tinode } from 'tinode-sdk';
import CallPanel from './components/CallPanel.jsx';
import MessageBody from './components/MessageBody.jsx';
import { attachmentLabel, contentText, imageDimensions } from './lib/media.js';
import { createTinodeClient, tinodeConfig } from './lib/tinode.js';

const P2P_MODE = 'JRWPS';
const MESSAGE_PAGE = 48;
const FALLBACK_UPLOAD_LIMIT = 32 * 1024 * 1024;

function safeName(value, fallback = 'Без имени') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value.fn || value.name || fallback;
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

function statusMark(status) {
  if (status >= Tinode.MESSAGE_STATUS_READ) return '✓✓';
  if (status >= Tinode.MESSAGE_STATUS_RECEIVED) return '✓✓';
  if (status >= Tinode.MESSAGE_STATUS_SENT) return '✓';
  return '•';
}

export default function App() {
  const tinodeRef = useRef(null);
  const currentUserRef = useRef(null);
  const selectedRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const discardRecordingRef = useRef(false);
  const typingTimersRef = useRef({});
  const lastTypingSentRef = useRef(0);
  const callRef = useRef(null);
  const callInfoHandlerRef = useRef(null);
  const callInfoQueueRef = useRef([]);

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
  const [uploadProgress, setUploadProgress] = useState(null);

  const [replying, setReplying] = useState(null);
  const [editingSeq, setEditingSeq] = useState(null);
  const [typingByTopic, setTypingByTopic] = useState({});

  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatMode, setNewChatMode] = useState('person');
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [call, setCall] = useState(null);

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

  const activeMessages = messages[selected] || [];
  const typingNow = Boolean(selected && typingByTopic[selected]);

  function updateCall(next) {
    callRef.current = next;
    setCall(next);
  }

  function releaseCallMedia(callValue = callRef.current) {
    callValue?.stream?.getTracks?.().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore already-stopped media tracks.
      }
    });
  }

  function closeCallLocal() {
    releaseCallMedia();
    callInfoQueueRef.current = [];
    callInfoHandlerRef.current = null;
    updateCall(null);
  }

  function registerCallInfoHandler(handler) {
    callInfoHandlerRef.current = handler;
    if (handler && callInfoQueueRef.current.length) {
      const queued = callInfoQueueRef.current.splice(0);
      queued.forEach((info) => handler(info));
    }
  }

  function ensureClient() {
    if (!tinodeRef.current) {
      const client = createTinodeClient();

      client.onDisconnect = (err) => {
        if (currentUserRef.current) setServerState('offline');
        if (err?.message) setAuthError(err.message);
        if (callRef.current) closeCallLocal();
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

    if (!client.isAuthenticated()) setServerState('online');
    return client;
  }

  function setRemoteTyping(topicName, value) {
    setTypingByTopic((current) => ({ ...current, [topicName]: value }));
    clearTimeout(typingTimersRef.current[topicName]);

    if (value) {
      typingTimersRef.current[topicName] = setTimeout(() => {
        setTypingByTopic((current) => ({ ...current, [topicName]: false }));
      }, 3500);
    }
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
        content: msg.content,
        head: msg.head || {},
        time: formatTime(msg.ts),
        status: msg.from === ownId ? topic.msgStatus(msg, true) : Tinode.MESSAGE_STATUS_TO_ME,
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
      if (desc?.public) setProfileName(safeName(desc.public, userId));
    };
    me.onContactUpdate = () => refreshChats(client);
    me.onSubsUpdated = () => refreshChats(client);

    client.onDataMessage = handleGlobalDataMessage;
    client.onInfoMessage = handleGlobalInfoMessage;

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
    if (!topic) return;

    topic.onData = (msg) => {
      syncTopicMessages(topic);
      refreshChats();

      if (
        msg &&
        selectedRef.current === topic.name &&
        msg.from !== currentUserRef.current &&
        msg.seq
      ) {
        try {
          topic.noteRead(msg.seq);
        } catch {
          // Reading notification is best-effort.
        }
      }
    };

    topic.onMetaDesc = () => {
      refreshChats();
      syncTopicMessages(topic);
    };

    topic.onSubsUpdated = () => refreshChats();
    topic.onPres = () => refreshChats();

    topic.onInfo = (info) => {
      if (!info) return;

      if (['kp', 'kpa', 'kpv'].includes(info.what) && info.from !== currentUserRef.current) {
        setRemoteTyping(topic.name, true);
      }

      if (info.what === 'read' || info.what === 'recv') {
        syncTopicMessages(topic);
      }
    };
  }

  async function subscribeTopic(topic, createP2P = false) {
    if (topic.isSubscribed()) {
      try {
        await topic.getMeta(
          topic.startMetaQuery()
            .withLaterDesc()
            .withLaterSub()
            .withLaterData(MESSAGE_PAGE)
            .build(),
        );
      } catch {
        // Existing local data is still usable if a refresh fails.
      }
      return topic.name;
    }

    const getQuery = topic.startMetaQuery()
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
      setReplying(null);
      setEditingSeq(null);
      syncTopicMessages(actualTopic);
      refreshChats(client);

      try {
        actualTopic.noteRead();
      } catch {
        // Read receipt is best-effort.
      }

      setChats((current) => {
        if (current.some((chat) => chat.topic === actualName)) return current;
        return [
          {
            topic: actualName,
            name: safeName(actualTopic.public, actualName),
            unread: 0,
            online: false,
            touched: new Date(),
          },
          ...current,
        ];
      });
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

      if (cleanLogin.length < 4) throw new Error('Логин должен содержать минимум 4 символа');
      if (password.length < 6) throw new Error('Пароль должен содержать минимум 6 символов');
      if (!cleanName) throw new Error('Укажи имя');
      if (!cleanEmail.includes('@')) throw new Error('Укажи корректный email');

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

      const ctrl = pendingAuth.token
        ? await client.loginToken(pendingAuth.token, cred)
        : await client.loginBasic(pendingAuth.login, pendingAuth.password, cred);

      if (ctrl?.code >= 300) throw new Error(ctrl.text || 'Код подтверждения не принят');
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

  function toggleGroupMember(user) {
    setGroupMembers((current) => {
      if (current.some((item) => item.user === user.user)) {
        return current.filter((item) => item.user !== user.user);
      }
      return [...current, user];
    });
  }

  async function createGroup(event) {
    event.preventDefault();
    if (!authorized) return;

    const cleanName = groupName.trim();
    if (!cleanName) {
      setSearchError('Укажи название группы');
      return;
    }

    setBusy(true);
    setSearchError('');

    try {
      const client = tinodeRef.current;
      const tempName = client.newGroupTopicName(false);
      const topic = client.getTopic(tempName);
      attachTopicCallbacks(topic);

      const getQuery = topic.startMetaQuery()
        .withLaterDesc()
        .withLaterSub()
        .withLaterData(MESSAGE_PAGE);

      const ctrl = await topic.subscribe(getQuery.build(), {
        desc: {
          public: { fn: cleanName },
          defacs: { auth: P2P_MODE, anon: 'N' },
        },
      });

      const actualName = ctrl?.topic || topic.name;
      const actualTopic = client.getTopic(actualName);
      attachTopicCallbacks(actualTopic);

      for (const member of groupMembers) {
        await actualTopic.invite(member.user, null);
      }

      setNewChatOpen(false);
      setNewChatMode('person');
      setGroupName('');
      setGroupMembers([]);
      setUserQuery('');
      setUserResults([]);
      refreshChats(client);
      await openChat(actualName, false);
    } catch (err) {
      setSearchError(err?.message || 'Не удалось создать группу');
    } finally {
      setBusy(false);
    }
  }

  function handleGlobalDataMessage(data) {
    if (
      !data?.head?.webrtc ||
      data.head.webrtc !== 'started' ||
      !Tinode.isP2PTopicName(data.topic) ||
      data.from === currentUserRef.current
    ) {
      return;
    }

    const client = tinodeRef.current;
    const topic = client?.getTopic(data.topic);
    if (!topic) return;

    if (callRef.current) {
      try {
        topic.videoCall('hang-up', data.seq);
      } catch {
        // Ignore failure to reject a second concurrent call.
      }
      return;
    }

    try {
      topic.videoCall('ringing', data.seq);
    } catch {
      // Ringing is a best-effort signal.
    }

    updateCall({
      topic: data.topic,
      seq: data.seq,
      state: 'incoming',
      direction: 'incoming',
      audioOnly: Boolean(data.head.aonly),
      stream: null,
    });
  }

  function handleGlobalInfoMessage(info) {
    if (!info || info.what !== 'call') return;

    const currentCall = callRef.current;
    if (!currentCall || info.topic !== currentCall.topic) return;

    if (info.event === 'accept' && currentCall.direction === 'outgoing') {
      updateCall({ ...currentCall, state: 'active' });
    } else if (info.event === 'hang-up') {
      closeCallLocal();
      return;
    }

    if (callInfoHandlerRef.current) {
      callInfoHandlerRef.current(info);
    } else {
      callInfoQueueRef.current.push(info);
    }
  }

  async function startCall(audioOnly) {
    if (!selected || !authorized) return;

    if (!Tinode.isP2PTopicName(selected)) {
      setAuthError('Звонки сейчас доступны только в личных чатах');
      return;
    }

    if (callRef.current) {
      setAuthError('Другой звонок уже активен');
      return;
    }

    setBusy(true);
    setAuthError('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !audioOnly,
      });

      const { topic } = await ensureWritableTopic();
      const pub = topic.createMessage(Drafty.videoCall(audioOnly), false);
      pub.head = {
        ...(pub.head || {}),
        webrtc: 'started',
        aonly: Boolean(audioOnly),
      };

      const ctrl = await topic.publishMessage(pub);
      const seq = ctrl?.params?.seq;
      if (!seq) throw new Error('Сервер не вернул ID звонка');

      updateCall({
        topic: selected,
        seq,
        state: 'outgoing',
        direction: 'outgoing',
        audioOnly: Boolean(audioOnly),
        stream,
      });
    } catch (err) {
      stream?.getTracks?.().forEach((track) => track.stop());
      setAuthError(err?.message || 'Не удалось начать звонок');
    } finally {
      setBusy(false);
    }
  }

  async function acceptIncomingCall() {
    const currentCall = callRef.current;
    if (!currentCall || currentCall.state !== 'incoming') return;

    setBusy(true);
    setAuthError('');

    let stream;
    try {
      await openChat(currentCall.topic, false);
      const topic = tinodeRef.current?.getTopic(currentCall.topic);
      if (!topic) throw new Error('Чат звонка недоступен');

      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !currentCall.audioOnly,
      });

      await topic.videoCall('accept', currentCall.seq);
      updateCall({
        ...currentCall,
        state: 'active',
        stream,
      });
    } catch (err) {
      stream?.getTracks?.().forEach((track) => track.stop());
      setAuthError(err?.message || 'Не удалось принять звонок');
      rejectIncomingCall();
    } finally {
      setBusy(false);
    }
  }

  function rejectIncomingCall() {
    const currentCall = callRef.current;
    if (!currentCall) return;

    try {
      tinodeRef.current?.getTopic(currentCall.topic)?.videoCall('hang-up', currentCall.seq);
    } catch {
      // Ignore signaling errors while rejecting.
    }

    closeCallLocal();
  }

  function hangupCall() {
    const currentCall = callRef.current;
    if (!currentCall) return;

    try {
      tinodeRef.current?.getTopic(currentCall.topic)?.videoCall('hang-up', currentCall.seq);
    } catch {
      // Local cleanup must still happen.
    }

    closeCallLocal();
  }

  async function ensureWritableTopic() {
    const client = tinodeRef.current;
    if (!client || !selected) throw new Error('Чат не выбран');

    const topic = client.getTopic(selected);
    attachTopicCallbacks(topic);

    if (!topic.isSubscribed()) {
      await subscribeTopic(topic, false);
    }

    return { client, topic };
  }

  async function publishContent(content, head) {
    const { client, topic } = await ensureWritableTopic();
    const pub = topic.createMessage(content, false);

    if (head) {
      pub.head = { ...(pub.head || {}), ...head };
    }

    await topic.publishMessage(pub);
    syncTopicMessages(topic);
    refreshChats(client);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected || !authorized) return;

    setBusy(true);
    setAuthError('');

    try {
      let head;
      if (editingSeq) {
        head = { replace: `:${editingSeq}` };
      } else if (replying?.seq) {
        head = { reply: String(replying.seq) };
      }

      await publishContent(Drafty.parse(text), head);
      setDraft('');
      setEditingSeq(null);
      setReplying(null);
    } catch (err) {
      setAuthError(err?.message || 'Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  }

  function handleDraftChange(event) {
    const value = event.target.value;
    setDraft(value);

    if (!value || !selected || !authorized) return;

    const now = Date.now();
    if (now - lastTypingSentRef.current < 2500) return;
    lastTypingSentRef.current = now;

    try {
      const topic = tinodeRef.current?.getTopic(selected);
      if (topic?.isSubscribed()) topic.noteKeyPress();
    } catch {
      // Typing notification is best-effort.
    }
  }

  async function sendAttachment(file) {
    if (!file || !selected || !authorized) return;

    setBusy(true);
    setAuthError('');
    setUploadProgress(0);

    try {
      const { client } = await ensureWritableTopic();
      const maxUpload = Number(
        client.getServerParam?.(Tinode.MAX_FILE_UPLOAD_SIZE, FALLBACK_UPLOAD_LIMIT),
      ) || FALLBACK_UPLOAD_LIMIT;

      if (file.size > maxUpload) {
        throw new Error(`Файл слишком большой. Лимит сервера: ${Math.round(maxUpload / 1024 / 1024)} MB`);
      }

      const uploader = client.getLargeFileHelper();
      if (!uploader) throw new Error('Сервер не поддерживает загрузку файлов');

      const refurl = await uploader.upload(
        file,
        null,
        (progress) => setUploadProgress(Math.round(progress * 100)),
      );

      let content;
      if (file.type.startsWith('image/')) {
        const { width, height } = await imageDimensions(file);
        content = Drafty.insertImage(null, 0, {
          mime: file.type || 'image/jpeg',
          refurl,
          width,
          height,
          filename: file.name,
          size: file.size,
        });
      } else {
        content = Drafty.attachFile(null, {
          mime: file.type || 'application/octet-stream',
          refurl,
          filename: file.name,
          size: file.size,
        });
      }

      await publishContent(content);
    } catch (err) {
      setAuthError(err?.message || 'Не удалось отправить файл');
    } finally {
      setBusy(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function sendVoiceBlob(blob, durationMs) {
    if (!blob || blob.size === 0) return;

    setBusy(true);
    setUploadProgress(0);

    try {
      const { client } = await ensureWritableTopic();
      const uploader = client.getLargeFileHelper();
      if (!uploader) throw new Error('Сервер не поддерживает загрузку аудио');

      const refurl = await uploader.upload(
        blob,
        null,
        (progress) => setUploadProgress(Math.round(progress * 100)),
      );

      const content = Drafty.appendAudio(null, {
        mime: blob.type || 'audio/webm',
        refurl,
        size: blob.size,
        duration: durationMs,
      });

      await publishContent(content);
    } catch (err) {
      setAuthError(err?.message || 'Не удалось отправить голосовое');
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  async function startRecording() {
    if (!selected || !authorized || recording) return;

    setAuthError('');

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Этот браузер не поддерживает запись голоса');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;

      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        clearInterval(recordingTimerRef.current);
        setRecording(false);
        setRecordingSeconds(0);

        const duration = Date.now() - recordingStartedAtRef.current;
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        recordingChunksRef.current = [];
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;

        if (!discardRecordingRef.current) {
          sendVoiceBlob(blob, duration);
        }
      };

      recorder.start(250);
      setRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }, 500);

      const topic = tinodeRef.current?.getTopic(selected);
      if (topic?.isSubscribed()) topic.noteRecording(true);
    } catch (err) {
      setAuthError(err?.message || 'Не удалось включить микрофон');
    }
  }

  function stopRecording(discard = false) {
    discardRecordingRef.current = discard;
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  function beginReply(message) {
    setReplying({
      seq: message.seq,
      text: attachmentLabel(message.content),
    });
    setEditingSeq(null);
  }

  function beginEdit(message) {
    const text = contentText(message.content);
    if (!text) {
      setAuthError('Редактирование вложений пока не поддерживается');
      return;
    }

    setDraft(text);
    setEditingSeq(message.seq);
    setReplying(null);
  }

  function cancelComposerMode() {
    setReplying(null);
    setEditingSeq(null);
    setDraft('');
  }

  async function deleteMessage(message) {
    if (!message?.seq || !selected) return;

    const hardDelete = message.mine
      ? window.confirm('Удалить сообщение для всех?\nOK — для всех, Отмена — только у себя.')
      : false;

    try {
      const topic = tinodeRef.current?.getTopic(selected);
      if (!topic) return;
      await topic.delMessagesList([message.seq], hardDelete);
      syncTopicMessages(topic);
    } catch (err) {
      setAuthError(err?.message || 'Не удалось удалить сообщение');
    }
  }

  function logout() {
    if (recording) stopRecording(true);
    if (callRef.current) hangupCall();

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
    setReplying(null);
    setEditingSeq(null);
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

  function resetNewChat() {
    setNewChatOpen(false);
    setNewChatMode('person');
    setUserQuery('');
    setUserResults([]);
    setSearchError('');
    setGroupName('');
    setGroupMembers([]);
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
                <span className={typingNow ? 'typing-status' : ''}>
                  {typingNow ? 'печатает…' : activeChat.online ? 'в сети' : activeChat.topic}
                </span>
              </div>
              <div className="header-actions">
                <button
                  disabled={busy || Boolean(call) || !Tinode.isP2PTopicName(activeChat.topic)}
                  title="Аудиозвонок"
                  onClick={() => startCall(true)}
                >
                  ☎
                </button>
                <button
                  disabled={busy || Boolean(call) || !Tinode.isP2PTopicName(activeChat.topic)}
                  title="Видеозвонок"
                  onClick={() => startCall(false)}
                >
                  ◫
                </button>
                <button title="ID чата" onClick={() => navigator.clipboard?.writeText(activeChat.topic)}>i</button>
              </div>
            </header>

            <section className="messages">
              <div className="day-pill">VisionChat</div>

              {activeMessages.length === 0 && (
                <div className="empty-conversation">
                  <div className="empty-icon">✦</div>
                  <h2>Начни разговор</h2>
                  <p>Можно писать, отправлять фото, файлы и голосовые сообщения.</p>
                </div>
              )}

              {activeMessages.map((message) => {
                const replyTarget = message.head?.reply
                  ? activeMessages.find((item) => String(item.seq) === String(message.head.reply))
                  : null;

                return (
                  <div
                    className={message.mine ? 'message mine' : 'message'}
                    key={message.seq ?? `${message.from}-${message.time}`}
                  >
                    <div className="message-actions">
                      <button type="button" title="Ответить" onClick={() => beginReply(message)}>↩</button>
                      {message.mine && (
                        <button type="button" title="Редактировать" onClick={() => beginEdit(message)}>✎</button>
                      )}
                      <button type="button" title="Удалить" onClick={() => deleteMessage(message)}>⌫</button>
                    </div>

                    {replyTarget && (
                      <button
                        type="button"
                        className="message-reply-preview"
                        onClick={() => document.getElementById(`msg-${replyTarget.seq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                      >
                        <strong>Ответ</strong>
                        <span>{attachmentLabel(replyTarget.content)}</span>
                      </button>
                    )}

                    <div id={`msg-${message.seq}`}>
                      <MessageBody
                        content={message.content}
                        client={tinodeRef.current}
                        onError={setAuthError}
                      />
                    </div>

                    <div className="message-meta">
                      {message.head?.replace && <span className="edited-mark">изменено</span>}
                      <time>{message.time}</time>
                      {message.mine && (
                        <span
                          className={message.status >= Tinode.MESSAGE_STATUS_READ ? 'delivery-status read' : 'delivery-status'}
                          title={
                            message.status >= Tinode.MESSAGE_STATUS_READ
                              ? 'Прочитано'
                              : message.status >= Tinode.MESSAGE_STATUS_RECEIVED
                                ? 'Доставлено'
                                : 'Отправлено'
                          }
                        >
                          {statusMark(message.status)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {(replying || editingSeq) && (
              <div className="composer-context">
                <div>
                  <strong>{editingSeq ? 'Редактирование' : 'Ответ'}</strong>
                  <span>
                    {editingSeq
                      ? 'Измени текст и отправь снова'
                      : replying?.text}
                  </span>
                </div>
                <button type="button" onClick={cancelComposerMode}>×</button>
              </div>
            )}

            {uploadProgress !== null && (
              <div className="upload-progress">
                <div style={{ width: `${uploadProgress}%` }} />
                <span>Загрузка {uploadProgress}%</span>
              </div>
            )}

            {recording && (
              <div className="recording-bar">
                <span className="recording-dot" />
                <strong>Запись {recordingSeconds} сек.</strong>
                <button type="button" onClick={() => stopRecording(true)}>Отмена</button>
                <button type="button" className="recording-send" onClick={() => stopRecording(false)}>Отправить</button>
              </div>
            )}

            <form className="composer" onSubmit={sendMessage}>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden-file-input"
                onChange={(event) => sendAttachment(event.target.files?.[0])}
              />

              <button
                type="button"
                className="attach"
                title="Фото или файл"
                disabled={busy || recording}
                onClick={() => fileInputRef.current?.click()}
              >
                ＋
              </button>

              <input
                value={draft}
                onChange={handleDraftChange}
                placeholder={editingSeq ? 'Редактировать сообщение…' : 'Написать сообщение…'}
                disabled={busy || recording}
              />

              <button
                className={recording ? 'voice recording' : 'voice'}
                type="button"
                disabled={busy}
                title="Голосовое сообщение"
                onClick={recording ? () => stopRecording(false) : startRecording}
              >
                🎤
              </button>

              <button className="send" type="submit" disabled={busy || recording || !draft.trim()}>➤</button>
            </form>
          </>
        ) : (
          <section className="welcome-screen">
            <div className="welcome-logo">V</div>
            <h1>VisionChat</h1>

            {authorized ? (
              <>
                <p>Сервер подключён. Создай личный чат или группу.</p>
                <button className="welcome-primary" onClick={() => setNewChatOpen(true)}>
                  Новый чат
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

      {call && call.state !== 'incoming' && call.stream && (
        <CallPanel
          client={tinodeRef.current}
          call={call}
          title={chats.find((item) => item.topic === call.topic)?.name || 'VisionChat'}
          registerInfoHandler={registerCallInfoHandler}
          onHangup={hangupCall}
          onRemoteEnd={closeCallLocal}
          onError={setAuthError}
        />
      )}

      {call?.state === 'incoming' && (
        <div className="modal-backdrop call-incoming-backdrop">
          <div className="incoming-call-card">
            <div className="incoming-pulse">
              {(chats.find((item) => item.topic === call.topic)?.name || 'V').slice(0, 1).toUpperCase()}
            </div>
            <span>{call.audioOnly ? 'Входящий аудиозвонок' : 'Входящий видеозвонок'}</span>
            <h2>{chats.find((item) => item.topic === call.topic)?.name || 'VisionChat user'}</h2>
            <div className="incoming-call-actions">
              <button type="button" className="reject-call" onClick={rejectIncomingCall}>Отклонить</button>
              <button type="button" className="accept-call" onClick={acceptIncomingCall} disabled={busy}>
                {busy ? 'Подключение…' : 'Принять'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div className="modal-backdrop" onMouseDown={resetNewChat}>
          <div className="auth-card user-search-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="auth-logo">{newChatMode === 'group' ? '👥' : '＋'}</div>
            <h2>{newChatMode === 'group' ? 'Новая группа' : 'Новый чат'}</h2>
            <p>
              {newChatMode === 'group'
                ? 'Создай группу и добавь участников.'
                : 'Найди пользователя по логину, email или ID.'}
            </p>

            <div className="auth-tabs new-chat-tabs">
              <button
                className={newChatMode === 'person' ? 'active' : ''}
                onClick={() => {
                  setNewChatMode('person');
                  setSearchError('');
                }}
              >
                Личный
              </button>
              <button
                className={newChatMode === 'group' ? 'active' : ''}
                onClick={() => {
                  setNewChatMode('group');
                  setSearchError('');
                }}
              >
                Группа
              </button>
            </div>

            {newChatMode === 'group' && (
              <label>
                Название группы
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Например, Support Team"
                />
              </label>
            )}

            {groupMembers.length > 0 && newChatMode === 'group' && (
              <div className="selected-members">
                {groupMembers.map((member) => (
                  <button type="button" key={member.user} onClick={() => toggleGroupMember(member)}>
                    {member.name} ×
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={searchUsers}>
              <label>
                Поиск пользователей
                <input
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="например alex"
                  autoFocus={newChatMode === 'person'}
                />
              </label>
              <button className="primary" type="submit" disabled={searchBusy || !userQuery.trim()}>
                {searchBusy ? 'Ищем…' : 'Найти'}
              </button>
            </form>

            {searchError && <div className="auth-error">{searchError}</div>}

            <div className="search-results">
              {userResults.map((user) => {
                const selectedMember = groupMembers.some((member) => member.user === user.user);
                return (
                  <button
                    key={user.user}
                    className={selectedMember ? 'search-result selected' : 'search-result'}
                    onClick={() => newChatMode === 'group' ? toggleGroupMember(user) : startChatWith(user.user)}
                    type="button"
                  >
                    <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <strong>{user.name}</strong>
                      <span>{user.user}</span>
                    </div>
                    {newChatMode === 'group' && (
                      <b className="member-check">{selectedMember ? '✓' : '+'}</b>
                    )}
                  </button>
                );
              })}

              {!searchBusy && userQuery && userResults.length === 0 && !searchError && (
                <div className="search-placeholder">Нажми «Найти» для поиска по серверу.</div>
              )}
            </div>

            {newChatMode === 'group' && (
              <button
                className="primary group-create-button"
                type="button"
                disabled={busy || !groupName.trim()}
                onClick={createGroup}
              >
                {busy ? 'Создаём…' : `Создать группу${groupMembers.length ? ` (${groupMembers.length})` : ''}`}
              </button>
            )}

            <button className="ghost" type="button" onClick={resetNewChat}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
