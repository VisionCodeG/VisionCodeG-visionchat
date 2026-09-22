/*
 * VisionChat WebRTC call panel.
 * Signaling flow is adapted from Tinode Web's CallPanel (Apache-2.0).
 * This file is modified for VisionChat.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function CallPanel({
  client,
  call,
  title,
  registerInfoHandler,
  onHangup,
  onRemoteEnd,
  onError,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pcRef = useRef(null);
  const pendingIceRef = useRef([]);
  const setupCompleteRef = useRef(false);
  const makingOfferRef = useRef(false);

  const [remoteStream, setRemoteStream] = useState(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(!call.audioOnly);
  const [connectionState, setConnectionState] = useState(
    call.state === 'outgoing' ? 'Вызов…' : 'Соединение…',
  );

  const topic = client?.getTopic(call.topic);

  const sendSignal = useCallback((event, payload) => {
    if (!topic || !call.seq) return;
    try {
      topic.videoCall(event, call.seq, payload);
    } catch (err) {
      onError?.(err?.message || 'Ошибка сигналинга звонка');
    }
  }, [call.seq, onError, topic]);

  const drainIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;

    const pending = pendingIceRef.current.splice(0);
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (candidate?.candidate) {
          onError?.(err?.message || 'Ошибка ICE');
        }
      }
    }
  }, [onError]);

  const createPeer = useCallback(() => {
    if (pcRef.current) return pcRef.current;

    const iceServers = client?.getServerParam?.('iceServers', null);
    const pc = iceServers
      ? new RTCPeerConnection({ iceServers })
      : new RTCPeerConnection();

    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('ice-candidate', event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      setRemoteStream(stream);
      setConnectionState('В разговоре');

      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          setConnectionState('В разговоре');
          break;
        case 'connecting':
          setConnectionState('Соединение…');
          break;
        case 'failed':
          onError?.('WebRTC соединение не установлено');
          onRemoteEnd?.();
          break;
        case 'closed':
          setConnectionState('Звонок завершён');
          break;
        default:
          break;
      }
    };

    pc.onnegotiationneeded = async () => {
      if (call.direction !== 'outgoing' || makingOfferRef.current) return;
      makingOfferRef.current = true;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal('offer', pc.localDescription.toJSON());
      } catch (err) {
        onError?.(err?.message || 'Не удалось создать WebRTC offer');
      } finally {
        makingOfferRef.current = false;
      }
    };

    return pc;
  }, [call.direction, client, onError, onRemoteEnd, sendSignal]);

  const addLocalTracks = useCallback((pc) => {
    const stream = call.stream;
    if (!pc || !stream) return;

    const existing = new Set(
      pc.getSenders().map((sender) => sender.track?.id).filter(Boolean),
    );

    stream.getTracks().forEach((track) => {
      if (!existing.has(track.id)) {
        pc.addTrack(track, stream);
      }
    });
  }, [call.stream]);

  const startCallerPeer = useCallback(() => {
    const pc = createPeer();
    addLocalTracks(pc);
  }, [addLocalTracks, createPeer]);

  const handleOffer = useCallback(async (info) => {
    try {
      const pc = createPeer();
      await pc.setRemoteDescription(new RTCSessionDescription(info.payload));
      addLocalTracks(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal('answer', pc.localDescription.toJSON());

      setupCompleteRef.current = true;
      await drainIce();
    } catch (err) {
      onError?.(err?.message || 'Не удалось принять WebRTC offer');
    }
  }, [addLocalTracks, createPeer, drainIce, onError, sendSignal]);

  const handleAnswer = useCallback(async (info) => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(info.payload));
      setupCompleteRef.current = true;
      await drainIce();
    } catch (err) {
      onError?.(err?.message || 'Не удалось применить WebRTC answer');
    }
  }, [drainIce, onError]);

  const handleIce = useCallback(async (info) => {
    if (!info?.payload) return;
    const candidate = new RTCIceCandidate(info.payload);
    const pc = pcRef.current;

    if (pc && setupCompleteRef.current && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (candidate.candidate) onError?.(err?.message || 'Ошибка ICE candidate');
      }
    } else {
      pendingIceRef.current.push(candidate);
    }
  }, [onError]);

  const handleInfo = useCallback((info) => {
    if (!info || info.what !== 'call' || info.topic !== call.topic) return;

    switch (info.event) {
      case 'accept':
        if (call.direction === 'outgoing') {
          setConnectionState('Соединение…');
          startCallerPeer();
        }
        break;
      case 'offer':
        handleOffer(info);
        break;
      case 'answer':
        handleAnswer(info);
        break;
      case 'ice-candidate':
        handleIce(info);
        break;
      case 'ringing':
        setConnectionState('Звонит…');
        break;
      case 'hang-up':
        onRemoteEnd?.();
        break;
      default:
        break;
    }
  }, [call.direction, call.topic, handleAnswer, handleIce, handleOffer, onRemoteEnd, startCallerPeer]);

  useEffect(() => {
    registerInfoHandler?.(handleInfo);
    return () => registerInfoHandler?.(null);
  }, [handleInfo, registerInfoHandler]);

  useEffect(() => {
    if (localVideoRef.current && call.stream) {
      localVideoRef.current.srcObject = call.stream;
    }
  }, [call.stream]);

  useEffect(() => {
    if (remoteStream) {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (call.state === 'active' && call.direction === 'outgoing') {
      startCallerPeer();
    }
  }, [call.direction, call.state, startCallerPeer]);

  useEffect(() => () => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.onnegotiationneeded = null;
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  function toggleMic() {
    const track = call.stream?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
  }

  function toggleCamera() {
    if (call.audioOnly) return;
    const track = call.stream?.getVideoTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
  }

  const remoteHasVideo = Boolean(
    !call.audioOnly && remoteStream?.getVideoTracks?.().some((track) => track.readyState === 'live'),
  );

  return (
    <div className="call-overlay">
      <div className="call-window">
        <div className="call-topbar">
          <div>
            <strong>{title || 'VisionChat call'}</strong>
            <span>{connectionState}</span>
          </div>
          <div className="call-kind">{call.audioOnly ? 'Аудио' : 'Видео'}</div>
        </div>

        <div className={call.audioOnly ? 'call-stage audio-only' : 'call-stage'}>
          {!call.audioOnly && (
            <div className="call-local">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <span>Вы</span>
            </div>
          )}

          <div className="call-remote">
            {remoteHasVideo ? (
              <video ref={remoteVideoRef} autoPlay playsInline />
            ) : (
              <>
                <audio ref={remoteAudioRef} autoPlay />
                <div className="call-avatar">{(title || 'V').slice(0, 1).toUpperCase()}</div>
                <strong>{title || 'Собеседник'}</strong>
              </>
            )}
          </div>
        </div>

        <div className="call-controls">
          <button
            type="button"
            className={micEnabled ? '' : 'off'}
            onClick={toggleMic}
            title={micEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
          >
            {micEnabled ? '🎤' : '🔇'}
          </button>

          <button
            type="button"
            disabled={call.audioOnly}
            className={cameraEnabled ? '' : 'off'}
            onClick={toggleCamera}
            title={cameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
          >
            {cameraEnabled ? '📹' : '🚫'}
          </button>

          <button type="button" className="hangup" onClick={onHangup} title="Завершить звонок">
            ☎
          </button>
        </div>
      </div>
    </div>
  );
}
