/* ================================================
   app-core.js
   ORQUESTRADOR CENTRAL E INFRAESTRUTURA DA APLICAÇÃO
   ================================================ */

// Utilitário para evitar Layout Thrashing e Flickering
window.RenderCycle = {
    awaitNextFrame: () => new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }),
    bloquearScrollBody: (bloquear) => {
        if (bloquear) {
            const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.overflow = 'hidden';
            document.body.style.paddingRight = `${scrollBarWidth}px`;
        } else {
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
    }
};

/* ================================================
   MÓDULO DA SPLASH SCREEN (GERENCIADOR DE ESTADO E EVENT LOOP)
   ================================================ */
window.SplashScreenManager = (function() {
    let splashEl = null;
    let textEl = null;
    const DEFAULT_TEXT = "Organizar ideias. Fazer justiça.";
    let initialLoadPromise = null;

    function init() {
        splashEl = document.getElementById('juris-splash');
        textEl = document.getElementById('splash-dynamic-text');
        initialLoadPromise = new Promise(resolve => setTimeout(resolve, 1500));
    }

    async function showWithYield(mensagem = DEFAULT_TEXT) {
        if (!splashEl) return;
        if (textEl) textEl.textContent = mensagem;
        splashEl.classList.remove('is-hidden');
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(resolve, 50); 
                });
            });
        });
    }

    function hide() {
        if (splashEl) splashEl.classList.add('is-hidden');
    }

    async function hideInitialLoad() {
        if (initialLoadPromise) await initialLoadPromise;
        hide();
    }

    return { init, showWithYield, hide, hideInitialLoad };
})();

/* ================================================
   JURIS PROMPT: MOTOR UNIVERSAL DE INPUT (V2 - Produção)
   ================================================ */
window.JurisPrompt = (function() {
    let _resolvePromise = null;
    let _isBusy = false;
    let _elementos = {};

    function _cacheDOM() {
        if (_elementos.backdrop) return true;
        const backdrop = document.getElementById('juris-prompt-backdrop');
        if (!backdrop) return false;

        _elementos = {
            backdrop: backdrop,
            modal: document.getElementById('juris-prompt-modal'),
            title: document.getElementById('juris-prompt-title-text'),
            message: document.getElementById('juris-prompt-message'),
            input: document.getElementById('juris-prompt-input')
        };
        return true;
    }

    function _handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            _fechar(null);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            _fechar(_elementos.input.value);
        } else if (e.key === 'Tab') {
            _trapFocus(e);
        }
    }

    function _handleClick(e) {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (e.target === _elementos.backdrop || action === 'cancel') {
            _fechar(null);
        } else if (action === 'confirm') {
            _fechar(_elementos.input.value);
        }
    }

    function _trapFocus(e) {
        const focusables = _elementos.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function ask(titulo, mensagem, placeholder = '', valorInicial = '') {
        return new Promise((resolve) => {
            if (_isBusy) {
                console.warn('[JurisPrompt] Requisição ignorada: Prompt já está em uso.');
                return resolve(null);
            }
            if (!_cacheDOM()) {
                console.error('[JurisPrompt] Elementos ausentes no DOM.');
                return resolve(null);
            }

            _isBusy = true;
            _resolvePromise = resolve;

            _elementos.title.innerHTML = titulo;
            _elementos.message.textContent = mensagem;
            _elementos.input.placeholder = placeholder;
            _elementos.input.value = valorInicial || '';

            _elementos.backdrop.addEventListener('mousedown', _handleClick);
            document.addEventListener('keydown', _handleKeydown);

            _elementos.backdrop.classList.add('is-active');

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    _elementos.input.focus();
                    _elementos.input.select();
                });
            });
        });
    }

    function _fechar(valor) {
        if (!_isBusy) return;
        
        _elementos.backdrop.classList.remove('is-active');
        _elementos.backdrop.removeEventListener('mousedown', _handleClick);
        document.removeEventListener('keydown', _handleKeydown);
        _isBusy = false;

        setTimeout(() => {
            if (_resolvePromise) {
                _resolvePromise(valor);
                _resolvePromise = null;
            }
        }, 300); 
    }

    return { ask };
})();

/* ================================================
   ESTADO GLOBAL DA APLICAÇÃO (ORQUESTRADOR)
   ================================================ */
let topicos              = [];     
let modoRetomada         = false;  
let _encerrarTimer       = null;   
let _encerrarConfirmando = false;  
let _sessaoPossuiAudio   = false;  

let _tempHighlightState = {
    rects: null,
    paginaFisica: null
};

/* ================================================
   MOTOR GLOBAL DE SINCRONIZAÇÃO (Ponte)
   ================================================ */
window.sincronizarHighlightsGerais = function() {
    if (window.PdfEngine) window.PdfEngine.sincronizarHighlightsGerais();
};

/* ================================================
   MOTOR DE HIGIENIZAÇÃO DE TEXTO (JURIS UTILS)
   ================================================ */
window.JurisUtils = window.JurisUtils || {};

window.JurisUtils.criarRegexDeRepeticao = function(textoExemplo) {
    if (!textoExemplo || typeof textoExemplo !== 'string') return null;

    let snippet = (typeof this.limparTextoPDF === 'function') 
        ? this.limparTextoPDF(textoExemplo) 
        : textoExemplo.trim();
    
    if (snippet.length < 20) return null; 

    let pattern = snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = pattern.replace(/\d+/g, '[\\d\\s]+');
    pattern = pattern.replace(/[-–—_]/g, '[-–—_\\s]*');
    pattern = pattern.replace(/\s+/g, '\\s+');
    
    return new RegExp('\\s*' + pattern + '\\s*', 'gi');
};

window.JurisUtils.limparTextoPDF = function(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        // Expressão Regular Segura: Limita a captura à própria linha do rodapé, englobando as variações comuns do PJe
        .replace(/(?:Documento\s+assinado\s+eletronicamente\s+por|Assinado\s+(?:digitalmente|eletronicamente)\s+por|Signatário(?:\(a\))?[:\s])[^\n]*(?=\n|$)/gi, ' ')
        .replace(/([\p{L}])-\r?\n\s*([\p{L}])/gu, '$1$2')
        .replace(/([^\n\r])\r?\n([^\n\r])/g, '$1 $2')
        .replace(/ {2,}/g, ' ')
        .trim();
};

window.JurisUtils.limparEscapeMarkdown = function(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto.replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1');
};

const _encontrarMaiorSubstringComum = (s1, s2) => {
    if (!s1 || !s2) return "";
    let maxLen = 0, endIdx = 0;
    const prev = new Uint16Array(s2.length + 1);
    const curr = new Uint16Array(s2.length + 1);
    for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                curr[j] = prev[j - 1] + 1;
                if (curr[j] > maxLen) { maxLen = curr[j]; endIdx = i; }
            } else { curr[j] = 0; }
        }
        prev.set(curr);
    }
    return s1.substring(endIdx - maxLen, endIdx);
};

window.JurisUtils.removerTrechoFuzzy = function(textoBruto, amostraTarget, marcadorLGPD, isAgulhaEsqueleto = false) {
    if (!textoBruto || !amostraTarget) return textoBruto;
    const fallbackMarcador = '\n\n[AVISO DE SISTEMA: Dados estruturais ou sensíveis ocultados.]\n\n';
    const tagFinal = marcadorLGPD !== undefined ? marcadorLGPD : fallbackMarcador;

    let esqueletoAgulha = amostraTarget;
    
    if (!isAgulhaEsqueleto) {
        const agulhaMatches = [...amostraTarget.toLowerCase().matchAll(/[\p{L}]/gu)];
        if (agulhaMatches.length < 15) return textoBruto; 
        esqueletoAgulha = agulhaMatches.map(m => m[0]).join('');
    }

    const palheiroMatches = [...textoBruto.toLowerCase().matchAll(/[\p{L}]/gu)];
    if (palheiroMatches.length === 0) return textoBruto;
    const esqueletoPalheiro = palheiroMatches.map(m => m[0]).join('');

    const rangesParaSubstituir = [];
    let startIndex = 0;

    while (true) {
        const pos = esqueletoPalheiro.indexOf(esqueletoAgulha, startIndex);
        if (pos === -1) break;

        const inicioReal = palheiroMatches[pos].index;
        const fimRealObj = palheiroMatches[pos + esqueletoAgulha.length - 1];
        const fimReal = fimRealObj.index + fimRealObj[0].length; 

        rangesParaSubstituir.push({ start: inicioReal, end: fimReal });
        startIndex = pos + esqueletoAgulha.length;
    }

    if (rangesParaSubstituir.length === 0) return textoBruto;

    let resultadoFinal = textoBruto;
    for (let i = rangesParaSubstituir.length - 1; i >= 0; i--) {
        const { start, end } = rangesParaSubstituir[i];
        resultadoFinal = resultadoFinal.substring(0, start) + tagFinal + resultadoFinal.substring(end);
    }

    return resultadoFinal;
};

window.JurisUtils.descobrirRuidosEstruturais = function(textoPagA, textoPagB) {
    const esqA = [...textoPagA.toLowerCase().matchAll(/[\p{L}]/gu)].map(m => m[0]).join('');
    const esqB = [...textoPagB.toLowerCase().matchAll(/[\p{L}]/gu)].map(m => m[0]).join('');
    if (esqA.length < 50 || esqB.length < 50) return [];
    
    const ruidos = [];
    const lcsTopo = _encontrarMaiorSubstringComum(esqA.substring(0, 300), esqB.substring(0, 300));
    if (lcsTopo.length >= 15) ruidos.push(lcsTopo);
    
    const lcsBase = _encontrarMaiorSubstringComum(esqA.substring(Math.max(0, esqA.length - 300)), esqB.substring(Math.max(0, esqB.length - 300)));
    if (lcsBase.length >= 15 && lcsBase !== lcsTopo) ruidos.push(lcsBase);
    
    return ruidos;
};

window.JurisUtils.formatarVicioED = function(vicioRaw) {
    if (!vicioRaw) return 'Vício Não Especificado';
    
    // Dicionário Híbrido: Mapeia Legado + Novas Chaves normativas
    const dicionario = {
        // Legados da V1
        'omissao': 'Omissão',
        'contradicao': 'Contradição',
        'erro': 'Erro Material', // Fallback Legado garantido
        
        // Novas chaves da V2
        'obscuridade': 'Obscuridade',
        'manifesto_equivoco': 'Manifesto Equívoco',
        'erro_material': 'Erro Material',
        'pre_questionamento': 'Pré-Questionamento'
    };
    
    return dicionario[vicioRaw.toLowerCase()] || vicioRaw;
};

