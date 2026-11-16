"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import io, { Socket } from "socket.io-client";

// URL do servidor de sinalização Socket.io
const socket = io("https://justcast-backend.onrender.com");

// Configuração dos servidores STUN públicos para negociação de ICE Candidates
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Armazena o ID do socket remoto conectado (espectador ou transmissor)
  const remotePeerIdRef = useRef<string | null>(null);

  // Fila para guardar ICE Candidates que chegam antes de setRemoteDescription
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Refs para evitar problemas de stale closure nos callbacks do Socket
  const roomIdRef = useRef(roomId);
  const isStreamingRef = useRef(isStreaming);
  const isWatchingRef = useRef(isWatching);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    isWatchingRef.current = isWatching;
  }, [isWatching]);

  // Lê parâmetro "room" da URL de forma assíncrona para compatibilidade com SSR e ESLint
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      queueMicrotask(() => setRoomId(room));
    }
  }, []);

  /**
   * Adiciona ICE candidate de forma segura à conexão RTCPeerConnection.
   * Se a descrição remota ainda não estiver pronta, enfileira o candidato.
   */
  const addIceCandidateSafe = useCallback(async (pc: RTCPeerConnection, candidate: RTCIceCandidateInit) => {
    try {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        queuedCandidatesRef.current.push(candidate);
      }
    } catch (err) {
      console.error("[WebRTC] Erro ao adicionar ICE Candidate:", err);
    }
  }, []);

  /**
   * Descarrega todos os candidatos ICE que estavam aguardando o setRemoteDescription.
   */
  const drainQueuedCandidates = useCallback(async (pc: RTCPeerConnection) => {
    while (queuedCandidatesRef.current.length > 0) {
      const candidate = queuedCandidatesRef.current.shift();
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("[WebRTC] Erro ao descarregar ICE Candidate acumulado:", err);
        }
      }
    }
  }, []);

  /**
   * Cria e configura uma RTCPeerConnection para o espectador (Assistir).
   */
  const createViewerPeer = useCallback((broadcasterSocketId?: string) => {
    if (peerRef.current) {
      peerRef.current.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = pc;

    if (broadcasterSocketId) {
      remotePeerIdRef.current = broadcasterSocketId;
    }

    // Quando o stream de mídia remota chegar via P2P
    pc.ontrack = (event) => {
      console.log("[WebRTC Assistir] Stream remoto recebido via P2P:", event.streams);
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = false;
          videoRef.current.play().catch((err) => {
            console.warn("[Video] Autoplay com áudio bloqueado pelo navegador, mutando:", err);
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().catch(console.error);
            }
          });
        }
        setHasRemoteStream(true);
        setStatusMessage("P2P conectado! Exibindo transmissão.");
      }
    };

    // Troca de ICE Candidates para encontrar rota direta P2P
    pc.onicecandidate = (event) => {
      if (event.candidate && remotePeerIdRef.current) {
        socketRef.current?.emit("ice-candidate", {
          target: remotePeerIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC Assistir] Estado da conexão:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatusMessage("Conexão P2P estabelecida!");
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        setHasRemoteStream(false);
        setStatusMessage("Transmissão encerrada ou conexão P2P perdida.");
      }
    };

    return pc;
  }, []);

  /**
   * Cria e configura uma RTCPeerConnection para o transmissor (Transmitir Tela).
   */
  const createBroadcasterPeer = useCallback((targetSocketId: string, stream: MediaStream) => {
    if (peerRef.current) {
      peerRef.current.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = pc;
    remotePeerIdRef.current = targetSocketId;

    // Adiciona todas as faixas do stream de tela à conexão P2P
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Envio dos ICE Candidates gerados localmente para o espectador
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", {
          target: targetSocketId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC Transmissor] Estado da conexão:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatusMessage("P2P conectado! Transmitindo tela com sucesso.");
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        setStatusMessage("Espectador desconectado.");
      }
    };

    return pc;
  }, []);

  // Conecta ao servidor de sinalização Socket.io e registra ouvintes globais
  useEffect(() => {
    const socket: Socket = io(SIGNALING_SERVER_URL, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket.io] Conectado ao servidor JustCast:", socket.id);
    });

    /**
     * Quando outro usuário se conecta à sala:
     * - Se formos o transmissor com tela ativa, geramos a Offer e enviamos para ele.
     * - Se formos o espectador aguardando, re-emitimos join-room para que ele saiba da nossa presença.
     */
    socket.on("user-connected", async (userId: string) => {
      console.log("[Socket] Novo usuário na sala:", userId);

      if (isStreamingRef.current && localStreamRef.current) {
        console.log("[WebRTC Transmissor] Gerando Offer para novo espectador:", userId);
        const pc = createBroadcasterPeer(userId, localStreamRef.current);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("offer", {
            target: userId,
            caller: socket.id,
            sdp: offer,
          });
          setStatusMessage("Negociando conexão P2P com espectador...");
        } catch (err) {
          console.error("[WebRTC] Erro ao criar Offer para novo espectador:", err);
        }
      } else if (isWatchingRef.current && !remotePeerIdRef.current) {
        // Notifica o novo usuário (transmissor) que estamos nesta sala
        socket.emit("join-room", roomIdRef.current);
      }
    });

    /**
     * Quando o espectador recebe uma Offer do transmissor:
     * Configura a descrição remota, cria a Answer e a envia de volta pelo socket.
     */
    socket.on("offer", async (payload: { target: string; caller: string; sdp: RTCSessionDescriptionInit }) => {
      // Ignora ofertas emitidas pelo próprio socket
      if (payload.caller === socket.id) return;
      if (isStreamingRef.current) return;

      console.log("[WebRTC Assistir] Offer recebida de:", payload.caller);
      remotePeerIdRef.current = payload.caller;

      let pc = peerRef.current;
      if (!pc || pc.signalingState === "closed") {
        pc = createViewerPeer(payload.caller);
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await drainQueuedCandidates(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("answer", {
          target: payload.caller,
          caller: socket.id,
          sdp: answer,
        });

        console.log("[WebRTC Assistir] Answer enviada para:", payload.caller);
        setStatusMessage("Answer enviada. Conectando P2P...");
      } catch (err) {
        console.error("[WebRTC] Erro ao processar Offer e enviar Answer:", err);
      }
    });

    /**
     * Quando o transmissor recebe a Answer do espectador:
     * Aplica a descrição remota e finaliza o aperto de mão (handshake) WebRTC.
     */
    socket.on("answer", async (payload: { target: string; caller: string; sdp: RTCSessionDescriptionInit }) => {
      if (payload.caller === socket.id) return;
      console.log("[WebRTC Transmissor] Answer recebida de:", payload.caller);

      if (peerRef.current && peerRef.current.signalingState !== "stable") {
        try {
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await drainQueuedCandidates(peerRef.current);
          console.log("[WebRTC Transmissor] Descrição remota configurada com sucesso!");
        } catch (err) {
          console.error("[WebRTC] Erro ao aplicar Answer remota:", err);
        }
      }
    });

    /**
     * Quando chega um ICE candidate pela sinalização:
     */
    socket.on("ice-candidate", async (candidate: RTCIceCandidateInit) => {
      if (!candidate) return;
      if (peerRef.current) {
        await addIceCandidateSafe(peerRef.current, candidate);
      } else {
        queuedCandidatesRef.current.push(candidate);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [createBroadcasterPeer, createViewerPeer, drainQueuedCandidates, addIceCandidateSafe]);

  /**
   * Ação do botão "Transmitir Tela":
   * Captura a tela do usuário, conecta à sala, cria a Offer WebRTC e transmite via Socket.
   */
  const startScreenShare = async () => {
    if (!roomId.trim()) {
      alert("Por favor, digite um ID de Sala primeiro!");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: true,
      });

      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true; // Mudo localmente para evitar eco/feedback
      }

      setIsStreaming(true);
      isStreamingRef.current = true;
      setStatusMessage("Captura iniciada. Aguardando espectadores...");

      // Conecta à sala no Socket.io
      socketRef.current?.emit("join-room", roomId.trim());

      // Cria conexão WebRTC e emite Offer inicial para a sala
      const pc = createBroadcasterPeer(roomId.trim(), stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current?.emit("offer", {
        target: roomId.trim(),
        caller: socketRef.current.id,
        sdp: offer,
      });

      // Se o usuário clicar em "Interromper compartilhamento" nativo do navegador
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error("Erro ao partilhar a tela:", err);
      setStatusMessage("Compartilhamento cancelado ou não autorizado.");
    }
  };

  /**
   * Encerra a transmissão local e a conexão P2P.
   */
  const stopScreenShare = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsStreaming(false);
    isStreamingRef.current = false;
    remotePeerIdRef.current = null;
    setStatusMessage("");
  };

  /**
   * Ação do botão "Assistir":
   * Conecta o espectador à sala, cria a RTCPeerConnection e aguarda a Offer do transmissor.
   */
  const startWatching = () => {
    if (!roomId.trim()) {
      alert("Por favor, digite um ID de Sala primeiro!");
      return;
    }

    setIsWatching(true);
    isWatchingRef.current = true;
    setHasRemoteStream(false);
    setStatusMessage("Conectando à sala e aguardando transmissão...");

    // Entra na sala no servidor Socket.io
    socketRef.current?.emit("join-room", roomId.trim());

    // Cria a RTCPeerConnection receptora
    createViewerPeer();
  };

  /**
   * Encerra a visualização e fecha a conexão P2P do espectador.
   */
  const stopWatching = () => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsWatching(false);
    isWatchingRef.current = false;
    setHasRemoteStream(false);
    remotePeerIdRef.current = null;
    queuedCandidatesRef.current = [];
    setStatusMessage("");
  };

  const copyLink = () => {
    if (!roomId.trim()) return alert("Digite o ID da sala para gerar o link!");
    const url = `${window.location.origin}?room=${encodeURIComponent(roomId.trim())}`;
    navigator.clipboard.writeText(url);
    alert(`Link copiado: ${url}\n\nQuando seu amigo acessar, a sala já estará preenchida!`);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4 font-sans">
      {/* Cabeçalho */}
      <div className="text-center mb-10">
        <h1 className="text-5xl font-extrabold tracking-tight mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
          JustCast
        </h1>
        <p className="text-neutral-400">P2P Screen Sharing. Qualidade máxima, zero delay.</p>
      </div>

      {/* Painel de Controle */}
      <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800 shadow-xl w-full max-w-md">
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-neutral-400">ID da Sala</label>
              <button
                onClick={copyLink}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium cursor-pointer"
              >
                Copiar Link da Sala
              </button>
            </div>
            <input
              type="text"
              placeholder="ex: sala-do-loloco"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={isStreaming || isWatching}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            {!isWatching ? (
              <button
                onClick={startWatching}
                disabled={isStreaming}
                className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 transition font-medium rounded-lg px-4 py-3 cursor-pointer"
              >
                Assistir
              </button>
            ) : (
              <button
                onClick={stopWatching}
                className="bg-amber-600 hover:bg-amber-700 transition font-medium rounded-lg px-4 py-3 shadow-[0_0_15px_rgba(217,119,6,0.3)] cursor-pointer"
              >
                Parar de Assistir
              </button>
            )}

            {!isStreaming ? (
              <button
                onClick={startScreenShare}
                disabled={isWatching}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium rounded-lg px-4 py-3 shadow-[0_0_15px_rgba(37,99,235,0.3)] cursor-pointer"
              >
                Transmitir Tela
              </button>
            ) : (
              <button
                onClick={stopScreenShare}
                className="bg-red-600 hover:bg-red-700 transition font-medium rounded-lg px-4 py-3 shadow-[0_0_15px_rgba(220,38,38,0.3)] cursor-pointer"
              >
                Parar Transmissão
              </button>
            )}
          </div>

          {/* Mensagem de Status e Feedback em tempo real */}
          {statusMessage && (
            <div className="mt-2 text-center">
              <span className="text-xs text-neutral-400 bg-neutral-800/80 px-3 py-1 rounded-full border border-neutral-700">
                {statusMessage}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Área do Vídeo (Player) */}
      <div className="mt-10 w-full max-w-5xl aspect-video bg-black rounded-2xl border border-neutral-800 flex items-center justify-center overflow-hidden shadow-2xl relative">
        {/* Placeholder no centro quando não há transmissão ativa na tela */}
        {!isStreaming && !hasRemoteStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none p-4 text-center">
            <p className="text-neutral-500 font-medium text-lg">
              {isWatching ? statusMessage || "Aguardando o transmissor iniciar o stream..." : "A transmissão aparecerá aqui"}
            </p>
            {isWatching && roomId && (
              <span className="text-xs text-neutral-600 mt-2">Sala conectada: {roomId}</span>
            )}
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isStreaming}
          controls={isWatching && hasRemoteStream}
          className="w-full h-full object-contain z-0"
        />
      </div>
    </div>
  );
}
