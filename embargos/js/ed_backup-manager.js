/* ================================================
   ed_backup-manager.js — v7.2
   Gerenciador de Sessão e Integridade de Backup (ED)
   ================================================ */
window.BackupManager = (function () {
    'use strict';

    /* ── Estado Privado ──────────────────────────────── */
    let _processoId       = null;
    let _processoCnj      = null;
    let _pdfHash          = null;
    let _pdfNumPaginas    = null;
    let _ultimaPaginaHash = null;
    let _historicoPdf     = [];
    let _pendingUpdate    = null;
    let _fileHandle       = null;

    /* ── Utilitários Privados ────────────────────────── */
    async function _calcularHash(buffer) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    function _extrairId(nomeArquivo) {
        return String(nomeArquivo || '').replace(/\.[^/.]+$/, '').toLowerCase();
    }

    function _gerarUUID() {
        return 'id-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    }

    function _empacotar(topicos) {
        const possuiAudio = topicos.some(t =>
            t.anotacoes.some(a =>
                a.tipo === 'audio' ||
                (a.itensCorrelacionados && a.itensCorrelacionados.some(ic => ic.tipo === 'audio'))
            )
        );
        const atalhosCapturados = window.ShortcutManager ? window.ShortcutManager.getState() : null;
        return JSON.stringify({
            metadata: {
                processoId:        _processoId,
                processoCnj:       _processoCnj,
                pdfHash:           _pdfHash,
                pdfNumPaginas:     _pdfNumPaginas,
                ultimaPaginaHash:  _ultimaPaginaHash,
                historicoPdf:      _historicoPdf,
                possuiAudio:       possuiAudio,
                balancaHtml:       window.BalancaManager ? window.BalancaManager.getHtmlState() : null,
                versaoApp:         '7.2',
                ultimaAtualizacao: Date.now(),
                atalhosPdf:        atalhosCapturados,
                tarefas:           window.TaskManager ? window.TaskManager.getTarefasState() : []
            },
            dados: topicos
        }, null, 2);
    }

    function _desempacotar(textoJson) {
        const obj = JSON.parse(textoJson); // SyntaxError se JSON inválido
        let pacote = obj;
        
        // Formato legado v1.0: array puro de tópicos (sem metadata)
        if (Array.isArray(obj)) {
            pacote = {
                metadata: { processoId: null, pdfHash: null, versaoApp: '1.0' },
                dados:    obj
            };
        } else if (!obj || typeof obj !== 'object' || !Array.isArray(obj.dados)) {
            throw new Error('Estrutura de backup não reconhecida.');
        }

        // MUDANÇA ARQUITETURAL: Migração Silenciosa de Nós de Ideia (v3.0)
        if (pacote.metadata.versaoApp !== '3.0') {
            pacote.dados.forEach(topico => {
                topico.anotacoes.forEach(anotacao => {
                    // 1. Inicializa a mochila dos filhos
                    if (anotacao.itensCorrelacionados) {
                        anotacao.itensCorrelacionados.forEach(item => {
                            if (!item.subAnotacoes) item.subAnotacoes = [];
                        });
                    }
                    
                    // 2. Realoca os nós perdidos no mestre
                    if (anotacao.subAnotacoes && anotacao.subAnotacoes.length > 0) {
                        const nosDoMestre = [];
                        anotacao.subAnotacoes.forEach(sub => {
                            if (sub.sourceRef !== undefined && sub.sourceRef !== 'main') {
                                const cIdx = parseInt(sub.sourceRef, 10);
                                if (!isNaN(cIdx) && anotacao.itensCorrelacionados && anotacao.itensCorrelacionados[cIdx]) {
                                    delete sub.sourceRef; 
                                    anotacao.itensCorrelacionados[cIdx].subAnotacoes.push(sub);
                                } else {
                                    nosDoMestre.push(sub); // Fallback caso filho não exista
                                }
                            } else {
                                delete sub.sourceRef;
                                nosDoMestre.push(sub);
                            }
                        });
                        anotacao.subAnotacoes = nosDoMestre;
                    }
                });
            });
        }
        
        // MUDANÇA ARQUITETURAL: Normalização de UUIDs (v4.0 Keyed Morphing)
        // Garante que todo dado legado ganhe uma chave única persistente.
        pacote.dados.forEach(topico => {
            if (!topico.uuid) topico.uuid = _gerarUUID();
            
            topico.anotacoes.forEach(anotacao => {
                if (!anotacao.uuid) anotacao.uuid = _gerarUUID();
                
                if (anotacao.itensCorrelacionados) {
                    anotacao.itensCorrelacionados.forEach(item => {
                        if (!item.uuid) item.uuid = _gerarUUID();
                        if (item.subAnotacoes) item.subAnotacoes.forEach(sub => { if (!sub.uuid) sub.uuid = _gerarUUID(); });
                    });
                }
                if (anotacao.subAnotacoes) {
                    anotacao.subAnotacoes.forEach(sub => { if (!sub.uuid) sub.uuid = _gerarUUID(); });
                }
            });
        });
        
        // MUDANÇA ARQUITETURAL: Migração de Razões Recursais e Fundamentos para o Topo (v5.0/6.0)
        pacote.dados.forEach(topico => {
            // Inicializa propriedades se não existirem
            if (topico.alegacoes === undefined) topico.alegacoes = '';
            if (topico.fundamentos === undefined) topico.fundamentos = '';

            let extraiuAlegacoes = [];
            let extraiuFundamentos = [];

            // Função auxiliar para varrer e extirpar nós antigos
            const limparNosLegados = (listaNos) => {
                if (!listaNos) return listaNos;
                return listaNos.filter(sub => {
                    if (sub.intencao === 'alegacao') {
                        extraiuAlegacoes.push(sub.texto);
                        return false; // Remove do array original
                    }
                    if (sub.intencao === 'fundamento_sentenca') {
                        extraiuFundamentos.push(sub.texto);
                        return false; // Remove do array original
                    }
                    // NOVA REGRA: Mover veredito e apagar o nó de origem
                    if (sub.intencao === 'veredito') {
                        if (!topico.veredito) topico.veredito = sub.texto; 
                        return false;
                    }
                    return true; // Mantém as outras intenções
                });
            };

            topico.anotacoes.forEach(anotacao => {
                anotacao.subAnotacoes = limparNosLegados(anotacao.subAnotacoes);
                if (anotacao.itensCorrelacionados) {
                    anotacao.itensCorrelacionados.forEach(item => {
                        item.subAnotacoes = limparNosLegados(item.subAnotacoes);
                    });
                }
            });

            // Se encontrou dados legados, promove para as propriedades de topo
            if (extraiuAlegacoes.length > 0 && !topico.alegacoes) {
                topico.alegacoes = extraiuAlegacoes.join('\n\n');
            }
            if (extraiuFundamentos.length > 0 && !topico.fundamentos) {
                topico.fundamentos = extraiuFundamentos.join('\n\n');
            }
        });

        // MUDANÇA ARQUITETURAL: Saneamento de Checkpoints de Volume (v7.3 Auto-Healing)
        // Resgata itensCorrelacionados ou subAnotacoes que tenham sido anexados acidentalmente
        // a um objeto checkpoint_entrada/checkpoint_saida devido ao deslocamento de índice nos Volumes II+.
        pacote.dados.forEach(topico => {
            if (!Array.isArray(topico.anotacoes)) return;

            const EhChk = (a) => !!(a && typeof a.tipo === 'string' && a.tipo.startsWith('checkpoint'));
            const orfaosCorrelacionados = [];
            const orfaosSubAnotacoes = [];

            topico.anotacoes.forEach(anotacao => {
                if (EhChk(anotacao)) {
                    if (Array.isArray(anotacao.itensCorrelacionados) && anotacao.itensCorrelacionados.length > 0) {
                        orfaosCorrelacionados.push(...anotacao.itensCorrelacionados.splice(0, anotacao.itensCorrelacionados.length));
                    }
                    if (Array.isArray(anotacao.subAnotacoes) && anotacao.subAnotacoes.length > 0) {
                        orfaosSubAnotacoes.push(...anotacao.subAnotacoes.splice(0, anotacao.subAnotacoes.length));
                    }
                }
            });

            if (orfaosCorrelacionados.length > 0 || orfaosSubAnotacoes.length > 0) {
                let primeiroCardValido = topico.anotacoes.find(a => !EhChk(a));

                // Se o volume ainda não tinha nenhum Card Mestre válido além do checkpoint,
                // promove o primeiro órfão a Card Mestre para hospedar os demais.
                if (!primeiroCardValido && orfaosCorrelacionados.length > 0) {
                    primeiroCardValido = orfaosCorrelacionados.shift();
                    primeiroCardValido.itensCorrelacionados = primeiroCardValido.itensCorrelacionados || [];
                    primeiroCardValido.subAnotacoes = primeiroCardValido.subAnotacoes || [];
                    
                    const idxSaida = topico.anotacoes.findIndex(a => a && a.tipo === 'checkpoint_saida');
                    if (idxSaida !== -1) topico.anotacoes.splice(idxSaida, 0, primeiroCardValido);
                    else topico.anotacoes.push(primeiroCardValido);
                }

                if (primeiroCardValido) {
                    if (orfaosCorrelacionados.length > 0) {
                        if (!Array.isArray(primeiroCardValido.itensCorrelacionados)) {
                            primeiroCardValido.itensCorrelacionados = [];
                        }
                        primeiroCardValido.itensCorrelacionados.push(...orfaosCorrelacionados);
                    }
                    if (orfaosSubAnotacoes.length > 0) {
                        if (!Array.isArray(primeiroCardValido.subAnotacoes)) {
                            primeiroCardValido.subAnotacoes = [];
                        }
                        primeiroCardValido.subAnotacoes.push(...orfaosSubAnotacoes);
                    }
                }
            }
        });

        // MUDANÇA ARQUITETURAL: Higienização de Chaves de Tese/Vício e Teses Fantasmas (v7.4)
        // Normaliza espaços nas pontas de `an.tese`, `diretrizesPorTese` e `diretrizesPorVicio` já no carregamento do JSON,
        // garantindo visibilidade imediata dos nós antes mesmo da primeira mutação.
        pacote.dados.forEach(topico => {
            if (Array.isArray(topico.anotacoes)) {
                topico.anotacoes.forEach(an => {
                    if (an && typeof an.tese === 'string') {
                        const teseLimpa = an.tese.trim();
                        if (teseLimpa === '') delete an.tese;
                        else an.tese = teseLimpa;
                    }
                    if (Array.isArray(an.itensCorrelacionados)) {
                        an.itensCorrelacionados.forEach(corr => {
                            if (corr) {
                                delete corr.tese;
                                delete corr.teseClassificacao;
                            }
                        });
                    }
                });
            }
            if (topico.diretrizesPorTese && typeof topico.diretrizesPorTese === 'object') {
                const mapaLimpo = {};
                for (const [k, nos] of Object.entries(topico.diretrizesPorTese)) {
                    if (!Array.isArray(nos) || nos.length === 0) continue;
                    const chaveLimpa = k.trim() || 'Tese Não Nomeada';
                    if (!mapaLimpo[chaveLimpa]) mapaLimpo[chaveLimpa] = [];
                    mapaLimpo[chaveLimpa].push(...nos);
                }
                topico.diretrizesPorTese = mapaLimpo;
            }
            if (topico.diretrizesPorVicio && typeof topico.diretrizesPorVicio === 'object') {
                const mapaVicioLimpo = {};
                const fallbackVicio = (topico.vicio && String(topico.vicio).trim()) || 'omissao';
                for (const [k, nos] of Object.entries(topico.diretrizesPorVicio)) {
                    if (!Array.isArray(nos) || nos.length === 0) continue;
                    const chaveLimpa = k.trim() || fallbackVicio;
                    if (!mapaVicioLimpo[chaveLimpa]) mapaVicioLimpo[chaveLimpa] = [];
                    mapaVicioLimpo[chaveLimpa].push(...nos);
                }
                topico.diretrizesPorVicio = mapaVicioLimpo;
            }
        });

        return pacote;
    }

    /* ── API Pública ─────────────────────────────────── */

    /**
     * Inicia uma nova sessão. Suporta tanto a assinatura explícita por objeto
     * iniciarSessao(nomeArquivo, { hash, buffer, numPaginas, processoCnj, ultimaPaginaHash })
     * quanto a assinatura legada iniciarSessao(nomeArquivo, arrayBuffer).
     */
    async function iniciarSessao(nomeArquivo, opcoesOuBuffer) {
        _processoId = _extrairId(nomeArquivo);

        if (opcoesOuBuffer && typeof opcoesOuBuffer === 'object' && !(opcoesOuBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(opcoesOuBuffer)) {
            const { hash, buffer, numPaginas = null, processoCnj = null, ultimaPaginaHash = null } = opcoesOuBuffer;
            _pdfHash          = hash || (buffer ? await _calcularHash(buffer) : null);
            _pdfNumPaginas    = Number.isInteger(numPaginas) ? numPaginas : null;
            _processoCnj      = processoCnj || null;
            _ultimaPaginaHash = ultimaPaginaHash || null;
        } else {
            _pdfHash          = opcoesOuBuffer ? await _calcularHash(opcoesOuBuffer) : null;
            _pdfNumPaginas    = null;
            _processoCnj      = null;
            _ultimaPaginaHash = null;
        }

        _historicoPdf  = [];
        _pendingUpdate = null;
        _fileHandle    = null;
    }

    async function carregarJson(handle) {
        const arquivo = await handle.getFile();
        const texto   = await arquivo.text();
        const pacote  = _desempacotar(texto);

        _processoId       = pacote.metadata.processoId || null;
        _processoCnj      = pacote.metadata.processoCnj || null;
        _pdfHash          = pacote.metadata.pdfHash || null;
        _pdfNumPaginas    = Number.isInteger(pacote.metadata.pdfNumPaginas) ? pacote.metadata.pdfNumPaginas : null;
        _ultimaPaginaHash = pacote.metadata.ultimaPaginaHash || null;
        _historicoPdf     = Array.isArray(pacote.metadata.historicoPdf) ? pacote.metadata.historicoPdf : [];
        _pendingUpdate    = null;
        _fileHandle       = handle;

        if (window.ShortcutManager) {
            if (pacote.metadata.atalhosPdf) {
                window.ShortcutManager.setState(pacote.metadata.atalhosPdf);
            } else {
                window.ShortcutManager.reset();
            }
        }
        
        if (window.BalancaManager) {
            window.BalancaManager.restoreHtmlState(pacote.metadata.balancaHtml || null);
        }

        if (window.TaskManager) {
            window.TaskManager.setTarefasState(pacote.metadata.tarefas || []);
        }

        return pacote;
    }

    async function compararPdf(arrayBuffer) {
        const hashCalculado = await _calcularHash(arrayBuffer);
        if (!_pdfHash) {
            return { coincide: true, hash: hashCalculado, isLegado: true };
        }
        return {
            coincide: hashCalculado === _pdfHash,
            hash: hashCalculado,
            isLegado: false
        };
    }

    async function validarPdf(arrayBuffer) {
        const { coincide } = await compararPdf(arrayBuffer);
        return coincide;
    }

    function prepararAtualizacaoPdf({ hash, numPaginas = null, processoCnj = null, ultimaPaginaHash = null } = {}) {
        if (!hash) return;
        _pendingUpdate = {
            hash,
            numPaginas: Number.isInteger(numPaginas) ? numPaginas : null,
            processoCnj: processoCnj || null,
            ultimaPaginaHash: ultimaPaginaHash || null
        };
    }

    function confirmarAtualizacaoPdf({ numPaginas = null, processoCnj = null, ultimaPaginaHash = null } = {}) {
        if (!_pendingUpdate || !_pendingUpdate.hash) {
            return false;
        }

        const paginasFinais = Number.isInteger(numPaginas)
            ? numPaginas
            : (_pendingUpdate.numPaginas ?? _pdfNumPaginas);
        const cnjFinal = processoCnj || _pendingUpdate.processoCnj || _processoCnj;
        const ultHashFinal = ultimaPaginaHash || _pendingUpdate.ultimaPaginaHash || _ultimaPaginaHash;

        if (_pdfHash && _pdfHash !== _pendingUpdate.hash) {
            _historicoPdf.push({
                hashAnterior: _pdfHash,
                hashNovo: _pendingUpdate.hash,
                paginasAntes: _pdfNumPaginas,
                paginasDepois: paginasFinais,
                data: Date.now()
            });
        }

        _pdfHash          = _pendingUpdate.hash;
        _pdfNumPaginas    = paginasFinais;
        _processoCnj      = cnjFinal;
        _ultimaPaginaHash = ultHashFinal;
        _pendingUpdate    = null;
        return true;
    }

    function descartarAtualizacaoPdf() {
        _pendingUpdate = null;
    }

    /**
     * Registra ou promove metadados ausentes (ex: quando um backup legado v1.0 sem hash é aberto).
     * Retorna true se algum metadado estrutural novo (como hash antes ausente) foi promovido.
     */
    function registrarMetadadosPdf({ hash = null, numPaginas = null, processoCnj = null, ultimaPaginaHash = null } = {}) {
        let promoveuEstado = false;
        if (!_pdfHash && hash) {
            _pdfHash = hash;
            promoveuEstado = true;
        }
        if (Number.isInteger(numPaginas) && _pdfNumPaginas !== numPaginas) {
            if (!_pdfNumPaginas) promoveuEstado = true;
            _pdfNumPaginas = numPaginas;
        }
        if (processoCnj && !_processoCnj) {
            _processoCnj = processoCnj;
            promoveuEstado = true;
        }
        if (ultimaPaginaHash && _ultimaPaginaHash !== ultimaPaginaHash) {
            if (!_ultimaPaginaHash) promoveuEstado = true;
            _ultimaPaginaHash = ultimaPaginaHash;
        }
        return promoveuEstado;
    }

    async function atualizarHashPdf(arrayBufferOuHash, numPaginas = null, processoCnj = null, ultimaPaginaHash = null) {
        if (!arrayBufferOuHash) return;
        const hash = (typeof arrayBufferOuHash === 'string' && arrayBufferOuHash.length === 64)
            ? arrayBufferOuHash
            : await _calcularHash(arrayBufferOuHash);
        prepararAtualizacaoPdf({ hash, numPaginas, processoCnj, ultimaPaginaHash });
        confirmarAtualizacaoPdf({ numPaginas, processoCnj, ultimaPaginaHash });
    }

    async function salvar(topicos) {
        if (!_fileHandle) {
            console.warn('BackupManager.salvar(): nenhum arquivo de backup ativo.');
            return;
        }
        const writable = await _fileHandle.createWritable();
        await writable.write(_empacotar(topicos));
        await writable.close();
    }

    function encerrar() {
        _processoId       = null;
        _processoCnj      = null;
        _pdfHash          = null;
        _pdfNumPaginas    = null;
        _ultimaPaginaHash = null;
        _historicoPdf     = [];
        _pendingUpdate    = null;
        _fileHandle       = null;
    }

    function getProcessoId()   { return _processoId; }
    function getMetadadosPdf() {
        return {
            processoId:       _processoId,
            processoCnj:      _processoCnj,
            pdfHash:          _pdfHash,
            pdfNumPaginas:    _pdfNumPaginas,
            ultimaPaginaHash: _ultimaPaginaHash,
            historicoPdf:     [..._historicoPdf]
        };
    }
    function isAtivo()             { return _fileHandle !== null; }
    function setFileHandle(handle) { _fileHandle = handle; }

    return {
        iniciarSessao,
        carregarJson,
        compararPdf,
        validarPdf,
        prepararAtualizacaoPdf,
        confirmarAtualizacaoPdf,
        descartarAtualizacaoPdf,
        registrarMetadadosPdf,
        atualizarHashPdf,
        salvar,
        encerrar,
        getProcessoId,
        getMetadadosPdf,
        isAtivo,
        setFileHandle
    };
})();