window.JurisUtils.obterBadgeTeseCompleto = function(vicioRaw, teseTexto, renderHtml = false) {
    const vicioFormatado = window.JurisUtils.formatarVicioED(vicioRaw);
    if (teseTexto && teseTexto.trim() !== '') {
        return `${vicioFormatado} — ${teseTexto.trim()}`;
    }
    // Se a tese estiver vazia, aplicamos a melhoria de UX caso a flag renderHtml seja true
    return renderHtml 
        ? `${vicioFormatado} <span style="opacity:0.6; font-style:italic; font-weight:normal;">— (Clique para definir a tese recursal)</span>` 
        : vicioFormatado;
};

/* ================================================
   CONTROLE DE INTERFACE DE AUTENTICAÇÃO
   ================================================ */
window.toggleLoginMenu = function(event) {
    event.stopPropagation();
    const menu = document.getElementById('login-menu');
    const jurisMenu = document.getElementById('juris-menu');
    const isVisible = menu.style.display === 'flex';
    
    if (jurisMenu && jurisMenu.style.display === 'flex') {
        jurisMenu.style.display = 'none';
    }
    
    if (!isVisible) {
        menu.style.display = 'flex';
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.left = (rect.right + 12) + 'px';
        menu.style.top = rect.top + 'px';
        setTimeout(() => document.getElementById('login-email').focus(), 50);
    } else {
        menu.style.display = 'none';
    }
};

/* ================================================
   MÓDULO DE ATALHOS FLUTUANTES (SHORTCUT MANAGER V2.1 - SMART FABS REVISED - ED)
   ================================================ */
window.ShortcutManager = (function() {
    let state = { 
        fav1: null, fav2: null, fav3: null, 
        embargosAutora: null, embargosReu: null, embargosReu2: null, acordao: null 
    };
    let currentEditingType = null;
    let isCustomizing = false;
    let hoveredType = null;
    
    const originalIcons = {};

    const baseColors = { 
        fav1: 'is-active-fav1', fav2: 'is-active-fav2', fav3: 'is-active-fav3', 
        embargosAutora: 'is-active-alvo-autora', embargosReu: 'is-active-alvo-re', 
        embargosReu2: 'is-active-alvo-re2', acordao: 'is-active-acordao' 
    };
    
    const baseRotulos = { 
        fav1: 'Favorito 1 (Ouro)', fav2: 'Favorito 2 (Fúcsia)', fav3: 'Favorito 3 (Pastel)', 
        embargosAutora: 'Embargos (Autora)', embargosReu: 'Embargos (Ré 1)', 
        embargosReu2: 'Embargos (Ré 2)', acordao: 'Acórdão Embargado' 
    };

    const STAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

    function init() {
        Object.keys(state).forEach(type => {
            const btn = document.getElementById(getFabId(type));
            if (btn && !originalIcons[type]) {
                originalIcons[type] = btn.innerHTML;
            }
        });
        bindSmartFabEvents();
        updateUI();
    }

    function getTypeFromFabId(id) {
        const map = {
            fav1: 'fab-fav1', fav2: 'fab-fav2', fav3: 'fab-fav3',
            embargosAutora: 'fab-embargos-autora', embargosReu: 'fab-embargos-reu',
            embargosReu2: 'fab-embargos-reu2', acordao: 'fab-acordao'
        };
        return Object.keys(map).find(type => map[type] === id) || null;
    }

    function bindSmartFabEvents() {
        Object.keys(state).forEach(type => {
            const btn = document.getElementById(getFabId(type));
            if (!btn) return;

            btn.addEventListener('mouseenter', () => { hoveredType = type; });
            btn.addEventListener('mouseleave', () => { if (hoveredType === type) hoveredType = null; });

            btn.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                abrirCustomizacao(type);
            });
        });

        document.addEventListener('keydown', (event) => {
            if (!event.ctrlKey || !event.shiftKey || event.code !== 'KeyK') return;

            const activeEl = document.activeElement;
            if (activeEl && (
                activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' ||
                activeEl.tagName === 'SELECT' || activeEl.isContentEditable
            )) { return; }

            const modal = document.getElementById('shortcut-modal');
            if (modal && modal.style.display === 'flex') return;

            let targetType = hoveredType;
            if (!targetType && activeEl && activeEl.classList.contains('fab-shortcut')) {
                targetType = getTypeFromFabId(activeEl.id);
            }

            if (!targetType) {
                exibirToast('Passe o mouse sobre o botão que deseja customizar.', 'aviso');
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            abrirCustomizacao(targetType);
        });
    }

    async function _commitShortcut(type, payload) {
        state[type] = payload;
        updateUI();
        const pageNum = payload ? payload.page : null;
        const msg = pageNum === null ? 'Atalho removido.' : `Atalho atualizado para fl. ${pageNum}!`;
        exibirToast(msg, 'sucesso');
        if (typeof salvarBackupAutomatico === 'function') await salvarBackupAutomatico();
    }

    function updateUI() {
        Object.keys(state).forEach(type => {
            const btn = document.getElementById(getFabId(type));
            if (!btn) return;
            
            if (!originalIcons[type]) originalIcons[type] = btn.innerHTML;

            btn.className = 'fab-btn fab-shortcut'; 
            btn.removeAttribute('data-tooltip');
            btn.title = ''; 
            
            const data = state[type];
            const config = (typeof data === 'number') ? { page: data } : data;

            if (!config || !config.page) {
                btn.classList.add('is-empty');
                btn.setAttribute(
                    'data-tooltip', 
                    `${baseRotulos[type]} — sem página\n[Ctrl+Clique] Capturar página atual\n[Botão direito] ou [Ctrl+Shift+K] Customizar`
                );
                btn.innerHTML = originalIcons[type];
            } else {
                const isCustom = config.isCustom;
                const corClass = isCustom ? `is-active-${config.color}` : baseColors[type];
                const rotulo = isCustom ? (config.label || 'Favorito') : baseRotulos[type];

                btn.classList.add(corClass);
                btn.setAttribute(
                    'data-tooltip', 
                    `⭐ ${rotulo} (fl. ${config.page})\n[Shift+Clique] Editar\n[Botão direito] ou [Ctrl+Shift+K] Customizar/Remover`
                );
                btn.innerHTML = isCustom ? STAR_SVG : originalIcons[type];
            }
        });
    }
    
    function abrirCustomizacao(type) {
        if (!window.PdfEngine || !PdfEngine.getPdfDoc()) {
            exibirToast('Carregue um documento primeiro.', 'aviso');
            return;
        }
        const currentPage = PdfEngine.getCurrentPage();
        const dadoAtual = state[type];
        const paginaAtualDoAtalho = dadoAtual === null || dadoAtual === undefined
            ? currentPage
            : (typeof dadoAtual === 'number' ? dadoAtual : dadoAtual.page);

        abrirModal(type, true, paginaAtualDoAtalho || currentPage);
    }

    async function handleClick(type, event) {
        if (!window.PdfEngine || !PdfEngine.getPdfDoc()) { 
            exibirToast('Carregue um documento primeiro.', 'aviso'); 
            return; 
        }

        const currentPage = PdfEngine.getCurrentPage();

        if (event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault(); 
            event.stopPropagation();
            if (currentPage > 0) {
                await _commitShortcut(type, { page: currentPage });
            }
            return; 
        }

        if (state[type] === null || event.shiftKey) {
            const paginaExistente = state[type] === null
                ? ''
                : (typeof state[type] === 'number' ? state[type] : state[type].page);
            abrirModal(type, false, paginaExistente);
        } else {
            const targetPage = typeof state[type] === 'number' ? state[type] : state[type].page;
            PdfEngine.goToPage(targetPage);
        }
    }

    function abrirModal(type, customMode = false, suggestedPage = '') {
        currentEditingType = type;
        isCustomizing = customMode || (state[type] && state[type].isCustom);

        const titleEl = document.getElementById('shortcut-modal-title');
        if(titleEl) titleEl.textContent = isCustomizing ? 'Customizar Favorito - Página:' : `Página para: ${baseRotulos[type]}`;
        
        const inputEl = document.getElementById('shortcut-page-input');
        if(inputEl) inputEl.value = suggestedPage;
        
        const customFields = document.getElementById('shortcut-custom-fields');
        if(customFields) customFields.style.display = isCustomizing ? 'block' : 'none';
        
        if (isCustomizing && state[type] && state[type].isCustom) {
            const labelInput = document.getElementById('shortcut-label-input');
            if(labelInput) labelInput.value = state[type].label || '';
            
            const radio = document.querySelector(`input[name="shortcut_color"][value="${state[type].color}"]`);
            if(radio) radio.checked = true;
        } else {
            const labelInput = document.getElementById('shortcut-label-input');
            if(labelInput) labelInput.value = '';
            const firstRadio = document.querySelector('input[name="shortcut_color"]');
            if(firstRadio) firstRadio.checked = true;
        }
        
        document.getElementById('shortcut-modal-backdrop').style.display = 'block';
        document.getElementById('shortcut-modal').style.display = 'flex';
        setTimeout(() => inputEl?.focus(), 50);
    }

    async function salvarModal() {
        if (!currentEditingType) return;
        const pageVal = document.getElementById('shortcut-page-input').value.trim();
        const parsedPage = parseInt(pageVal, 10);
        
        if (pageVal === '') {
            await _commitShortcut(currentEditingType, null);
        } else if (!isNaN(parsedPage) && parsedPage > 0) {
            let payload = { page: parsedPage };
            
            if (isCustomizing) {
                const label = document.getElementById('shortcut-label-input').value.trim() || 'Favorito';
                const colorRadio = document.querySelector('input[name="shortcut_color"]:checked');
                const color = colorRadio ? colorRadio.value : 'fuchsia';
                payload = { page: parsedPage, isCustom: true, label, color };
            }
            
            await _commitShortcut(currentEditingType, payload);
        } else {
            exibirToast('Número de página inválido.', 'erro'); 
            return;
        }
        fecharModal();
    }
    
    function fecharModal() {
        currentEditingType = null;
        document.getElementById('shortcut-modal-backdrop').style.display = 'none';
        document.getElementById('shortcut-modal').style.display = 'none';
    }

    function getFabId(type) {
        const map = { 
            fav1: 'fab-fav1', fav2: 'fab-fav2', fav3: 'fab-fav3', 
            embargosAutora: 'fab-embargos-autora', embargosReu: 'fab-embargos-reu', 
            embargosReu2: 'fab-embargos-reu2', acordao: 'fab-acordao' 
        };
        return map[type];
    }

    return { 
        init, handleClick, updateUI, fecharModal, salvarModal,
        getState: () => state,
        setState: (newState) => { if (newState) { state = { ...state, ...newState }; updateUI(); } },
        reset: () => { 
            state = { fav1: null, fav2: null, fav3: null, embargosAutora: null, embargosReu: null, embargosReu2: null, acordao: null }; 
            updateUI(); 
        },
        toggleVisibility: (show) => { 
            Object.keys(state).forEach(type => {
                const btn = document.getElementById(getFabId(type));
                if (btn) btn.style.display = show ? 'flex' : 'none';
            });
        }
    };
})();

