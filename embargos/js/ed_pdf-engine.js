/* ================================================
   MOTOR DE RENDERIZAÇÃO DE PDF E METADADOS (ED)
   Módulo isolado para gestão do PDF.js, Canvas e DOM do Inteiro Teor
   ================================================ */
window.PdfEngine = (function () {
    'use strict';

    // Estado Privado do Motor
    let _pdfDoc = null;
    let _docEpoch = 0; // Contador monotônico de geração para invalidar Promises órfãs
    let _currentPage = 1;
    let _pageLabelsGlobais = null;
    const _pageMetadataCache = new Map();
    const _footerBoundaryCache = new Map();
    let _pdfRenderObserver = null;
    let _pdfReadTracker = null;
    let _pdfDestroyObserver = null;
    const _activePages = new Set();

    // Dependências Injetadas pelo ed_app-core.js
    let _deps = {
        getTopicos: () => [],
        exibirToast: () => {},
        atualizarDisplayPaginador: () => {},
        validarPdf: async () => true,
        compararPdf: null,
        resolverDivergenciaPdf: null,
        iniciarSessaoBackup: async () => {},
        habilitarFerramentas: () => {},
        onProcessoIdentificado: null,
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
            if (!_pdfDoc) return;
            const epoch = _docEpoch;
            try {
                let explicitDest = dest;
                if (typeof dest === 'string') {
                    explicitDest = await _pdfDoc.getDestination(dest);
                }
                if (epoch !== _docEpoch || !_pdfDoc) return;
                if (Array.isArray(explicitDest)) {
                    const pageRef = explicitDest[0];
                    let pageNum;
                    if (typeof pageRef === 'object' && pageRef !== null) {
                        const pageIndex = await _pdfDoc.getPageIndex(pageRef);
                        if (epoch !== _docEpoch) return;
                        pageNum = pageIndex + 1; 
                    } else if (Number.isInteger(pageRef)) {
                        pageNum = pageRef + 1;
                    }
                    if (pageNum) this.goTo(pageNum);
                }
            } catch (e) {
                console.error('Exceção crítica na resolução do link:', e);
            }
        },
        
        goTo: function(pageNum, opcoes = {}) {
            const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNum}"]`);
            const scrollContainer = document.getElementById('pdf-container');
            
            if (pageContainer && scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const pageRect = pageContainer.getBoundingClientRect();
                const targetScrollTop = scrollContainer.scrollTop + (pageRect.top - containerRect.top) - 16;
                
                scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'auto' });
                _currentPage = pageNum;
                _deps.atualizarDisplayPaginador(pageNum);

                if (!opcoes.silencioso) {
                    _deps.exibirToast(`Acessando fl. ${pageNum} via sumário.`, 'sucesso');
                }
                return true;
            } else {
                if (!opcoes.silencioso) {
                    _deps.exibirToast('Página alvo não encontrada no DOM.', 'erro');
                }
                return false;
            }
        },
        
        getDestinationHash: function(dest) { return ''; },
        getAnchorUrl: function(hash) { return ''; },
        setDocument: function(doc) {},
        executeNamedAction: function(action) {}
    };

    /* ================================================
       METADADOS E BUSCA DE PÁGINAS (BLINDADOS POR _docEpoch)
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
        if (!_pdfDoc) return null;
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
        if (!_pdfDoc) return { pjeId: null, flsNum: null };

        const epoch = _docEpoch;
        try {
            const page = await _pdfDoc.getPage(pageNum);
            if (epoch !== _docEpoch || !_pdfDoc) return { pjeId: null, flsNum: null };

            const textContent = textContentPreCarregado || await page.getTextContent();
            if (epoch !== _docEpoch || !_pdfDoc) return { pjeId: null, flsNum: null };

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
            if (epoch === _docEpoch) {
                _pageMetadataCache.set(pageNum, resultado);
            }
            return resultado;
        } catch (err) {
            if (epoch === _docEpoch) {
                console.error('Falha ao extrair metadados físicos da página:', err);
            }
            return { pjeId: null, flsNum: null };
        }
    }

    async function obterLimiteRodape(pageNum) {
        if (_footerBoundaryCache.has(pageNum)) return _footerBoundaryCache.get(pageNum);
        if (!_pdfDoc) return null;

        const epoch = _docEpoch;
        const REGEX_RODAPE_ASSINATURA = /(Documento\s+assinado\s+eletronicamente\s+por|Assinado\s+(?:digitalmente|eletronicamente)\s+por|Signatário(?:\(a\))?\s*:)/i;

        try {
            const page = await _pdfDoc.getPage(pageNum);
            if (epoch !== _docEpoch || !_pdfDoc) return null;

            const viewport = page.getViewport({ scale: 1.5 });
            const textContent = await page.getTextContent();
            if (epoch !== _docEpoch || !_pdfDoc) return null;

            let limiteY = null;
            for (const item of textContent.items) {
                if (REGEX_RODAPE_ASSINATURA.test(item.str)) {
                    const [, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                    // Converte a altura real do glifo (pts PDF) para a escala 1.5 do viewport para obter o topo da linha
                    const alturaPts = Math.abs(item.height || item.transform[3] || 10);
                    const topoDoItem = vy - (alturaPts * 1.5) - 2;
                    if (limiteY === null || topoDoItem < limiteY) limiteY = topoDoItem;
                }
            }

            if (epoch === _docEpoch) {
                _footerBoundaryCache.set(pageNum, limiteY);
            }
            return limiteY;
        } catch (err) {
            if (epoch === _docEpoch) {
                console.warn('Falha ao calcular limite de rodapé da página', pageNum, err);
            }
            return null;
        }
    }

    const _yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

    async function extrairTextoPorRegiao(marcoInicio, marcoFim, onProgress = null, onPageRawText = null) {
        if (!_pdfDoc) return "";
        const targetPdfInstance = _pdfDoc;
        const epoch = _docEpoch;
        let textoExtraido = "";
        
        const ESCALA_RENDERIZACAO_UI = 1.5; 
        const PADDING_SEGURANCA_PTS = 4;
        const TIME_BUDGET_MS = 40; 
        
        const pInicio = Math.min(marcoInicio.pagina, marcoFim.pagina);
        const pFim = Math.max(marcoInicio.pagina, marcoFim.pagina);
        const yInicioDOM = (pInicio === marcoInicio.pagina) ? marcoInicio.offsetY : marcoFim.offsetY;
        const yFimDOM = (pFim === marcoFim.pagina) ? marcoFim.offsetY : marcoInicio.offsetY;
        const totalPaginas = (pFim - pInicio) + 1;
        let lastYieldTime = performance.now();

        for (let i = pInicio; i <= pFim; i++) {
            if (_pdfDoc !== targetPdfInstance || epoch !== _docEpoch) {
                throw new Error("CONCURRENCY_VIOLATION: O documento original foi alterado durante a extração.");
            }
            
            let page = null;
            try {
                page = await _pdfDoc.getPage(i);
                const viewportNative = page.getViewport({ scale: 1.0 }); 
                const textContent = await page.getTextContent();
                
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
                    try { onProgress((i - pInicio) + 1, totalPaginas); } catch (e) {}
                }
            } finally {
                if (page && typeof page.cleanup === 'function') {
                    try { page.cleanup(); } catch (e) {}
                }
            }

            if (performance.now() - lastYieldTime > TIME_BUDGET_MS) {
                await _yieldToMain();
                lastYieldTime = performance.now(); 
            }
        }
        
        if (textoExtraido.trim().length === 0) _deps.exibirToast("Não foi possível extrair texto.", "aviso");
        return textoExtraido;
    }

    /* ================================================
       INSPEÇÃO DE IDENTIDADE (CNJ + HASH DE PÁGINA) E DESMONTAGEM
       ================================================ */
    async function _extrairNumeroCnjCapa(firstPage) {
        try {
            const textContentFirstPage = await firstPage.getTextContent();
            const rawString = textContentFirstPage.items.map(item => item.str).join('');
            const sanitizedString = rawString.replace(/\s+/g, '');
            const cnjRegex = /(\d{7})[-]?(\d{2})\.?(\d{4})\.?\d\.?\d{2}\.?\d{4}/;
            const match = sanitizedString.match(cnjRegex);
            if (match) {
                const sequencialLimpo = match[1].slice(-4);
                const digito = match[2];
                const ano = match[3];
                return `${sequencialLimpo}-${digito}.${ano}`;
            }
        } catch (err) {
            console.warn("[Juris Notes ED] Falha ao tentar capturar o número do processo na capa.", err);
        }
        return null;
    }

    /**
     * Gera um hash SHA-256 do conteúdo textual normalizado de uma página específica
     * para detectar deslocamento de páginas (Page Shift) no meio do processo.
     * Retorna null se a página for puramente imagem (< 20 caracteres alfanuméricos).
     */
    async function _calcularHashTextoPagina(pdfDocInstance, pageNum) {
        if (!pdfDocInstance || !Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfDocInstance.numPages) {
            return null;
        }
        let page = null;
        try {
            page = await pdfDocInstance.getPage(pageNum);
            const textContent = await page.getTextContent();
            const textoNormalizado = textContent.items
                .map(item => item.str)
                .join('')
                .replace(/\s+/g, '')
                .toLowerCase();

            if (textoNormalizado.length < 20) return null;

            const encoder = new TextEncoder();
            const data = encoder.encode(textoNormalizado);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        } catch (e) {
            return null;
        } finally {
            if (page && typeof page.cleanup === 'function') {
                try { page.cleanup(); } catch (e) {}
            }
        }
    }

    function _desmontarDocumentoAtual() {
        // Incrementa a época ANTES de cancelar/limpar para invalidar qualquer Promise em voo
        _docEpoch++;

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

        document.querySelectorAll('.pdf-page-container').forEach(container => {
            if (container._scrollRaf) {
                cancelAnimationFrame(container._scrollRaf);
                container._scrollRaf = null;
            }
            descarregarPaginaElemento(container);
        });

        _activePages.clear();
        _pageMetadataCache.clear();
        _footerBoundaryCache.clear();
        _pageLabelsGlobais = null;

        if (_pdfDoc && typeof _pdfDoc.destroy === 'function') {
            try { _pdfDoc.destroy(); } catch (e) {}
        }
        _pdfDoc = null;
    }

    /* ================================================
       CARREGAMENTO TRANSACIONAL E RENDERIZAÇÃO
       ================================================ */
    async function carregarPDF(file, modoOuRetomada = false) {
        if (!file) return { ok: false, motivo: 'arquivo_ausente' };

        let modo = 'novo';
        if (typeof modoOuRetomada === 'string') {
            modo = modoOuRetomada;
        } else if (modoOuRetomada && typeof modoOuRetomada === 'object' && modoOuRetomada.modo) {
            modo = modoOuRetomada.modo;
        } else if (modoOuRetomada === true) {
            modo = 'retomada';
        }

        let arrayBuffer;
        try {
            arrayBuffer = await file.arrayBuffer();
        } catch (err) {
            console.error('Erro na leitura do arquivo:', err);
            _deps.exibirToast('Não foi possível ler o arquivo selecionado.', 'erro');
            return { ok: false, motivo: 'erro_io' };
        }

        // 1. Calcula o hash SHA-256 uma única vez antes de o pdf.js transferir o ArrayBuffer ao Worker
        let comparacao = { coincide: true, hash: null, isLegado: false };
        if (typeof _deps.compararPdf === 'function') {
            comparacao = await _deps.compararPdf(arrayBuffer);
        } else if (modo !== 'novo' && typeof _deps.validarPdf === 'function') {
            const valido = await _deps.validarPdf(arrayBuffer);
            comparacao = { coincide: valido, hash: null, isLegado: false };
        }

        // 2. Abre o PDF candidato em memória SEM tocar no documento atual
        let novoDoc = null;
        try {
            const typedarray = new Uint8Array(arrayBuffer);
            novoDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
        } catch (err) {
            console.error('Erro ao processar estrutura do PDF:', err);
            _deps.exibirToast('Erro ao ler o PDF. Verifique a integridade do arquivo.', 'erro');
            return { ok: false, motivo: 'pdf_invalido' };
        }

        // 3. Inspeciona 1ª página (CNJ) e calcula o hash textual da última página do novoDoc
        let firstPage = null;
        let numeroCnjCapa = null;
        let novaUltimaPaginaHash = null;
        try {
            firstPage = await novoDoc.getPage(1);
            numeroCnjCapa = await _extrairNumeroCnjCapa(firstPage);
            novaUltimaPaginaHash = await _calcularHashTextoPagina(novoDoc, novoDoc.numPages);
        } catch (err) {
            try { await novoDoc.destroy(); } catch (e) {}
            _deps.exibirToast('Não foi possível ler as páginas do PDF.', 'erro');
            return { ok: false, motivo: 'pagina_invalida' };
        }

        // 4. Se for retomada com divergência ou substituição (Hot-Swap), valida com o usuário
        if (modo !== 'novo' && (!comparacao.coincide || modo === 'substituicao')) {
            let aceito = false;
            if (typeof _deps.resolverDivergenciaPdf === 'function') {
                aceito = await _deps.resolverDivergenciaPdf({
                    hash: comparacao.hash,
                    coincide: comparacao.coincide,
                    numPaginas: novoDoc.numPages,
                    nomeArquivo: file.name,
                    numeroCnj: numeroCnjCapa,
                    novaUltimaPaginaHash,
                    inspecionarHashPagina: (numPag) => _calcularHashTextoPagina(novoDoc, numPag),
                    modo
                });
            } else {
                aceito = comparacao.coincide;
            }

            if (!aceito) {
                if (firstPage && typeof firstPage.cleanup === 'function') {
                    try { firstPage.cleanup(); } catch (e) {}
                }
                try { await novoDoc.destroy(); } catch (e) {}

                if (modo === 'retomada') {
                    const uploadInput = document.getElementById('pdf-upload');
                    if (uploadInput) {
                        uploadInput.value = '';
                        setTimeout(() => uploadInput.click(), 1200);
                    }
                }
                return { ok: false, motivo: 'recusado' };
            }
        }

        // 5. Se for sessão nova, registra no BackupManager com o hash já calculado
        if (modo === 'novo') {
            await _deps.iniciarSessaoBackup(file.name, {
                hash: comparacao.hash,
                numPaginas: novoDoc.numPages,
                processoCnj: numeroCnjCapa,
                ultimaPaginaHash: novaUltimaPaginaHash
            });
        }

        // 6. Desmonta o documento antigo (incrementando _docEpoch) e assume o novoDoc
        _desmontarDocumentoAtual();
        _pdfDoc = novoDoc;
        _currentPage = 1;
        const activeEpoch = _docEpoch;

        document.getElementById('total-page-display').textContent = _pdfDoc.numPages;

        try {
            _pageLabelsGlobais = await _pdfDoc.getPageLabels();
        } catch (e) {
            _pageLabelsGlobais = null;
        }
        if (activeEpoch !== _docEpoch) return { ok: false, motivo: 'substituido' };

        _deps.habilitarFerramentas();

        const wrapper = document.getElementById('pdf-wrapper');
        wrapper.innerHTML = '';
        wrapper.style.display = 'flex';
        document.getElementById('pdf-placeholder').style.display = 'none';
        document.getElementById('floating-page-panel').style.display = 'flex';

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

        _pdfDestroyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const container = entry.target;
                if (entry.isIntersecting) {
                    _activePages.add(container);
                } else {
                    _activePages.delete(container);
                    if (container.dataset.loaded === 'true') {
                        descarregarPaginaElemento(container);
                        container.dataset.loaded = 'false';
                    }
                }
            });
        }, { root: document.getElementById('pdf-container'), rootMargin: '3000px 0px', threshold: 0 });

        _pdfReadTracker = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
                    _currentPage = pageNum;
                    _deps.atualizarDisplayPaginador(pageNum);
                }
            });
        }, { root: document.getElementById('pdf-container'), rootMargin: '-15% 0px -80% 0px', threshold: 0 });

        const viewportCSS = firstPage.getViewport({ scale: 1.5 });
        const fragment = document.createDocumentFragment();

        for (let i = 1; i <= _pdfDoc.numPages; i++) {
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
            fragment.appendChild(pageContainer);
            
            _pdfRenderObserver.observe(pageContainer);
            _pdfDestroyObserver.observe(pageContainer);
            _pdfReadTracker.observe(pageContainer);
        }
        
        wrapper.appendChild(fragment);

        if (numeroCnjCapa && typeof _deps.onProcessoIdentificado === 'function') {
            _deps.onProcessoIdentificado(numeroCnjCapa);
        }

        // Primeiro parâmetro: false quando 'novo' (retrocompatível com checagens booleanas legadas)
        await _deps.onPdfCarregado(modo === 'novo' ? false : modo, {
            modo,
            numPaginas: _pdfDoc.numPages,
            numeroCnj: numeroCnjCapa,
            hash: comparacao.hash,
            ultimaPaginaHash: novaUltimaPaginaHash
        });

        return {
            ok: true,
            numPaginas: _pdfDoc.numPages,
            numeroCnj: numeroCnjCapa
        };
    }

    async function renderizarPaginaElemento(num, container) {
        if (!_pdfDoc) return;
        const epoch = _docEpoch;

        if (container._renderTask) {
            try { container._renderTask.cancel(); } catch (e) {}
            container._renderTask = null;
        }
        container.innerHTML = '';

        let page;
        try {
            page = await _pdfDoc.getPage(num);
        } catch (err) {
            if (epoch === _docEpoch) container.dataset.loaded = 'false';
            return;
        }
        if (epoch !== _docEpoch || !_pdfDoc) {
            if (page && typeof page.cleanup === 'function') {
                try { page.cleanup(); } catch (e) {}
            }
            return;
        }

        container._pdfPageRef = page;
        const dpr = window.devicePixelRatio || 1;
        const scale = 1.5;
        const viewport = page.getViewport({ scale: scale });

        container.style.width = Math.floor(viewport.width) + 'px';
        container.style.height = Math.floor(viewport.height) + 'px';

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block;';
        container.appendChild(canvas);

        const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;

        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        textLayer.style.setProperty('--scale-factor', viewport.scale);
        container.appendChild(textLayer);

        container._renderTask = page.render({
            canvasContext: ctx,
            transform: transform,
            viewport: viewport
        });

        try {
            await container._renderTask.promise;
            if (epoch !== _docEpoch || !_pdfDoc) return;
            
            const textContent = await page.getTextContent();
            if (epoch !== _docEpoch || !_pdfDoc) return;

            const tl = new pdfjsLib.TextLayer({
                textContentSource: textContent,
                container: textLayer,
                viewport: viewport
            });
            await tl.render();
            if (epoch !== _docEpoch || !_pdfDoc) return;

            const highlightLayerDiv = document.createElement('div');
            highlightLayerDiv.className = 'highlightLayer';
            highlightLayerDiv.style.setProperty('--scale-factor', viewport.scale);
            container.appendChild(highlightLayerDiv);

            _renderizarHighlightsDaPagina(num, highlightLayerDiv);

            if (!_pageMetadataCache.has(num)) {
                extrairMetadadosDaPagina(num, textContent).then(() => {
                    if (epoch === _docEpoch) _deps.atualizarDisplayPaginador(num);
                });
            }

            const annotationData = await page.getAnnotations();
            if (epoch !== _docEpoch || !_pdfDoc) return;

            if (annotationData && annotationData.length > 0 && container.contains(textLayer)) {
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
            
            if (epoch === _docEpoch) {
                container.dataset.loaded = 'true';
            }
        } catch (err) {
            if (err.name !== 'RenderingCancelledException' && epoch === _docEpoch) {
                console.error('Erro ao renderizar página PDF:', err);
            }
            if (epoch === _docEpoch) {
                container.dataset.loaded = 'false';
            }
        } finally {
            container._renderTask = null;
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

            // Mapa O(N) de índice real -> número visual (ignora checkpoints)
            const mapaVisuais = window.JurisIndexUtils
                ? window.JurisIndexUtils.construirMapaVisual(topico.anotacoes)
                : new Map((topico.anotacoes || []).map((_, i) => [i, i + 1]));

            const desenharMarcacoes = (itens, parentRealIndex) => {
                if (!itens) return;
                itens.forEach((item, idx) => {
                    if (window.JurisIndexUtils && window.JurisIndexUtils.ehCheckpoint(item)) return;

                    const realIndex = (parentRealIndex !== undefined) ? parentRealIndex : idx;
                    const numIdeia = mapaVisuais.get(realIndex) ?? (realIndex + 1);

                    if ((item.tipo === 'texto' || item.tipo === 'imagem') && item.highlightRects && item.highlightRects.length > 0) {
                        // Filtra apenas os retângulos pertencentes à página atual (suporte a Captura Composta multi-página)
                        const rectsNaPagina = item.highlightRects.filter(r => (r.page ?? item.paginaFisica) === pageNum);

                        if (rectsNaPagina.length > 0) {
                            if (item.tipo === 'texto') {
                                rectsNaPagina.forEach(rect => {
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
                                rectsNaPagina.forEach(rect => {
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

                            // O marcador circular numerado aparece APENAS na página âncora (início da anotação)
                            if (item.paginaFisica === pageNum) {
                                const firstRect = rectsNaPagina[0];
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
                                            window.navegarParaAnotacao(topico.id, realIndex);
                                        }
                                    }
                                });

                                highlightLayerDiv.appendChild(badge);
                            }
                        }
                    }
                    if (item.itensCorrelacionados) {
                        desenharMarcacoes(item.itensCorrelacionados, realIndex);
                    }
                });
            };
            desenharMarcacoes(topico.anotacoes);

            // [NOVO] Renderização dos Alfinetes de Extração (Dumb Components)
            if (topico.marcosExtracao && topico.marcosExtracao.length > 0) {
                topico.marcosExtracao.forEach(marco => {
                    if (marco.pagina === pageNum) {
                        const pin = document.createElement('div');
                        pin.className = 'pdf-extrator-pin'; 
                        pin.style.top = marco.offsetY + 'px';
                        pin.style.borderColor = topico.cor; 
                        pin.style.color = topico.cor; 
                        
                        // DATA-ATTRIBUTES para a Event Delegation (Performance)
                        pin.dataset.tooltipFronteira = marco.fronteira;
                        pin.dataset.tooltipDoc = marco.docTipo;
                        pin.dataset.tooltipTopico = topico.nome;
                        pin.dataset.tooltipPolo = marco.polo || 'Comum';

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
                bloco.rects.forEach(rect => {
                    const marker = document.createElement('div');
                    marker.className = 'pdf-highlight-rect is-draft-capture';
                    marker.style.top = rect.top + 'px';
                    marker.style.left = rect.left + 'px';
                    marker.style.width = rect.width + 'px';
                    marker.style.height = rect.height + 'px';
                    highlightLayerDiv.appendChild(marker);
                });

                if (bloco.mostrarBadge && bloco.rects.length > 0) {
                    const firstRect = bloco.rects[0];
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
                const pageNum = parseInt(container.dataset.pageNumber, 10);
                const highlightLayerDiv = container.querySelector('.highlightLayer');
                if (highlightLayerDiv) {
                    _renderizarHighlightsDaPagina(pageNum, highlightLayerDiv);
                }
            }
        });
    }

    function descarregarPaginaElemento(container) {
        if (container._renderTask) {
            try { container._renderTask.cancel(); } catch (e) {}
            container._renderTask = null;
        }
        container.innerHTML = '';
        
        if (container._pdfPageRef && typeof container._pdfPageRef.cleanup === 'function') {
            try { container._pdfPageRef.cleanup(); } catch (e) {}
            container._pdfPageRef = null;
        }
    }

    function forcarReRenderizacaoVisiveis() {
        if (!_pdfDoc) return;
        _activePages.forEach(container => {
            const canvas = container.querySelector('canvas');
            if (!canvas || canvas.width === 0) {
                descarregarPaginaElemento(container);
                renderizarPaginaElemento(parseInt(container.dataset.pageNumber, 10), container);
                container.dataset.loaded = 'true';
            }
        });
    }

    function encerrar() {
        _desmontarDocumentoAtual();
        _currentPage = 1;
    }

    return {
        init,
        carregarPDF,
        sincronizarHighlightsGerais,
        obterRotuloPagina,
        getDisplayLabel,
        extrairMetadadosDaPagina,
        extrairTextoPorRegiao,
        obterLimiteRodape,
        resolverPagina,
        goToPage: (pageNum, opcoes) => jurisLinkService.goTo(pageNum, opcoes),
        getPdfDoc: () => _pdfDoc,
        getCurrentPage: () => _currentPage,
        forcarReRenderizacaoVisiveis,
        encerrar
    };
})();