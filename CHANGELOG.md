# Changelog do JustCast

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

## [Unreleased]

### [Adicionado]

- Conexão e integração do frontend com o servidor de sinalização Socket.io em `http://localhost:3001`.
- Lógica completa do botão "Assistir": entrada na sala, inicialização de `RTCPeerConnection`, recebimento de Offer e envio de Answer via WebRTC.
- Mecanismo de troca de ICE Candidates entre transmissor e espectador via Socket.io com fila assíncrona de candidatos para garantir conexão direta P2P estável.
- Exibição e reprodução automática do stream de vídeo recebido via P2P na tag `<video>` do espectador.
- Feedback visual do status da conexão WebRTC (negociação, conexão P2P estabelecida, desconexão) e opção de encerrar a visualização.
- Inicialização da estrutura base do projeto (Frontend Next.js e Backend Node.js).
- Configuração das regras do Antigravity (.cursorrules).

### [Alterado]

- Configuração do Next.js definida em `frontend/next.config.mjs` com a inclusão de `devIndicators: { buildActivity: false, appIsrStatus: false }` no objeto `nextConfig` para ocultar os indicadores de desenvolvimento no ecrã.
- Função "Transmitir Tela" em `frontend/app/page.tsx`: agora gera e transmite a Offer WebRTC via Socket.io após a captura de tela (`getDisplayMedia`) e responde dinamicamente à entrada de novos espectadores na sala.
- Elemento de `<video>` ajustado para manter áudio mutado no transmissor (evitando microfonia/feedback local) e habilitar reprodução de áudio e controles interativos no espectador.
- Botões de ação da interface para alternar dinamicamente entre transmitir/parar transmissão e assistir/parar visualização.

### [Removido]

- Arquivo `frontend/next.config.ts` substituído por `frontend/next.config.mjs`.

### [Corrigido]

- Correção de chamada de estado síncrono dentro do hook `useEffect` na leitura do parâmetro `?room=` da URL, adequando o componente às regras do React 19 / ESLint.