/* ================================================
   INICIALIZAÇÃO E INJEÇÃO DE DEPENDÊNCIAS
   ================================================ */
document.addEventListener("DOMContentLoaded", () => {
    document.body.dataset.activeTab = 'leitura';
    SplashScreenManager.init();
    
    if (window.TimeTrackerManager) {
        TimeTrackerManager.init({ getTopicos: () => topicos });
    }
    
    if (window.PdfEngine) {
        PdfEngine.init({
            getTopicos: () => topicos,
            exibirToast: exibirToast,
            atualizarDisplayPaginador: atualizarDisplayPaginador,
            validarPdf: (buffer) => BackupManager.validarPdf(buffer),
            iniciarSessaoBackup: (name, buffer) => BackupManager.iniciarSessao(name, buffer),
            habilitarFerramentas: habilitarFerramentasDeTrabalho,
            onProcessoIdentificado: (numeroCurto) => {
                // Atualiza o DOM (Interface)
                const tagProcesso = document.getElementById('tag-numero-processo');
                if (tagProcesso) {
                    tagProcesso.textContent = numeroCurto;
                    tagProcesso.style.display = 'inline-block';
                    tagProcesso.title = 'Clique para copiar';
                    tagProcesso.classList.add('tag-clicavel-copia');

                    // Clone profundo para prevenir vazamento de memória com listeners acumulados
                    const novaTag = tagProcesso.cloneNode(true);
                    tagProcesso.parentNode.replaceChild(novaTag, tagProcesso);

                    // Evento de clique com Fallback de Clipboard
                    novaTag.addEventListener('click', async () => {
                        try {
                            if (navigator.clipboard && window.isSecureContext) {
                                await navigator.clipboard.writeText(numeroCurto);
                            } else {
                                // Fallback para ambientes sem contexto seguro (ex: file://)
                                const textArea = document.createElement("textarea");
                                textArea.value = numeroCurto;
                                textArea.style.position = "fixed";
                                textArea.style.opacity = "0";
                                document.body.appendChild(textArea);
                                textArea.focus();
                                textArea.select();
                                const executou = document.execCommand('copy');
                                document.body.removeChild(textArea);
                                if (!executou) throw new Error("Comando legado falhou");
                            }
                            exibirToast(`Processo ${numeroCurto} copiado!`, 'sucesso');
                        } catch (err) {
                            console.warn("Erro no Clipboard API:", err);
                            exibirToast('Seu navegador bloqueou a cópia. Copie manualmente.', 'erro');
                        }
                    });
                }
                // Define o nome de backup padrão ED SEM o sufixo arbitrário "_backup"
                window._nomeArquivoSugerido = `ED_${numeroCurto}.json`;
            },
            onPdfCarregado: async (isRetomada) => {
                if (isRetomada) {
                    modoRetomada = false;
                    trocarAba('leitura');
                    exibirToast('PDF validado e carregado. Sessão retomada com sucesso. ✓');
                    
                    if (_sessaoPossuiAudio && typeof window.AudioManager?.prepararRetomada === 'function') {
                        window.AudioManager.prepararRetomada();
                    }
                } else {
                    trocarAba('leitura');
                    console.log("[JURIS LOG] PDF renderizado. Exibindo modal de backup.");
                    document.getElementById('backup-modal-backdrop').style.display = 'block';
                    document.getElementById('modal-ativar-backup').style.display = 'flex';

                    if (window.PjeParser && window.PdfEngine && PdfEngine.getPdfDoc()) {
                        exibirToast('Analisando sumário do processo em segundo plano...', 'aviso');
                        PjeParser.mapearAtalhos(PdfEngine.getPdfDoc())
                            .then(async (atalhos) => {
                                if (atalhos.sentenca) {
                                    window.ShortcutManager.setState({
                                        acordao: atalhos.sentenca || null // O Parser acha a "Sentença", nós mapeamos para "Acórdão" no ED.
                                    });
                                    window.ShortcutManager.toggleVisibility(true);
                                    if (typeof salvarBackupAutomatico === 'function') {
                                        await salvarBackupAutomatico();
                                    }
                                    exibirToast('Atalho do Acórdão Embargado preenchido automaticamente!', 'sucesso');
                                } else {
                                    exibirToast('Análise concluída: Sumário padrão não encontrado.', 'aviso');
                                }
                            })
                            .catch(e => console.warn('[Juris Notes] Erro não-bloqueante no Parser PJe:', e));
                    }
                }
            }
        });
    }

    const savedThemeProcesso = localStorage.getItem('theme-processo') || 'jasmine';
    const savedThemeAnotacoes = localStorage.getItem('theme-anotacoes') || 'white';
    document.body.classList.add(`theme-processo-${savedThemeProcesso}`);
    document.body.classList.add(`theme-anotacoes-${savedThemeAnotacoes}`);

    if (window.AudioManager) AudioManager.init({ getTopicos: () => topicos, exibirToast, salvarAnotacao });
    if (window.ExportManager) ExportManager.init({ getTopicos: () => topicos, exibirToast, getActiveTabId: () => TopicsManager.getActiveTabId() });
    if (window.ShortcutManager) window.ShortcutManager.init(); // <-- INICIALIZA O ICON REGISTRY E EVENTOS

    const historyContainer = document.getElementById('history-container');
    if (historyContainer) historyContainer.addEventListener('scroll', checkScrollFabState, { passive: true });
    
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer) {
        pdfContainer.addEventListener('scroll', checkScrollFabState, { passive: true });
        pdfContainer.addEventListener('click', (e) => {
            const linkAncorado = e.target.closest('.linkAnnotation a');
            if (linkAncorado && !e.defaultPrevented) {
                console.error('🔴 ALERTA: O PDF.js rejeitou a vinculação do evento! O clique vazou.');
                e.preventDefault(); 
            }
        }, true);
    }

    SplashScreenManager.hideInitialLoad();
});

/* ================================================
   GERENCIAMENTO DE INTERFACE E SCROLL DISPATCHER
   ================================================ */
function atualizarDisplayPaginador(pageNum) {
    if (window.PdfEngine && PdfEngine.getCurrentPage() === pageNum) {
        const displayLabel = PdfEngine.getDisplayLabel(pageNum);
        document.getElementById('current-page-display').textContent = displayLabel;
    }
}

window.aplicarTema = function(alvo, tema) { 
    const regex = alvo === 'processo' ? /^theme-processo-/ : /^theme-anotacoes-/;
    document.body.className = document.body.className.split(' ').filter(c => !regex.test(c)).join(' ');
    document.body.classList.add(`theme-${alvo}-${tema}`);
    localStorage.setItem(`theme-${alvo}`, tema);
    
    const menu = document.getElementById('juris-menu');
    if (menu) menu.style.display = 'none';
    exibirToast(`Fundo ${tema === 'white' ? 'Branco' : 'Jasmine'} aplicado a ${alvo}.`, 'sucesso');
};

function getActiveScrollContainer() {
    return document.getElementById('tab-leitura').classList.contains('active') 
        ? document.getElementById('pdf-container') 
        : document.getElementById('history-container');
}

window.toggleModoFoco = function(ativar) {
    const pdfWrapper = document.getElementById('pdf-wrapper');
    if (!pdfWrapper) return;
    if (ativar) pdfWrapper.classList.add('pdf-foco-ativo');
    else pdfWrapper.classList.remove('pdf-foco-ativo');
};

function trocarAba(aba) {
    document.body.dataset.activeTab = aba;

    document.getElementById('pdf-container').style.display     = aba === 'leitura'   ? 'flex'  : 'none';
    document.getElementById('history-container').style.display = aba === 'historico' ? 'block' : 'none';
    document.getElementById('tab-leitura').classList.toggle('active',   aba === 'leitura');
    document.getElementById('tab-historico').classList.toggle('active', aba === 'historico');

    const isAnotacoes = (aba === 'historico' && topicos.length > 0);
    const isLeitura   = (aba === 'leitura');
    
    const btnExportar = document.getElementById('btn-exportar-topico');
    if (btnExportar) btnExportar.style.display = isAnotacoes ? 'flex' : 'none';

    // GERENCIAMENTO DA VISIBILIDADE DO GERADOR DE CONTEXTO
    const btnGerador = document.getElementById('btn-gerador-contexto');
    if (btnGerador) btnGerador.style.display = isAnotacoes ? 'flex' : 'none';
    
    const btnAcervo = document.getElementById('btn-acervo-modelos');
    if (btnAcervo) btnAcervo.style.display = isAnotacoes ? 'flex' : 'none';

    const btnGlobais = document.getElementById('btn-toggle-globais');
    if (btnGlobais) btnGlobais.style.display = isAnotacoes ? 'flex' : 'none';

    const btnTexto = document.getElementById('btn-ferramenta-texto');
    if (btnTexto) btnTexto.style.display = isLeitura ? 'flex' : 'none';

    const btnRecorte = document.getElementById('btn-ferramenta-recorte');
    if (btnRecorte) btnRecorte.style.display = isLeitura ? 'flex' : 'none';

    const btnExtrator = document.getElementById('btn-ferramenta-extrator');
    if (btnExtrator) btnExtrator.style.display = isLeitura ? 'flex' : 'none';

    const fabContainer = document.getElementById('scroll-fab-container');
    if (fabContainer) {
        fabContainer.style.display = 'flex';
        setTimeout(checkScrollFabState, 60);
    }

    if (window.ShortcutManager) {
        const temPdf = (window.PdfEngine && PdfEngine.getPdfDoc());
        window.ShortcutManager.toggleVisibility(aba === 'leitura' && temPdf);
    }

    if (window.AudioManager && typeof window.AudioManager.onTabChange === 'function') {
        window.AudioManager.onTabChange(aba);
    }

    if (window.TimeTrackerManager) {
        TimeTrackerManager.toggleVisibility();
    }

    // [NOVO] Reavalia o botão ao trocar o contexto visual (Aba)
    if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
}

function checkScrollFabState() {
    const hc     = getActiveScrollContainer();
    const btnTop = document.getElementById('btn-scroll-top');
    const btnBot = document.getElementById('btn-scroll-bottom');
    if (!hc || !btnTop || !btnBot) return;

    const scrollable = hc.scrollHeight > hc.clientHeight + 10;
    const atTop      = hc.scrollTop < 50;
    const atBottom   = hc.scrollTop + hc.clientHeight >= hc.scrollHeight - 30;

    btnTop.classList.toggle('is-hidden', atTop);
    btnBot.classList.toggle('is-hidden', !scrollable || atBottom);
}

function rolarParaTopo() {
    const hc = getActiveScrollContainer();
    if (hc) hc.scrollTo({ top: 0, behavior: 'smooth' });
}

