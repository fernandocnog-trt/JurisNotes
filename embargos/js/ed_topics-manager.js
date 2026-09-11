/* ================================================
   topics-manager.js  —  v2.0
   Gerenciador do Fichário de Tópicos e Anotações
   ================================================ */
window.TopicsManager = (function () {
    'use strict';

    const romanoCache = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"];
    function obterRomano(idx) { return romanoCache[idx] || String(idx + 1); }

    // NOVA CAMADA DE CONFIGURAÇÃO: Dicionário Centralizado de Interface (ED)
    const ED_UI_LABELS = {
        alegacao: {
            titulo: "Vício Alegado (Escopo)",
            placeholder: "Clique para delimitar qual a omissão, contradição ou erro material apontado..."
        },
        origem: {
            titulo: "Decisão Embargada (Alvo)",
            placeholder: "Clique para redigir ou colar o trecho da decisão sob ataque..."
        },
        veredito: {
            titulo: "Veredito / Conclusão",
            placeholder: "Clique para definir se há o vício e o efeito modificativo (se houver)..."
        }
    };

    let _activeTopicoCor = '#ffffff';

    const _topicosComGlobaisAbertas = new Set();

    function _sincronizarBtnGlobais(temDados, aberto) {
        const btn = document.getElementById('btn-toggle-globais');
        if (!btn) return;
        
        const isAtivo = temDados || aberto;
        btn.classList.toggle('is-active', isAtivo);
        btn.setAttribute('aria-pressed', isAtivo ? 'true' : 'false');
        
        if (temDados) {
            btn.title = "Diretrizes Globais estão em uso (Trancado)";
        } else if (aberto) {
            btn.title = "Ocultar Diretrizes Globais (Vazio)";
        } else {
            btn.title = "Ativar Card de Diretrizes Globais";
        }
    }

    function toggleDiretrizesGlobais() {
        const activeId = activeTabId;
        if (!activeId) return;
        const topico = topicos.find(t => t.id === activeId);
        if (!topico) return;

        const temDiretrizes = topico.diretrizesGlobais && topico.diretrizesGlobais.length > 0;
        
        if (temDiretrizes) {
            if(window.exibirToast) exibirToast('Não é possível ocultar: existem diretrizes cadastradas. Remova-as primeiro.', 'aviso');
            return;
        }

        const ativando = !_topicosComGlobaisAbertas.has(activeId);
        
        if (ativando) {
            _topicosComGlobaisAbertas.add(activeId);
        } else {
            _topicosComGlobaisAbertas.delete(activeId);
        }
        
        renderizarFichario(topicos); 

        if (ativando) {
            requestAnimationFrame(() => {
                const globalCard = document.querySelector('.nivel-global .annotation-card');
                if (globalCard) {
                    const scrollContainer = document.getElementById('history-container');
                    const offset = (globalCard.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top) + scrollContainer.scrollTop - 40;
                    scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });
                    
                    globalCard.classList.remove('card-flash-focus');
                    void globalCard.offsetWidth;
                    globalCard.classList.add('card-flash-focus');
                }
            });
        }
    }
    
    function resetVisibilidadeGlobais() {
        _topicosComGlobaisAbertas.clear();
    }

    // Observer Otimizado (Debounce de ~16ms para agrupar Recalculate Styles)
    let _layoutDebounceTimer = null;
    const resizeObserver = new ResizeObserver(() => {
        clearTimeout(_layoutDebounceTimer);
        _layoutDebounceTimer = setTimeout(() => {
            requestAnimationFrame(() => {
                const container = document.getElementById('timeline-container');
                if (container) {
                    if (typeof posicionarNosDeIdeia === 'function') posicionarNosDeIdeia(container);
                    if (typeof desenharConexoes === 'function') requestAnimationFrame(() => desenharConexoes());
                }
            });
        }, 16); 
    });

    // Funções Privadas do Modo de Leitura Centralizado
    let _textoLeituraAtualMarkdown = "";
    let _textoLeituraAtualHTML = "";

    function abrirModoLeitura(btn) {
        const textoOriginal = btn.dataset.rawText || '';
        const tituloOriginal = btn.dataset.rawTitle || 'Anotação';

        const modal = document.getElementById('reading-mode-modal');
        const backdrop = document.getElementById('reading-mode-backdrop');
        const tituloEl = document.getElementById('reading-mode-title-text');
        const conteudoEl = document.getElementById('reading-mode-content');
        if (!modal || !backdrop || !tituloEl || !conteudoEl) return;

        _textoLeituraAtualMarkdown = textoOriginal;
        _textoLeituraAtualHTML = renderizarMarkdownSeguro(escaparHTML(textoOriginal));

        tituloEl.textContent = tituloOriginal;
        conteudoEl.innerHTML = _textoLeituraAtualHTML.replace(/\n/g, '<br>');

        backdrop.style.display = 'block';
        modal.style.display = 'flex';
    }

    function fecharModoLeitura() {
        const modal = document.getElementById('reading-mode-modal');
        const backdrop = document.getElementById('reading-mode-backdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
    }

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('reading-mode-modal');
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
            fecharModoLeitura();
        }
    });

    async function copiarTextoModoLeitura() {
        const paragrafosHtml = _textoLeituraAtualHTML
            .split('\n')
            .filter(linha => linha.trim() !== '')
            .map(linha => `<p>${linha}</p>`)
            .join('');

        try {
            const clipboardItem = new ClipboardItem({
                'text/plain': new Blob([_textoLeituraAtualMarkdown], { type: 'text/plain' }),
                'text/html': new Blob([paragrafosHtml], { type: 'text/html' })
            });
            await navigator.clipboard.write([clipboardItem]);
            exibirToast('Texto copiado com formatação inteligente!', 'sucesso');
        } catch (err) {
            console.warn('Fallback de cópia acionado:', err);
            try {
                await navigator.clipboard.writeText(_textoLeituraAtualMarkdown);
                exibirToast('Texto copiado (Modo Básico).', 'info');
            } catch (err2) {
                exibirToast('Não foi possível copiar automaticamente.', 'erro');
            }
        }
    }

    function obterCorContraste(hex) {
        if (!hex || !hex.startsWith('#')) return '#ffffff';
        let cleanHex = hex.replace('#', '');
        if (cleanHex.length === 3) cleanHex = cleanHex.split('').map(c => c + c).join('');
        const r = parseInt(cleanHex.substr(0, 2), 16);
        const g = parseInt(cleanHex.substr(2, 2), 16);
        const b = parseInt(cleanHex.substr(4, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#1a1a1a' : '#ffffff';
    }

    /**
     * Sanitizador de HTML — previne XSS ao interpolar dados do usuário
     * em template literals. Escapa os 5 metacaracteres fundamentais do HTML.
     * @param {string} str - String bruta (input do usuário ou dado de backup).
     * @returns {string} String segura para inserção em innerHTML.
     */
    function escaparHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderizarMarkdownSeguro(strEscapada) {
        if (!strEscapada) return '';
        
        let processado = window.JurisUtils.limparEscapeMarkdown(strEscapada);

        // 1. Negrito (**texto**) - Processado primeiro para evitar conflito com Itálico
        processado = processado.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');

        // 2. Itálico (*texto*)
        processado = processado.replace(/\*([\s\S]*?)\*/g, '<i>$1</i>');

        // 3. Sublinhado (O motor de escape converteu '<' para '&lt;', então buscamos a versão segura)
        processado = processado.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');

        // 4. Tamanhos de Fonte
        processado = processado.replace(/\[\[size:1\]\]([\s\S]*?)\[\[\/size\]\]/g,
            '<span class="txt-largo-1" style="font-size:1.15em;">$1</span>');
        processado = processado.replace(/\[\[size:2\]\]([\s\S]*?)\[\[\/size\]\]/g,
            '<span class="txt-largo-2" style="font-size:1.3em;">$1</span>');

        return processado;
    }

    function escurecerCor(hex, fator = 0.65) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, Math.floor(((num >> 16) & 0xFF) * fator));
        const g = Math.min(255, Math.floor(((num >> 8) & 0xFF) * fator));
        const b = Math.min(255, Math.floor((num & 0xFF) * fator));
        return `rgb(${r},${g},${b})`;
    }

    /**
     * Converte cor Hexadecimal para RGBA com segurança.
     * @param {string} hex - Cor em formato hexadecimal (ex: #FF0000)
     * @param {number} alpha - Opacidade (0.0 a 1.0)
     * @returns {string} String CSS válida (rgba ou o fallback original)
     */
    function hexToRgba(hex, alpha = 0.2) {
        if (!hex || !hex.startsWith('#')) return hex;
        
        let c = hex.substring(1).split('');
        if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        
        if (c.length !== 6) return hex;
        
        const num = parseInt(c.join(''), 16);
        return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    // Paleta Neon / Vibrante para as abas de tópicos e linhas de conexão
    const CORES_TOPICOS = [
        '#00FFFF', // Ciano Neon
        '#FF00FF', // Magenta Neon
        '#39FF14', // Verde Neon
        '#FF3131', // Vermelho Neon
        '#FFFF00', // Amarelo Elétrico
        '#BC13FE', // Roxo Neon
        '#FF1493', // Rosa Choque (Deep Pink)
        '#00FF66', // Verde Primavera (Spring Green)
        '#FF6600', // Laranja Neon
        '#CCFF00', // Limão Elétrico (Electric Lime)
        '#08E8DE', // Teal Brilhante
        '#FF007F', // Rosa Brilhante (Rose Bright)
        '#8A2BE2', // Violeta Azulado
        '#00BFFF', // Azul Céu Profundo
        '#FFD700'  // Ouro Brilhante
    ];

    /**
     * Converte um índice numérico (base-0) em identificador alfabético.
     * Suporta overflow: 0→A, 25→Z, 26→AA, 27→AB, etc.
     * @param {number} idx - Índice da sub-anotação.
     * @returns {string} Identificador de 1 ou 2 letras.
     */
    function gerarLetra(idx) {
        const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (idx < 26) return ABC[idx];
        return ABC[Math.floor(idx / 26) - 1] + ABC[idx % 26];
    }

    function obterIconeIntencao(intencao) {
        switch(intencao) {
            case 'comando': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>`;
            case 'texto': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
            case 'jurisprudencia': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><path d="M12 10l-2-2m0 0l-2 2m2-2v6"></path></svg>`;
            case 'degravacao': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>`;
            case 'nota': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
            case 'fundamentacao': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`;
            case 'refutacao': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>`;
            case 'preliminar': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
            case 'veredito': return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`;
            case 'premissa':
            default: return `<svg class="intencao-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;
        }
    }

    function _gerarBtnRevisaoHtml(topicoId, parentIndex, viewSource, localIndex, intencao, isRevisada) {
        if (intencao !== 'nota') return '';
        
        const safeViewSource = String(viewSource).replace(/'/g, "\\'");
        const safeParentIdx = parentIndex === null ? 'null' : parentIndex;
        
        const svgPendente = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        const svgRevisada = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        
        return `<button class="btn-revisao-nota ${isRevisada ? 'revisada' : 'pendente'}" 
                title="${isRevisada ? 'Nota revisada. Clique para desmarcar.' : 'Nota pendente. Clique para marcar como revisada.'}" 
                onclick="toggleRevisaoNotaOculta('${topicoId}', ${safeParentIdx}, '${safeViewSource}', ${localIndex}, event)">
                ${isRevisada ? svgRevisada : svgPendente}
                </button>`;
    }

    // --- FÁBRICA DE COMPONENTES: PILHA (GRUPO DE IDEIAS) ED ---
    function _obterTextosDaPilha(topico, grupoId) {
        if (!topico) return "";
        let textos = [];
        
        const extrair = (arr) => {
            if (!arr) return;
            arr.forEach(s => {
                if (s.grupoId === grupoId && s.texto && s.texto.trim() !== '') {
                    textos.push(s.texto.trim());
                }
            });
        };

        topico.anotacoes.forEach(an => {
            extrair(an.subAnotacoes);
            if (an.itensCorrelacionados) an.itensCorrelacionados.forEach(ic => extrair(ic.subAnotacoes));
        });
        extrair(topico.diretrizesGlobais);
        // Usa diretrizesPorVicio (específico do ED)
        if (topico.diretrizesPorVicio) Object.values(topico.diretrizesPorVicio).forEach(arr => extrair(arr));

        return textos.join(' - ');
    }

    function _gerarHtmlPilha(sub, renderContext, activeTabId) {
        if (!renderContext.romanMap.has(sub.grupoId)) {
            renderContext.romanMap.set(sub.grupoId, obterRomano(renderContext.romanCounter++));
        }
        const numRomano = renderContext.romanMap.get(sub.grupoId);
        
        // Motor Computed:
        const topico = topicos.find(t => t.id === activeTabId);
        const teorAutomatico = _obterTextosDaPilha(topico, sub.grupoId);
        
        const tituloPilha = sub.grupoTitulo || "📚 Grupo de Ideias";
        const descPilha = sub.grupoDescricao || (teorAutomatico !== "" ? teorAutomatico : "Nós vazios.");
        const source = sub.viewSource || 'main';

        return `
        <div class="sub-annotation-item sub-stack-wrapper" data-source="${source}">
            <div class="sub-annotation-card sub-annotation-stack tema-dossie-ed">
                <div class="stack-roman-badge" title="Desagrupar Pilha" onclick="TopicsManager.desagruparPilha('${activeTabId}', '${sub.grupoId}')">
                    ${numRomano}
                </div>
                
                <div class="pilha-editavel" title="Clique para editar metadados" onclick="TopicsManager.abrirModalPilha('${activeTabId}', '${sub.grupoId}')">
                    ${escaparHTML(tituloPilha)}
                </div>
                
                <div class="pilha-editavel pilha-editavel-desc" title="Clique para editar metadados" onclick="TopicsManager.abrirModalPilha('${activeTabId}', '${sub.grupoId}')">
                    ${renderizarMarkdownSeguro(escaparHTML(descPilha)).replace(/\n/g, '<br>')}
                </div>
                
                <div class="btn-read-mode-trigger sub-read-badge" title="Modo Leitura do Grupo" onclick="TopicsManager.abrirModoLeituraPilha('${activeTabId}', '${sub.grupoId}', '${numRomano}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                    </svg>
                </div>
            </div>
        </div>`;
    }

    let activeTabId = null;

    /**
     * Retorna uma cor da paleta com suporte a módulo (infinitos tópicos).
     */
    function obterCor(index) {
        return CORES_TOPICOS[index % CORES_TOPICOS.length];
    }

    /**
     * Converte a string do polo em uma classe CSS válida.
     */
    function poloParaClasse(polo) {
        return 'tag-' + polo
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') 
            .replace(/[^a-z0-9]+/g, '-')     
            .replace(/^-|-$/g, '');          
    }

    /**
     * Motor unificado para construção de cards de áudio.
     * Desacopla o parseamento do JSON do loop principal de renderização.
     */
    function _gerarHtmlCardAudio(anotacao) {
        let htmlConteudo = '';
        let htmlComentario = '';
        
        try {
            const dadosAudio = JSON.parse(anotacao.conteudo);
            
            // Fallback unificado para nomenclatura segura
            const nomePapel = dadosAudio.role || dadosAudio.oradorStr || 'Orador não idt.';
            const classePolo = dadosAudio.poloTag ? poloParaClasse(dadosAudio.poloTag) : 'doc-tag';
            
            let tagVisual = `<span class="polo-tag ${classePolo}">${escaparHTML(nomePapel)}</span>`;
            if ((dadosAudio.role === 'Testemunha' || dadosAudio.role === 'Advogado') && dadosAudio.poloTag) {
                tagVisual = `<span class="polo-tag doc-tag">${escaparHTML(dadosAudio.role)}</span> <span class="polo-tag ${classePolo}">${escaparHTML(dadosAudio.poloTag)}</span>`;
            }

            // Garante extração segura de tempos matemáticos (fallback para 0)
            const inicioNum = dadosAudio.inicio || 0;
            const fimNum = dadosAudio.fim || 0;
            
            const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;

            // Renderiza o cabeçalho com o botão Clickable e Ícone de Play
            const trechoValido = Number.isFinite(inicioNum) && Number.isFinite(fimNum) && fimNum > inicioNum;

            if (!trechoValido) {
                htmlConteudo = `<p class="card-texto" style="color:#c62828;">[Erro: intervalo do áudio inválido]</p>`;
            } else {
                const tituloMini = `Oitiva: ${nomePapel}`;
                const tituloMiniAttr = escaparHTML(tituloMini).replace(/'/g, '&apos;');
                
                // Injeção condicional: só cria o atributo se houver transcrição
                const degravacaoAttr = dadosAudio.transcricao ? `data-audio-degravacao="${escaparHTML(dadosAudio.transcricao).replace(/'/g, '&apos;')}"` : '';

                htmlConteudo = `
                    <div class="card-audio">
                        <div class="audio-icon-box clickable-audio" 
                             role="button" 
                             tabindex="0" 
                             title="Ouvir este trecho em player focado"
                             aria-label="${tituloMiniAttr}"
                             data-audio-inicio="${inicioNum}" 
                             data-audio-fim="${fimNum}" 
                             data-audio-titulo="${tituloMiniAttr}"
                             ${degravacaoAttr}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                        </div>
                        <div class="audio-card-meta">
                            <strong>Oitiva:</strong> ${tagVisual}<br>
                            <span class="audio-time-badge">⏱️ ${safeFormatTime(inicioNum)} a ${safeFormatTime(fimNum)}</span>
                        </div>
                    </div>`;
            }

            // PRESERVAÇÃO CRÍTICA: Lógica de Comentários e Degravações
            let comentarios = [];
            if (anotacao.comentario) comentarios.push(`<strong>Contexto:</strong> ${escaparHTML(anotacao.comentario)}`);
            if (dadosAudio.transcricao) {
                // A MÁGICA DA QUEBRA DE LINHA ACONTECE NO STYLE ABAIXO (white-space: pre-wrap)
                comentarios.push(`
                    <div style="display:flex; align-items:flex-start; gap:4px;">
                        <div style="flex: 1; white-space: pre-wrap; overflow-wrap: break-word;"><strong>Degravação:</strong> <em>"${escaparHTML(dadosAudio.transcricao)}"</em></div>
                        <button class="btn-copy-degravacao" title="Copiar Degravação" onclick="window.copiarDegravacao('${anotacao.topicoIdOrigem || activeTabId}', '${anotacao.uuid || ''}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                `);
            }
            
            if (comentarios.length > 0) {
                htmlComentario = `<div class="card-comentario" style="display:flex; flex-direction:column; gap:6px;">${comentarios.join('<br>')}</div>`;
            }
        } catch (e) {
            htmlConteudo = `<p class="card-texto" style="color:#c62828;">[Erro: metadados do áudio corrompidos]</p>`;
        }
        
        return { htmlConteudo, htmlComentario };
    }

    /**
     * Extrai a referência (meta-texto) do canto superior direito.
     * Para documentos, retorna ID e Folha. Para áudios, retorna os marcadores de tempo.
     */
    function _obterMetaTexto(item) {
        if (item.tipo === 'audio') {
            try {
                const dados = JSON.parse(item.conteudo);
                const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;
                // Retorna exatamente o formato que o usuário quer copiar para a minuta
                return `(⏱️ ${safeFormatTime(dados.inicio)} a ${safeFormatTime(dados.fim)})`;
            } catch (e) {
                return '(Oitiva)';
            }
        }
        
        // Tratamento padrão para documentos e imagens
        const idFormt = item.pjeId ? `Id. ${item.pjeId} - ` : '';
        return item.pagina ? `(${idFormt}fl. ${item.pagina})` : '';
    }

    /**
     * Fábrica de Componente: Gera o HTML do meta-texto (ID/Folha) com interatividade.
     * @param {boolean} isModalLeitura - Se true, encadeia o fechamento síncrono do modal antes de saltar para o PDF.
     */
    function _gerarMetaInterativo(topicoId, parentIndex, originalCIdx, metaTexto, isModalLeitura = false) {
        const acaoFechamento = isModalLeitura ? 'TopicsManager.fecharModoLeitura(); ' : '';
        return `<span class="card-meta" style="cursor:pointer; font-size:0.85rem; color:var(--trt-blue); font-weight:700; text-decoration: underline dashed; text-underline-offset: 3px;" title="Clique: Copiar | Shift+Clique: Editar folha | Ctrl+Clique: Ir ao PDF" onclick="${acaoFechamento}handleMetaClick(event, '${topicoId}', ${parentIndex}, true, ${originalCIdx})">${metaTexto}</span>`;
    }

    // Função estática gerarSVGConector removida (substituída pelo motor dinâmico desenharConexoes)

    /**
     * FÁBRICA UNIFICADA DE SUB-NÓS (Nós de Ideia e Diretrizes)
     * Centraliza a renderização eliminando duplicação de templates e garantindo SSOT.
     */
    function _gerarTemplateSubNo(sub, idx, ctx) {
        const intencao = sub.intencao || 'premissa';
        const isHasIntent = true; 
        const subIconSVG = obterIconeIntencao(intencao);
        
        const badgeClass = isHasIntent ? `sub-badge has-intent intencao-${intencao}` : 'sub-badge';
        const label = isHasIntent ? `${subIconSVG} ${ctx.prefixoBadge}${ctx.usarLetra ? gerarLetra(idx) : (idx + 1)}` : `${ctx.prefixoBadge}${ctx.usarLetra ? gerarLetra(idx) : (idx + 1)}`;
        
        const textoFormatado = renderizarMarkdownSeguro(escaparHTML(sub.texto));
        const isRevisada = sub.revisada === true;
        const itemWrapperClass = intencao === 'nota' ? `sub-annotation-item is-nota-interna ${isRevisada ? 'is-revisada' : 'is-pendente'}` : 'sub-annotation-item';
        
        const clickSubMenu = ctx.parentIndex === null 
            ? `abrirMenuSubAnotacao('${ctx.topicoId}', null, '${ctx.viewSource.replace(/'/g, "\\'")}', ${sub.localIndex}, event)`
            : `abrirMenuSubAnotacao('${ctx.topicoId}', ${ctx.parentIndex}, '${ctx.viewSource}', ${sub.localIndex}, event)`;

        const classBorda = ctx.bordaClass ? ` ${ctx.bordaClass}` : '';
        const classFase = ctx.bordaFaseClass ? ` ${ctx.bordaFaseClass}` : '';
        const styleAttr = ctx.bordaStyle ? ` style="${ctx.bordaStyle}"` : '';

        return `
            <div class="${itemWrapperClass}" data-source="${ctx.viewSource}">
                <div class="sub-annotation-card${classFase}${classBorda}"${styleAttr}>
                    <div class="${badgeClass}"
                         title="Opções deste nó/diretriz"
                         onclick="${clickSubMenu}">
                        ${label}
                    </div>
                    <div class="sub-text-content">${textoFormatado}</div>
                    
                    <button class="btn-leitura-flutuante" aria-label="Abrir modo leitura" data-raw-text="${escaparHTML(sub.texto)}" data-raw-title="${escaparHTML(ctx.tituloLeitura)}" onclick="TopicsManager.abrirModoLeitura(this)" title="Abrir no Modo Leitura (Tela Cheia)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                        </svg>
                    </button>
                    
                    <button class="btn-copiar-zen" aria-label="Copiar texto bruto" onclick="navigator.clipboard.writeText('${escaparHTML(sub.texto).replace(/'/g, "\\'")}')" title="Copiar texto bruto para a área de transferência">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        Copiar Trecho
                    </button>
                    
                    ${_gerarBtnRevisaoHtml(ctx.topicoId, ctx.parentIndex, ctx.viewSource, sub.localIndex, intencao, isRevisada)}
                </div>
            </div>`;
    }

    /**
     * Fábrica de cards no formato de fluxograma alternado.
     * Retorna: card + bloco de sub-anotações (se houver) + conector SVG.
     * Os três fragmentos são irmãos diretos no .timeline-container,
     * garantindo que align-self funcione corretamente nas sub-anotações.
     */
    function criarCard(anotacao, index, arr, renderContext) {
        const total    = arr.length;
        const numero   = index + 1;
        const tagClass = poloParaClasse(anotacao.polo);
        const metaTexto = _obterMetaTexto(anotacao);

        let htmlConteudo = '';
        let htmlComentario = '';

        if (anotacao.tipo === 'texto') {
            htmlConteudo = `
            <div style="position: relative;">
                <p class="card-texto">"${renderizarMarkdownSeguro(escaparHTML(anotacao.conteudo))}"</p>
            </div>`;
            if (anotacao.comentario) htmlComentario = `<div class="card-comentario"><strong>Observação:</strong> ${escaparHTML(anotacao.comentario)}</div>`;
        } else if (anotacao.tipo === 'imagem') {
            htmlConteudo = `
            <div class="image-resize-wrapper" title="Arraste o canto inferior direito para redimensionar">
                <img class="card-imagem" src="${anotacao.conteudo}" alt="Recorte">
            </div>`;
            if (anotacao.comentario) htmlComentario = `<div class="card-comentario"><strong>Descrição:</strong> ${escaparHTML(anotacao.comentario)}</div>`;
        } else if (anotacao.tipo === 'audio') {
            const audioData = _gerarHtmlCardAudio(anotacao);
            htmlConteudo = audioData.htmlConteudo;
            htmlComentario = audioData.htmlComentario;
        }

        const isLeft     = index % 2 === 0;
        const alignClass = isLeft ? 'align-left' : 'align-right';
        const isLast     = index === total - 1;
        
        const faseDoCard = typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(anotacao.documento) : 4;
        const bgZoneClass = `fase-${faseDoCard}`;

        let bgPoloClass = '';
        if (anotacao.polo === 'Parte Autora') bgPoloClass = 'polo-autora';
        else if (anotacao.polo === 'Parte Ré') bgPoloClass = 'polo-re';
        
        const corTextoBadge = obterCorContraste(_activeTopicoCor);
        
        const docSeguro = anotacao.documento ? escaparHTML(anotacao.documento) : escaparHTML(anotacao.polo);
        const poloSeguro = (anotacao.documento && anotacao.polo) ? escaparHTML(anotacao.polo) : '';
        
        let tagsHtml = `<span class="polo-tag doc-tag">${docSeguro}</span>`;
        if (poloSeguro && poloSeguro !== docSeguro) {
            tagsHtml += ` <span class="polo-tag ${poloParaClasse(anotacao.polo)}">${poloSeguro}</span>`;
        }

        function gerarBarraAcoes(isCorrelacionado, cIdx) {
            // Utiliza o escopo léxico para obter o item real de forma segura
            const itemReal = isCorrelacionado && cIdx != null ? anotacao.itensCorrelacionados[cIdx] : anotacao;
            const ctxCidx = isCorrelacionado && cIdx != null ? `, cIdx: ${cIdx}` : '';
            const tipoDoItem = itemReal.tipo;
            
            const acaoEditar = isCorrelacionado ? 'editarItemCorrelacionado()' : 'editarAnotacao()';
            const paramMove = isCorrelacionado ? `'${activeTabId}', ${index}, ${cIdx}` : `'${activeTabId}', ${index}, null`;
            
            const btnEditar = (tipoDoItem === 'texto' || tipoDoItem === 'audio') ? `<button title="Editar" onclick="_menuAnotacaoCtx={topicoId:'${activeTabId}', index:${index}${ctxCidx}}; ${acaoEditar}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>` : '';
            
            // NOVO: Renderiza botão apenas se for tipo texto. Variáveis tratadas para não quebrar o DOM.
            const btnLeitura = tipoDoItem === 'texto' ? `
                <button title="Modo Leitura" onclick="TopicsManager.abrirModoLeitura(this)" data-raw-text="${escaparHTML(itemReal.conteudo)}" data-raw-title="${escaparHTML(itemReal.documento || itemReal.polo || 'Anotação')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                </button>` : '';

            // NOVO: Lógica de Elegibilidade para Pilha
            const isElegivelParaPilha = isCorrelacionado && cIdx != null && !anotacao.itensCorrelacionados[cIdx].pilhaProcId;
            const btnAgrupar = isElegivelParaPilha 
                ? `<button title="Criar Pilha Processual" onclick="TopicsManager.abrirModalPilhaProcessual('${activeTabId}', ${index}, ${cIdx})">🗂️</button>` 
                : '';

            return `
            <div class="card-actions-bar">
                ${btnAgrupar}
                ${btnLeitura}
                ${btnEditar}
                <button title="Adicionar Nó de Ideia" onclick="_menuAnotacaoCtx={topicoId:'${activeTabId}', index:${index}${ctxCidx}}; acionarNovoNoIdeia()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                <button title="Mover / Reordenar" onclick="abrirModalSmartMove(${paramMove})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><polyline points="8 7 12 3 16 7"></polyline><line x1="12" y1="12" x2="12" y2="3"></line></svg></button>
                <button class="delete-btn" title="Excluir" onclick="${isCorrelacionado ? `excluirItemCorrelacionado('${activeTabId}', ${index}, ${cIdx})` : `_menuAnotacaoCtx={topicoId:'${activeTabId}', index:${index}}; excluirAnotacao()`}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>`;
        }

        // Card Principal (Removido o código morto redundante do wrapper interno)

        // Nós de Ideia (Sub-anotações - Flattening Architecture)
        let htmlSubAnotacoes = '';
        let flatSubAnotacoes = [];
        
        // 1. Achata os nós do Mestre
        if (anotacao.subAnotacoes) {
            flatSubAnotacoes.push(...anotacao.subAnotacoes.map((s, idx) => ({ ...s, viewSource: 'main', localIndex: idx })));
        }
        
        // 2. Achata os nós dos Filhos (Correlacionados)
        if (anotacao.itensCorrelacionados) {
            // Reutiliza ou recria o Map para O(1)
            const pilhaAnchorMapSub = new Map();
            anotacao.itensCorrelacionados.forEach((ic, i) => {
                if (ic.pilhaProcId && !pilhaAnchorMapSub.has(ic.pilhaProcId)) {
                    pilhaAnchorMapSub.set(ic.pilhaProcId, i);
                }
            });

            anotacao.itensCorrelacionados.forEach((item, fIdx) => {
                if (item.subAnotacoes) {
                    let anchorCidx = item.pilhaProcId ? pilhaAnchorMapSub.get(item.pilhaProcId) : fIdx;
                    flatSubAnotacoes.push(...item.subAnotacoes.map((s, idx) => ({ ...s, viewSource: anchorCidx, localIndex: idx })));
                }
            });
        }

        if (flatSubAnotacoes.length > 0) {
            const subCardsHTMLArray = [];
            const gruposProcessadosNesteCard = new Set();
            
            flatSubAnotacoes.forEach((sub, sIdx) => {
                // 1. NÓS SOLTOS (Utiliza o template unificado do ED)
                if (!sub.grupoId) {
                    let faseSub = faseDoCard;
                    if (sub.viewSource !== 'main' && anotacao.itensCorrelacionados) {
                        const cIdx = parseInt(sub.viewSource, 10);
                        if (!isNaN(cIdx) && anotacao.itensCorrelacionados[cIdx]) {
                             faseSub = typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(anotacao.itensCorrelacionados[cIdx].documento) : 4;
                        }
                    }
                    
                    subCardsHTMLArray.push(_gerarTemplateSubNo(sub, sIdx, {
                        topicoId: activeTabId,
                        parentIndex: index,
                        viewSource: sub.viewSource,
                        bordaFaseClass: `borda-fase-${faseSub}`,
                        prefixoBadge: `${numero}.`,
                        usarLetra: true,
                        tituloLeitura: 'Nó de Ideia'
                    }));
                }
                // 2. NÓS AGRUPADOS (A PILHA)
                else {
                    if (!gruposProcessadosNesteCard.has(sub.grupoId)) {
                        gruposProcessadosNesteCard.add(sub.grupoId);
                        subCardsHTMLArray.push(_gerarHtmlPilha(sub, renderContext, activeTabId));
                    }
                }
            });

            htmlSubAnotacoes = `<div class="sub-annotations-wrapper">${subCardsHTMLArray.join('')}</div>`;
        }

        // NOVO: Processar itens agrupados
        let htmlCorrelacionados = '';
        if (anotacao.itensCorrelacionados && anotacao.itensCorrelacionados.length > 0) {
            const processadosPilha = new Set();
            
            // OTIMIZAÇÃO O(1): Mapeia as âncoras das pilhas antes do loop principal
            const pilhaAnchorMap = new Map();
            anotacao.itensCorrelacionados.forEach((ic, i) => {
                if (ic.pilhaProcId && !pilhaAnchorMap.has(ic.pilhaProcId)) {
                    pilhaAnchorMap.set(ic.pilhaProcId, i);
                }
            });

            htmlCorrelacionados = anotacao.itensCorrelacionados.map((item, cIdx) => {
                const itemTag = poloParaClasse(item.polo);
                const itemMeta = _obterMetaTexto(item);
                const docSeguro = item.documento ? escaparHTML(item.documento) : escaparHTML(item.polo);
                const poloSeguro = (item.documento && item.polo && item.polo !== item.documento) ? escaparHTML(item.polo) : '';
                
                // --- FLUXO A: PILHA PROCESSUAL ---
                if (item.pilhaProcId) {
                    if (processadosPilha.has(item.pilhaProcId)) return ''; 
                    processadosPilha.add(item.pilhaProcId);
                    const anchorCidx = pilhaAnchorMap.get(item.pilhaProcId);
                    
                    // OTIMIZAÇÃO O(N): Mapeamento nativo preservando o índice original
                    const itensDestaPilhaObj = anotacao.itensCorrelacionados
                        .map((ic, originalCIdx) => ({ ic, originalCIdx }))
                        .filter(obj => obj.ic.pilhaProcId === item.pilhaProcId);
                    
                    const faseClass = `fase-${typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(item.documento) : 4}`;
                    
                    let htmlTextosInternos = itensDestaPilhaObj.map(obj => {
                        const metaText = _obterMetaTexto(obj.ic);
                        return `
                        <div style="margin-bottom:8px;">
                            <span class="card-meta" style="cursor:pointer; font-size:0.75rem; color:var(--trt-blue); font-weight:700;" title="Clique: Copiar | Shift+Clique: Editar folha | Ctrl+Clique: Ir ao PDF" onclick="handleMetaClick(event, '${activeTabId}', ${index}, true, ${obj.originalCIdx})">${metaText}</span>
                            <p style="font-size:0.85rem; margin-top:4px;">"${renderizarMarkdownSeguro(escaparHTML(obj.ic.conteudo))}"</p>
                        </div>`;
                    }).join('<hr class="stack-text-divider">');
                    
                    return `
                    <div class="correlated-item-wrapper" data-cidx="${anchorCidx}"
                         draggable="true"
                         ondragstart="DnDManager.dragStart(event, '${activeTabId}', ${index}, ${anchorCidx})"
                         ondragover="DnDManager.dragOver(event)"
                         ondrop="DnDManager.drop(event, '${activeTabId}', ${index}, ${anchorCidx})"
                         ondragenter="DnDManager.dragEnter(event)"
                         ondragleave="DnDManager.dragLeave(event)"
                         ondragend="DnDManager.dragEnd(event)">
                         
                        <div class="two-way-arrow-container correlated-drag-handle" title="Arraste a pasta inteira para reordenar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </div>
                        
                        <div class="annotation-card correlated-card pilha-processual-card ${faseClass}">
                            <div class="card-header">
                                <div style="display:flex; gap:6px;">
                                    <span class="polo-tag doc-tag">🗂️ ${docSeguro}</span>
                                    ${poloSeguro ? `<span class="polo-tag ${itemTag}">${poloSeguro}</span>` : ''}
                                </div>
                            </div>
                            <div class="scrollable-stack-text">${htmlTextosInternos}</div>
                            
                            <!-- BOTÃO ATUALIZADO: Dispara o novo motor de leitura estruturada -->
                            <div class="btn-read-mode-trigger pilha-read-badge" title="Ler Pastinha Completa" onclick="TopicsManager.abrirModoLeituraPilhaProcessual('${activeTabId}', ${index}, '${item.pilhaProcId}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                            </div>
                            <div class="card-actions-bar">
                                <button title="Adicionar Nó de Ideia" onclick="_menuAnotacaoCtx={topicoId:'${activeTabId}', index:${index}, cIdx:${anchorCidx}}; acionarNovoNoIdeia()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                                <button class="delete-btn" title="Desagrupar" onclick="TopicsManager.desagruparPilhaProcessual('${activeTabId}', ${index}, '${item.pilhaProcId}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 22L2 22 2 14M22 2L14 2 14 10" stroke-linecap="round" stroke-linejoin="round"/><line x1="22" y1="2" x2="10" y2="14" stroke-linecap="round" stroke-linejoin="round"/><line x1="2" y1="22" x2="14" y2="10" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                            </div>
                        </div>
                    </div>`;
                }

                // --- FLUXO B: RENDERIZAR CARD NORMAL ---
                let cConteudo = '';
                let cComent = '';
                if (item.tipo === 'texto') {
                    cConteudo = `
                    <div style="position: relative;">
                        <p class="card-texto">"${renderizarMarkdownSeguro(escaparHTML(item.conteudo))}"</p>
                    </div>`;
                    if (item.comentario) cComent = `<div class="card-comentario"><strong>Observação:</strong> ${escaparHTML(item.comentario)}</div>`;
                } else if (item.tipo === 'imagem') {
                    cConteudo = `<div class="image-resize-wrapper" title="Arraste para redimensionar"><img class="card-imagem" src="${item.conteudo}" alt="Agrupamento"></div>`;
                    if (item.comentario) cComent = `<div class="card-comentario"><strong>Descrição:</strong> ${escaparHTML(item.comentario)}</div>`;
                } else if (item.tipo === 'audio') {
                    const audioData = _gerarHtmlCardAudio(item);
                    cConteudo = audioData.htmlConteudo;
                    cComent = audioData.htmlComentario;
                }
                
                return `
                <div class="correlated-item-wrapper" data-cidx="${cIdx}"
                     draggable="true"
                     ondragstart="DnDManager.dragStart(event, '${activeTabId}', ${index}, ${cIdx})"
                     ondragover="DnDManager.dragOver(event)"
                     ondrop="DnDManager.drop(event, '${activeTabId}', ${index}, ${cIdx})"
                     ondragenter="DnDManager.dragEnter(event)"
                     ondragleave="DnDManager.dragLeave(event)"
                     ondragend="DnDManager.dragEnd(event)">
                    <div class="two-way-arrow-container correlated-drag-handle" title="Arraste para reordenar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <div class="annotation-card correlated-card fase-${typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(item.documento) : 4}">
                        <div class="card-header">
                            <div style="display:flex; gap:6px;">
                                <span class="polo-tag doc-tag">${docSeguro}</span>
                                ${poloSeguro ? `<span class="polo-tag ${itemTag}">${poloSeguro}</span>` : ''}
                            </div>
                            <span class="card-meta" style="cursor:pointer;" title="Clique: Copiar | Shift+Clique: Editar folha | Ctrl+Clique: Ir ao PDF" onclick="handleMetaClick(event, '${activeTabId}', ${index}, true, ${cIdx})">${itemMeta}</span>
                        </div>
                        ${cConteudo}
                        ${cComent}
                        ${gerarBarraAcoes(true, cIdx)}
                    </div>
                </div>`;
            }).join('');
        }

        // Wrapper Master Flex atualizado para envelopar a hierarquia inteira
        const wrapperMaster = `
            <div class="timeline-item-master ${alignClass}" id="timeline-wrapper-${anotacao.uuid || index}">
                <div class="main-card-wrapper" data-uuid="${anotacao.uuid || index}" data-cidx="main"
                     ondragover="DnDManager.dragOver(event)"
                     ondrop="DnDManager.drop(event, '${activeTabId}', ${index}, 'main')"
                     ondragenter="DnDManager.dragEnter(event)"
                     ondragleave="DnDManager.dragLeave(event)">
                    <div class="annotation-number-area">
                        <div class="timeline-number master-drag-handle" 
                             draggable="true"
                             ondragstart="DnDManager.dragStart(event, '${activeTabId}', ${index}, 'main')"
                             ondragend="DnDManager.dragEnd(event)"
                             style="background-color: ${_activeTopicoCor}; color: ${corTextoBadge}; cursor: grab;" 
                             title="Arraste para trocar o Card Mestre, ou Clique para Nomear Tese"
                             onclick="abrirModalTese('${activeTabId}', ${index})">
                            ${numero}
                        </div>
                    </div>
                    <div class="annotation-card ${bgZoneClass} ${bgPoloClass}">
                        <div class="card-header">
                            <div style="display:flex; gap:6px;">${tagsHtml}</div>
                            <span class="card-meta" style="cursor:pointer;" title="Clique: Copiar | Shift+Clique: Editar folha | Ctrl+Clique: Ir ao PDF" onclick="handleMetaClick(event, '${activeTabId}', ${index}, false)">${metaTexto}</span>
                        </div>
                        ${htmlConteudo}
                        ${htmlComentario}
                        ${gerarBarraAcoes(false, null)}
                    </div>
                    ${htmlCorrelacionados}
                </div>
                ${htmlSubAnotacoes}
            </div>`;

        return wrapperMaster; // Sem o conector anexado aqui
    }

    /**
     * Renderiza o bloco de diretrizes visuais para a IA (Global ou Por Vício)
     */
    function renderizarNivelHierarquico(tipo, titulo, subanotacoes, topicoId, tesesConsolidadas = [], indexGlobal = 0, renderContext) {
        const listaSegura = subanotacoes || [];
        const isGlobal = tipo === 'global';
        
        // NÚCLEO DA CORREÇÃO: paridade dinâmica baseada no índice global
        const isLeft = (indexGlobal % 2 === 0);
        const alignClass = isLeft ? 'align-left' : 'align-right';

        const iconSvg = isGlobal 
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle></svg>`;
        
        let styleIconBox = '';
        let styleCard = '';
        let styleTitle = '';
        let styleSubBorda = '';
        let classSubBorda = isGlobal ? 'borda-global' : '';
        
        // CORREÇÃO DA COR BRANCA FANTASMA
        let corBase = _activeTopicoCor;
        if (corBase.toLowerCase() === '#ffffff' && !isGlobal) {
            corBase = '#1a3a5c'; // Azul Sóbrio Padrão do ED para garantir leitura
        }
        
        const corTextoTese = obterCorContraste(corBase);

        if (!isGlobal) {
            const rgbaTeseFundo = hexToRgba(corBase, 0.08); // Fundo super suave
            const rgbaTeseBorda = hexToRgba(corBase, 0.4);
            const corTituloTese = escurecerCor(corBase, 0.6);

            styleIconBox = `background-color: ${corBase}; color: ${corTextoTese};`;
            styleCard = `border-left: 4px solid ${corBase}; background-color: #ffffff; background-image: linear-gradient(${rgbaTeseFundo}, ${rgbaTeseFundo});`;
            styleTitle = `color: ${corTituloTese};`;
            styleSubBorda = `border-left: 5px solid ${corBase}; border-color: ${rgbaTeseBorda};`;
        }
        
        const tituloContexto = isGlobal ? 'Diretriz Global' : `Diretriz do Vício: ${titulo}`;
        
        // RENDERIZAÇÃO SEGURA DOS NÓS COM SHALLOW COPY E PILHAS
        const gruposProcessadosNesteCard = new Set();
        const subCardsHTMLArray = [];
        const viewSourceAtual = isGlobal ? 'global' : `vicio:${titulo}`;
        
        listaSegura.forEach((sub, idx) => {
            // CÓPIA SUPERFICIAL
            const subRender = { ...sub, viewSource: viewSourceAtual, localIndex: idx };
            
            if (!subRender.grupoId) {
                subCardsHTMLArray.push(_gerarTemplateSubNo(subRender, idx, {
                    topicoId: topicoId,
                    parentIndex: null,
                    viewSource: viewSourceAtual,
                    bordaClass: classSubBorda,
                    bordaStyle: styleSubBorda,
                    prefixoBadge: isGlobal ? 'G.' : 'V.',
                    usarLetra: false,
                    tituloLeitura: tituloContexto
                }));
            } else {
                if (!gruposProcessadosNesteCard.has(subRender.grupoId)) {
                    gruposProcessadosNesteCard.add(subRender.grupoId);
                    subCardsHTMLArray.push(_gerarHtmlPilha(subRender, renderContext, topicoId));
                }
            }
        });
        const subCardsHTML = subCardsHTMLArray.join('');

        const hierarquiaTitulo = isGlobal ? 'Diretrizes Globais (Auditoria)' : `Vício Alegado: ${escaparHTML(titulo)}`;
        const wrapperClass = isGlobal ? 'nivel-global' : 'nivel-vicio';

        // NOVO: Renderização segura e elegante das teses compiladas
        let htmlTesesMapeadas = '';
        if (!isGlobal && tesesConsolidadas.length > 0) {
            // Escapa os dados para evitar injeção de HTML malicioso (XSS)
            const tesesSeguras = tesesConsolidadas.map(t => escaparHTML(t)).join(' <span style="color:#ccc;">|</span> ');
            htmlTesesMapeadas = `
                <div style="font-size: 0.8rem; color: #555; margin-top: 4px; font-weight: normal; line-height: 1.4;">
                    <strong style="color: var(--trt-blue-mid);">Teses Mapeadas:</strong> ${tesesSeguras}
                </div>`;
        }

        return `
            <div class="timeline-item-master ${alignClass} nivel-hierarquico ${wrapperClass}">
                <div class="main-card-wrapper">
                    <div class="annotation-number-area">
                        <div class="timeline-icon-box" title="${hierarquiaTitulo}" style="${styleIconBox}">
                            ${iconSvg}
                        </div>
                    </div>
                    <div class="annotation-card" style="${styleCard}">
                        <div class="card-header" style="justify-content: space-between; margin-bottom: 0; align-items: flex-start;">
                            <div>
                                <div class="hierarquia-titulo" style="${styleTitle}">${hierarquiaTitulo}</div>
                                ${htmlTesesMapeadas}
                            </div>
                            <div class="card-actions-bar" style="margin-top: 0; padding-top: 0; border-top: none;">
                                <button title="Adicionar Diretriz" onclick="adicionarDiretrizEstrutural('${isGlobal ? 'global' : 'vicio'}', '${topicoId}', '${isGlobal ? '' : escaparHTML(titulo)}', event)">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="sub-annotations-wrapper">${subCardsHTML}</div>
            </div>`;
    }

    /**
     * Split Read/Write para evitar Layout Thrashing
     */
    function aplicarTruncamentoDinamicoSeguro() {
        requestAnimationFrame(() => {
            const textNodes = Array.from(document.querySelectorAll('.sub-text-content, .card-texto'));
            const measurements = textNodes.map(node => ({
                el: node,
                btn: node.parentElement.querySelector('.btn-expand-text'),
                isOverflowing: node.scrollHeight > node.clientHeight
            }));

            requestAnimationFrame(() => {
                measurements.forEach(m => {
                    if (m.isOverflowing) {
                        // Exibe o botão e aplica a classe do fade-out
                        if (m.btn) m.btn.style.display = 'inline-flex';
                        m.el.classList.add('is-truncated');
                    } else {
                        // Garante a limpeza do estado caso a tela seja redimensionada
                        if (m.btn) m.btn.style.display = 'none';
                        m.el.classList.remove('is-truncated');
                    }
                });
            });
        });
    }

    /**
     * Atualiza o índice de marcadores flutuantes com base no tópico ativo.
     * Função idempotente: zera o DOM e reconstrói de forma leve.
     */
    function _atualizarMarcadoresDeIdeia(topico) {
        const listContainer = document.getElementById('idea-markers-list');
        if (!listContainer) return;
        
        // 1. Limpeza de Estado
        listContainer.innerHTML = '';
        
        // 2. Validação de Escopo (Se não há ideias, encerra silenciosamente)
        if (!topico || !topico.anotacoes || topico.anotacoes.length === 0) return;

        // 3. Renderização Dinâmica e Cálculos
        const corTexto = obterCorContraste(_activeTopicoCor);
        
        const fragment = document.createDocumentFragment(); // Otimização de reflow

        topico.anotacoes.forEach((anotacao, index) => {
            const btn = document.createElement('div');
            btn.className = 'fab-idea-marker';
            btn.style.backgroundColor = _activeTopicoCor;
            btn.style.color = corTexto;
            btn.textContent = index + 1;
            
            // UX Rica: Tooltip injeta o título da tese se existir
            const nomeTese = anotacao.tese ? ` - ${escaparHTML(anotacao.tese)}` : '';
            btn.title = `Ir para a Ideia ${index + 1}${nomeTese}`;

            // 4. Feitiçaria Matemática de Scroll (Alerta 1 resolvido)
            btn.onclick = (e) => {
                e.stopPropagation();
                
                const scrollContainer = document.getElementById('history-container');
                const targetId = `timeline-wrapper-${anotacao.uuid || index}`; // Reconciliação via UUID
                const targetElement = document.getElementById(targetId);
                
                if (targetElement && scrollContainer) {
                    // Calcula a posição relativa entre o card alvo e o container que rola, 
                    // somando com a rolagem atual para chegar no Offset absoluto correto.
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const targetRect = targetElement.getBoundingClientRect();
                    
                    // -16px de margem de respiro para o card não colar no topo do teto
                    const offset = (targetRect.top - containerRect.top) + scrollContainer.scrollTop - 16;
                    
                    scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });
                }
            };
            
            fragment.appendChild(btn);
        });
        
        // Injeção única no DOM
        listContainer.appendChild(fragment);
    }

    /**
     * Re-renderiza o fichário inteiro.
     */
    function renderizarFichario(topicosArray) {
        const headerEl  = document.getElementById('topics-tabs-header');
        const contentEl = document.getElementById('topics-tab-content');

        if (!headerEl || !contentEl) return;

        if (topicosArray.length === 0) {
            headerEl.innerHTML = '';
            contentEl.innerHTML = `
                <p class="empty-state">
                    Nenhum tópico criado.<br>
                    Use o botão <strong>+</strong> na barra lateral para criar um Tópico Recursal.
                </p>`;
            contentEl.style.borderTop       = 'none';
            contentEl.style.backgroundColor = 'transparent';
            return;
        }

        if (!activeTabId || !topicosArray.some(t => t.id === activeTabId)) {
            activeTabId = topicosArray[0].id;
        }

        const scrollAnterior = headerEl.scrollLeft;
        let abaAtivaNode = null;

        headerEl.innerHTML = '';
        [...topicosArray].reverse().forEach(topico => {
            const isActive = topico.id === activeTabId;
            const btn      = document.createElement('div');

            btn.className        = `topic-tab-btn ${isActive ? 'active' : ''}`;
            btn.textContent      = topico.nome;
            btn.title            = topico.nome; 
            
            const corContraste = obterCorContraste(topico.cor);
            btn.style.setProperty('--tab-bg', topico.cor);
            btn.style.setProperty('--tab-color', corContraste);

            btn.onclick = () => {
                activeTabId = topico.id;
                renderizarFichario(topicosArray);
            };

            headerEl.appendChild(btn);
            
            if (isActive) abaAtivaNode = btn;
        });

        const topicoAtivo = topicosArray.find(t => t.id === activeTabId);
        if (!topicoAtivo) return;

        _activeTopicoCor = topicoAtivo.cor;
        contentEl.style.setProperty('--active-tab-color', escurecerCor(_activeTopicoCor, 0.85));
        const corTextoTese = obterCorContraste(_activeTopicoCor);

        requestAnimationFrame(() => {
            headerEl.scrollLeft = scrollAnterior;
            if (abaAtivaNode) {
                abaAtivaNode.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        });

        const preambleHtml = `
            <div class="topic-preamble-panel" style="position: sticky; top: 0; z-index: 10;">
                <div class="preamble-card preamble-alegacao ${!topicoAtivo.alegacoes ? 'is-empty' : ''}" onclick="abrirEdicaoPreambulo('${activeTabId}', 'alegacoes')">
                    
                    <div class="preamble-icon ai-trigger-btn" 
                         title="✨ Inteligência Artificial: Buscar modelos compatíveis" 
                         onclick="event.stopPropagation(); AIRecommendationManager.buscarModelosCompativeis('${activeTabId}', decodeURIComponent('${encodeURIComponent(topicoAtivo.alegacoes || '').replace(/'/g, "%27")}'))">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" class="ai-sparkle" style="display:none; transform-origin: 12px 12px;"></path>
                        </svg>
                    </div>

                    <div class="preamble-content">
                        <span class="preamble-title">${ED_UI_LABELS.alegacao.titulo}</span>
                        ${topicoAtivo.alegacoes ? renderizarMarkdownSeguro(escaparHTML(topicoAtivo.alegacoes)) : `<span class="preamble-empty">${ED_UI_LABELS.alegacao.placeholder}</span>`}
                    </div>
                </div>
                <div class="preamble-card preamble-origem" onclick="abrirEdicaoPreambulo('${activeTabId}', 'fundamentos')">
                    <div class="preamble-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M6 21V7l6-4 6 4v14"></path></svg>
                    </div>
                    <div class="preamble-content">
                        <span class="preamble-title">${ED_UI_LABELS.origem.titulo}</span>
                        ${topicoAtivo.fundamentos ? renderizarMarkdownSeguro(escaparHTML(topicoAtivo.fundamentos)) : `<span class="preamble-empty">${ED_UI_LABELS.origem.placeholder}</span>`}
                    </div>
                </div>
                <div class="preamble-card preamble-veredito" onclick="abrirEdicaoPreambulo('${activeTabId}', 'veredito')">
                    <div class="preamble-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
                    </div>
                    <div class="preamble-content">
                        <span class="preamble-title">${ED_UI_LABELS.veredito.titulo}</span>
                        ${topicoAtivo.veredito ? renderizarMarkdownSeguro(escaparHTML(topicoAtivo.veredito)) : `<span class="preamble-empty">${ED_UI_LABELS.veredito.placeholder}</span>`}
                    </div>
                </div>
            </div>`;

        let conteudoCentralHtml = '';

        const temAnotacoes = topicoAtivo.anotacoes && topicoAtivo.anotacoes.length > 0;
        const temGlobais = topicoAtivo.diretrizesGlobais && topicoAtivo.diretrizesGlobais.length > 0;
        const forcadoAberto = _topicosComGlobaisAbertas.has(activeTabId);

        if (!temAnotacoes && !temGlobais && !forcadoAberto) {
            conteudoCentralHtml = `
                <p class="empty-state" style="margin-top: 20px;">
                    A Matriz Dialética está vazia. Adicione extrações das provas ou clique no Globo no cabeçalho para inserir Diretrizes Globais.
                </p>`;
            const novoHtml = preambleHtml + conteudoCentralHtml;
            
            if (typeof resizeObserver !== 'undefined') resizeObserver.disconnect();
            if (typeof morphdom !== 'undefined') {
                morphdom(contentEl, `<div id="topics-tab-content" class="topics-content-area" style="${contentEl.style.cssText}">${novoHtml}</div>`, {
                    childrenOnly: true,
                    getNodeKey: function(node) {
                        if (node.id) return node.id;
                    }
                });
            } else {
                contentEl.innerHTML = novoHtml;
            }
            
            _sincronizarBtnGlobais(false, false);
            return;
        }

        let sumarioHtml = '';
        const tesesValidas = topicoAtivo.anotacoes.filter(an => an.tese && an.tese.trim() !== '');
        if (tesesValidas.length > 0) {
            sumarioHtml = `
            <div class="thesis-summary-panel">`;

            topicoAtivo.anotacoes.forEach((an, idx) => {
                if (an.tese && an.tese.trim() !== '') {
                    const fasesPresentes = new Set();
                    
                    fasesPresentes.add(typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(an.documento) : 4);
                    
                    if (an.itensCorrelacionados?.length) {
                        an.itensCorrelacionados.forEach(ic => fasesPresentes.add(typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(ic.documento) : 4));
                    }

                    if (an.itensCorrelacionados?.length) {
                        an.itensCorrelacionados.forEach(ic => {
                            if (ic.subAnotacoes && ic.subAnotacoes.length > 0) {
                                fasesPresentes.add(typeof identificarFaseMetodologica === 'function' ? identificarFaseMetodologica(ic.documento) : 4);
                            }
                        });
                    }

                    const cores = [];
                    if(fasesPresentes.has(1)) cores.push('var(--fase-1-bg)');
                    if(fasesPresentes.has(2)) cores.push('var(--fase-2-bg)');
                    if(fasesPresentes.has(3)) cores.push('var(--fase-3-bg)');
                    if(fasesPresentes.has(4)) cores.push('var(--fase-4-bg)');
                    
                    let bgStyle = '';
                    if(cores.length > 0) {
                        const step = 100 / cores.length;
                        const gradients = cores.map((cor, i) => `${cor} ${i * step}%, ${cor} ${(i + 1) * step}%`);
                        bgStyle = `style="background: linear-gradient(to right, ${gradients.join(', ')}), #ffffff;"`; 
                    }

                    const tipoVicio = topicoAtivo.vicio || 'omissao'; 
                    let isMature = false;

                    if (tipoVicio === 'omissao') {
                        isMature = fasesPresentes.has(1) && fasesPresentes.has(2) && fasesPresentes.has(3);
                    } else if (tipoVicio === 'contradicao') {
                        let contadorRoxo = (typeof identificarFaseMetodologica === 'function' && identificarFaseMetodologica(an.documento) === 3) ? 1 : 0;
                        if (an.itensCorrelacionados) {
                            contadorRoxo += an.itensCorrelacionados.filter(ic => typeof identificarFaseMetodologica === 'function' && identificarFaseMetodologica(ic.documento) === 3).length;
                        }
                        isMature = fasesPresentes.has(1) && fasesPresentes.has(3) && (contadorRoxo >= 2);
                    } else if (tipoVicio === 'erro') {
                        isMature = fasesPresentes.has(1) && fasesPresentes.has(3) && fasesPresentes.has(4);
                    }

                    const matureClass = isMature ? 'mature' : '';
                    
                    const teseEscapada = an.tese ? escaparHTML(an.tese) : '';
                    const textoPainelRenderizado = window.JurisUtils.obterBadgeTeseCompleto(an.vicio || tipoVicio, teseEscapada, true);

                    sumarioHtml += `
                        <div class="thesis-badge ${matureClass}" onclick="abrirModalTese('${activeTabId}', ${idx})">
                            <div class="thesis-badge-inner" ${bgStyle}>
                                <span class="num" style="background-color: ${_activeTopicoCor}; color: ${corTextoTese};">${idx + 1}</span> 
                                <span class="texto-tese">${textoPainelRenderizado}</span>
                            </div>
                        </div>`;
                }
            });
            sumarioHtml += '</div>';
        }
        
        let htmlDiretrizes = '';
        
        const renderContext = {
            romanCounter: 0,
            romanMap: new Map() 
        };

        if (temGlobais || forcadoAberto) {
            const diretrizesGlobaisSeguras = topicoAtivo.diretrizesGlobais || [];
            htmlDiretrizes += renderizarNivelHierarquico('global', null, diretrizesGlobaisSeguras, activeTabId, [], 0, renderContext);
        }

        let cardsHTML = '';
        let ultimaTeseRenderizada = null;

        topicoAtivo.anotacoes.forEach((anotacao, index) => {
            const chaveTeseCrua = anotacao.tese || "Provas não agrupadas";
            const isTesePreenchida = (anotacao.tese && anotacao.tese.trim() !== '');
            const vicioRaw = anotacao.vicio || topicoAtivo.vicio || 'omissao';
            const vicioFormatado = window.JurisUtils.formatarVicioED(vicioRaw);

            if (chaveTeseCrua !== ultimaTeseRenderizada) {
                const diretrizesDoVicio = (topicoAtivo.diretrizesPorVicio && topicoAtivo.diretrizesPorVicio[vicioRaw])
                                          ? topicoAtivo.diretrizesPorVicio[vicioRaw]
                                          : [];

                if (isTesePreenchida || diretrizesDoVicio.length > 0) {
                    const tituloExibicao = isTesePreenchida ? anotacao.tese.trim() : "Provas não agrupadas";
                    cardsHTML += renderizarNivelHierarquico(
                        'vicio',
                        vicioFormatado,
                        diretrizesDoVicio,
                        activeTabId,
                        [tituloExibicao],
                        index,
                        renderContext
                    );
                }
                ultimaTeseRenderizada = chaveTeseCrua;
            }
            cardsHTML += criarCard(anotacao, index, topicoAtivo.anotacoes, renderContext);
        });

        conteudoCentralHtml = sumarioHtml + `
            <div class="timeline-container" id="timeline-container">
                <svg id="connections-canvas"></svg>
                ${htmlDiretrizes}
                ${cardsHTML}
            </div>`;

        const novoHtml = preambleHtml + conteudoCentralHtml;
            
        if (typeof resizeObserver !== 'undefined') resizeObserver.disconnect();
            
        if (typeof morphdom !== 'undefined') {
            morphdom(contentEl, `<div id="topics-tab-content" class="topics-content-area" style="${contentEl.style.cssText}">${novoHtml}</div>`, {
                childrenOnly: true,
                getNodeKey: function(node) {
                    if (node.id) return node.id;
                }
            });
        } else {
            contentEl.innerHTML = novoHtml;
        }
            
        requestAnimationFrame(() => {
            document.querySelectorAll('.sub-text-content, .card-texto').forEach(el => {
                if (typeof resizeObserver !== 'undefined') resizeObserver.observe(el);
            });
            const historyContainer = document.getElementById('history-container');
            if (historyContainer && typeof resizeObserver !== 'undefined') resizeObserver.observe(historyContainer);

            aplicarTruncamentoDinamicoSeguro();
            
            document.querySelectorAll('.image-resize-wrapper').forEach(wrapper => {
                wrapper.addEventListener('mouseup', () => desenharConexoes());
                wrapper.addEventListener('mouseleave', () => desenharConexoes());
            });

            const container = document.getElementById('timeline-container');
            if (container) {
                posicionarNosDeIdeia(container);
                requestAnimationFrame(() => {
                    desenharConexoes();
                });
            }
            
            _atualizarMarcadoresDeIdeia(topicoAtivo);
            atualizarContadorNotasOcultas();
        });
        
        _sincronizarBtnGlobais(temGlobais, forcadoAberto);
    }

    /**
     * Motor de Posicionamento Absoluto dos Nós de Ideia
     * Evita Layout Thrashing através de leitura em massa (Passe A) seguida de mutação (Passe B)
     */
    function posicionarNosDeIdeia(container) {
        const masterItems = container.querySelectorAll('.timeline-item-master');
        
        masterItems.forEach(master => {
            const mainCard = master.querySelector('.main-card-wrapper > .annotation-card');
            const subWrapper = master.querySelector('.sub-annotations-wrapper');
            const subItems = master.querySelectorAll('.sub-annotation-item');

            if (!mainCard || subItems.length === 0 || !subWrapper) return;

            const wrapperRect = subWrapper.getBoundingClientRect();
            
            // Passe A: Leituras (Evita Layout Thrashing)
            const measurements = Array.from(subItems).map(subItem => {
                const sourceRef = subItem.dataset.source;
                let sourceCard = mainCard;
                if (sourceRef !== 'main') {
                    const correlatedWrapper = master.querySelector(`.correlated-item-wrapper[data-cidx="${sourceRef}"]`);
                    if (correlatedWrapper) sourceCard = correlatedWrapper.querySelector('.annotation-card');
                }
                
                // TRAVA DE SEGURANÇA: Previne o bug de sobreposição ao trocar abas no navegador
                if (sourceCard.offsetHeight === 0) return null;

                return {
                    el: subItem,
                    sourceCenterY: (sourceCard.getBoundingClientRect().top - wrapperRect.top) + (sourceCard.getBoundingClientRect().height / 2),
                    height: subItem.offsetHeight
                };
            }).filter(m => m !== null); // Remove os itens inválidos da contagem

            if (measurements.length === 0) return; // Aborta mutação em views ocultas

            // Passe B: Mutações
            let currentY = 0;
            measurements.forEach(m => {
                let desiredTop = m.sourceCenterY - (m.height / 2);
                if (desiredTop < currentY) desiredTop = currentY;
                
                m.el.style.position = 'absolute';
                m.el.style.top = desiredTop + 'px';
                m.el.style.width = '100%';
                
                currentY = desiredTop + m.height + 16;
            });

            subWrapper.style.minHeight = currentY + 'px';
        });
    }

    /**
     * Motor Dinâmico de Conexões Sinuosas
     * @param {boolean} isZenActive - Indica se o Modo Zen está ativo
     */
    function desenharConexoes(isZenActive = false) {
        const container = document.getElementById('timeline-container');
        const svg = document.getElementById('connections-canvas');
        if (!container || !svg) return;

        const containerRect = container.getBoundingClientRect();
        let svgContent = '';

        // 1. LINHA VERMELHA (ESPINHA DORSAL): Conecta Grupo a Grupo (incluindo Vícios)
        // CORREÇÃO TOPOLÓGICA: Exclui a diretriz global (.nivel-global) 
        // para que a linha ancore corretamente nos cards de Vício Alegado.
        const masterItemsForSpine = Array.from(container.querySelectorAll('.timeline-item-master:not(.nivel-global)'));

        for (let i = 0; i < masterItemsForSpine.length - 1; i++) {
            const currentGroup = masterItemsForSpine[i];
            const nextGroup = masterItemsForSpine[i + 1];

            const currentCorrelated = currentGroup.querySelectorAll('.correlated-item-wrapper > .annotation-card');
            let cardAtual = currentCorrelated.length > 0 ? currentCorrelated[currentCorrelated.length - 1] : currentGroup.querySelector('.main-card-wrapper > .annotation-card');
            const cardProx = nextGroup.querySelector('.main-card-wrapper > .annotation-card');

            if (!cardAtual || !cardProx) continue;

            const rectAtual = cardAtual.getBoundingClientRect();
            const rectProx = cardProx.getBoundingClientRect();

            const startX = (rectAtual.left + rectAtual.width / 2) - containerRect.left;
            const startY = rectAtual.bottom - containerRect.top;
            const endX = (rectProx.left + rectProx.width / 2) - containerRect.left;
            const endY = rectProx.top - containerRect.top;
            const ctrlY = (startY + endY) / 2;

            // Constante geométrica para a haste horizontal nas pontas (8px para cada lado)
            const tick = 8; 

            // Montagem consolidada do Path:
            // 1. Haste Superior (Move, Line)
            // 2. Curva Sinuosa (Move, Curve)
            // 3. Haste Inferior (Move, Line)
            const pathD = `M ${startX - tick},${startY} L ${startX + tick},${startY} ` +
                          `M ${startX},${startY} C ${startX},${ctrlY} ${endX},${ctrlY} ${endX},${endY} ` +
                          `M ${endX - tick},${endY} L ${endX + tick},${endY}`;

            // Injeção puramente geométrica e semântica
            svgContent += `<path class="spine-connection" d="${pathD}" />`;
        }

        const masterItems = container.querySelectorAll('.timeline-item-master');
        masterItems.forEach(master => {
            const mainCard = master.querySelector('.main-card-wrapper > .annotation-card');
            const subItems = master.querySelectorAll('.sub-annotation-item');
            if (!mainCard || subItems.length === 0) return;

            const isRightAligned = master.classList.contains('align-right');
            
            subItems.forEach(subItem => {
                const subCard = subItem.querySelector('.sub-annotation-card');
                const subRect = subCard.getBoundingClientRect();
                const sourceRef = subItem.dataset.source;
                
                let sourceCard = mainCard;
                if (sourceRef !== 'main') {
                    const correlatedWrapper = master.querySelector(`.correlated-item-wrapper[data-cidx="${sourceRef}"]`);
                    if (correlatedWrapper) sourceCard = correlatedWrapper.querySelector('.annotation-card');
                }
                const sourceRect = sourceCard.getBoundingClientRect();

                const startX = isRightAligned ? sourceRect.left - containerRect.left : sourceRect.right - containerRect.left;
                const endX = isRightAligned ? subRect.right - containerRect.left : subRect.left - containerRect.left;
                const startY = (sourceRect.top + sourceRect.height / 2) - containerRect.top;
                const endY   = (subRect.top + subRect.height / 2) - containerRect.top;
                const ctrlX  = (startX + endX) / 2;

                let strokeColor = "#777";
                let strokeOpacity = "1";
                let strokeWidth = "1.5";
                let dashArray = "5 4";

                if (isZenActive) {
                    if (subItem.classList.contains('is-zen-focused')) {
                        strokeColor = _activeTopicoCor;
                        strokeWidth = "2.5";
                        dashArray = "none";
                    } else {
                        strokeOpacity = "0.15";
                    }
                }

                svgContent += `<path d="M ${startX},${startY} C ${ctrlX},${startY} ${ctrlX},${endY} ${endX},${endY}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="${dashArray}" opacity="${strokeOpacity}" fill="none" stroke-linecap="round"/>`;
            });
        });

        svg.innerHTML = svgContent;
    }

    /**
     * Motor de Sincronia: Executa posicionamento e aciona loop passivo de SVG
     */
    function _sincronizarConexoesComAnimacao(container) {
        if (typeof posicionarNosDeIdeia === 'function') posicionarNosDeIdeia(container);
        
        const isZenModeActive = document.getElementById('topics-tab-content').classList.contains('zen-mode-ativo');
        let start = null;
        const duration = 350; 

        function step(timestamp) {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            
            desenharConexoes(isZenModeActive);

            if (progress < duration) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // A função toggleTextExpansion foi removida. O sistema agora utiliza o Modo de Leitura Centralizado.

    let notaOcultaIndexAtual = -1;

    function atualizarContadorNotasOcultas() {
        const notas = document.querySelectorAll('.sub-annotation-item.is-nota-interna.is-pendente');
        const trackerContainer = document.getElementById('efficiency-tracker-container');
        const lampTracker = document.getElementById('hidden-notes-tracker');
        const badge = document.getElementById('hidden-notes-badge');
        
        if (!trackerContainer || !lampTracker || !badge) return;

        if (notas.length > 0) {
            trackerContainer.style.display = 'flex';
            lampTracker.style.display = 'flex';
            badge.textContent = notas.length;
        } else {
            lampTracker.style.display = 'none';
            const pill = document.getElementById('efficiency-tracker-pill');
            if (pill && pill.style.display === 'none') {
                trackerContainer.style.display = 'none';
            }
        }
        notaOcultaIndexAtual = -1;
    }

    function rolarParaProximaNotaOculta() {
        const notas = document.querySelectorAll('.sub-annotation-item.is-nota-interna.is-pendente');
        if (notas.length === 0) return;

        notaOcultaIndexAtual++;
        if (notaOcultaIndexAtual >= notas.length) notaOcultaIndexAtual = 0;

        const notaAlvo = notas[notaOcultaIndexAtual];
        const scrollContainer = document.getElementById('history-container');
        
        if (notaAlvo && scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const alvoRect = notaAlvo.getBoundingClientRect();
            
            const offset = (alvoRect.top - containerRect.top) + scrollContainer.scrollTop - 30;
            scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });
            
            const cardInterno = notaAlvo.querySelector('.sub-annotation-card');
            cardInterno.style.transition = 'box-shadow 0.2s, border-color 0.2s';
            cardInterno.style.borderColor = '#D500B5';
            cardInterno.style.boxShadow = '0 0 0 4px rgba(213, 0, 181, 0.3), 4px 4px 0px rgba(0, 0, 0, 0.15)';
            
            setTimeout(() => {
                cardInterno.style.borderColor = '';
                cardInterno.style.boxShadow = '';
            }, 1200);
        }
    }

    // Listener ergonômico para Scroll Horizontal com a roda do mouse
    const _headerEl = document.getElementById('topics-tabs-header');
    if (_headerEl) {
        _headerEl.addEventListener('wheel', (evt) => {
            if (evt.deltaY !== 0) {
                evt.preventDefault();
                _headerEl.scrollLeft += evt.deltaY * 2;
            }
        }, { passive: false });
    }

    function abrirModoLeituraPilha(topicoId, grupoId, numeroRomano) {
        const topico = topicos.find(t => t.id === topicoId);
        if (!topico) return;
        
        let htmlAgrupado = '';
        let itemContador = 1;

        const getIntencaoLabel = (intKey) => {
            const mapa = {
                'comando': { text: 'COMANDO', color: '#c62828', bg: '#ffebee' },
                'texto': { text: 'TEXTO FIXO', color: '#1565c0', bg: '#e3f2fd' },
                'premissa': { text: 'PREMISSA LÓGICA', color: '#7b1fa2', bg: '#f3e5f5' },
                'fundamentacao': { text: 'FUNDAMENTAÇÃO LEGAL', color: '#00695c', bg: '#e0f2f1' },
                'refutacao': { text: 'REFUTAÇÃO / MÉRITO', color: '#8B4513', bg: '#efebe9' },
                'preliminar': { text: 'PREJUDICIAL / FILTRO', color: '#5d4037', bg: '#efebe9' },
                'veredito': { text: 'VEREDITO', color: '#e65100', bg: '#fff3e0' },
                'nota': { text: 'NOTA INTERNA', color: '#616161', bg: '#f5f5f5' },
                'jurisprudencia': { text: 'JURISPRUDÊNCIA', color: '#00838F', bg: '#E0F7FA' },
                'degravacao': { text: 'DEGRAVAÇÃO (CURADA)', color: '#BF360C', bg: '#FBE9E7' }
            };
            return mapa[intKey] || { text: 'DIRETRIZ', color: '#475569', bg: '#f1f5f9' };
        };

        const processar = (subArr, origemHtml) => {
            if (subArr) {
                subArr.filter(s => s.grupoId === grupoId).forEach((no) => {
                    const intencaoKey = no.intencao || 'premissa';
                    const configInt = getIntencaoLabel(intencaoKey);
                    const isRevisada = no.revisada ? ' <span title="Revisada" style="color:#48bb78; margin-left:4px;">✔</span>' : '';
                    
                    htmlAgrupado += `
                    <div style="padding-bottom: 16px; border-bottom: 1px dashed #e2e8f0; margin-bottom: 16px;">
                        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                            <span style="font-size:0.75rem; color:#64748b; font-weight:800; background:#f1f5f9; padding:2px 8px; border-radius:12px;">ITEM ${itemContador++}</span>
                            <span style="font-size:0.7rem; font-weight:800; color:${configInt.color}; background:${configInt.bg}; padding:2px 8px; border-radius:12px; border: 1px solid ${configInt.color}40; display:flex; align-items:center;">${configInt.text}${isRevisada}</span>
                            <span style="font-size:0.8rem; color:#475569; display:flex; align-items:center; gap:4px; margin-left: 4px;">${origemHtml}</span>
                        </div>
                        <div style="font-size: 1rem; color: #334155; line-height: 1.6;">
                            ${renderizarMarkdownSeguro(escaparHTML(no.texto))}
                        </div>
                    </div>`;
                });
            }
        };

        // 1. Varre Diretrizes Globais
        processar(topico.diretrizesGlobais, '🌐 <strong>Diretriz Global</strong>');

        // 2. Varre Vícios e Provas
        let ultimaTese = null;
        topico.anotacoes.forEach(an => {
            const teseAtual = an.tese || "Provas sem agrupamento";
            const vicioRaw = an.vicio || topico.vicio || 'omissao';
            
            // Subnós de Vício (ED)
            if (teseAtual !== ultimaTese) {
                if (topico.diretrizesPorVicio && topico.diretrizesPorVicio[vicioRaw]) {
                    const vicioFormatado = window.JurisUtils ? window.JurisUtils.formatarVicioED(vicioRaw) : vicioRaw;
                    processar(topico.diretrizesPorVicio[vicioRaw], `⚖️ Diretriz do Vício: <strong>${escaparHTML(vicioFormatado)}</strong>`);
                }
                ultimaTese = teseAtual;
            }

            // Subnós da Prova Master
            const docMaster = an.documento || an.polo || 'Elemento Probatório';
            const flMaster = an.pagina ? `(fl. ${an.pagina})` : '';
            processar(an.subAnotacoes, `📄 ${escaparHTML(docMaster)} <em>${escaparHTML(flMaster)}</em>`);

            // Subnós das Provas Correlacionadas
            if (an.itensCorrelacionados) {
                an.itensCorrelacionados.forEach(ic => {
                    const docCorr = ic.documento || ic.polo || 'Elemento Correlacionado';
                    const flCorr = ic.pagina ? `(fl. ${ic.pagina})` : '';
                    processar(ic.subAnotacoes, `📄 ${escaparHTML(docCorr)} <em>${escaparHTML(flCorr)}</em>`);
                });
            }
        });

        const modal = document.getElementById('reading-mode-modal');
        document.getElementById('reading-mode-title-text').textContent = `Leitura da Pilha ${numeroRomano}`;
        document.getElementById('reading-mode-content').innerHTML = htmlAgrupado || '<p style="color:#666; font-style:italic;">Nenhuma ideia encontrada para este grupo.</p>';
        document.getElementById('reading-mode-backdrop').style.display = 'block';
        modal.style.display = 'flex';
    }

    function abrirModoLeituraPilhaProcessual(topicoId, parentIndex, pilhaProcId) {
        const topico = topicos.find(t => t.id === topicoId);
        if (!topico) return;
        const mestre = topico.anotacoes[parentIndex];
        
        // Otimização O(N) e Preservação do Índice Original
        const itensDestaPilhaObj = mestre.itensCorrelacionados
            .map((ic, originalCIdx) => ({ ic, originalCIdx }))
            .filter(obj => obj.ic.pilhaProcId === pilhaProcId);
        
        if (itensDestaPilhaObj.length === 0) return;
        const docSeguro = escaparHTML(itensDestaPilhaObj[0].ic.documento || itensDestaPilhaObj[0].ic.polo || 'Pastinha de Provas');
        
        let htmlAgrupado = '';
        let markdownAcumulado = `### 🗂️ Leitura: ${docSeguro}\n\n`;
        
        // COMPATIBILIDADE CRÍTICA: O motor nativo \`copiarTextoModoLeitura\` quebra o HTML a cada '\\n' 
        // e envolve em <p>. Usamos APENAS tags inline (<strong>, <i>, <br>) para evitar HTML inválido no Word/PJe.
        let htmlAcumulado = `<strong>🗂️ Leitura: ${docSeguro}</strong>\n`;
        
        itensDestaPilhaObj.forEach((obj, i) => {
            const ic = obj.ic;
            const metaTexto = _obterMetaTexto(ic);
            
            // HTML de Tela: Componente interativo com UX de fechamento automático síncrono
            const metaInterativoTela = _gerarMetaInterativo(topicoId, parentIndex, obj.originalCIdx, metaTexto, true);
            
            htmlAgrupado += `
            <div style="padding-bottom: 16px; border-bottom: 1px dashed #e2e8f0; margin-bottom: 16px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="font-size:0.75rem; color:#64748b; font-weight:800; background:#f1f5f9; padding:2px 8px; border-radius:12px;">ITEM ${i + 1}</span>
                    ${metaInterativoTela}
                </div>
                <div style="font-size: 1.05rem; color: #334155; line-height: 1.6; font-style: italic;">
                    "${renderizarMarkdownSeguro(escaparHTML(ic.conteudo))}"
                </div>
            </div>`;
            
            // Sincronização de Estado (Copy-Safe)
            markdownAcumulado += `**ITEM ${i + 1}** ${metaTexto}\n"${ic.conteudo}"\n\n`;
            htmlAcumulado += `<strong>ITEM ${i + 1}</strong> ${metaTexto}<br><i>"${renderizarMarkdownSeguro(escaparHTML(ic.conteudo))}"</i>\n`;
        });
        
        // Mutação das Variáveis Globais (Resolve o Stale State)
        _textoLeituraAtualMarkdown = markdownAcumulado.trim();
        _textoLeituraAtualHTML = htmlAcumulado;
        
        // Renderização Visual no Modal
        const modal = document.getElementById('reading-mode-modal');
        document.getElementById('reading-mode-title-text').innerHTML = `🗂️ Leitura: ${docSeguro}`;
        document.getElementById('reading-mode-content').innerHTML = htmlAgrupado;
        document.getElementById('reading-mode-backdrop').style.display = 'block';
        modal.style.display = 'flex';
    }

    function desagruparPilha(topicoId, grupoId) {
        if (!confirm('Deseja desagrupar esta pilha e restaurar os nós individualmente?')) return;
        const topico = topicos.find(t => t.id === topicoId);
        
        const limparGrupo = (subArr) => {
            if(subArr) subArr.forEach(s => { if (s.grupoId === grupoId) delete s.grupoId; });
        };

        topico.anotacoes.forEach(an => {
            limparGrupo(an.subAnotacoes);
            if (an.itensCorrelacionados) an.itensCorrelacionados.forEach(ic => limparGrupo(ic.subAnotacoes));
        });

        renderizarFichario(topicos); 
        if(window.salvarBackupAutomatico) salvarBackupAutomatico();
        if(window.exibirToast) exibirToast('Pilha desagrupada com sucesso.', 'sucesso');
    }

    let _contextoEdicaoPilha = null;

    function abrirModalPilha(topicoId, grupoId) {
        _contextoEdicaoPilha = { topicoId, grupoId };
        const topico = topicos.find(t => t.id === topicoId);
        if (!topico) return;

        let titAtual = "📚 Grupo de Ideias";
        let descManualSalva = ""; 

        const extrair = (arr) => {
            if (!arr) return;
            const no = arr.find(s => s.grupoId === grupoId);
            if (no) {
                if (no.grupoTitulo) titAtual = no.grupoTitulo;
                if (no.grupoDescricao) descManualSalva = no.grupoDescricao;
            }
        };

        topico.anotacoes.forEach(an => { 
            extrair(an.subAnotacoes); 
            if (an.itensCorrelacionados) an.itensCorrelacionados.forEach(ic => extrair(ic.subAnotacoes)); 
        });
        extrair(topico.diretrizesGlobais);
        if (topico.diretrizesPorVicio) Object.values(topico.diretrizesPorVicio).forEach(arr => extrair(arr));

        const inputTitulo = document.getElementById('input-pilha-titulo');
        const inputDesc = document.getElementById('input-pilha-descricao');
        
        inputTitulo.value = titAtual;
        inputDesc.value = descManualSalva;
        
        if (descManualSalva === "") {
            const previewAuto = _obterTextosDaPilha(topico, grupoId);
            inputDesc.placeholder = previewAuto !== "" ? previewAuto : "Nós vazios. O texto gerado aparecerá aqui...";
        } else {
            inputDesc.placeholder = "Deixe vazio para o sistema extrair os textos automaticamente.";
        }

        document.getElementById('pilha-modal-backdrop').style.display = 'block';
        document.getElementById('modal-editar-pilha').style.display = 'flex';
    }

    function fecharModalPilha() {
        document.getElementById('pilha-modal-backdrop').style.display = 'none';
        document.getElementById('modal-editar-pilha').style.display = 'none';
        _contextoEdicaoPilha = null;
    }

    function salvarEdicaoPilha() {
        if (!_contextoEdicaoPilha) return;
        const topico = topicos.find(t => t.id === _contextoEdicaoPilha.topicoId);
        if (!topico) return;
        
        const nTit = document.getElementById('input-pilha-titulo').value.trim();
        const nDesc = document.getElementById('input-pilha-descricao').value.trim();

        const atualizar = (arr) => {
            if (!arr) return;
            arr.forEach(s => {
                if (s.grupoId === _contextoEdicaoPilha.grupoId) {
                    s.grupoTitulo = nTit;
                    
                    if (nDesc === "") {
                        delete s.grupoDescricao;
                    } else {
                        s.grupoDescricao = nDesc;
                    }
                }
            });
        };

        topico.anotacoes.forEach(an => { 
            atualizar(an.subAnotacoes); 
            if (an.itensCorrelacionados) an.itensCorrelacionados.forEach(ic => atualizar(ic.subAnotacoes)); 
        });
        atualizar(topico.diretrizesGlobais);
        if (topico.diretrizesPorVicio) Object.values(topico.diretrizesPorVicio).forEach(arr => atualizar(arr));

        fecharModalPilha();
        renderizarFichario(topicos);
        if (window.salvarBackupAutomatico) salvarBackupAutomatico();
    }

    let _pilhaProcContext = null;

    function abrirModalPilhaProcessual(topicoId, parentIndex, cIdxOrigem) {
        const topico = topicos.find(t => t.id === topicoId);
        const mestre = topico.anotacoes[parentIndex];
        const itemReferencia = mestre.itensCorrelacionados[cIdxOrigem];

        const elegiveis = mestre.itensCorrelacionados.map((item, idx) => ({ item, idx }))
            .filter(obj => 
                obj.item.documento === itemReferencia.documento && 
                obj.item.polo === itemReferencia.polo &&
                !obj.item.pilhaProcId 
            );

        if (elegiveis.length < 2 && !itemReferencia.pilhaProcId) {
            if(typeof exibirToast === 'function') exibirToast('Não há outros cards elegíveis para agrupar com este.', 'aviso');
            return;
        }

        _pilhaProcContext = { topicoId, parentIndex };
        let html = '';

        elegiveis.forEach(obj => {
            const textoBruto = obj.item.conteudo.replace(/<[^>]*>?/gm, '').substring(0, 70) + '...';
            const textoSeguro = escaparHTML(textoBruto); 

            html += `
            <label style="display:flex; align-items:flex-start; gap:10px; padding:10px; border:1px solid var(--border-color); border-radius:6px; cursor:pointer; background:#fafafa; transition: background 0.2s;">
                <input type="checkbox" class="pilha-chk" value="${obj.idx}" ${obj.idx === cIdxOrigem ? 'checked disabled' : ''} style="margin-top:2px; transform: scale(1.1);">
                <span style="font-size:0.85rem; color:var(--text-dark); line-height:1.4;">${textoSeguro}</span>
            </label>`;
        });

        document.getElementById('lista-checklist-pilha').innerHTML = html;
        document.getElementById('pilha-processual-backdrop').style.display = 'block';
        document.getElementById('modal-pilha-processual').style.display = 'flex';
    }

    function fecharModalPilhaProcessual() {
        document.getElementById('pilha-processual-backdrop').style.display = 'none';
        document.getElementById('modal-pilha-processual').style.display = 'none';
        _pilhaProcContext = null;
    }

    function salvarPilhaProcessual() {
        if (!_pilhaProcContext) return;
        const topico = topicos.find(t => t.id === _pilhaProcContext.topicoId);
        const chks = document.querySelectorAll('.pilha-chk:checked');
        
        if (chks.length < 2) {
            if(typeof exibirToast === 'function') exibirToast('Selecione pelo menos 2 provas.', 'aviso');
            return;
        }

        const novaPilhaId = 'pilhaProc-' + Date.now();
        
        chks.forEach(chk => {
            const idx = parseInt(chk.value, 10);
            topico.anotacoes[_pilhaProcContext.parentIndex].itensCorrelacionados[idx].pilhaProcId = novaPilhaId;
        });

        fecharModalPilhaProcessual();
        renderizarFichario(topicos); 
        if(window.salvarBackupAutomatico) salvarBackupAutomatico();
        if(typeof exibirToast === 'function') exibirToast('Pilha Processual criada!', 'sucesso');
    }

    function desagruparPilhaProcessual(topicoId, parentIndex, pilhaId) {
        if(!confirm('Desagrupar e restaurar as provas individualmente?')) return;
        
        const topico = topicos.find(t => t.id === topicoId);
        topico.anotacoes[parentIndex].itensCorrelacionados.forEach(ic => {
            if (ic.pilhaProcId === pilhaId) delete ic.pilhaProcId;
        });

        renderizarFichario(topicos);
        if(window.salvarBackupAutomatico) salvarBackupAutomatico();
        if(typeof exibirToast === 'function') exibirToast('Pilha desagrupada com sucesso.', 'info');
    }

    // API pública do módulo
    return {
        toggleDiretrizesGlobais,
        resetVisibilidadeGlobais,
        obterCor,
        abrirModalPilha,
        fecharModalPilha,
        salvarEdicaoPilha,
        obterCorContraste,
        renderizarFichario,
        abrirModoLeituraPilha,
        desagruparPilha,
        getActiveTabId: () => activeTabId,
        setActiveTabId: (id) => { activeTabId = id; },
        escaparHTML,
        renderizarMarkdownSeguro,
        abrirModoLeitura,
        fecharModoLeitura,
        copiarTextoModoLeitura,
        hexToRgba,
        rolarParaProximaNotaOculta,
        // NOVAS EXPORTAÇÕES DA PILHA PROCESSUAL
        abrirModoLeituraPilhaProcessual,
        abrirModalPilhaProcessual,
        fecharModalPilhaProcessual,
        salvarPilhaProcessual,
        desagruparPilhaProcessual
    };

})();

/* ================================================
   VISÃO ESTRUTURADA E VISÃO DE MINUTA (ED)
   Movidas para js/ed_document-views.js
   ================================================ */