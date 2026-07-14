import {
  saveLeadDetails,
  getAvailableSlots,
  bookAppointment,
  submitLeadToCrm,
} from './api';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export interface RealtimeHandlers {
  onEmmaTextDone?: (text: string) => void;
  onCallerTextDone?: (text: string) => void;
  onEmmaSpeakingChange?: (speaking: boolean) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (message: string) => void;
}

export interface RealtimeConnection {
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  close: () => void;
}

/**
 * Opens a direct browser <-> OpenAI WebRTC connection using an ephemeral
 * client secret minted by our backend. Audio flows peer-to-peer between the
 * browser and OpenAI; only tool calls and transcript lines are relayed to
 * our own backend (see dispatchToolCall below).
 */
export async function connectRealtime(
  sessionId: string,
  clientSecret: string,
  micStream: MediaStream,
  remoteAudioEl: HTMLAudioElement,
  handlers: RealtimeHandlers
): Promise<RealtimeConnection> {
  const pc = new RTCPeerConnection();

  pc.onconnectionstatechange = () => {
    handlers.onConnectionStateChange?.(pc.connectionState);
  };

  pc.ontrack = (event) => {
    remoteAudioEl.srcObject = event.streams[0];
    remoteAudioEl.play().catch(() => {
      /* Autoplay can be blocked until a user gesture; the "Start web call"
         click that triggered this whole flow already counts as one, so this
         should succeed in practice. */
    });
  };

  micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

  const dataChannel = pc.createDataChannel('oai-events');
  wireDataChannel(sessionId, dataChannel, handlers);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI Realtime handshake failed (${response.status}): ${detail}`);
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  } catch (error) {
    // Never leave a half-negotiated RTCPeerConnection dangling with a live mic
    // track attached - a failed handshake here previously left the connection
    // (and the mic) open, which could poison the next attempt from the same tab.
    try {
      dataChannel.close();
    } catch {
      /* noop */
    }
    pc.getSenders().forEach((sender) => sender.track?.stop());
    pc.close();
    throw error;
  }

  return {
    peerConnection: pc,
    dataChannel,
    close: () => {
      try {
        dataChannel.close();
      } catch {
        /* noop */
      }
      pc.getSenders().forEach((sender) => sender.track?.stop());
      pc.close();
    },
  };
}

function wireDataChannel(sessionId: string, dc: RTCDataChannel, handlers: RealtimeHandlers) {
  // Emma sometimes calls multiple tools (e.g. save_lead_details several times
  // while recapping) within a single model turn. Each function call's output
  // must be submitted, but response.create must only be sent ONCE after all
  // of them land - calling it per-tool-call caused overlapping responses that
  // sounded like Emma interrupting herself. This array collects the in-flight
  // dispatch promises for the response currently being generated; response.done
  // (the model finishing that turn) is what flushes them into one response.create.
  const pendingToolDispatches: Promise<void>[] = [];

  dc.addEventListener('open', () => {
    // Prompt Emma to greet the caller immediately - with server_vad turn
    // detection there's nothing to trigger a first response otherwise.
    sendEvent(dc, {
      type: 'response.create',
      response: {
        instructions:
          'Greet the caller warmly as Emma from Golden Lead Generation. Introduce yourself in one short sentence and ask how you can help today.',
      },
    });
  });

  dc.addEventListener('message', (event) => {
    let payload: any;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    handleRealtimeEvent(sessionId, dc, payload, handlers, pendingToolDispatches);
  });

  dc.addEventListener('error', () => {
    handlers.onError?.('Realtime data channel error.');
  });
}

function sendEvent(dc: RTCDataChannel, event: unknown) {
  if (dc.readyState !== 'open') return;
  dc.send(JSON.stringify(event));
}

async function handleRealtimeEvent(
  sessionId: string,
  dc: RTCDataChannel,
  event: any,
  handlers: RealtimeHandlers,
  pendingToolDispatches: Promise<void>[]
) {
  // Full wire log for diagnosing call issues - open the browser console during
  // a call and filter on "[realtime:event]" to see every server event in order.
  // Using console.log (not .debug) since Chrome hides Verbose-level logs by
  // default and .debug output was silently missing from exported logs.
  console.log('[realtime:event]', event.type, JSON.stringify(event));

  switch (event.type) {
    // Current GA models emit `response.output_audio_transcript.done`; older
    // preview models used `response.audio_transcript.done`. Handle both so
    // Emma's transcript line always renders regardless of model generation.
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done':
      if (event.transcript) handlers.onEmmaTextDone?.(event.transcript);
      break;

    case 'conversation.item.input_audio_transcription.completed':
      if (event.transcript) handlers.onCallerTextDone?.(event.transcript);
      break;

    case 'output_audio_buffer.started':
      handlers.onEmmaSpeakingChange?.(true);
      break;

    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      handlers.onEmmaSpeakingChange?.(false);
      break;

    case 'response.function_call_arguments.done':
      // Don't await here - the response may include several parallel tool
      // calls, and awaiting each in turn would delay dispatching the rest.
      pendingToolDispatches.push(dispatchToolCall(sessionId, dc, event));
      break;

    case 'response.done':
      // A failed/cancelled response (rate limits, quota, content filters, etc.)
      // arrives here, not as a top-level 'error' event - previously this was
      // silently swallowed, so Emma would just go quiet with no on-screen
      // indication of why. Surface it so a real failure is never invisible.
      if (event.response?.status === 'failed') {
        const detail = event.response?.status_details?.error?.message;
        handlers.onError?.(detail ?? 'Emma could not generate a response.');
        break;
      }
      if (pendingToolDispatches.length > 0) {
        const dispatches = pendingToolDispatches.splice(0, pendingToolDispatches.length);
        await Promise.all(dispatches);
        sendEvent(dc, { type: 'response.create' });
      }
      break;

    case 'error':
      handlers.onError?.(event.error?.message ?? 'Realtime session error.');
      break;

    default:
      break;
  }
}

/**
 * Executes a tool call the model requested (by hitting our backend, which
 * holds the GHL/calendar credentials) and reports the result back to the
 * model so the conversation can continue.
 */
async function dispatchToolCall(sessionId: string, dc: RTCDataChannel, event: any) {
  const { name, call_id: callId, arguments: rawArgs } = event;
  let args: Record<string, any> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    args = {};
  }

  let output: unknown;
  try {
    switch (name) {
      case 'save_lead_details':
        output = await saveLeadDetails(sessionId, args);
        break;
      case 'get_available_demo_slots':
        output = await getAvailableSlots(sessionId, args.daysAhead);
        break;
      case 'book_demo_appointment':
        output = await bookAppointment(sessionId, args.slotNumber);
        break;
      case 'submit_lead_to_crm':
        output = await submitLeadToCrm(sessionId);
        break;
      default:
        output = { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    output = { error: error instanceof Error ? error.message : 'Tool call failed.' };
  }

  sendEvent(dc, {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output),
    },
  });
}