function rolarParaFinal() {
    const hc = getActiveScrollContainer();
    if (hc) hc.scrollTo({ top: hc.scrollHeight, behavior: 'smooth' });
}

function exibirToast(mensagem, tipo = 'sucesso', iconeSvgString = null) {
    const toast = document.getElementById('toast-feedback');
    
    if (iconeSvgString) {
        toast.innerHTML = `${iconeSvgString}<span class="toast-text"></span>`;
        toast.querySelector('.toast-text').textContent = mensagem;
    } else {
        toast.innerHTML = '';
        toast.textContent = mensagem;
    }

    toast.className = `toast-feedback toast-${tipo} visivel`;
    clearTimeout(toast._timer);
    
    const tempoExibicao = tipo === 'aviso' ? 4000 : 2800;
    toast._timer = setTimeout(() => {
        toast.classList.remove('visivel');
        setTimeout(() => toast.innerHTML = '', 300);
    }, tempoExibicao);
}

function atualizarStatusBackup(texto, ativa = false) {
    if (texto.includes('Restaurada') || texto.includes('Erro')) {
        exibirToast(`Sistema: ${texto}`, ativa ? 'sucesso' : 'erro');
    }
}

function habilitarFerramentasDeTrabalho() {
    ['btn-ferramenta-recorte', 'btn-ferramenta-texto', 'btn-novo-topico', 'btn-encerrar-sessao', 'btn-ferramenta-audio', 'btn-balanca-justica', 'btn-ferramenta-extrator', 'btn-visao-estruturada', 'btn-visao-minuta']
        .forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        });
    
    if (window.ShortcutManager && document.getElementById('tab-leitura').classList.contains('active')) {
        window.ShortcutManager.toggleVisibility(true);
        window.ShortcutManager.updateUI();
    }
}

function encerrarSessao() {
    const btn = document.getElementById('btn-encerrar-sessao');

    if (!_encerrarConfirmando) {
        _encerrarConfirmando = true;
        btn.classList.add('confirmando');
        btn.title = 'Clique novamente para confirmar';
        exibirToast('Clique novamente no botão para confirmar o encerramento da sessão.', 'aviso');
        _encerrarTimer = setTimeout(() => {
            _encerrarConfirmando = false;
            btn.classList.remove('confirmando');
            btn.title = 'Encerrar Sessão';
        }, 3000);
        return;
    }

    clearTimeout(_encerrarTimer);
    _encerrarConfirmando = false;

    if (typeof modoRecorteAtivo !== 'undefined' && modoRecorteAtivo) desativarOverlayRecorte();
    if (typeof fecharTudoWizard === 'function') fecharTudoWizard();
    if (typeof fecharPopupClassificacao === 'function') fecharPopupClassificacao();
    if (window.AudioManager) window.AudioManager.encerrar();
    if (window.TimeTrackerManager) window.TimeTrackerManager.parar();
    if (window.TaskManager) window.TaskManager.setTarefasState([]);

    topicos      = [];
    modoRetomada = false;
    sessionStorage.removeItem('juris_active_session');

    if (window.TopicsManager && typeof window.TopicsManager.resetVisibilidadeGlobais === 'function') {
        window.TopicsManager.resetVisibilidadeGlobais();
    }
    
    if (window.PdfEngine) window.PdfEngine.encerrar();
    BackupManager.encerrar();
    if (window.ShortcutManager) window.ShortcutManager.reset();

    if (window.BalancaManager) {
        window.BalancaManager.resetarEstado(); // Limpa iframe, contadores e estilos na aba ED
    }

    const wrapper = document.getElementById('pdf-wrapper');
    wrapper.innerHTML     = '';
    wrapper.style.display = 'none';
    document.getElementById('pdf-placeholder').style.display = 'flex';
    document.getElementById('floating-page-panel').style.display = 'none';
    document.getElementById('btn-exportar-topico').style.display = 'none';
    document.getElementById('current-page-display').textContent  = '1';
    document.getElementById('pdf-upload').value = '';

    // NOVO: Limpeza de Estado do Número do Processo
    const tagProcesso = document.getElementById('tag-numero-processo');
    if (tagProcesso) {
        tagProcesso.textContent = '';
        tagProcesso.style.display = 'none';
    }
    window._nomeArquivoSugerido = null; // Reseta nome do backup

    ['btn-ferramenta-recorte', 'btn-ferramenta-texto', 'btn-novo-topico', 'btn-encerrar-sessao', 'btn-ferramenta-audio', 'btn-ferramenta-extrator', 'btn-visao-estruturada', 'btn-visao-minuta']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.disabled = true;
                el.classList.remove('confirmando', 'ativo');
            }
        });
    btn.title = 'Encerrar Sessão';

    renderizarTopicos();
    atualizarStatusBackup('Aguardando...', false);
    trocarAba('leitura');
    exibirToast('Sessão encerrada. Sistema pronto para novo processo.', 'sucesso');
}

/* ================================================
   API DE SISTEMA DE ARQUIVOS E PROCESSO
   ================================================ */
async function retomarProcesso() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Arquivo de Backup', accept: { 'application/json': ['.json'] } }]
        });

        await window.SplashScreenManager.showWithYield("Restaurando mapa mental...");

        let pacote;
        try {
            pacote = await BackupManager.carregarJson(handle);
        } catch {
            window.SplashScreenManager.hide();
            exibirToast('O arquivo selecionado não é um backup válido ou está corrompido.', 'erro');
            return;
        }

        const permissao = await handle.requestPermission({ mode: 'readwrite' });

        topicos      = pacote.dados;
        modoRetomada = true;
        _sessaoPossuiAudio = pacote.metadata.possuiAudio ?? false;

        renderizarTopicos();
        habilitarFerramentasDeTrabalho();
        trocarAba('historico');
        window.SplashScreenManager.hide();

        const isLegado = pacote.metadata.versaoApp === '1.0';
        const msgHash  = isLegado ? ' Backup legado.' : ' O PDF será validado por SHA-256.';

        atualizarStatusBackup(permissao === 'granted' ? 'Sessão Restaurada ✓' : 'Restaurada (sem auto-save)', true);
        exibirToast(`Anotações restauradas.${msgHash} Selecione agora o PDF do processo.`);

        document.getElementById('pdf-upload').click();
    } catch (err) {
        if (window.SplashScreenManager) window.SplashScreenManager.hide();
        modoRetomada = false;
        if (err.name !== 'AbortError') exibirToast('Erro ao restaurar a sessão.', 'erro');
    }
}

async function salvarBackupAutomatico() {
    if (!BackupManager.isAtivo()) return;
    try {
        await BackupManager.salvar(topicos);
    } catch (err) {
        exibirToast('Não foi possível atualizar o backup automático.', 'aviso');
    }
}

async function novoProcesso(event) {
    if ((topicos.length > 0 || (window.PdfEngine && PdfEngine.getPdfDoc())) && !modoRetomada) {
        const continuar = confirm('Iniciar um novo processo irá apagar as anotações em memória não salvas.\nDeseja continuar?');
        if (!continuar) {
            event.target.value = '';
            return;
        }
        if (window.AudioManager) window.AudioManager.encerrar();
        topicos = [];
        BackupManager.encerrar(); 
        if (window.ShortcutManager) window.ShortcutManager.reset();
        renderizarTopicos();
        atualizarStatusBackup('Aguardando...');
    }

    const file = event.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
        exibirToast('Selecione um arquivo PDF válido.', 'erro');
        return;
    }
    
    window._nomeArquivoSugerido = file.name.replace(/\.[^/.]+$/, "").toLowerCase() + ".json";

    if (window.PdfEngine) {
        await window.SplashScreenManager.showWithYield("Processando arquivo PDF...");
        console.log("[JURIS LOG] Iniciando leitura do PDF:", file.name);
        await PdfEngine.carregarPDF(file, modoRetomada);
        window.SplashScreenManager.hide();
    }
}

/* ================================================
   GESTÃO DE TÓPICOS, ANOTAÇÕES E ACERVO (ED)
   ================================================ */

function verificarAcervoEmSegundoPlano(nomeTopico) {
    const agendarTarefaBackground = window.requestIdleCallback || ((cb, opts) => setTimeout(cb, opts?.timeout ?? 1));
    
    agendarTarefaBackground(async () => {
        if (typeof window.AcervoManager === 'undefined') return;
        
        try {
            const modelos = await AcervoManager.carregarModelos();
            if (!modelos || modelos.length === 0) return;
            
            const nomeTopicoMin = nomeTopico.toLowerCase();
            const modelosEncontrados = [];
            const tagsGatilho = new Set();
            
            modelos.forEach(mod => {
                if (mod.tags) {
                    const tagMatch = mod.tags.find(tag => nomeTopicoMin.includes(tag.toLowerCase()));
                    if (tagMatch) {
                        modelosEncontrados.push(mod);
                        tagsGatilho.add(tagMatch); 
                    }
                }
            });
            
            if (modelosEncontrados.length > 0) {
                const quantidade = modelosEncontrados.length;
                let mensagem = "";
                
                if (quantidade === 1) {
                    mensagem = `💡 Dica: Encontramos o modelo "${modelosEncontrados[0].nome}" relacionado a este tópico.`;
                } else {
                    const expressoes = Array.from(tagsGatilho).join(', ');
                    mensagem = `💡 Dica: Encontramos ${quantidade} modelos no acervo baseados na expressão (${expressoes}).`;
                }
                
                const DURACAO_TOAST_ORIGINAL_MS = 2800; 
                const MARGEM_SEGURANCA_MS = 400;
                
                setTimeout(() => {
                    exibirToast(mensagem, 'info');
                }, DURACAO_TOAST_ORIGINAL_MS + MARGEM_SEGURANCA_MS);
            }
            
        } catch (error) {
            console.warn("[Juris Notes] Verificação de acervo em background falhou:", error);
        }
    }, { timeout: 5000 });
}

window.criarTopicoPrompt = function() {
    document.getElementById('input-tema-novo-topico').value = '';
    // Reseta para o primeiro radio selecionado
    document.querySelector('input[name="vicio_alegado_novo"][value="omissao"]').checked = true;
    
    document.getElementById('novo-topico-backdrop').style.display = 'block';
    document.getElementById('modal-novo-topico').style.display = 'flex';
    
    setTimeout(() => {
        document.getElementById('input-tema-novo-topico').focus();
    }, 100);
};

window.fecharModalCriarTopico = function() {
    document.getElementById('novo-topico-backdrop').style.display = 'none';
    document.getElementById('modal-novo-topico').style.display = 'none';
};

