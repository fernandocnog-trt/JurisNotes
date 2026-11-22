/* ================================================
   MOTOR DE RENDERIZAÇÃO DE PDF E METADADOS
   Módulo isolado para gestão do PDF.js, Canvas e DOM do Inteiro Teor
   ================================================ */
window.PdfEngine = (function () {
    'use strict';

    // Constantes do Motor de Visualização por Página
    const BASE_SCALE = 1.5;
    const ZOOM_STEPS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
    const MAX_CANVAS_PIXELS = 16777216; // Teto 4096x4096 px (proteção de VRAM em telas HiDPI/4K)

    // Estado Privado do Motor
    let _pdfDoc = null;
    let _currentPage = 1;
    let _pageLabelsGlobais = null;
    const _pageMetadataCache = new Map();
    let _pdfRenderObserver = null;
    let _pdfReadTracker = null;
    let _pdfDestroyObserver = null;
    const _activePages = new Set();

    const _pageViewOverrides = new Map();  // Map<pageNum, { zoom: number, rotation: number }>
    const _pageBaseDimensions = new Map(); // Map<pageNum, { width: number, height: number }>
    const _pendingTransforms = new Map();  // Fila coalescida por página
    const _scrollAnchors = new Map();      // Map<pageNum, { ratioY, ratioX, baseRotation }>

    let _transformRafId = null;
    let _paginaAlvoTravada = null;
    let _sincronizarPaginaNoScroll = false;
    let _scrollSyncRafId = null;
    let _navListenersBound = false;

    // Dependências Injetadas pelo app.js (Inversão de Controle)
    let _deps = {
        getTopicos: () => [],
        exibirToast: () => {},
        atualizarDisplayPaginador: () => {},
        onPageViewStateChange: () => {},
        validarPdf: async () => true,
        iniciarSessaoBackup: async () => {},
        habilitarFerramentas: () => {},
        onPdfCarregado: async () => {}
    };

    function init(dependencies) {
        _deps = { ..._deps, ...dependencies };
    }

    /* ================================================
       MOCK COMPLETO DO LINKSERVICE (Compatível PDF.js V4)
       ================================================ */
    const jurisLinkService = {
        externalLinkEnabled: true,
        externalLinkRel: 'noopener noreferrer nofollow',
        externalLinkTarget: 2,
        
        goToDestination: async function(dest) {
            console.group('🔵 [Diagnóstico LinkService] Gatilho Acionado!');
            if (!_pdfDoc) {
                console.error('Falha: Documento PDF não está disponível no escopo.');
                console.groupEnd();
                return;
            }
            try {
                let explicitDest = dest;
                if (typeof dest === 'string') {
                    explicitDest = await _pdfDoc.getDestination(dest);
                }
                if (Array.isArray(explicitDest)) {
                    const pageRef = explicitDest[0];
                    let pageNum;
                    
                    if (typeof pageRef === 'object' && pageRef !== null) {
                        const pageIndex = await _pdfDoc.getPageIndex(pageRef);
                        pageNum = pageIndex + 1; 
                    } else if (Number.isInteger(pageRef)) {
                        pageNum = pageRef + 1;
                    }
                    if (pageNum) this.goTo(pageNum);
                }
            } catch (e) {
                console.error('Exceção crítica na resolução do link:', e);
            }
            console.groupEnd();
        },
        
        goTo: function(pageNum) {
            const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNum}"]`);
            const scrollContainer = document.getElementById('pdf-container');

            if (pageContainer && scrollContainer) {
                _liberarTravaPaginaAlvo(false);
                _currentPage = pageNum;

                const containerRect = scrollContainer.getBoundingClientRect();
                const pageRect = pageContainer.getBoundingClientRect();
                const targetScrollTop = scrollContainer.scrollTop + (pageRect.top - containerRect.top) - 16;

                // Zera left explicitamente para eliminar scrollLeft residual herdado de páginas ampliadas
                scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), left: 0, behavior: 'auto' });

                _deps.atualizarDisplayPaginador(pageNum);
                _notificarEstadoVisualizacao(pageNum);
                _deps.exibirToast(`Acessando fl. ${getDisplayLabel(pageNum)}.`, 'sucesso');
            } else {
                _deps.exibirToast('Página alvo não encontrada no DOM.', 'erro');
            }
        },
        
        getDestinationHash: function(dest) { return ''; },
        getAnchorUrl: function(hash) { return ''; },
        setDocument: function(doc) {},
        executeNamedAction: function(action) { console.log('[JurisNotes] Ação interna:', action); }
    };

    /* ================================================
       METADADOS E BUSCA DE PÁGINAS
       ================================================ */
    function getDisplayLabel(pageNum) {
        const meta = _pageMetadataCache.get(pageNum);
        if (meta && meta.flsNum) return meta.flsNum;
        if (_pageLabelsGlobais && _pageLabelsGlobais[pageNum - 1]) return _pageLabelsGlobais[pageNum - 1];
        return pageNum;
    }

    function obterRotuloPagina(paginaFisica) {
        return getDisplayLabel(paginaFisica);
    }

    function resolverPagina(termoBusca) {
        let pageNum = parseInt(termoBusca, 10);
        let encontradoNoCache = false;
        
        for (const [key, value] of _pageMetadataCache.entries()) {
            if (value.flsNum === termoBusca) {
                pageNum = key;
                encontradoNoCache = true;
                break;
            }
        }

        if (!encontradoNoCache && _pageLabelsGlobais) {
            const indexEncontrado = _pageLabelsGlobais.findIndex(label => 
                label && label.toString().trim().toLowerCase() === termoBusca
            );
            if (indexEncontrado !== -1) {
                pageNum = indexEncontrado + 1;
            }
        }

        if (isNaN(pageNum) || pageNum < 1 || pageNum > _pdfDoc.numPages) {
            return null;
        }
        return pageNum;
    }

    async function extrairMetadadosDaPagina(pageNum, textContentPreCarregado = null) {
        if (_pageMetadataCache.has(pageNum)) return _pageMetadataCache.get(pageNum);
        
        try {
            const page = await _pdfDoc.getPage(pageNum);
            const textContent = textContentPreCarregado || await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });
            const items = textContent.items;

            const fullTextNormal = items.map(item => item.str).join(' ');
            const regexPje = /\d{2}:\d{2}:\d{2}\s*-\s*([a-f0-9]{7,})\b/i;
            const matchPje = fullTextNormal.match(regexPje);
            const pjeId = matchPje ? matchPje[1].toLowerCase() : null;
            
            const topRightItems = items.filter(item => {
                const x = item.transform[4]; 
                const y = item.transform[5]; 
                return x > (viewport.width * 0.4) && y > (viewport.height * 0.6);
            });

            const topRightText = topRightItems.map(item => item.str).join(' ');
            const regexFlsRigida = /\bfls\.?\s*:\s*(\d+)\b/i;
            const matchFls = topRightText.match(regexFlsRigida);
            const flsNum = matchFls ? matchFls[1] : null;

            const resultado = { pjeId, flsNum };
            _pageMetadataCache.set(pageNum, resultado);
            
            return resultado;
        } catch (err) {
            console.error('Falha ao extrair metadados físicos da página:', err);
            return { pjeId: null, flsNum: null };
        }
    }

    const _footerBoundaryCache = new Map();

    /**
     * Detecta, para uma página específica, a coordenada Y (em pixels de viewport,
     * escala 1.5 — a mesma usada na renderização) a partir da qual o conteúdo
     * é bloco de assinatura eletrônica. Usa reconhecimento de padrão textual,
     * não percentuais fixos, para se adaptar a rodapés de tamanhos diferentes.
     */
    async function obterLimiteRodape(pageNum) {
        if (_footerBoundaryCache.has(pageNum)) return _footerBoundaryCache.get(pageNum);

        const REGEX_RODAPE_ASSINATURA = /(Documento\s+assinado\s+eletronicamente\s+por|Assinado\s+(?:digitalmente|eletronicamente)\s+por|Signatário(?:\(a\))?\s*:)/i;

        try {
            const page = await _pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: BASE_SCALE });
            const textContent = await page.getTextContent();

            let limiteY = null;
            for (const item of textContent.items) {
                if (REGEX_RODAPE_ASSINATURA.test(item.str)) {
                    const [, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                    // Converte a altura real do glifo (pts PDF) para a escala base do viewport para obter o topo da linha
                    const alturaPts = Math.abs(item.height || item.transform[3] || 10);
                    const topoDoItem = vy - (alturaPts * BASE_SCALE) - 2;
                    if (limiteY === null || topoDoItem < limiteY) limiteY = topoDoItem;
                }
            }

            _footerBoundaryCache.set(pageNum, limiteY);
            return limiteY;
        } catch (err) {
            console.warn('Falha ao calcular limite de rodapé da página', pageNum, err);
            return null;
        }
    }

    /* ================================================
       EXTRAÇÃO MATEMÁTICA DE TEXTO POR REGIÃO (ALFINETE)
       ================================================ */
    
    // Função utilitária para liberar a Main Thread (macro-task)
    const _yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

    async function extrairTextoPorRegiao(marcoInicio, marcoFim, onProgress = null, onPageRawText = null) {
        if (!_pdfDoc) return "";
        const targetPdfInstance = _pdfDoc;
        let textoExtraido = "";
        
        const ESCALA_RENDERIZACAO_UI = BASE_SCALE;
        const PADDING_SEGURANCA_PTS = 4;
        const TIME_BUDGET_MS = 40; 
        
        const pInicio = Math.min(marcoInicio.pagina, marcoFim.pagina);
        const pFim = Math.max(marcoInicio.pagina, marcoFim.pagina);
        const yInicioDOM = (pInicio === marcoInicio.pagina) ? marcoInicio.offsetY : marcoFim.offsetY;
        const yFimDOM = (pFim === marcoFim.pagina) ? marcoFim.offsetY : marcoInicio.offsetY;
        const totalPaginas = (pFim - pInicio) + 1;
        let lastYieldTime = performance.now();

        for (let i = pInicio; i <= pFim; i++) {
            if (_pdfDoc !== targetPdfInstance) throw new Error("CONCURRENCY_VIOLATION: O documento original foi alterado durante a extração.");
            
            let page = null;
            try {
                page = await _pdfDoc.getPage(i);
                const viewportNative = page.getViewport({ scale: 1.0 }); 
                const textContent = await page.getTextContent();
                
                // Hook de Amostragem (Single-Pass)
                if (onPageRawText) {
                    onPageRawText(i, textContent.items.map(item => item.str).join(' '));
                }
                
                const yInicioNativo = yInicioDOM / ESCALA_RENDERIZACAO_UI;
                const yFimNativo = yFimDOM / ESCALA_RENDERIZACAO_UI;
                let limiteYSuperiorPDF = (i === pInicio) ? (viewportNative.height - yInicioNativo) : viewportNative.height;
                let limiteYInferiorPDF = (i === pFim) ? (viewportNative.height - yFimNativo) : 0;

                if (i === pInicio) limiteYSuperiorPDF = Math.min(viewportNative.height, limiteYSuperiorPDF - PADDING_SEGURANCA_PTS);
                if (i === pFim) limiteYInferiorPDF = Math.max(0, limiteYInferiorPDF + PADDING_SEGURANCA_PTS);
                if (pInicio === pFim && limiteYInferiorPDF > limiteYSuperiorPDF) {
                    const temp = limiteYSuperiorPDF;
                    limiteYSuperiorPDF = limiteYInferiorPDF;
                    limiteYInferiorPDF = temp;
                }

                let textoPagina = textContent.items
                    .filter(item => item.transform[5] <= limiteYSuperiorPDF && item.transform[5] >= limiteYInferiorPDF)
                    .map(item => item.str)
                    .join(' ');
                    
                textoExtraido += textoPagina + " \n\n ";

                if (onProgress) {
                    try { onProgress((i - pInicio) + 1, totalPaginas); } catch (e) {
                        console.warn("[PdfEngine AI] Aviso não-bloqueante no callback de UI.", e);
                    }
                }
            } finally {
                // Descarte O(1) nativo do V8 / Canvas
                if (page && typeof page.cleanup === 'function') {
                    try { page.cleanup(); } catch(e){}
                }
            }

            if (performance.now() - lastYieldTime > TIME_BUDGET_MS) {
                await _yieldToMain();
                lastYieldTime = performance.now(); 
            }
        }
        
        if (textoExtraido.trim().length === 0) _deps.exibirToast("Não foi possível extrair texto. O documento pode ser uma imagem digitalizada (sem OCR).", "aviso");
        return textoExtraido;
    }

    /* ================================================
       ESTADO POR PÁGINA, TRAVA DE FOCO E CONVERSÃO CANÔNICA
       ================================================ */
    function getPageViewState(pageNum = _currentPage) {
        const override = _pageViewOverrides.get(pageNum);
        return {
            pageNum,
            zoom: override ? override.zoom : 1.0,
            rotation: override ? override.rotation : 0
        };
    }

    function getOverridesCount() {
        return _pageViewOverrides.size;
    }

    function _notificarEstadoVisualizacao(pageNum = _currentPage) {
        if (typeof _deps.onPageViewStateChange === 'function') {
            _deps.onPageViewStateChange(getPageViewState(pageNum));
        }
    }

    function _liberarTravaPaginaAlvo(ressincronizarAposScroll = true) {
        if (_paginaAlvoTravada === null) return;
        _paginaAlvoTravada = null;
        if (ressincronizarAposScroll) {
            _sincronizarPaginaNoScroll = true;
        }
    }

    function _sincronizarPaginaAtivaPelaViewport() {
        const scrollContainer = document.getElementById('pdf-container');
        if (!scrollContainer || _activePages.size === 0) return;

        const scRect = scrollContainer.getBoundingClientRect();
        const linhaLeituraY = scRect.top + (scRect.height * 0.18);

        let candidata = null;
        let menorDistancia = Infinity;

        _activePages.forEach(container => {
            const r = container.getBoundingClientRect();
            if (r.top <= linhaLeituraY && r.bottom >= linhaLeituraY) {
                candidata = container;
                menorDistancia = 0;
            } else if (menorDistancia > 0) {
                const dist = Math.min(Math.abs(r.top - linhaLeituraY), Math.abs(r.bottom - linhaLeituraY));
                if (dist < menorDistancia) {
                    menorDistancia = dist;
                    candidata = container;
                }
            }
        });

        if (candidata) {
            const num = parseInt(candidata.dataset.pageNumber, 10);
            if (!isNaN(num) && num !== _currentPage) {
                _currentPage = num;
                _deps.atualizarDisplayPaginador(num);
                _notificarEstadoVisualizacao(num);
            }
        }
    }

    function _vincularListenersLiberacaoTrava() {
        if (_navListenersBound) return;
        const scrollContainer = document.getElementById('pdf-container');
        if (!scrollContainer) return;

        const NAV_KEYS = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Space']);

        scrollContainer.addEventListener('wheel', () => _liberarTravaPaginaAlvo(true), { passive: true });
        scrollContainer.addEventListener('touchstart', () => _liberarTravaPaginaAlvo(true), { passive: true });
        scrollContainer.addEventListener('pointerdown', (e) => {
            if (e.target === scrollContainer) _liberarTravaPaginaAlvo(true);
        }, { passive: true });

        scrollContainer.addEventListener('scroll', () => {
            if (!_sincronizarPaginaNoScroll || _paginaAlvoTravada !== null) return;
            if (_scrollSyncRafId) return;
            _scrollSyncRafId = requestAnimationFrame(() => {
                _scrollSyncRafId = null;
                _sincronizarPaginaNoScroll = false;
                _sincronizarPaginaAtivaPelaViewport();
            });
        }, { passive: true });

        document.addEventListener('keydown', (e) => {
            if (_paginaAlvoTravada === null) return;
            if (document.body.dataset.activeTab !== 'leitura') return;
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
            if (NAV_KEYS.has(e.code)) _liberarTravaPaginaAlvo(true);
        }, { passive: true });

        _navListenersBound = true;
    }

    /**
     * Converte retângulo do espaço canônico (BASE_SCALE, rotação extra 0°)
     * para a geometria atual (zoom, rotação) da página renderizada.
     */
    function _transformarRectParaViewportAtual(pageNum, rect) {
        const { zoom, rotation } = getPageViewState(pageNum);
        if (zoom === 1.0 && rotation === 0) return rect;

        let x = rect.left;
        let y = rect.top;
        let w = rect.width;
        let h = rect.height;

        if (rotation !== 0) {
            const baseDim = _pageBaseDimensions.get(pageNum);
            if (baseDim) {
                const W = baseDim.width;
                const H = baseDim.height;
                if (rotation === 90)       [x, y, w, h] = [H - (y + h), x, h, w];
                else if (rotation === 180) [x, y, w, h] = [W - (x + w), H - (y + h), w, h];
                else if (rotation === 270) [x, y, w, h] = [y, W - (x + w), h, w];
            }
        }

        return {
            ...rect,
            left: x * zoom,
            top: y * zoom,
            width: w * zoom,
            height: h * zoom
        };
    }

    /**
     * Inversa exata: converte retângulo do DOM atual para o espaço canônico
     * antes de validar limiteRodape ou persistir no backup.
     */
    function normalizarRectParaBase(pageNum, rect) {
        const { zoom, rotation } = getPageViewState(pageNum);
        if (zoom === 1.0 && rotation === 0) return rect;

        let rx = rect.left / zoom;
        let ry = rect.top / zoom;
        let rw = rect.width / zoom;
        let rh = rect.height / zoom;

        if (rotation !== 0) {
            const baseDim = _pageBaseDimensions.get(pageNum);
            if (baseDim) {
                const W = baseDim.width;
                const H = baseDim.height;
                if (rotation === 90)       [rx, ry, rw, rh] = [ry, H - rx - rw, rh, rw];
                else if (rotation === 180) [rx, ry, rw, rh] = [W - rx - rw, H - ry - rh, rw, rh];
                else if (rotation === 270) [rx, ry, rw, rh] = [W - ry - rh, rx, rh, rw];
            }
        }

        return {
            ...rect,
            left: rx,
            top: ry,
            width: rw,
            height: rh
        };
    }

    function _agendarTransformacaoPagina(pageNum, novoZoom, novaRotacao) {
        if (!_pdfDoc) return;
        const container = document.querySelector(`.pdf-page-container[data-page-number="${pageNum}"]`);
        if (!container) return;

        const estadoAnterior = getPageViewState(pageNum);
        const rotNormalizada = ((novaRotacao % 360) + 360) % 360;
        const zoomNormalizado = Number(novoZoom.toFixed(2));

        if (zoomNormalizado === 1.0 && rotNormalizada === 0) {
            _pageViewOverrides.delete(pageNum);
        } else {
            _pageViewOverrides.set(pageNum, { zoom: zoomNormalizado, rotation: rotNormalizada });
        }

        // Trava a página-alvo para impedir que o observer troque _currentPage durante ajustes
        _paginaAlvoTravada = pageNum;
        _currentPage = pageNum;
        _deps.atualizarDisplayPaginador(pageNum);
        _notificarEstadoVisualizacao(pageNum);

        // Captura âncora 2D (ratioY e ratioX) apenas uma vez no início da rajada
        if (!_scrollAnchors.has(pageNum)) {
            const scrollContainer = document.getElementById('pdf-container');
            if (scrollContainer) {
                const scRect = scrollContainer.getBoundingClientRect();
                const pgRect = container.getBoundingClientRect();
                const centerYInPage = (scRect.height / 2) - (pgRect.top - scRect.top);
                const centerXInPage = (scRect.width / 2) - (pgRect.left - scRect.left);
                const ratioY = Math.max(0, Math.min(1, centerYInPage / (pgRect.height || 1)));
                const ratioX = Math.max(0, Math.min(1, centerXInPage / (pgRect.width || 1)));
                _scrollAnchors.set(pageNum, { ratioY, ratioX, baseRotation: estadoAnterior.rotation });
            }
        }

        _pendingTransforms.set(pageNum, { zoom: zoomNormalizado, rotation: rotNormalizada });

        if (_transformRafId === null) {
            _transformRafId = requestAnimationFrame(() => {
                _transformRafId = null;
                const fila = Array.from(_pendingTransforms.keys());
                _pendingTransforms.clear();

                fila.forEach(pNum => {
                    const targetEl = document.querySelector(`.pdf-page-container[data-page-number="${pNum}"]`);
                    if (targetEl) {
                        renderizarPaginaElemento(pNum, targetEl, { isTransformUpdate: true });
                    }
                });
            });
        }
    }

    function _paginaPossuiAlfinetes(pageNum) {
        const listaTopicos = _deps.getTopicos() || [];
        return listaTopicos.some(t =>
            Array.isArray(t.marcosExtracao) && t.marcosExtracao.some(m => m.pagina === pageNum)
        );
    }

    function alterarZoomPaginaAtual(direcao) {
        if (!_pdfDoc) return;
        const pageAlvo = _paginaAlvoTravada ?? _currentPage;
        const { zoom, rotation } = getPageViewState(pageAlvo);
        let idx = ZOOM_STEPS.findIndex(s => Math.abs(s - zoom) < 0.01);
        if (idx === -1) idx = ZOOM_STEPS.indexOf(1.0);

        const novoIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direcao));
        if (novoIdx === idx) return;

        _agendarTransformacaoPagina(pageAlvo, ZOOM_STEPS[novoIdx], rotation);
    }

    function resetarZoomPaginaAtual() {
        if (!_pdfDoc) return;
        const pageAlvo = _paginaAlvoTravada ?? _currentPage;
        const { zoom, rotation } = getPageViewState(pageAlvo);
        if (zoom === 1.0) return;
        _agendarTransformacaoPagina(pageAlvo, 1.0, rotation);
    }

    function girarPaginaAtual(deltaGraus = 90) {
        if (!_pdfDoc) return;
        const pageAlvo = _paginaAlvoTravada ?? _currentPage;
        const { zoom, rotation } = getPageViewState(pageAlvo);
        const novaRot = ((rotation + deltaGraus) % 360 + 360) % 360;

        if (rotation === 0 && novaRot !== 0 && _paginaPossuiAlfinetes(pageAlvo)) {
            _deps.exibirToast('Alfinetes do extrator ficam ocultos enquanto esta página estiver girada.', 'info');
        }

        _agendarTransformacaoPagina(pageAlvo, zoom, novaRot);
    }

    function resetarVisualizacaoPaginaAtual() {
        if (!_pdfDoc) return;
        const pageAlvo = _paginaAlvoTravada ?? _currentPage;
        const { zoom, rotation } = getPageViewState(pageAlvo);
        if (zoom === 1.0 && rotation === 0) return;
        _agendarTransformacaoPagina(pageAlvo, 1.0, 0);
    }

    function limparEstadoVisualizacao() {
        _pageViewOverrides.clear();
        _pendingTransforms.clear();
        _scrollAnchors.clear();
        _paginaAlvoTravada = null;
        _sincronizarPaginaNoScroll = false;
        _notificarEstadoVisualizacao(_currentPage);
    }

    function restaurarOverridesVisualizacao(mapaOverrides) {
        _pageViewOverrides.clear();
        if (!mapaOverrides || typeof mapaOverrides !== 'object') return;
        Object.entries(mapaOverrides).forEach(([pageKey, val]) => {
            const pageNum = parseInt(pageKey, 10);
            if (isNaN(pageNum) || pageNum < 1) return;
            const zoom = typeof val === 'number' ? 1.0 : (val.zoom ?? 1.0);
            const rotation = typeof val === 'number' ? val : (val.rotation ?? 0);
            const rotNorm = ((rotation % 360) + 360) % 360;
            if (zoom !== 1.0 || rotNorm !== 0) {
                _pageViewOverrides.set(pageNum, { zoom, rotation: rotNorm });
            }
        });
    }

    /* ================================================
       CARREGAMENTO DE ARQUIVO E RENDERIZAÇÃO
       ================================================ */
    async function carregarPDF(file, isRetomada) {
        if (!file) return;

        const fileReader = new FileReader();

        fileReader.onload = async function () {
            const arrayBuffer = this.result;

            if (isRetomada) {
                const hashValido = await _deps.validarPdf(arrayBuffer);
                if (!hashValido) {
                    _deps.exibirToast('PDF incorreto ou corrompido para este processo. Selecione o arquivo correto.', 'erro');
                    const uploadInput = document.getElementById('pdf-upload');
                    uploadInput.value = '';
                    setTimeout(() => uploadInput.click(), 1500);
                    return;
                }
            }

            if (!isRetomada) {
                await _deps.iniciarSessaoBackup(file.name, arrayBuffer);
            }

            const typedarray = new Uint8Array(arrayBuffer);

            pdfjsLib.getDocument(typedarray).promise
                .then(async pdf => {
                    _pdfDoc = pdf;
                    _pageMetadataCache.clear();
                    _footerBoundaryCache.clear();
                    _pageBaseDimensions.clear();
                    _pendingTransforms.clear();
                    _scrollAnchors.clear();
                    _paginaAlvoTravada = null;
                    _sincronizarPaginaNoScroll = false;

                    if (!isRetomada) {
                        _pageViewOverrides.clear();
                    } else {
                        for (const key of _pageViewOverrides.keys()) {
                            if (key > pdf.numPages) _pageViewOverrides.delete(key);
                        }
                    }

                    _vincularListenersLiberacaoTrava();
                    document.getElementById('total-page-display').textContent = pdf.numPages;

                    try {
                        _pageLabelsGlobais = await pdf.getPageLabels();
                    } catch (e) {
                        _pageLabelsGlobais = null;
                    }

                    _deps.habilitarFerramentas();

                    const wrapper = document.getElementById('pdf-wrapper');
                    wrapper.innerHTML = '';
                    wrapper.style.display = 'flex';
                    document.getElementById('pdf-placeholder').style.display = 'none';
                    document.getElementById('floating-page-panel').style.display = 'flex';

                    if (_pdfRenderObserver) _pdfRenderObserver.disconnect();
                    if (_pdfDestroyObserver) _pdfDestroyObserver.disconnect();
                    _activePages.clear();

                    // Observer 1: Renderiza cedo (800px) com Micro-Task Filtering e estado 'loading'
                    _pdfRenderObserver = new IntersectionObserver((entries) => {
                        entries.forEach(entry => {
                            const container = entry.target;

                            if (entry.isIntersecting) {
                                if (container.dataset.loaded === 'false') {
                                    container.dataset.loaded = 'loading';
                                    container._scrollRaf = requestAnimationFrame(() => {
                                        renderizarPaginaElemento(parseInt(container.dataset.pageNumber, 10), container);
                                    });
                                }
                            } else {
                                if (container._scrollRaf && container.dataset.loaded === 'loading') {
                                    cancelAnimationFrame(container._scrollRaf);
                                    container._scrollRaf = null;
                                    container.dataset.loaded = 'false';
                                }
                            }
                        });
                    }, { root: document.getElementById('pdf-container'), rootMargin: '800px 0px', threshold: 0 });

                    // Observer 2: Destrói tarde (Histerese de 3000px — cobre 'true' e 'loading' contra vazamento de VRAM)
                    _pdfDestroyObserver = new IntersectionObserver((entries) => {
                        entries.forEach(entry => {
                            const container = entry.target;
                            if (entry.isIntersecting) {
                                _activePages.add(container);
                            } else {
                                _activePages.delete(container);
                                if (container.dataset.loaded !== 'false') {
                                    descarregarPaginaElemento(container);
                                    container.dataset.loaded = 'false';
                                }
                            }
                        });
                    }, { root: document.getElementById('pdf-container'), rootMargin: '3000px 0px', threshold: 0 });

                    if (_pdfReadTracker) _pdfReadTracker.disconnect();
                    _pdfReadTracker = new IntersectionObserver((entries) => {
                        if (_paginaAlvoTravada !== null) return;
                        entries.forEach(entry => {
                            if (entry.isIntersecting) {
                                const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
                                _currentPage = pageNum;
                                _deps.atualizarDisplayPaginador(pageNum);
                                _notificarEstadoVisualizacao(pageNum);
                            }
                        });
                    }, { root: document.getElementById('pdf-container'), rootMargin: '-15% 0px -80% 0px', threshold: 0 });

                    const firstPage = await pdf.getPage(1);
                    const viewportCSS = firstPage.getViewport({ scale: BASE_SCALE });

                    try {
                        const textContentFirstPage = await firstPage.getTextContent();
                        // 1. Higieniza o texto (remove espaços e quebras de linha invisíveis)
                        const rawString = textContentFirstPage.items.map(item => item.str).join('');
                        const sanitizedString = rawString.replace(/\s+/g, '');

                        // 2. Regex robusta CNJ: Captura 7 dígitos, 2 dígitos e 4 do ano
                        const cnjRegex = /(\d{7})[-]?(\d{2})\.?(\d{4})\.?\d\.?\d{2}\.?\d{4}/;
                        const match = sanitizedString.match(cnjRegex);

                        if (match && typeof _deps.onProcessoIdentificado === 'function') {
                            // Modificação: Em vez de parseInt, aplicamos slice(-4) na string de 7 dígitos.
                        // Isso preserva os zeros necessários para formar 4 casas decimais.
                        const sequencialLimpo = match[1].slice(-4); 
                        const digito = match[2];
                        const ano = match[3];

                        // Monta o formato ultra-curto (Ex: 0541-68.2025)
                            const numeroUltraCurto = `${sequencialLimpo}-${digito}.${ano}`; 
                            
                            _deps.onProcessoIdentificado(numeroUltraCurto);
                        } 
                    } catch (err) {
                        console.warn("[Juris Notes ED] Falha ao tentar capturar o número do processo na capa.", err);
                    }

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const pageContainer = document.createElement('div');
                        pageContainer.className = 'pdf-page-container';
                        pageContainer.dataset.pageNumber = i;
                        pageContainer.dataset.loaded = 'false';
                        pageContainer.style.cssText = `
                            width: ${viewportCSS.width}px;
                            height: ${viewportCSS.height}px;
                            position: relative;
                            margin-bottom: 24px;
                            background-color: var(--pdf-bg-color);
                            box-shadow: var(--shadow-md);
                        `;
                        wrapper.appendChild(pageContainer);
                        
                        _pdfRenderObserver.observe(pageContainer);
                        _pdfDestroyObserver.observe(pageContainer);
                        _pdfReadTracker.observe(pageContainer);
                    }

                    _notificarEstadoVisualizacao(_currentPage);
                    await _deps.onPdfCarregado(isRetomada);
                })
                .catch(err => {
                    console.error('Erro ao processar PDF:', err);
                    _deps.exibirToast('Erro ao ler o PDF. Verifique a integridade do arquivo.', 'erro');
                });
        };

        fileReader.readAsArrayBuffer(file);
    }

    async function renderizarPaginaElemento(num, container, options = {}) {
        if (!_pdfDoc) return;

        const { isTransformUpdate = false } = options;
        const isReRenderSemFlash = isTransformUpdate && container.dataset.loaded === 'true';

        const renderSeq = (container._renderSeq = (container._renderSeq || 0) + 1);
        if (container._renderTask) container._renderTask.cancel();

        if (isReRenderSemFlash) {
            container.classList.add('is-page-updating');
        } else {
            container.innerHTML = '';
        }

        const page = await _pdfDoc.getPage(num);
        if (container._renderSeq !== renderSeq) return;

        container._pdfPageRef = page; // Salva referência para GC granular

        const baseViewport = page.getViewport({ scale: BASE_SCALE });
        _pageBaseDimensions.set(num, { width: baseViewport.width, height: baseViewport.height });

        const { zoom, rotation } = getPageViewState(num);
        const finalScale = BASE_SCALE * zoom;
        const finalRotation = ((page.rotate || 0) + rotation) % 360;
        const viewport = page.getViewport({ scale: finalScale, rotation: finalRotation });

        // Teto de VRAM em telas Retina + zoom 250%
        const rawDpr = window.devicePixelRatio || 1;
        const rawPixelArea = viewport.width * viewport.height * rawDpr * rawDpr;
        const effectiveDpr = rawPixelArea > MAX_CANVAS_PIXELS
            ? Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)))
            : rawDpr;

        // 1. Renderização pesada do <canvas> 100% OFF-DOM (folha atual segue visível sem flash)
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width * effectiveDpr);
        canvas.height = Math.floor(viewport.height * effectiveDpr);
        canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block;';

        const transform = effectiveDpr !== 1 ? [effectiveDpr, 0, 0, effectiveDpr, 0, 0] : null;
        container._renderTask = page.render({
            canvasContext: ctx,
            transform: transform,
            viewport: viewport
        });

        try {
            await container._renderTask.promise;
            if (container._renderSeq !== renderSeq) return;

            // 2. Commit Atômico: redimensiona e substitui os filhos num único frame
            const textLayer = document.createElement('div');
            textLayer.className = 'textLayer';
            textLayer.style.setProperty('--scale-factor', viewport.scale);

            const highlightLayerDiv = document.createElement('div');
            highlightLayerDiv.className = 'highlightLayer';
            highlightLayerDiv.style.setProperty('--scale-factor', viewport.scale);

            container.style.width = Math.floor(viewport.width) + 'px';
            container.style.height = Math.floor(viewport.height) + 'px';
            container.classList.toggle('is-page-transformed', zoom !== 1.0 || rotation !== 0);
            container.replaceChildren(canvas, textLayer, highlightLayerDiv);
            container.classList.remove('is-page-updating');
            container.dataset.loaded = 'true';

            // 3. Compensa o scroll em 2D usando a âncora preservada
            const anchor = _scrollAnchors.get(num);
            if (anchor) {
                _scrollAnchors.delete(num);
                const scrollContainer = document.getElementById('pdf-container');
                if (scrollContainer) {
                    const scRect = scrollContainer.getBoundingClientRect();
                    const newPgRect = container.getBoundingClientRect();

                    const targetTop =
                        scrollContainer.scrollTop +
                        (newPgRect.top - scRect.top) +
                        (newPgRect.height * anchor.ratioY) -
                        (scRect.height / 2);

                    const effectiveRatioX = (rotation === anchor.baseRotation) ? anchor.ratioX : 0.5;
                    const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
                    const rawTargetLeft = newPgRect.width > scRect.width
                        ? scrollContainer.scrollLeft +
                          (newPgRect.left - scRect.left) +
                          (newPgRect.width * effectiveRatioX) -
                          (scRect.width / 2)
                        : 0;

                    scrollContainer.scrollTo({
                        top: Math.max(0, targetTop),
                        left: Math.max(0, Math.min(maxLeft, rawTargetLeft)),
                        behavior: 'auto'
                    });
                }
            }

            // 4. Desenha highlights sincronamente
            _renderizarHighlightsDaPagina(num, highlightLayerDiv);

            // 5. Renderiza TextLayer e AnnotationLayer já conectados ao DOM
            const textContent = await page.getTextContent();
            if (container._renderSeq !== renderSeq) return;

            const tl = new pdfjsLib.TextLayer({
                textContentSource: textContent,
                container: textLayer,
                viewport: viewport
            });
            await tl.render();
            if (container._renderSeq !== renderSeq) return;

            if (!_pageMetadataCache.has(num)) {
                extrairMetadadosDaPagina(num, textContent).then(() => {
                    _deps.atualizarDisplayPaginador(num);
                });
            }

            const annotationData = await page.getAnnotations();
            if (annotationData && annotationData.length > 0 && container._renderSeq === renderSeq && container.contains(textLayer)) {
                const annotationLayerDiv = document.createElement('div');
                annotationLayerDiv.className = 'annotationLayer';
                annotationLayerDiv.style.setProperty('--scale-factor', viewport.scale);
                container.appendChild(annotationLayerDiv);

                const annotationLayer = new pdfjsLib.AnnotationLayer({
                    page: page,
                    viewport: viewport,
                    div: annotationLayerDiv,
                    linkService: jurisLinkService,
                    renderInteractiveForms: false
                });

                await annotationLayer.render({
                    annotations: annotationData,
                    viewport: viewport,
                    intent: 'display',
                    linkService: jurisLinkService
                });
            }
        } catch (err) {
            if (err.name !== 'RenderingCancelledException') {
                console.error('Erro ao renderizar página PDF:', err);
            }
            if (container._renderSeq === renderSeq) {
                container.classList.remove('is-page-updating');
                if (!isReRenderSemFlash) container.dataset.loaded = 'false';
            }
        } finally {
            if (container._renderSeq === renderSeq) {
                container._renderTask = null;
            }
        }
    }

    /* ================================================
       HIGHLIGHTS E MARCAÇÕES (DOM ISOLADO)
       ================================================ */
    function _renderizarHighlightsDaPagina(pageNum, highlightLayerDiv) {
        highlightLayerDiv.innerHTML = ''; 
        const topicos = _deps.getTopicos();
        
        topicos.forEach(topico => {
            const borderCor = topico.cor;

            const desenharMarcacoes = (itens, parentIndex) => {
                if (!itens) return;
                itens.forEach((item, idx) => {
                    const numIdeia = (parentIndex !== undefined ? parentIndex : idx) + 1;

                    if ((item.tipo === 'texto' || item.tipo === 'imagem') && item.highlightRects && item.highlightRects.length > 0) {
                        const rectsNestaPagina = item.highlightRects
                            .filter(r => r.page !== undefined ? r.page === pageNum : item.paginaFisica === pageNum)
                            .map(r => _transformarRectParaViewportAtual(pageNum, r));

                        if (rectsNestaPagina.length > 0) {
                            // 1. Renderiza grifos/bordas pertencentes a esta página (suporta captura multi-página)
                            if (item.tipo === 'texto') {
                                rectsNestaPagina.forEach(rect => {
                                    const marker = document.createElement('div');
                                    marker.className = 'pdf-highlight-rect';
                                    marker.style.top = rect.top + 'px';
                                    marker.style.left = rect.left + 'px';
                                    marker.style.width = rect.width + 'px';
                                    marker.style.height = rect.height + 'px';
                                    marker.style.borderBottom = `2.5px solid ${borderCor}`;
                                    highlightLayerDiv.appendChild(marker);
                                });
                            } else if (item.tipo === 'imagem') {
                                rectsNestaPagina.forEach(rect => {
                                    const marker = document.createElement('div');
                                    marker.className = 'pdf-highlight-rect';
                                    marker.style.top = rect.top + 'px';
                                    marker.style.left = rect.left + 'px';
                                    marker.style.width = rect.width + 'px';
                                    marker.style.height = rect.height + 'px';
                                    marker.style.border = `1.5px dashed ${borderCor}`;
                                    highlightLayerDiv.appendChild(marker);
                                });
                            }

                            // 2. O marcador circular numerado aparece exclusivamente na página âncora inicial
                            if (item.paginaFisica === pageNum) {
                                const firstRect = rectsNestaPagina[0];
                                const badge = document.createElement('div');
                                badge.className = 'pdf-annotation-badge';
                                badge.style.backgroundColor = topico.cor;
                                if (window.TopicsManager && typeof window.TopicsManager.obterCorContraste === 'function') {
                                    badge.style.color = window.TopicsManager.obterCorContraste(topico.cor);
                                }
                                badge.innerText = numIdeia;

                                if (item.tipo === 'texto') {
                                    badge.style.top = (firstRect.top + (firstRect.height / 2)) + 'px';
                                    badge.style.transform = 'translateY(-50%)';
                                } else if (item.tipo === 'imagem') {
                                    badge.style.top = firstRect.top + 'px';
                                    badge.style.right = 'auto';
                                    badge.style.left = Math.max(4, firstRect.left - 28) + 'px';
                                }

                                badge.addEventListener('mouseenter', (e) => {
                                    const tooltip = document.getElementById('quick-intent-tooltip');
                                    if (!tooltip) return;
                                    tooltip.innerHTML = `<strong>Tópico Vinculado</strong>${topico.nome}<br><span style="font-size:0.75rem; color:#aab; display:block; margin-top:4px;">(Ctrl + Clique para acessar a anotação)</span>`;
                                    tooltip.style.display = 'block';
                                    tooltip.classList.remove('visible');

                                    let x = e.clientX + 15;
                                    let y = e.clientY + 15;
                                    const rect = tooltip.getBoundingClientRect();
                                    if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 15;
                                    if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 15;

                                    tooltip.style.left = `${x}px`;
                                    tooltip.style.top = `${y}px`;
                                    requestAnimationFrame(() => tooltip.classList.add('visible'));
                                });

                                badge.addEventListener('mouseleave', () => {
                                    const tooltip = document.getElementById('quick-intent-tooltip');
                                    if (tooltip) {
                                        tooltip.classList.remove('visible');
                                        setTimeout(() => { tooltip.style.display = 'none'; }, 200);
                                    }
                                });

                                // Gatilho de Viagem (Navegação Reversa)
                                badge.addEventListener('click', (e) => {
                                    if (e.ctrlKey && !e.shiftKey) {
                                        e.preventDefault();
                                        e.stopPropagation(); // Bloqueia propagação p/ o container e popups indesejados

                                        if (window.navegarParaAnotacao) {
                                            const indiceDestino = parentIndex !== undefined ? parentIndex : idx;
                                            window.navegarParaAnotacao(topico.id, indiceDestino);
                                        }
                                    }
                                });

                                highlightLayerDiv.appendChild(badge);
                            }
                        }
                    }
                    if (item.itensCorrelacionados) {
                        desenharMarcacoes(item.itensCorrelacionados, parentIndex !== undefined ? parentIndex : idx);
                    }
                });
            };
            desenharMarcacoes(topico.anotacoes);

            // [NOVO] Renderização dos Alfinetes de Extração (Dumb Components)
            const { zoom: pageZoom, rotation: pageRot } = getPageViewState(pageNum);
            if (pageRot === 0 && topico.marcosExtracao && topico.marcosExtracao.length > 0) {
                topico.marcosExtracao.forEach(marco => {
                    if (marco.pagina === pageNum) {
                        const pin = document.createElement('div');
                        pin.className = 'pdf-extrator-pin'; 
                        pin.style.top = (marco.offsetY * pageZoom) + 'px';
                        pin.style.borderColor = topico.cor; 
                        pin.style.color = topico.cor; 
                        
                        // DATA-ATTRIBUTES para a Event Delegation (Performance)
                        pin.dataset.tooltipFronteira = marco.fronteira;
                        pin.dataset.tooltipDoc = marco.docTipo;
                        pin.dataset.tooltipTopico = topico.nome;

                        pin.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;

                        highlightLayerDiv.appendChild(pin);
                    }
                });
            }
        });

        // Renderização de trechos provisórios da Captura Composta (TextCaptureManager)
        if (window.TextCaptureManager && typeof window.TextCaptureManager.obterHighlightsProvisoriosParaPagina === 'function') {
            const blocosProvisorios = window.TextCaptureManager.obterHighlightsProvisoriosParaPagina(pageNum);
            blocosProvisorios.forEach(bloco => {
                const rectsProjetados = bloco.rects.map(r => _transformarRectParaViewportAtual(pageNum, r));
                rectsProjetados.forEach(rect => {
                    const marker = document.createElement('div');
                    marker.className = 'pdf-highlight-rect is-draft-capture';
                    marker.style.top = rect.top + 'px';
                    marker.style.left = rect.left + 'px';
                    marker.style.width = rect.width + 'px';
                    marker.style.height = rect.height + 'px';
                    highlightLayerDiv.appendChild(marker);
                });

                if (bloco.mostrarBadge && rectsProjetados.length > 0) {
                    const firstRect = rectsProjetados[0];
                    const draftBadge = document.createElement('div');
                    draftBadge.className = 'pdf-annotation-badge is-draft-badge';
                    draftBadge.style.top = (firstRect.top + (firstRect.height / 2)) + 'px';
                    draftBadge.style.transform = 'translateY(-50%)';
                    draftBadge.title = `Trecho ${bloco.ordem} acumulado (aguardando conclusão)`;
                    draftBadge.textContent = `+${bloco.ordem}`;
                    highlightLayerDiv.appendChild(draftBadge);
                }
            });
        }
    }

    function sincronizarHighlightsGerais() {
        document.querySelectorAll('.pdf-page-container').forEach(container => {
            if (container.dataset.loaded === 'true') {
                const pageNum = parseInt(container.dataset.pageNumber);
                const highlightLayerDiv = container.querySelector('.highlightLayer');
                if (highlightLayerDiv) {
                    _renderizarHighlightsDaPagina(pageNum, highlightLayerDiv);
                }
            }
        });
    }

    /* ================================================
       OTIMIZAÇÃO DE MEMÓRIA (GARBAGE COLLECTION) E RECUPERAÇÃO
       ================================================ */
    function descarregarPaginaElemento(container) {
        // Invalida imediatamente qualquer await em voo (getPage / render / textContent / annotations)
        container._renderSeq = (container._renderSeq || 0) + 1;

        if (container._scrollRaf) {
            cancelAnimationFrame(container._scrollRaf);
            container._scrollRaf = null;
        }
        if (container._renderTask) {
            container._renderTask.cancel();
            container._renderTask = null;
        }

        const pageNum = parseInt(container.dataset.pageNumber, 10);
        if (!isNaN(pageNum)) {
            _pendingTransforms.delete(pageNum);
            _scrollAnchors.delete(pageNum);
        }

        container.classList.remove('is-page-updating');
        container.innerHTML = '';

        // Limpeza granular O(1) de cache na API do PDF.js 
        // (Libera Memória VRAM e Bitmap sem destruir o Parser Global)
        if (container._pdfPageRef && typeof container._pdfPageRef.cleanup === 'function') {
            try { container._pdfPageRef.cleanup(); } catch (e) {}
            container._pdfPageRef = null;
        }
    }

    function forcarReRenderizacaoVisiveis() {
        if (!_pdfDoc) return;
        // Travessia assintótica de O(N=4000) reduzida para O(K=~15)
        _activePages.forEach(container => {
            const canvas = container.querySelector('canvas');
            // Se o navegador ceifou o contexto do Canvas na suspensão da aba
            if (!canvas || canvas.width === 0) {
                descarregarPaginaElemento(container);
                renderizarPaginaElemento(parseInt(container.dataset.pageNumber, 10), container);
                container.dataset.loaded = 'true';
            }
        });
    }

    function encerrar() {
        if (_pdfRenderObserver) {
            _pdfRenderObserver.disconnect();
            _pdfRenderObserver = null;
        }
        if (_pdfDestroyObserver) {
            _pdfDestroyObserver.disconnect();
            _pdfDestroyObserver = null;
        }
        if (_pdfReadTracker) {
            _pdfReadTracker.disconnect();
            _pdfReadTracker = null;
        }
        if (_transformRafId) {
            cancelAnimationFrame(_transformRafId);
            _transformRafId = null;
        }
        if (_scrollSyncRafId) {
            cancelAnimationFrame(_scrollSyncRafId);
            _scrollSyncRafId = null;
        }
        _activePages.clear();
        _pdfDoc = null;
        _pageLabelsGlobais = null;
        _pageMetadataCache.clear();
        _footerBoundaryCache.clear();
        _pageBaseDimensions.clear();
        _pageViewOverrides.clear();
        _pendingTransforms.clear();
        _scrollAnchors.clear();
        _paginaAlvoTravada = null;
        _sincronizarPaginaNoScroll = false;
        _currentPage = 1;
    }

    return {
        BASE_SCALE,
        init,
        carregarPDF,
        sincronizarHighlightsGerais,
        obterRotuloPagina,
        getDisplayLabel,
        extrairMetadadosDaPagina,
        extrairTextoPorRegiao,
        obterLimiteRodape,
        resolverPagina,
        goToPage: jurisLinkService.goTo,
        getPdfDoc: () => _pdfDoc,
        getCurrentPage: () => _currentPage,
        getPageViewState,
        getOverridesCount,
        normalizarRectParaBase,
        alterarZoomPaginaAtual,
        resetarZoomPaginaAtual,
        girarPaginaAtual,
        resetarVisualizacaoPaginaAtual,
        limparEstadoVisualizacao,
        restaurarOverridesVisualizacao,
        forcarReRenderizacaoVisiveis,
        encerrar
    };
})();