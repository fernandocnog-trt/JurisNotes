/* ================================================
   text-capture-manager.js  —  v1.0.0
   Motor de Captura Simples e Captura Composta (Aglutinação Manual)
   ================================================ */
window.TextCaptureManager = (function () {
    'use strict';

    const DEFAULT_TEXT_BTN_TITLE = 'Gerar Anotação a Partir de Texto';

    let _trechos = [];
    let _ocupado = false;
    let _avisouRetornoComRascunho = false;
    let _inicializado = false;

    let _deps = {
        setTempHighlightState: ({ rects, paginaFisica }) => {
            if (typeof _tempHighlightState !== 'undefined') {
                _tempHighlightState.rects = rects;
                _tempHighlightState.paginaFisica = paginaFisica;
            }
        },
        exibirToast: (msg, tipo) => {
            if (typeof exibirToast === 'function') exibirToast(msg, tipo);
        },
        abrirPopupClassificacao: (tipo, conteudo) => {
            if (typeof exibirPopupClassificacao === 'function') {
                exibirPopupClassificacao(tipo, conteudo);
            } else {
                console.error('[TextCaptureManager] exibirPopupClassificacao não encontrada.');
            }
        },
        sincronizarHighlights: () => {
            if (typeof window.sincronizarHighlightsGerais === 'function') {
                window.sincronizarHighlightsGerais();
            }
        }
    };

    function init(dependencies) {
        _deps = { ..._deps, ...dependencies };
        _inicializado = true;
        _atualizarUI();
    }

    /**
     * Extrai texto higienizado e retângulos relativos às páginas do PDF.
     * Filtra retângulos na zona de assinatura usando o ponto médio vertical (localMidY),
     * eliminando sensibilidade a variações de line-height do textLayer.
     */
    async function _extrairSelecaoAtualDoPdf(minCaracteres = 1) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return { erro: 'vazio' };
        }

        let selecaoTexto = selection.toString().trim();
        if (window.JurisUtils && typeof window.JurisUtils.limparTextoPDF === 'function') {
            selecaoTexto = window.JurisUtils.limparTextoPDF(selecaoTexto);
        }

        if (selecaoTexto.length < minCaracteres) {
            return { erro: selecaoTexto.length === 0 ? 'vazio' : 'curto' };
        }

        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !focusNode) return { erro: 'vazio' };

        const anchorEl = anchorNode.nodeType === 3 ? anchorNode.parentNode : anchorNode;
        const focusEl = focusNode.nodeType === 3 ? focusNode.parentNode : focusNode;
        const anchorContainer = anchorEl && anchorEl.closest ? anchorEl.closest('.pdf-page-container') : null;
        const focusContainer = focusEl && focusEl.closest ? focusEl.closest('.pdf-page-container') : null;

        if (!anchorContainer || !focusContainer) {
            return { erro: 'fora_pdf' };
        }

        const anchorPageNum = parseInt(anchorContainer.dataset.pageNumber, 10);
        const focusPageNum = parseInt(focusContainer.dataset.pageNumber, 10);
        const minPage = Math.min(anchorPageNum, focusPageNum);
        const maxPage = Math.max(anchorPageNum, focusPageNum);

        // DOM Read Phase em lote (previne layout thrashing)
        const cachedPages = [];
        for (let i = minPage; i <= maxPage; i++) {
            const pageEl = document.querySelector(`.pdf-page-container[data-page-number="${i}"]`);
            if (pageEl) {
                cachedPages.push({ page: i, rect: pageEl.getBoundingClientRect() });
            }
        }

        if (window.PdfEngine && typeof window.PdfEngine.obterLimiteRodape === 'function') {
            await Promise.all(cachedPages.map(async (p) => {
                p.limiteRodape = await window.PdfEngine.obterLimiteRodape(p.page);
            }));
        }

        const range = selection.getRangeAt(0);
        const rawRects = Array.from(range.getClientRects());
        const mappedRects = [];

        rawRects.forEach(rect => {
            if (rect.width < 1 || rect.height < 1) return;

            const midY = rect.top + (rect.height / 2);
            const matchedPage = cachedPages.find(p => midY >= p.rect.top && midY <= p.rect.bottom);

            if (matchedPage) {
                const localTop = rect.top - matchedPage.rect.top;
                const localMidY = localTop + (rect.height / 2);

                // Descarta linhas cujo centro vertical cai na zona de assinatura eletrônica
                if (matchedPage.limiteRodape != null && localMidY >= matchedPage.limiteRodape) {
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
            return { erro: 'assinatura' };
        }

        return {
            erro: null,
            texto: selecaoTexto,
            rects: mappedRects,
            paginaFisica: mappedRects[0].page || minPage
        };
    }

    /**
     * Emenda os textos acumulados.
     * Remove o hífen apenas entre minúscula + hífen e inicial minúscula
     * (protege siglas como TRT-GO e nomes próprios).
     */
    function _juntarTextos(trechos) {
        if (!trechos || trechos.length === 0) return '';
        let resultado = trechos[0].texto;

        for (let i = 1; i < trechos.length; i++) {
            const prox = trechos[i].texto;
            if (/\p{Ll}-$/u.test(resultado) && /^\p{Ll}/u.test(prox)) {
                resultado = resultado.slice(0, -1) + prox;
            } else {
                resultado = `${resultado} ${prox}`;
            }
        }
        return resultado.trim();
    }

    function _ehDuplicataDoUltimo(captura) {
        if (_trechos.length === 0 || !captura || !captura.rects.length) return false;
        const ultimo = _trechos[_trechos.length - 1];
        if (!ultimo.rects.length) return false;

        return (
            ultimo.texto === captura.texto &&
            ultimo.paginaFisica === captura.paginaFisica &&
            Math.abs(ultimo.rects[0].top - captura.rects[0].top) < 2 &&
            Math.abs(ultimo.rects[0].left - captura.rects[0].left) < 2
        );
    }

    function _notificarErroExtracao(erro, contexto = 'simples') {
        if (erro === 'fora_pdf') {
            _deps.exibirToast('A seleção deve estar dentro do PDF.', 'aviso');
        } else if (erro === 'assinatura') {
            _deps.exibirToast('Seleção restrita à área de assinatura do documento.', 'aviso');
            window.getSelection()?.removeAllRanges();
        } else if (contexto === 'composto') {
            _deps.exibirToast('Selecione um trecho no PDF antes de acumular.', 'aviso');
        } else {
            _deps.exibirToast('Selecione um trecho válido no documento.', 'aviso');
        }
    }

    function _atualizarUI() {
        const dock = document.getElementById('multi-capture-dock');
        const countEl = document.getElementById('multi-capture-count');
        const previewEl = document.getElementById('multi-capture-preview');
        const btnComposto = document.getElementById('btn-ferramenta-texto-composto');
        const badge = document.getElementById('badge-trechos-compostos');
        const btnTextoNormal = document.getElementById('btn-ferramenta-texto');

        const qtd = _trechos.length;
        const emLeitura = document.body.dataset.activeTab === 'leitura';

        if (btnComposto) btnComposto.classList.toggle('has-draft', qtd > 0);
        if (badge) {
            badge.style.display = qtd > 0 ? 'flex' : 'none';
            badge.textContent = String(qtd);
        }

        // Guardrail: explicita que o botão habitual concluirá a captura composta enquanto houver rascunho
        if (btnTextoNormal) {
            btnTextoNormal.classList.toggle('is-completing-draft', qtd > 0);
            btnTextoNormal.title = qtd > 0
                ? `Concluir Captura Composta (${qtd} ${qtd === 1 ? 'trecho acumulado' : 'trechos acumulados'})`
                : DEFAULT_TEXT_BTN_TITLE;
        }

        if (!dock) return;

        if (qtd === 0 || !emLeitura) {
            dock.style.display = 'none';
            return;
        }

        const textoConsolidado = _juntarTextos(_trechos);
        const previaTooltip = textoConsolidado.length > 260
            ? `${textoConsolidado.slice(0, 260)}…`
            : textoConsolidado;

        if (countEl) {
            countEl.textContent = qtd === 1 ? '1 trecho' : `${qtd} trechos`;
            countEl.title = `Prévia aglutinada:\n"${previaTooltip}"`;
        }

        if (previewEl) {
            const ultimo = _trechos[qtd - 1];
            const cauda = ultimo.texto.length > 44 ? `…${ultimo.texto.slice(-44)}` : ultimo.texto;
            const pagLabel = window.PdfEngine ? PdfEngine.obterRotuloPagina(ultimo.paginaFisica) : ultimo.paginaFisica;
            previewEl.textContent = `fl. ${pagLabel}: "${cauda}"`;
            previewEl.title = `Prévia aglutinada:\n"${previaTooltip}"`;
        }

        dock.style.display = 'flex';
    }

    async function acumular() {
        if (_ocupado) return false;
        _ocupado = true;

        try {
            const captura = await _extrairSelecaoAtualDoPdf(1);
            if (captura.erro) {
                _notificarErroExtracao(captura.erro, 'composto');
                return false;
            }

            if (_ehDuplicataDoUltimo(captura)) {
                _deps.exibirToast('Este trecho já foi adicionado à fila.', 'aviso');
                window.getSelection()?.removeAllRanges();
                return false;
            }

            _trechos.push({
                texto: captura.texto,
                rects: captura.rects,
                paginaFisica: captura.paginaFisica
            });

            window.getSelection()?.removeAllRanges();
            _atualizarUI();
            _deps.sincronizarHighlights();

            const rotuloPag = window.PdfEngine ? PdfEngine.obterRotuloPagina(captura.paginaFisica) : captura.paginaFisica;
            const msg = _trechos.length === 1
                ? `Trecho 1 guardado (fl. ${rotuloPag}). Selecione a continuação e clique em "Concluir ✓".`
                : `Trecho ${_trechos.length} adicionado (fl. ${rotuloPag}).`;
            _deps.exibirToast(msg, 'sucesso');
            return true;
        } finally {
            _ocupado = false;
        }
    }

    async function concluir(origemBotaoHabitual = false) {
        if (_ocupado) return;
        _ocupado = true;

        try {
            // Se houver seleção ativa ao clicar em Concluir, incorpora ou interrompe em caso de erro
            const selecaoAtual = window.getSelection()?.toString().trim() || '';
            if (selecaoAtual.length > 0) {
                const capturaFinal = await _extrairSelecaoAtualDoPdf(1);
                if (capturaFinal.erro) {
                    _notificarErroExtracao(capturaFinal.erro, 'composto');
                    return; // Aborta para impedir salvamento incompleto silencioso
                }

                if (!_ehDuplicataDoUltimo(capturaFinal)) {
                    _trechos.push({
                        texto: capturaFinal.texto,
                        rects: capturaFinal.rects,
                        paginaFisica: capturaFinal.paginaFisica
                    });
                }
                window.getSelection()?.removeAllRanges();
                _atualizarUI();
                _deps.sincronizarHighlights();
            }

            if (_trechos.length === 0) {
                _deps.exibirToast('Nenhum trecho acumulado. Selecione o primeiro trecho no PDF.', 'aviso');
                return;
            }

            if (origemBotaoHabitual) {
                _deps.exibirToast(`Concluindo captura composta (${_trechos.length} trechos).`, 'info');
            }

            const textoConsolidado = _juntarTextos(_trechos);
            const rectsConsolidados = _trechos.flatMap(t => t.rects);
            const paginaAncora = _trechos[0].paginaFisica;

            _deps.setTempHighlightState({
                rects: rectsConsolidados,
                paginaFisica: paginaAncora
            });

            _deps.abrirPopupClassificacao('texto', textoConsolidado);
        } finally {
            _ocupado = false;
        }
    }

    async function capturarSimplesOuConcluir() {
        if (_trechos.length > 0) {
            return concluir(true);
        }

        if (_ocupado) return;
        _ocupado = true;

        try {
            const captura = await _extrairSelecaoAtualDoPdf(6);
            if (captura.erro) {
                _notificarErroExtracao(captura.erro, 'simples');
                return;
            }

            _deps.setTempHighlightState({
                rects: captura.rects,
                paginaFisica: captura.paginaFisica
            });

            _deps.abrirPopupClassificacao('texto', captura.texto);
        } finally {
            _ocupado = false;
        }
    }

    function desfazerUltimo() {
        if (_ocupado || _trechos.length === 0) return;
        _trechos.pop();
        _atualizarUI();
        _deps.sincronizarHighlights();
        _deps.exibirToast('Último trecho removido da fila.', 'info');
    }

    function limpar(silencioso = false, pularSync = false) {
        const tinhaDados = _trechos.length > 0;
        _trechos = [];
        _avisouRetornoComRascunho = false;

        _atualizarUI();
        if (tinhaDados && !pularSync) {
            _deps.sincronizarHighlights();
        }
        if (tinhaDados && !silencioso) {
            _deps.exibirToast('Trechos acumulados descartados.', 'info');
        }
    }

    function sincronizarVisibilidadeAba(aba) {
        _atualizarUI();
        if (aba !== 'leitura') {
            _avisouRetornoComRascunho = false;
        } else if (_trechos.length > 0 && !_avisouRetornoComRascunho) {
            _avisouRetornoComRascunho = true;
            _deps.exibirToast(
                `Captura composta em aberto (${_trechos.length} ${_trechos.length === 1 ? 'trecho' : 'trechos'}).`,
                'info'
            );
        }
    }

    function obterHighlightsProvisoriosParaPagina(pageNum) {
        const blocos = [];
        _trechos.forEach((trecho, idx) => {
            const rectsNaPagina = trecho.rects.filter(r => r.page === pageNum);
            if (rectsNaPagina.length > 0) {
                blocos.push({
                    ordem: idx + 1,
                    rects: rectsNaPagina,
                    mostrarBadge: trecho.paginaFisica === pageNum
                });
            }
        });
        return blocos;
    }

    return {
        init,
        acumular,
        concluir,
        capturarSimplesOuConcluir,
        desfazerUltimo,
        limpar,
        temTrechos: () => _trechos.length > 0,
        sincronizarVisibilidadeAba,
        obterHighlightsProvisoriosParaPagina
    };
})();