window.confirmarCriacaoTopico = function() {
    const radioVicio = document.querySelector('input[name="vicio_alegado_novo"]:checked');
    if (!radioVicio) {
        exibirToast('Selecione uma hipótese legal.', 'erro');
        return;
    }

    const vicioTipado = radioVicio.value; // Chave estruturada limpa (ex: pre_questionamento)
    
    const inputTema = document.getElementById('input-tema-novo-topico');
    const nomeEspecifico = inputTema.value.trim();
    if (!nomeEspecifico) {
        exibirToast('Por favor, defina o tema do embargo.', 'aviso');
        inputTema.focus();
        return;
    }

    // Formatação elegante usando a camada de normalização
    const vicioFormatadoVisivel = window.JurisUtils.formatarVicioED(vicioTipado);
    const nomeCompleto = `${vicioFormatadoVisivel.toUpperCase()} — ${nomeEspecifico}`;
    
    const duplicado = topicos.some(t => t.nome.toLowerCase() === nomeCompleto.toLowerCase());
    if (duplicado) {
        exibirToast(`Já existe análise para "${nomeCompleto}".`, 'aviso');
        return;
    }

    const cor = TopicsManager.obterCor(topicos.length);
    const novoTopicoId = 'topico-' + Date.now();
    
    // Injeta a variável no "Cérebro" do Tópico (SSOT)
    topicos.push({ 
        id: novoTopicoId, 
        nome: nomeCompleto, 
        vicio: vicioTipado, 
        cor, 
        anotacoes: [] 
    });

    fecharModalCriarTopico();
    renderizarTopicos();
    
    if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    
    trocarAba('historico');
    exibirToast(`Análise de ${vicioFormatadoVisivel} iniciada.`, 'sucesso');
    
    if (typeof verificarAcervoEmSegundoPlano === 'function') {
        verificarAcervoEmSegundoPlano(nomeCompleto);
    }
    
    // Dispara o gatilho automático injetando o ID seguro para feedback visual instantâneo
    if (window.TimeTrackerManager && typeof window.TimeTrackerManager.handleNovoTopicoCriado === 'function') {
        window.TimeTrackerManager.handleNovoTopicoCriado(novoTopicoId);
    }
};

function renderizarTopicos() {
    TopicsManager.renderizarFichario(topicos);
    // [NOVO] Garante coerência visual após re-renderizações (ex: restauração de backup)
    if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
    
    // NOVO: Broadcast seguro enviando a variável EXPLICITAMENTE (Injeção de Dependência)
    if (window.BalancaManager && typeof window.BalancaManager.sincronizarTopicos === 'function') {
        window.BalancaManager.sincronizarTopicos(topicos);
    }
}

async function capturarTrechoSelecionado() {
    const selection = window.getSelection();

    // 1. Pipeline de Higienização de Texto
    let selecaoTexto = selection.toString().trim();
    selecaoTexto = window.JurisUtils.limparTextoPDF(selecaoTexto);

    if (selecaoTexto.length <= 5) {
        exibirToast('Selecione um trecho válido no documento.', 'aviso');
        return;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode) return;

    const anchorContainer = (anchorNode.nodeType === 3 ? anchorNode.parentNode : anchorNode).closest('.pdf-page-container');
    const focusContainer = (focusNode.nodeType === 3 ? focusNode.parentNode : focusNode).closest('.pdf-page-container');

    if (!anchorContainer || !focusContainer) {
        exibirToast('A seleção deve estar dentro do PDF.', 'aviso');
        return;
    }

    const anchorPageNum = parseInt(anchorContainer.dataset.pageNumber, 10);
    const focusPageNum = parseInt(focusContainer.dataset.pageNumber, 10);

    const minPage = Math.min(anchorPageNum, focusPageNum);
    const maxPage = Math.max(anchorPageNum, focusPageNum);

    // 2. DOM Read Phase
    const cachedPages = [];
    for (let i = minPage; i <= maxPage; i++) {
        const pageEl = document.querySelector(`.pdf-page-container[data-page-number="${i}"]`);
        if (pageEl) {
            cachedPages.push({ page: i, rect: pageEl.getBoundingClientRect() });
        }
    }

    // [NOVO] Busca o limite de rodapé por conteúdo (não percentual fixo) para cada página envolvida
    if (window.PdfEngine && typeof window.PdfEngine.obterLimiteRodape === 'function') {
        await Promise.all(cachedPages.map(async (p) => {
            p.limiteRodape = await window.PdfEngine.obterLimiteRodape(p.page);
        }));
    }

    const range = selection.getRangeAt(0);
    const rawRects = Array.from(range.getClientRects());
    const mappedRects = [];

    // 3. Compute Phase — descarta rects que caem na zona de assinatura
    rawRects.forEach(rect => {
        const midY = rect.top + (rect.height / 2);
        const matchedPage = cachedPages.find(p => midY >= p.rect.top && midY <= p.rect.bottom);

        if (matchedPage) {
            const localTop = rect.top - matchedPage.rect.top;

            // [NOVO] Se a linha estiver na zona de assinatura desta página específica, ignora o grifo
            if (matchedPage.limiteRodape != null && localTop >= matchedPage.limiteRodape) {
                return;
            }

            mappedRects.push({
                page: matchedPage.page,
                top: localTop,
                left: rect.left - matchedPage.rect.left,
                width: rect.width,
                height: rect.height
            });
        }
    });

    if (mappedRects.length === 0) {
        exibirToast('Seleção restrita à área de assinatura do documento.', 'aviso');
        window.getSelection().removeAllRanges();
        return;
    }

    // 4. Update de Estado
    _tempHighlightState.rects = mappedRects;
    _tempHighlightState.paginaFisica = anchorPageNum;

    // 5. Restauração de UX
    if (typeof exibirPopupClassificacao === 'function') {
        const popupAnchorX = rawRects[rawRects.length - 1].left;
        const popupAnchorY = rawRects[rawRects.length - 1].bottom + 10;
        exibirPopupClassificacao('texto', selecaoTexto, popupAnchorX, popupAnchorY, anchorPageNum);
    }
}

function identificarFaseMetodologica(docNome) {
    if (!docNome) return 4; 
    if (typeof DOC_CONFIG !== 'undefined') {
        const conf = DOC_CONFIG.find(d => d.label === docNome);
        if (conf) return conf.fase;
    }
    const upper = docNome.toUpperCase();
    
    // Regex e Lógica blindada contra colisão de ED vs Sentença
    if (upper.includes('SENTENÇA') || upper.includes('ACÓRDÃO') || upper.includes('DECISÃO')) return 3;
    if (upper.includes('EMBARGOS') || upper.includes('CONTRAMINUTA')) return 1; // Embargos só cai aqui se NÃO contiver Sentença/Acórdão
    if (upper.includes('RECURSO') || upper.includes('CONTRARRAZÕES')) return 2; // Passa a ser Fase 2
    if (upper.includes('INICIAL') || upper.includes('CONTEST') || upper.includes('IMPUGNAÇÃO')) return 2;
    return 4; 
}

/**
 * Exclui um marco de extração com segurança de estado e atualiza a UI.
 */
window.excluirMarcadorExtracao = function(topicoId, docTipo, fronteira) {
    const fronteiraLabel = fronteira === 'inicio' ? 'INÍCIO' : 'FIM';
    if (!confirm(`Deseja apagar o marcador de ${fronteiraLabel} deste documento?`)) return;

    const topico = topicos.find(t => t.id === topicoId);
    if (!topico || !topico.marcosExtracao) return;

    // Mutação Segura: Filtra o array preservando imutabilidade estrutural
    topico.marcosExtracao = topico.marcosExtracao.filter(m => !(m.docTipo === docTipo && m.fronteira === fronteira));

    exibirToast(`Marcador de ${fronteiraLabel} excluído.`, 'sucesso');
    
    // Atualização em Cascata (Assíncrona para não bloquear a UI)
    requestAnimationFrame(() => {
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
        // Re-renderiza o painel atualizado
        if (window.ExportManager && typeof window.ExportManager.abrirPainelExportacao === 'function') {
            window.ExportManager.abrirPainelExportacao();
        }
    });
};

async function salvarAnotacao(tipo, conteudo, documento, polo, topicoId, comentario = '', targetParentIndex = null, anchorPageOverride = null, vicioAlegado = null) {
    const capturedHighlights = (tipo === 'texto' || tipo === 'imagem') && _tempHighlightState.rects 
        ? structuredClone(_tempHighlightState.rects) : null;
    const capturedPagina = _tempHighlightState.paginaFisica;

    const topicoAlvo = topicos.find(t => t.id === topicoId);
    if (!topicoAlvo) return;

    const pageTarget = anchorPageOverride || (capturedPagina ? capturedPagina : (window.PdfEngine ? PdfEngine.getCurrentPage() : 1));
    let metaDaPagina = { pjeId: null, flsNum: null };
    
    if (window.PdfEngine) {
        metaDaPagina = await PdfEngine.extrairMetadadosDaPagina(pageTarget);
    }
    
    const novaExtracao = {
        uuid: 'id-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36),
        tipo,
        documento,
        polo,
        pagina: window.PdfEngine ? PdfEngine.obterRotuloPagina(pageTarget) : pageTarget, 
        paginaFisica: pageTarget, 
        timestamp: Date.now(),
        conteudo: conteudo,
        pjeId: metaDaPagina.pjeId,
        comentario: comentario
    };

    if (capturedHighlights) novaExtracao.highlightRects = capturedHighlights;
    const faseNova = identificarFaseMetodologica(documento);

    if (targetParentIndex !== null && targetParentIndex !== '') {
        const parentNode = topicoAlvo.anotacoes[targetParentIndex];
        if (!parentNode.itensCorrelacionados) parentNode.itensCorrelacionados = [];
        parentNode.itensCorrelacionados.push(novaExtracao);
        exibirToast(`Item agrupado à Ideia ${parseInt(targetParentIndex) + 1}.`);
    } else {
        // --- NOVA LÓGICA DE INJEÇÃO E PROPAGAÇÃO DO VÍCIO ---
        if (vicioAlegado) {
            novaExtracao.vicio = vicioAlegado; // Injeta no Card
            // Propaga para o Tópico (Base para o Dashboard de Maturidade)
            if (!topicoAlvo.vicio) topicoAlvo.vicio = vicioAlegado;
        }

        novaExtracao.subAnotacoes = [];
        novaExtracao.itensCorrelacionados = [];
        
        // Ajuste de Terminologia no Aviso de Pulo Metodológico
        const temFase2 = topicoAlvo.anotacoes.some(a => identificarFaseMetodologica(a.documento) === 2);
        if (faseNova === 3 && !temFase2) {
            exibirToast("Atenção: Cadê a peça de provocação original (RO/Contestação) para validar o ED?", "aviso");
        } else {
            exibirToast(`Anotação salva em "${topicoAlvo.nome}".`);
        }

        let insertIndex = topicoAlvo.anotacoes.length;
        for (let i = 0; i < topicoAlvo.anotacoes.length; i++) {
            if (identificarFaseMetodologica(topicoAlvo.anotacoes[i].documento) > faseNova) {
                insertIndex = i;
                break;
            }
        }
        topicoAlvo.anotacoes.splice(insertIndex, 0, novaExtracao);
    }

    if (capturedHighlights && capturedPagina) {
        if (window.getSelection) window.getSelection().removeAllRanges();
    }
    
    if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    renderizarTopicos();
    salvarBackupAutomatico();
}

