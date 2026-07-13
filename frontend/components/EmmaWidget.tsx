'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startCallSession,
  logTranscriptLine,
  emailTranscript,
  emailTranscriptToCaller,
} from '@/lib/api';
import { connectRealtime, type RealtimeConnection } from '@/lib/realtime';

interface TranscriptLine {
  who: 'Emma' | 'You';
  text: string;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mins = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

export default function EmmaWidget() {
  const [callActive, setCallActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [statusText, setStatusText] = useState('Ready for your call');
  const [callStateText, setCallStateText] = useState('Call not started');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [compatMessage, setCompatMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [typedReply, setTypedReply] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [callerEmailStatus, setCallerEmailStatus] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle');
  const [callerEmailError, setCallerEmailError] = useState('');

  const sessionIdRef = useRef<string | null>(null);
  const connectionRef = useRef<RealtimeConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startInFlightRef = useRef(false);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }, []);

  const appendLine = useCallback((who: 'Emma' | 'You', text: string) => {
    setTranscript((prev) => [...prev, { who, text }]);
    if (sessionIdRef.current) {
      logTranscriptLine(sessionIdRef.current, who === 'Emma' ? 'emma' : 'caller', text);
    }
  }, []);

  const setStatus = useCallback((text: string, isSpeaking = false) => {
    setCallStateText(text);
    setStatusText(text);
    setSpeaking(isSpeaking);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const endCall = useCallback(() => {
    const wasActive = callActive;
    const endedSessionId = sessionIdRef.current;
    setCallActive(false);
    setConnecting(false);
    stopTimer();
    clearReconnectTimeout();

    connectionRef.current?.close();
    connectionRef.current = null;

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    setStatus('Call ended');
    if (wasActive) {
      appendLine('Emma', 'Thanks for calling. Have a great day.');
      // Internal backup copy for every enquiry, sent automatically the moment
      // the call ends - best-effort, same as transcript line logging. The
      // manual "Email this transcript" button below still works as a resend.
      if (endedSessionId) {
        emailTranscript(endedSessionId)
          .then(() => setEmailStatus('sent'))
          .catch(() => {
            /* automatic send is best-effort; the manual button can retry */
          });
      }
    }
  }, [callActive, appendLine, setStatus, stopTimer, clearReconnectTimeout]);

  useEffect(() => {
    return () => {
      connectionRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      stopTimer();
      clearReconnectTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCall = useCallback(async () => {
    // React state (callActive/connecting) updates asynchronously, so a fast
    // double-click on the button could theoretically slip two calls of this
    // function through before the button actually disables. That would mint
    // two sessions and briefly hold two live mic streams/connections at once.
    // This ref is set synchronously and closes that gap.
    if (callActive || connecting || startInFlightRef.current) return;
    startInFlightRef.current = true;
    setCompatMessage('');
    setErrorMessage('');
    setConnecting(true);
    setTranscript([]);
    setEmailStatus('idle');
    setCallerEmailStatus('idle');
    setCallerEmailError('');
    setStatus('Connecting…');

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = mic;

      const session = await startCallSession();
      sessionIdRef.current = session.sessionId;

      if (!audioElRef.current) throw new Error('Audio element not ready.');

      const connection = await connectRealtime(
        session.sessionId,
        session.clientSecret,
        mic,
        audioElRef.current,
        {
          onEmmaTextDone: (text) => appendLine('Emma', text),
          onCallerTextDone: (text) => appendLine('You', text),
          onEmmaSpeakingChange: (isSpeaking) => {
            setSpeaking(isSpeaking);
            setStatus(isSpeaking ? 'Emma is speaking' : 'Listening…', isSpeaking);
          },
          onConnectionStateChange: (state) => {
            // WebRTC's 'disconnected' state is often transient (a brief network
            // hiccup that self-recovers within a few seconds) - hanging up on it
            // immediately caused calls to drop and "restart" on ordinary network
            // jitter. But 'disconnected' can also persist indefinitely without
            // ever reaching 'failed', so give it a grace window to self-recover
            // and force a hangup if it doesn't - otherwise the call just goes
            // silent forever with no way to tell it has died.
            if (state === 'disconnected') {
              setStatus('Reconnecting…');
              clearReconnectTimeout();
              reconnectTimeoutRef.current = setTimeout(() => {
                setErrorMessage('The call connection dropped. Please try again.');
                endCall();
              }, 8000);
            } else if (state === 'failed') {
              clearReconnectTimeout();
              setErrorMessage('The call connection dropped. Please try again.');
              endCall();
            } else if (state === 'connected') {
              clearReconnectTimeout();
              setStatus('Listening…');
            }
          },
          onError: (message) => setErrorMessage(message),
        }
      );
      connectionRef.current = connection;

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 500);

      setCallActive(true);
      setConnecting(false);
      setStatus('Listening…');
    } catch (error) {
      setConnecting(false);
      const message = error instanceof Error ? error.message : 'Could not start the call.';
      if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')) {
        setCompatMessage(
          'Microphone access was not granted. Please allow microphone access and try again, or use the reply box below.'
        );
      } else {
        setErrorMessage(message);
      }
      setStatus('Ready for your call');
    } finally {
      startInFlightRef.current = false;
    }
  }, [callActive, connecting, appendLine, setStatus, endCall, clearReconnectTimeout]);

  const submitTypedReply = useCallback(() => {
    const value = typedReply.trim();
    if (!value || !callActive || !connectionRef.current) return;
    setTypedReply('');
    appendLine('You', value);

    const { dataChannel } = connectionRef.current;
    dataChannel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: value }],
        },
      })
    );
    dataChannel.send(JSON.stringify({ type: 'response.create' }));
  }, [typedReply, callActive, appendLine]);

  const handleEmailTranscript = useCallback(async () => {
    if (!sessionIdRef.current || emailStatus === 'sending') return;
    setEmailStatus('sending');
    try {
      await emailTranscript(sessionIdRef.current);
      setEmailStatus('sent');
    } catch {
      setEmailStatus('error');
    }
  }, [emailStatus]);

  const handleEmailCallerTranscript = useCallback(async () => {
    if (!sessionIdRef.current || callerEmailStatus === 'sending') return;
    setCallerEmailStatus('sending');
    setCallerEmailError('');
    try {
      await emailTranscriptToCaller(sessionIdRef.current);
      setCallerEmailStatus('sent');
    } catch (error) {
      setCallerEmailStatus('error');
      setCallerEmailError(
        error instanceof Error ? error.message : 'Could not send the transcript email.'
      );
    }
  }, [callerEmailStatus]);

  const waveActive = callActive && speaking;
  const timerLabel = formatTime(elapsedMs);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand" />
        <div className="secure">
          <span className="secure-dot" /> Live voice demo · OpenAI Realtime
        </div>
      </header>

      <section className="card">
        <div className="visual">
          <div className="avatar-wrap">
            <div className={`avatar-ring${waveActive ? ' active' : ''}`} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="avatar" alt="Emma, GLG AI Receptionist" src="/emma-avatar.png" />
          </div>
          <h1>Emma</h1>
          <h2>AI RECEPTIONIST</h2>
          <p>
            Friendly, professional support for enquiries, lead qualification and appointment
            bookings — available 24/7.
          </p>
          <div className={`status-pill${errorMessage ? ' state-error' : callActive ? ' state-live' : ''}`}>
            {statusText}
          </div>
        </div>

        <div className="console">
          <div className="eyebrow">LIVE WEB CALL DEMO</div>
          <h3>Speak with Emma directly from your browser.</h3>
          <p className="intro">
            No phone number required. Allow microphone access, then speak naturally. Emma will
            answer questions, learn about your business and help arrange a strategy session.
          </p>

          <div className="call-panel">
            <div className="call-head">
              <span className="call-state">{callStateText}</span>
              <span className="timer">{timerLabel}</span>
            </div>
            <div className={`wave${waveActive ? ' active' : ''}`} aria-hidden="true">
              {Array.from({ length: 7 }).map((_, i) => (
                <span className="bar" key={i} />
              ))}
            </div>
            <div className="controls">
              <button
                className="call-btn"
                type="button"
                disabled={callActive || connecting}
                onClick={startCall}
              >
                {connecting ? 'Connecting…' : callActive ? 'Call in progress' : 'Start web call'}
              </button>
              <button
                className={`end-btn${callActive ? ' show' : ''}`}
                type="button"
                onClick={endCall}
              >
                End call
              </button>
            </div>
            <div className="permission">
              Your browser will ask for microphone permission. For best results, use Chrome or
              Edge on desktop or Android.
            </div>
            <div className="text-fallback">
              <input
                type="text"
                placeholder="Type a reply at any time"
                autoComplete="off"
                value={typedReply}
                onChange={(e) => setTypedReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitTypedReply();
                }}
              />
              <button type="button" onClick={submitTypedReply}>
                Send
              </button>
            </div>
            <div className="fallback-note">
              Emma still speaks aloud. This fallback keeps the demo testable everywhere, including
              browsers without full WebRTC audio support.
            </div>
            {(compatMessage || errorMessage) && (
              <div className="compat show">{compatMessage || errorMessage}</div>
            )}
          </div>

          <div className="transcript" aria-live="polite">
            {transcript.length === 0 ? (
              <div className="empty">Your live conversation transcript will appear here after the call begins.</div>
            ) : (
              transcript.map((line, i) => (
                <div className={`message${line.who === 'You' ? ' user' : ''}`} key={i}>
                  <span className="speaker">{line.who}</span>
                  <div className="bubble">{line.text}</div>
                </div>
              ))
            )}
          </div>
          {transcript.length > 0 && (
            <div className="email-backup">
              <button
                type="button"
                onClick={handleEmailCallerTranscript}
                disabled={callerEmailStatus === 'sending' || callerEmailStatus === 'sent'}
              >
                {callerEmailStatus === 'sending'
                  ? 'Sending…'
                  : callerEmailStatus === 'sent'
                    ? 'Sent to your email ✓'
                    : 'Email me this conversation'}
              </button>
              <button
                type="button"
                onClick={handleEmailTranscript}
                disabled={emailStatus === 'sending' || emailStatus === 'sent'}
              >
                {emailStatus === 'sending'
                  ? 'Sending…'
                  : emailStatus === 'sent'
                    ? 'Emailed ✓'
                    : 'Email this transcript as a backup'}
              </button>
              {callerEmailStatus === 'error' && (
                <span className="email-backup-error">{callerEmailError}</span>
              )}
              {emailStatus === 'error' && (
                <span className="email-backup-error">Could not send the email. Try again.</span>
              )}
            </div>
          )}
          <div className="privacy">
            This call runs on OpenAI&apos;s Realtime API for voice and GoHighLevel for CRM, SMS
            and email follow-up. Audio is processed live and is not stored by this page.
          </div>
        </div>
      </section>

      {/* Hidden element that plays Emma's live voice coming back over WebRTC. */}
      <audio ref={audioElRef} autoPlay style={{ display: 'none' }} />
    </main>
  );
}