/* ================================================
   NAVEGAÇÃO E UTILITÁRIOS DA INTERFACE
   ================================================ */
window.navegarParaAnotacao = function(topicoId, anotacaoIndex) {
    if (!document.getElementById('tab-historico').classList.contains('active')) {
        trocarAba('historico');
    }

    if (window.TopicsManager && TopicsManager.getActiveTabId() !== topicoId) {
        TopicsManager.setActiveTabId(topicoId);
        renderizarTopicos(); 
    }

    exibirToast('Localizando anotação no fichário...');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const scrollContainer = document.getElementById('history-container');
            const topicoTarget = topicos.find(t => t.id === topicoId);
            const uuidTarget = topicoTarget && topicoTarget.anotacoes[anotacaoIndex] ? topicoTarget.anotacoes[anotacaoIndex].uuid : null;
            const targetId = uuidTarget ? `timeline-wrapper-${uuidTarget}` : `timeline-wrapper-${anotacaoIndex}`;
            const targetElement = document.getElementById(targetId);

            if (!targetElement) {
                exibirToast('Não foi possível localizar o card alvo. Ele pode ter sido excluído.', 'erro');
                return;
            }

            if (scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();
                const offset = (targetRect.top - containerRect.top) + scrollContainer.scrollTop - 16;
                
                scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });

                const card = targetElement.querySelector('.main-card-wrapper > .annotation-card');
                if (card) {
                    card.classList.remove('card-flash-focus');
                    void card.offsetWidth; 
                    card.classList.add('card-flash-focus');
                }
            }
        });
    });
};

function irParaPagina() {
    const input = document.getElementById('goto-page-input');
    const termoBusca = input.value.trim().toLowerCase();
    
    if (!window.PdfEngine || !PdfEngine.getPdfDoc()) {
        exibirToast('Carregue um documento primeiro.', 'aviso');
        return;
    }
    
    if (!termoBusca) return;

    const targetPage = PdfEngine.resolverPagina(termoBusca);

    if (targetPage) {
        PdfEngine.goToPage(targetPage);
        input.value = '';
    } else {
        exibirToast(`Página não encontrada. Digite um número ou rótulo válido.`, 'erro');
    }
}

document.getElementById('goto-page-input')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') irParaPagina();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (typeof fecharPopupClassificacao === 'function') fecharPopupClassificacao();
        if (typeof cancelarRecorteWizard === 'function') cancelarRecorteWizard();
        
        // NOVO: Delegação genérica para fechamento de modais
        const modaisFechaveis = document.querySelectorAll('.fechavel-por-esc');
        modaisFechaveis.forEach(modal => {
            if (modal.style.display === 'flex' || modal.style.display === 'block') {
                if (modal.id === 'outline-view-modal' && window.OutlineViewManager) OutlineViewManager.fechar();
                if (modal.id === 'minuta-view-modal' && window.MinutaViewManager) MinutaViewManager.fechar();
                if (modal.id === 'modal-tarefas' && window.TaskManager) TaskManager.fecharModal();
            }
        });
    }
});

document.addEventListener('click', function (e) {
    const popup = document.getElementById('classification-popup');
    
    // ARQUITETURA SSOT: Identifica se o clique nasceu dentro de um menu suspenso (portal)
    // O(log n) na subida da árvore DOM.
    const isClickInsidePortal = e.target.closest('.jcs-options-portal');
    
    if (popup && popup.style.display === 'flex' && !popup.contains(e.target) && !e.target.closest('.icon-btn') && !isClickInsidePortal) {
        if (typeof fecharPopupClassificacao === 'function') fecharPopupClassificacao();
    }
    
    const menu = document.getElementById('annotation-context-menu');
    if (menu) menu.style.display = 'none';

    const menuSub = document.getElementById('sub-annotation-context-menu');
    if (menuSub) menuSub.style.display = 'none';

    const menuJuris = document.getElementById('juris-menu');
    if (menuJuris && menuJuris.style.display === 'flex' && !menuJuris.contains(e.target) && !e.target.closest('.sidebar-logo-container')) {
        menuJuris.style.display = 'none';
    }

    const loginMenu = document.getElementById('login-menu');
    if (loginMenu && loginMenu.style.display === 'flex' && !loginMenu.contains(e.target) && !e.target.closest('#btn-login-user')) {
        loginMenu.style.display = 'none';
    }
});

/* ================================================
   MENU JURIS NOTES E GESTÃO DE ABAS
   ================================================ */
function abrirMenuJuris(event) {
    event.stopPropagation();
    const menu = document.getElementById('juris-menu');
    menu.style.display = 'flex';
    menu.style.left = (event.clientX + 10) + 'px';
    menu.style.top = (event.clientY + 20) + 'px';
}

function abrirModalGerenciarAbas() {
    document.getElementById('juris-menu').style.display = 'none';
    const container = document.getElementById('lista-abas-gerenciador');
    container.innerHTML = '';

    if(topicos.length === 0) {
        container.innerHTML = '<p class="popup-label" style="text-align:center;">Nenhuma aba criada.</p>';
    } else {
        let htmlAcumulado = '';
        topicos.forEach((t, index) => {
            const nomeSeguro = TopicsManager.escaparHTML(t.nome);
            htmlAcumulado += `
                <div class="aba-manager-item" draggable="true" 
                     data-index="${index}"
                     ondragstart="AbaDnD.start(event)"
                     ondragover="AbaDnD.over(event)"
                     ondrop="AbaDnD.drop(event)"
                     ondragenter="AbaDnD.enter(event)"
                     ondragleave="AbaDnD.leave(event)"
                     ondragend="AbaDnD.end(event)"
                     style="cursor: grab; transition: opacity 0.2s;">
                    <span class="aba-manager-nome" title="${nomeSeguro}">
                        <span style="color:#ccc; margin-right:6px; font-size:1.1rem; vertical-align: middle;">⋮⋮</span> ${nomeSeguro}
                    </span>
                    <div class="aba-manager-actions">
                        <button class="ann-action-btn" title="Editar Nome" onclick="renomearAba('${t.id}')">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="ann-action-btn ann-action-delete" title="Excluir Aba" onclick="solicitarExclusaoAba(this, '${t.id}')">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>`;
        });
        container.innerHTML = htmlAcumulado;
    }

    document.getElementById('abas-modal-backdrop').style.display = 'block';
    document.getElementById('modal-gerenciar-abas').style.display = 'flex';
}

function fecharModalGerenciarAbas() {
    document.getElementById('abas-modal-backdrop').style.display = 'none';
    document.getElementById('modal-gerenciar-abas').style.display = 'none';
}

async function renomearAba(id) {
    const topico = topicos.find(t => t.id === id);
    if (!topico) return;
    
    const novoNome = await JurisPrompt.ask(
        '✏️ Renomear Aba', 
        'Digite o novo nome para a aba:', 
        'Novo nome...', 
        topico.nome
    );
    
    if (novoNome && novoNome.trim() !== '' && novoNome.trim() !== topico.nome) {
        topico.nome = novoNome.trim();
        renderizarTopicos();
        salvarBackupAutomatico();
        abrirModalGerenciarAbas(); 
        exibirToast('Aba renomeada com sucesso!', 'sucesso');
    }
}

function solicitarExclusaoAba(btnEl, id) {
    if (btnEl.dataset.confirming === "true") {
        if (window.TopicsManager && TopicsManager.getActiveTabId() === id) {
            if (window.TimeTrackerManager && typeof window.TimeTrackerManager.tratarExclusaoAba === 'function') {
                window.TimeTrackerManager.tratarExclusaoAba();
            }
        }
        
        topicos = topicos.filter(t => t.id !== id);
        renderizarTopicos();
        salvarBackupAutomatico();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        abrirModalGerenciarAbas(); 
        exibirToast('Aba excluída.', 'sucesso');
    } else {
        btnEl.dataset.confirming = "true";
        const svgOriginal = btnEl.innerHTML;
        btnEl.innerHTML = "<span style='font-size:0.75rem; font-weight:bold;'>Confirma?</span>";
        btnEl.style.color = "#c62828";
        btnEl.style.backgroundColor = "#ffebee";
        
        setTimeout(() => {
            if (document.body.contains(btnEl)) {
                btnEl.dataset.confirming = "false";
                btnEl.innerHTML = svgOriginal;
                btnEl.style.color = "";
                btnEl.style.backgroundColor = "";
            }
        }, 3500);
    }
}

window.handleMetaClick = async function(event, topicoId, index, isCorrelated = false, cIdx = null) {
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico) return;

    const anotacao = isCorrelated 
        ? topico.anotacoes[index].itensCorrelacionados[cIdx] 
        : topico.anotacoes[index];

    if (event.shiftKey) {
        const novaPagina = await JurisPrompt.ask(
            '📄 Editar Âncora de Página', 
            `Editar folha (Atual: ${anotacao.pagina || 'vazio'}):`, 
            'Nº da folha (ex: 302)', 
            anotacao.pagina || ''
        );
        
        if (novaPagina !== null) {
            anotacao.pagina = novaPagina;
            renderizarTopicos();
            salvarBackupAutomatico();
            exibirToast('Numeração de página atualizada!', 'sucesso');
        }

    } else if (event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation(); 

        const targetPage = anotacao.paginaFisica;

        if (!targetPage || isNaN(targetPage)) {
            exibirToast('Esta anotação foi capturada em uma versão antiga e não possui âncora física.', 'aviso');
            return;
        }

        if (!window.PdfEngine || !PdfEngine.getPdfDoc()) {
            exibirToast('Carregue o PDF do processo para acessar a folha correspondente.', 'aviso');
            return;
        }

        const isAbaProcessoAtiva = document.getElementById('tab-leitura').classList.contains('active');
        if (!isAbaProcessoAtiva) {
            trocarAba('leitura');
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                PdfEngine.goToPage(targetPage);
            });
        });

    } else {
        let textoParaCopiar = event.target.innerText;

        if (anotacao.tipo === 'audio') {
            try {
                const dados = JSON.parse(anotacao.conteudo);
                textoParaCopiar = `(${dados.labelInicio} a ${dados.labelFim} da gravação da audiência)`;
            } catch (e) {
                console.warn("[Juris Notes] Falha ao processar metadados de áudio.", e);
            }
        }

        navigator.clipboard.writeText(textoParaCopiar).then(() => {
            exibirToast('Referência copiada para a área de transferência.', 'sucesso');
        }).catch(() => {
            exibirToast('Falha ao copiar texto.', 'erro');
        });
    }
};

function abrirModalAjuda() {
    const menuJuris = document.getElementById('juris-menu');
    if (menuJuris) menuJuris.style.display = 'none';
    document.getElementById('ajuda-modal-backdrop').style.display = 'block';
    document.getElementById('modal-ajuda-intencoes').style.display = 'flex';
}

function fecharModalAjuda() {
    document.getElementById('ajuda-modal-backdrop').style.display = 'none';
    document.getElementById('modal-ajuda-intencoes').style.display = 'none';
}

window.AbaDnD = {
    draggedIndex: null,
    start: function(e) {
        this.draggedIndex = parseInt(e.currentTarget.dataset.index);
        e.currentTarget.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
    },
    over: function(e) { 
        e.preventDefault(); 
        e.dataTransfer.dropEffect = 'move'; 
    },
    enter: function(e) { 
        const item = e.currentTarget;
        item._dragCount = (item._dragCount || 0) + 1;
        item.style.borderTop = '3px dashed var(--trt-blue-mid)';
    },
    leave: function(e) { 
        const item = e.currentTarget;
        item._dragCount = (item._dragCount || 1) - 1;
        if (item._dragCount <= 0) {
            item.style.borderTop = '1px solid var(--border-color)';
            item._dragCount = 0;
        }
    },
    drop: function(e) {
        e.preventDefault();
        const targetElement = e.currentTarget.closest('.aba-manager-item');
        if (!targetElement) return;
        
        const targetIndex = parseInt(targetElement.dataset.index);
        if (this.draggedIndex === targetIndex) return;

        const [movido] = topicos.splice(this.draggedIndex, 1);
        topicos.splice(targetIndex, 0, movido);

        renderizarTopicos();
        salvarBackupAutomatico();
        exibirToast('Abas reordenadas com sucesso!', 'sucesso');
    },
    end: function(e) {
        e.currentTarget.style.opacity = '1';
        document.querySelectorAll('.aba-manager-item').forEach(el => {
            el.style.borderTop = '1px solid var(--border-color)';
            el._dragCount = 0;
        });
        if (typeof abrirModalGerenciarAbas === 'function') abrirModalGerenciarAbas(); 
    }
};

window.addEventListener('pageshow', (event) => {
    if (event.persisted && window.TopicsManager && topicos.length > 0) {
        TopicsManager.renderizarFichario(topicos);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (sessionStorage.getItem('juris_active_session') === 'true' && topicos.length === 0) {
            exibirToast('O navegador suspendeu esta aba e limpou a memória. Clique em "Retomar Processo" para carregar seu arquivo de backup.', 'erro');
            sessionStorage.removeItem('juris_active_session'); 
            return;
        }

        // Recuperação ativa e cirúrgica dos Canvases (Sem layout thrashing O(N))
        if (window.PdfEngine && window.PdfEngine.getPdfDoc && PdfEngine.getPdfDoc() && topicos.length > 0) {
            console.log("[JURIS LOG ED] Retornou à aba. Reconstruindo contexto das páginas na viewport...");
            // O(1) restrito às páginas ativas (Tracking via Set)
            PdfEngine.forcarReRenderizacaoVisiveis();
            
            // Re-renderização leve e síncrona do UI pararelo
            if(window.TopicsManager) TopicsManager.renderizarFichario(topicos);
        }
    }
});

/* ================================================
   CRIAÇÃO EXPLÍCITA DE BACKUP (Resolve erro de ativação)
   ================================================ */
async function acionarCriacaoBackup() {
    console.log("[JURIS LOG] Usuário clicou em criar backup. Iniciando FileSystem API...");
    
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: window._nomeArquivoSugerido || 'backup_processo.json',
            types: [{ description: 'Arquivo de Backup Juris Notes', accept: { 'application/json': ['.json'] } }]
        });
        
        console.log("[JURIS LOG] Permissão concedida pelo usuário. Handle capturado.");
        
        BackupManager.setFileHandle(handle);
        atualizarStatusBackup('Sessão Ativa ✓', true);
        sessionStorage.setItem('juris_active_session', 'true');
        
        await salvarBackupAutomatico();
        
        document.getElementById('backup-modal-backdrop').style.display = 'none';
        document.getElementById('modal-ativar-backup').style.display = 'none';
        exibirToast('Backup ancorado! Salvamento automático ativado.', 'sucesso');
        
    } catch (err) {
        console.error("[JURIS LOG FATAL] Falha ao criar arquivo de backup:");
        console.error("Nome do Erro:", err.name);
        console.error("Mensagem:", err.message);
        
        if (err.name === 'AbortError') {
            console.log("[JURIS LOG] O usuário cancelou a janela de salvar.");
            exibirToast('Você cancelou a criação do backup. Clique novamente para tentar.', 'aviso');
        } else if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
            exibirToast('O navegador bloqueou a gravação. Verifique as permissões de download.', 'erro');
        } else {
            exibirToast('Erro desconhecido ao tentar criar o arquivo.', 'erro');
        }
    }
}

/* ================================================
   MÓDULO DE MEDIÇÃO DE EFICIÊNCIA (TIME TRACKER)
   ================================================ */
window.TimeTrackerManager = (function() {
    let _getTopicos = () => []; 
    
    let isAutoMode = false;
    let isRodando = false;
    let tempoSegundos = 0;
    let intervaloId = null;
    let complexidadeAtual = 'medio';
    let marcosAtingidos = { excelente: false, bom: false, cautela: false };

    const limites = {
        simples: [45 * 60, 60 * 60, 90 * 60],
        medio: [60 * 60, 90 * 60, 105 * 60],
        complexo: [90 * 60, 120 * 60, 150 * 60]
    };

    function init(deps) {
        if (deps && typeof deps.getTopicos === 'function') {
            _getTopicos = deps.getTopicos;
        }
        
        const savedState = localStorage.getItem('juris_auto_timer_ed');
        isAutoMode = savedState === 'true';

        const toggleEl = document.getElementById('toggle-auto-cronometro');
        if (toggleEl) {
            toggleEl.checked = isAutoMode;
            toggleEl.addEventListener('change', (e) => {
                isAutoMode = e.target.checked;
                localStorage.setItem('juris_auto_timer_ed', isAutoMode);
                exibirToast(`Modo Automático ${isAutoMode ? 'Ativado' : 'Desativado'}.`, 'info');
            });
        }
    }

    function toggleVisibility() {
        const container = document.getElementById('efficiency-tracker-container');
        const isHistorico = document.body.dataset.activeTab === 'historico';
        const temTopico = _getTopicos().length > 0;
        
        const deveExibir = isHistorico && temTopico;
        
        container.style.display = deveExibir ? 'flex' : 'none';
        if (deveExibir) sincronizarCor();
    }

    function handleClick() {
        document.getElementById('modal-tracker-backdrop').style.display = 'block';
        document.getElementById('modal-tracker-config').style.display = 'block';
        
        const svgIcon = isRodando 
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px; height:18px; margin-right:6px; vertical-align:middle;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px; height:18px; margin-right:6px; vertical-align:middle;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';

        document.getElementById('tracker-modal-title').innerHTML = `${svgIcon} ${isRodando ? 'Pausar / Encerrar' : 'Iniciar Contagem'}`;
        document.getElementById('tracker-start-step').style.display = isRodando ? 'none' : 'block';
        document.getElementById('tracker-stop-step').style.display = isRodando ? 'block' : 'none';
    }

    function fecharModal() {
        document.getElementById('modal-tracker-backdrop').style.display = 'none';
        document.getElementById('modal-tracker-config').style.display = 'none';
    }

    function iniciar(isSilencioso = false, topicoIdForce = null) {
        const selectEl = document.getElementById('tracker-complexity-select');
        if (selectEl && selectEl.value) {
            complexidadeAtual = selectEl.value;
        }

        marcosAtingidos = { excelente: false, bom: false, cautela: false };
        isRodando = true;
        fecharModal();
        
        sincronizarCor(topicoIdForce);
        document.getElementById('efficiency-tracker-dot').classList.add('pulsing');
        
        const pill = document.getElementById('efficiency-tracker-pill');
        if (pill) pill.classList.remove('milestone-1', 'milestone-2', 'milestone-3');
        
        if (intervaloId) clearInterval(intervaloId);
        intervaloId = setInterval(tick, 1000);

        if (!isSilencioso) {
            exibirToast(`Cronômetro ativado. Foco na análise!`, 'info');
        }
    }

    function pararSilencioso() {
        isRodando = false;
        if (intervaloId) clearInterval(intervaloId);
        
        const dot = document.getElementById('efficiency-tracker-dot');
        const pill = document.getElementById('efficiency-tracker-pill');
        
        if(dot) {
            dot.classList.remove('pulsing');
            dot.style.backgroundColor = '#ccc';
            dot.style.boxShadow = 'none';
        }
        
        if(pill) pill.classList.remove('milestone-1', 'milestone-2', 'milestone-3');
        
        tempoSegundos = 0;
        atualizarDisplay();
    }

    function parar() {
        const timeEl = document.getElementById('efficiency-tracker-time');
        const tempoFinal = timeEl ? timeEl.textContent : '00:00';
        pararSilencioso();
        fecharModal();
        exibirToast(`Tópico concluído. Tempo de tela: ${tempoFinal}`, 'sucesso');
    }

    function tick() {
        tempoSegundos++;
        atualizarDisplay();
        verificarMarcos();
    }

    function atualizarDisplay() {
        const timeEl = document.getElementById('efficiency-tracker-time');
        if(!timeEl) return;

        const h = Math.floor(tempoSegundos / 3600);
        const m = Math.floor((tempoSegundos % 3600) / 60);
        const s = tempoSegundos % 60;
        
        let texto = '';
        if (h > 0) texto += `${h.toString().padStart(2, '0')}:`;
        texto += `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        timeEl.textContent = texto;
    }

    function verificarMarcos() {
        if (!complexidadeAtual) return;
        const metas = limites[complexidadeAtual];
        const pill = document.getElementById('efficiency-tracker-pill');
        if (!pill) return;

        if (tempoSegundos === metas[0] && !marcosAtingidos.excelente) {
            pill.classList.add('milestone-1');
            marcosAtingidos.excelente = true;
        } 
        else if (tempoSegundos === metas[1] && !marcosAtingidos.bom) {
            pill.classList.remove('milestone-1');
            pill.classList.add('milestone-2');
            marcosAtingidos.bom = true;
        } 
        else if (tempoSegundos === metas[2] && !marcosAtingidos.cautela) {
            pill.classList.remove('milestone-2');
            pill.classList.add('milestone-3');
            marcosAtingidos.cautela = true;
        }
    }

    function sincronizarCor(topicoIdForce = null) {
        const topicosData = _getTopicos();
        const activeTabId = topicoIdForce || (typeof TopicsManager !== 'undefined' ? TopicsManager.getActiveTabId() : null);
        let cor = '#ccc'; 
        
        if (activeTabId && topicosData.length > 0) {
            const topico = topicosData.find(t => t.id === activeTabId);
            if (topico && topico.cor) cor = topico.cor;
        }

        const pill = document.getElementById('efficiency-tracker-pill');
        const dot = document.getElementById('efficiency-tracker-dot');
        
        if (pill) {
            pill.style.setProperty('--tracker-color', cor);
        }

        if (isRodando && dot) {
            dot.style.backgroundColor = cor;
            dot.style.boxShadow = `0 0 8px ${cor}`;
        }
    }

    function handleNovoTopicoCriado(novoTopicoId = null) {
        if (!isAutoMode) return;
        if (isRodando) pararSilencioso();

        requestAnimationFrame(() => {
            iniciar(true, novoTopicoId);
        });
    }

    function tratarExclusaoAba() {
        if (isRodando) {
            pararSilencioso();
        }
    }

    return { 
        init, toggleVisibility, handleClick, fecharModal, iniciar, parar, 
        sincronizarCor, handleNovoTopicoCriado, tratarExclusaoAba 
    };
})();

/* ================================================
   [NOVO] Validador de Estado do Extrator (Escopo: Tópico Ativo)
   ================================================ */
window.atualizarStatusBotaoExtrator = function() {
    const btn = document.getElementById('btn-ferramenta-extrator');
    if (!btn) return;

    // Remove o destaque caso não haja aba ativa
    const activeTabId = typeof TopicsManager !== 'undefined' ? TopicsManager.getActiveTabId() : null;
    if (!activeTabId) {
        btn.classList.remove('extrator-completo');
        return;
    }

    const topico = topicos.find(t => t.id === activeTabId);
    if (!topico || !topico.marcosExtracao || topico.marcosExtracao.length === 0) {
        btn.classList.remove('extrator-completo');
        return;
    }

    // Flags para espelhar a exata regra do gerador de payload da IA
    let hasSentencaInicio = false, hasSentencaFim = false;
    let hasRecursoInicio = false, hasRecursoFim = false;

    topico.marcosExtracao.forEach(m => {
        // A lógica espelha: if (docTipo === 'decisao') { ... } else { /* é embargos */ }
        // Nota ED: no gerador-contexto do ED (ed_interaction-tools.js), os docs extraídos são 'decisao' e qualquer outro ('embargos').
        if (m.docTipo === 'decisao') {
            if (m.fronteira === 'inicio') hasSentencaInicio = true;
            if (m.fronteira === 'fim') hasSentencaFim = true;
        } else {
            if (m.fronteira === 'inicio') hasRecursoInicio = true;
            if (m.fronteira === 'fim') hasRecursoFim = true;
        }
    });

    if (hasSentencaInicio && hasSentencaFim && hasRecursoInicio && hasRecursoFim) {
        btn.classList.add('extrator-completo');
        btn.title = 'Contexto Completo! (Decisão e Embargos mapeados)';
    } else {
        btn.classList.remove('extrator-completo');
        btn.title = 'Alfinete de Extração (Marcar Início/Fim para IA)';
    }
};

/* ================================================
   MÓDULO GERENCIADOR DE TAREFAS NATIVO (TASK MANAGER)
   ================================================ */
window.TaskManager = (function() {
    let selectorArmTimer = null;

    async function abrirModal(e) {
        if(e) e.stopPropagation();
        const backdrop = document.getElementById('tarefas-modal-backdrop');
        const modal = document.getElementById('modal-tarefas');
        
        RenderCycle.bloquearScrollBody(true);
        backdrop.style.display = 'block';
        modal.style.display = 'flex';
        
        await RenderCycle.awaitNextFrame();
        
        atualizarBadge();
        const lista = document.getElementById('native-obs-list');
        if(lista) lista.scrollTop = 0;
    }

    function fecharModal() {
        document.getElementById('tarefas-modal-backdrop').style.display = 'none';
        document.getElementById('modal-tarefas').style.display = 'none';
        RenderCycle.bloquearScrollBody(false);
        atualizarBadge();
        if(typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    }

    function adicionarTarefa() {
        const container = document.getElementById('native-obs-list');
        if(!container) return;
        const div = document.createElement('div');
        div.className = 'native-task-item';
        
        div.innerHTML = `
            <input type="checkbox" onchange="TaskManager.toggleConcluido(this)">
            <div class="topic-circle-indicator" data-topic-id="global" title="Global" style="background-color: #ffffff; border: 2px solid #cbd5e1;" onclick="TaskManager.abrirSeletorTemas(this, event)"></div>
            <input type="text" placeholder="Escreva sua tarefa..." oninput="this.setAttribute('value', this.value);">
            <button onclick="this.parentElement.remove(); TaskManager.atualizarBadge();" style="border:none; background:none; cursor:pointer; color:#ef4444; margin-left: 8px;">✕</button>
        `;
        container.appendChild(div);
        
        requestAnimationFrame(() => {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        });
        atualizarBadge();
        if(typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    }

    function toggleConcluido(chk) {
        const item = chk.closest('.native-task-item');
        if(chk.checked) {
            item.classList.add('completed');
            chk.setAttribute('checked', 'checked');
        } else {
            item.classList.remove('completed');
            chk.removeAttribute('checked');
        }
        atualizarBadge();
        if(typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    }

    function atualizarBadge() {
        const container = document.getElementById('native-obs-list');
        if(!container) return;
        
        const pendentes = container.querySelectorAll('input[type="checkbox"]:not(:checked)').length;
        const btn = document.getElementById('btn-lembretes-tarefa');
        const badge = document.getElementById('badge-tarefas');
        
        if (!btn) return;

        if(pendentes > 0) {
            btn.classList.add('has-tasks');
            if(badge) {
                badge.style.display = 'flex';
                badge.textContent = pendentes > 99 ? '99+' : pendentes;
            }
        } else {
            btn.classList.remove('has-tasks');
            if(badge) badge.style.display = 'none';
        }
    }

    function abrirSeletorTemas(circleEl, event) {
        if (event) event.stopPropagation();

        document.querySelectorAll('.obs-topic-selector-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'obs-topic-selector-menu jcs-options-portal';
        menu.style.visibility = 'hidden'; 
        menu.style.position = 'fixed';
        menu.style.width = '200px';

        const optionGlobal = document.createElement('div');
        optionGlobal.className = 'jcs-option';
        optionGlobal.innerHTML = `<div class="jcs-color-dot" style="background: #ffffff; border: 1px solid #ccc;"></div> Global`;
        optionGlobal.addEventListener('click', () => applyTheme(circleEl, 'global', 'Global', '#ffffff', menu));
        menu.appendChild(optionGlobal);

        if (typeof topicos !== 'undefined' && topicos.length > 0) {
            const div = document.createElement('div');
            div.style.height = '1px';
            div.style.backgroundColor = '#eee';
            menu.appendChild(div);

            topicos.forEach(t => {
                const opt = document.createElement('div');
                opt.className = 'jcs-option';
                opt.innerHTML = `<div class="jcs-color-dot" style="background: ${t.cor};"></div> <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.nome}</span>`;
                opt.addEventListener('click', () => applyTheme(circleEl, t.id, t.nome, t.cor, menu));
                menu.appendChild(opt);
            });
        }

        document.body.appendChild(menu);

        const rect = circleEl.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';

        requestAnimationFrame(() => {
            menu.style.visibility = 'visible';
        });

        if (selectorArmTimer) clearTimeout(selectorArmTimer);
        selectorArmTimer = setTimeout(() => {
            const closeFn = () => {
                menu.remove();
                document.removeEventListener('click', closeFn);
            };
            document.addEventListener('click', closeFn);
        }, 50);
    }

    function applyTheme(circleEl, id, nome, cor, menu) {
        circleEl.dataset.topicId = id;
        circleEl.style.backgroundColor = cor;
        circleEl.title = nome;
        if(id === 'global') {
            circleEl.style.border = '2px solid #cbd5e1';
            circleEl.style.boxShadow = 'none';
        } else {
            circleEl.style.border = '2px solid transparent';
            circleEl.style.boxShadow = `0 0 6px ${cor}40`;
        }
        menu.remove();
        if(typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    }

    function getTarefasState() {
        const container = document.getElementById('native-obs-list');
        if(!container) return [];
        
        return Array.from(container.querySelectorAll('.native-task-item')).map(item => {
            const chk = item.querySelector('input[type="checkbox"]');
            const txt = item.querySelector('input[type="text"]');
            const ind = item.querySelector('.topic-circle-indicator');
            return {
                concluida: chk.checked,
                texto: txt.value,
                topicId: ind ? ind.dataset.topicId : 'global',
                topicCor: ind ? ind.style.backgroundColor : '#ffffff'
            };
        });
    }

    function setTarefasState(tarefasArray) {
        const container = document.getElementById('native-obs-list');
        if(!container) return;
        container.innerHTML = '';
        
        if(!tarefasArray || tarefasArray.length === 0) {
            atualizarBadge();
            return;
        }

        tarefasArray.forEach(t => {
            const div = document.createElement('div');
            div.className = 'native-task-item';
            if(t.concluida) div.classList.add('completed');
            
            const checkedAttr = t.concluida ? 'checked="checked"' : '';
            const borderStyle = t.topicId === 'global' ? '2px solid #cbd5e1' : '2px solid transparent';
            const shadowStyle = t.topicId === 'global' ? 'none' : `0 0 6px ${t.topicCor}40`;

            div.innerHTML = `
                <input type="checkbox" onchange="TaskManager.toggleConcluido(this)" ${checkedAttr}>
                <div class="topic-circle-indicator" data-topic-id="${t.topicId}" title="${t.topicId === 'global' ? 'Global' : 'Tópico Específico'}" style="background-color: ${t.topicCor}; border: ${borderStyle}; box-shadow: ${shadowStyle};" onclick="TaskManager.abrirSeletorTemas(this, event)"></div>
                <input type="text" placeholder="Escreva sua tarefa..." value="${t.texto.replace(/"/g, '&quot;')}" oninput="this.setAttribute('value', this.value);">
                <button onclick="this.parentElement.remove(); TaskManager.atualizarBadge();" style="border:none; background:none; cursor:pointer; color:#ef4444; margin-left: 8px;">✕</button>
            `;
            container.appendChild(div);
        });
        atualizarBadge();
    }

    return { abrirModal, fecharModal, adicionarTarefa, toggleConcluido, atualizarBadge, abrirSeletorTemas, getTarefasState, setTarefasState };
})();