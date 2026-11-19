/* ================================================
   js/ai_thesis-guard.js
   Guardião Transacional de Nós de Ideias de Óbice/Tese (Módulo AI)
   ================================================ */
window.ThesisGuard = (function () {
    'use strict';

    const CHAVE_SEM_TESE = 'Óbice Não Nomeado';
    let _filaOrfaos = [];
    let _itemAtual = null;
    let _loteMultiploAtivo = false;
    let _salvamentoAdiado = false;

    function _beforeUnloadHandler(e) {
        if (temDecisaoPendente()) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    }

    function _atualizarListenerBeforeUnload() {
        if (temDecisaoPendente()) {
            window.addEventListener('beforeunload', _beforeUnloadHandler);
        } else {
            window.removeEventListener('beforeunload', _beforeUnloadHandler);
        }
    }

    /**
     * Consulta usada pela Trava Central em `salvarBackupAutomatico()` (ai_app-core.js)
     * para impedir gravação em disco enquanto o modal de decisão estiver aberto.
     */
    function temDecisaoPendente() {
        return Boolean(_itemAtual !== null || _filaOrfaos.length > 0);
    }

    function registrarSalvamentoAdiado() {
        _salvamentoAdiado = true;
    }

    /**
     * Função canônica única para resolver a chave de óbice/tese de qualquer Cartão Mestre no AI.
     */
    function obterChaveTese(anotacao) {
        if (!anotacao || typeof anotacao.tese !== 'string') return CHAVE_SEM_TESE;
        const limpa = anotacao.tese.trim();
        return limpa !== '' ? limpa : CHAVE_SEM_TESE;
    }

    /**
     * Remove propriedades exclusivas de Cartão Mestre quando um cartão
     * vira correlacionado ou quando um correlacionado vira Nova Ideia.
     */
    function limparTeseFantasmaDeCard(card) {
        if (!card) return;
        delete card.tese;
        delete card.teseClassificacao;
    }

    /**
     * Clona um card mantendo referência O(1) para a string imutável `conteudo` (Base64/texto).
     */
    function _clonarCardLeve(card) {
        if (!card) return card;
        return {
            ...card,
            subAnotacoes: Array.isArray(card.subAnotacoes)
                ? card.subAnotacoes.map(s => ({ ...s }))
                : [],
            itensCorrelacionados: Array.isArray(card.itensCorrelacionados)
                ? card.itensCorrelacionados.map(c => ({
                    ...c,
                    subAnotacoes: Array.isArray(c.subAnotacoes)
                        ? c.subAnotacoes.map(s => ({ ...s }))
                        : []
                }))
                : []
        };
    }

    function _clonarTopicoLeveParaSnapshot(topico) {
        if (!topico) return null;
        const diretrizesObiceClone = {};
        const mapaOrigem = topico.diretrizesPorObice || topico.diretrizesPorTese;
        if (mapaOrigem && typeof mapaOrigem === 'object') {
            for (const [k, arr] of Object.entries(mapaOrigem)) {
                if (Array.isArray(arr)) {
                    diretrizesObiceClone[k] = arr.map(n => ({ ...n }));
                }
            }
        }
        return {
            ...topico,
            anotacoes: Array.isArray(topico.anotacoes)
                ? topico.anotacoes.map(_clonarCardLeve)
                : [],
            diretrizesGlobais: Array.isArray(topico.diretrizesGlobais)
                ? topico.diretrizesGlobais.map(n => ({ ...n }))
                : [],
            diretrizesPorObice: diretrizesObiceClone
        };
    }

    /**
     * Mescla arrays de Nós de Ideias protegendo contra colisão de `grupoId` (Pilhas).
     */
    function mesclarNosComSeguranca(arrayDestino, arrayNovos, forcarNovosUuids = false) {
        if (!Array.isArray(arrayDestino)) return Array.isArray(arrayNovos) ? [...arrayNovos] : [];
        if (!Array.isArray(arrayNovos) || arrayNovos.length === 0) return arrayDestino;

        const gruposExistentes = new Set(
            arrayDestino.map(n => n && n.grupoId).filter(Boolean)
        );
        const mapaReatribuicao = new Map();

        arrayNovos.forEach(no => {
            if (!no) return;
            const cloneNo = { ...no };
            if (forcarNovosUuids || !cloneNo.uuid) {
                cloneNo.uuid = 'id-' + crypto.randomUUID();
            }
            if (cloneNo.grupoId) {
                if (forcarNovosUuids || gruposExistentes.has(cloneNo.grupoId)) {
                    if (!mapaReatribuicao.has(cloneNo.grupoId)) {
                        mapaReatribuicao.set(cloneNo.grupoId, 'grp-' + crypto.randomUUID());
                    }
                    cloneNo.grupoId = mapaReatribuicao.get(cloneNo.grupoId);
                }
            }
            arrayDestino.push(cloneNo);
        });

        return arrayDestino;
    }

    /**
     * Higieniza espaços nas extremidades tanto em `an.tese` quanto nas chaves de `diretrizesPorObice`.
     */
    function normalizarChavesDiretrizes(topico) {
        if (!topico) return;

        if (Array.isArray(topico.anotacoes)) {
            topico.anotacoes.forEach(an => {
                if (an && typeof an.tese === 'string') {
                    const limpa = an.tese.trim();
                    if (limpa === '') delete an.tese;
                    else an.tese = limpa;
                }
            });
        }

        if (!topico.diretrizesPorObice && topico.diretrizesPorTese && typeof topico.diretrizesPorTese === 'object') {
            topico.diretrizesPorObice = topico.diretrizesPorTese;
            delete topico.diretrizesPorTese;
        }

        if (!topico.diretrizesPorObice || typeof topico.diretrizesPorObice !== 'object') return;

        const novoMapa = {};
        for (const [chaveBruta, nos] of Object.entries(topico.diretrizesPorObice)) {
            if (!Array.isArray(nos) || nos.length === 0) continue;
            const chaveLimpa = chaveBruta.trim() || CHAVE_SEM_TESE;
            if (!novoMapa[chaveLimpa]) novoMapa[chaveLimpa] = [];
            mesclarNosComSeguranca(novoMapa[chaveLimpa], nos);
        }
        topico.diretrizesPorObice = novoMapa;
    }

    /**
     * Mapeia todas as chaves de óbice/tese atualmente ancoradas em `topico.anotacoes` (100% pura).
     */
    function mapearTesesAncoradas(topico) {
        const mapa = new Map();
        if (!topico || !Array.isArray(topico.anotacoes)) return mapa;

        topico.anotacoes.forEach((an, idx) => {
            if (!an || (an.tipo && an.tipo.startsWith('checkpoint'))) return;
            const chave = obterChaveTese(an);
            if (!mapa.has(chave)) {
                mapa.set(chave, {
                    count: 0,
                    teseClassificacao: an.teseClassificacao || 'neutro',
                    primeiroIndice: idx
                });
            }
            const info = mapa.get(chave);
            info.count++;
            if ((!info.teseClassificacao || info.teseClassificacao === 'neutro') && an.teseClassificacao) {
                info.teseClassificacao = an.teseClassificacao;
            }
        });

        return mapa;
    }

    /**
     * PASSO 1 DA TRANSAÇÃO (100% PURO):
     */
    function capturarEstadoAntes(topico) {
        if (!topico) return null;
        return {
            topicoId: topico.id,
            ancorasAntes: mapearTesesAncoradas(topico),
            snapshotRollback: _clonarTopicoLeveParaSnapshot(topico)
        };
    }

    /**
     * PASSO 2 DA TRANSAÇÃO:
     * Verifica se alguma chave de `topico.diretrizesPorObice` perdeu todas as âncoras.
     */
    function verificarAposMutacao(topico, contextoAntes) {
        if (!topico) return false;
        normalizarChavesDiretrizes(topico);
        if (!topico.diretrizesPorObice) return false;

        const ancorasDepois = mapearTesesAncoradas(topico);
        const novosOrfaosDestaMutacao = [];

        for (const [chaveTese, listaNos] of Object.entries(topico.diretrizesPorObice)) {
            if (!Array.isArray(listaNos) || listaNos.length === 0) continue;

            if (!ancorasDepois.has(chaveTese)) {
                const metaAnterior = contextoAntes && contextoAntes.ancorasAntes
                    ? contextoAntes.ancorasAntes.get(chaveTese)
                    : null;

                const jaNaFila = _filaOrfaos.some(
                    i => i.topicoId === topico.id && i.nomeTese === chaveTese
                );

                if (!jaNaFila && (!_itemAtual || _itemAtual.nomeTese !== chaveTese)) {
                    novosOrfaosDestaMutacao.push({
                        modo: 'orfao',
                        topicoId: topico.id,
                        nomeTese: chaveTese,
                        chaveNovaHomonima: null,
                        teseClassificacao: metaAnterior ? metaAnterior.teseClassificacao : 'neutro',
                        nos: listaNos.map(n => ({ ...n })),
                        snapshotRollback: contextoAntes ? contextoAntes.snapshotRollback : null
                    });
                }
            }
        }

        if (novosOrfaosDestaMutacao.length > 0) {
            _filaOrfaos.push(...novosOrfaosDestaMutacao);
            _loteMultiploAtivo = (_filaOrfaos.length + (_itemAtual ? 1 : 0)) > 1;
            _atualizarListenerBeforeUnload();
            if (!_itemAtual) {
                _processarProximoDaFila();
            }
            return true;
        }

        return false;
    }

    /**
     * Caso especial de `salvarTese`: quando o usuário renomeia um bloco de óbice/tese (de `chaveAntiga`
     * para `chaveNova`), mas existe outro grupo não contíguo que ainda usa `chaveAntiga`.
     */
    function perguntarDestinoRenomeacaoHomonima(topico, chaveAntiga, chaveNova, contextoAntes) {
        if (!topico || !topico.diretrizesPorObice || !Array.isArray(topico.diretrizesPorObice[chaveAntiga])) return false;
        const listaNos = topico.diretrizesPorObice[chaveAntiga];
        if (listaNos.length === 0) return false;

        _filaOrfaos.push({
            modo: 'divisao_homonima',
            topicoId: topico.id,
            nomeTese: chaveAntiga,
            chaveNovaHomonima: chaveNova,
            teseClassificacao: 'neutro',
            nos: listaNos.map(n => ({ ...n })),
            snapshotRollback: contextoAntes ? contextoAntes.snapshotRollback : null
        });

        _atualizarListenerBeforeUnload();
        if (!_itemAtual) {
            _processarProximoDaFila();
        }
        return true;
    }

    function inspecionarSessaoRestaurada(listaTopicos) {
        if (!Array.isArray(listaTopicos)) return;
        listaTopicos.forEach(topico => {
            verificarAposMutacao(topico, null);
        });
    }

    function _processarProximoDaFila() {
        if (_filaOrfaos.length === 0) {
            _itemAtual = null;
            _loteMultiploAtivo = false;
            _atualizarListenerBeforeUnload();
            if (_salvamentoAdiado && typeof salvarBackupAutomatico === 'function') {
                _salvamentoAdiado = false;
                salvarBackupAutomatico();
            }
            return;
        }

        _itemAtual = _filaOrfaos.shift();
        _atualizarListenerBeforeUnload();

        const topico = typeof topicos !== 'undefined'
            ? topicos.find(t => t.id === _itemAtual.topicoId)
            : null;

        if (!topico) {
            _itemAtual = null;
            _processarProximoDaFila();
            return;
        }

        _abrirModalDOM(topico, _itemAtual);
    }

    function _escapar(str) {
        if (window.TopicsManager && typeof TopicsManager.escaparHTML === 'function') {
            return TopicsManager.escaparHTML(str || '');
        }
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _abrirModalDOM(topico, itemOrfao) {
        const backdrop = document.getElementById('redirecionar-nos-tese-backdrop');
        const modal = document.getElementById('modal-redirecionar-nos-tese');
        if (!backdrop || !modal) return;

        const isDivisaoHomonima = itemOrfao.modo === 'divisao_homonima';
        const descEl = document.getElementById('descricao-modal-redirecionar-tese');
        if (descEl) {
            if (isDivisaoHomonima) {
                descEl.innerHTML = `Você renomeou este grupo para <strong style="color:#6a1b9a;">"${_escapar(itemOrfao.chaveNovaHomonima)}"</strong>, mas outro grupo separado no tópico ainda utiliza o óbice/tese <strong style="color:#6a1b9a;">"${_escapar(itemOrfao.nomeTese)}"</strong>. Como deseja direcionar os Nós de Ideias abaixo?`;
            } else {
                descEl.innerHTML = `O grupo de ideias que sustentava o Cartão de Óbice/Tese <strong id="nome-tese-orfa-display" style="color: #6a1b9a;">"${_escapar(itemOrfao.nomeTese)}"</strong> deixou de existir. Escolha para qual Grupo de Ideias (já com a numeração atualizada) deseja enviar estes Nós de Ideias:`;
            }
        }

        document.getElementById('badge-qtd-nos-orfaos').textContent = `${itemOrfao.nos.length} nó(s)`;

        const btnDesfazer = document.getElementById('btn-desfazer-mutacao-tese');
        if (btnDesfazer) {
            btnDesfazer.style.display = itemOrfao.snapshotRollback ? 'inline-flex' : 'none';
        }

        const btnExcluir = document.getElementById('btn-excluir-nos-orfaos');
        if (btnExcluir) {
            btnExcluir.style.display = isDivisaoHomonima ? 'none' : 'inline-flex';
        }

        const avisoMultiplos = document.getElementById('aviso-multiplos-orfaos-rollback');
        if (avisoMultiplos) {
            avisoMultiplos.style.display = (_loteMultiploAtivo && itemOrfao.snapshotRollback) ? 'block' : 'none';
        }

        const inputTituloHerdar = document.getElementById('input-novo-titulo-tese-herdar');
        if (inputTituloHerdar) {
            inputTituloHerdar.value = itemOrfao.nomeTese !== CHAVE_SEM_TESE ? itemOrfao.nomeTese : '';
        }

        const previewBox = document.getElementById('lista-preview-nos-orfaos');
        previewBox.innerHTML = itemOrfao.nos.map(no => {
            const intencao = (no.intencao || 'premissa').toUpperCase();
            return `
                <div class="orphan-node-item">
                    <span class="orphan-node-intent-tag">${_escapar(intencao)}</span>
                    <span style="flex: 1;">${_escapar(no.texto)}</span>
                </div>
            `;
        }).join('');

        const select = document.getElementById('select-destino-nos-tese');
        select.innerHTML = '';

        if (isDivisaoHomonima) {
            const optMover = document.createElement('option');
            optMover.value = 'homonima:mover';
            optMover.dataset.temTese = 'true';
            optMover.textContent = `➡️ Mover nós exclusivamente para "${itemOrfao.chaveNovaHomonima}"`;
            select.appendChild(optMover);

            const optCopiar = document.createElement('option');
            optCopiar.value = 'homonima:copiar';
            optCopiar.dataset.temTese = 'true';
            optCopiar.textContent = `📑 Copiar nós para "${itemOrfao.chaveNovaHomonima}" (mantendo também em "${itemOrfao.nomeTese}")`;
            select.appendChild(optCopiar);

            const optManter = document.createElement('option');
            optManter.value = 'homonima:manter';
            optManter.dataset.temTese = 'true';
            optManter.textContent = `🔒 Manter nós apenas no óbice/tese original "${itemOrfao.nomeTese}"`;
            select.appendChild(optManter);
        } else {
            let contadorVisual = 0;
            topico.anotacoes.forEach((an) => {
                if (!an || (an.tipo && an.tipo.startsWith('checkpoint'))) return;
                contadorVisual++;
                if (!an.uuid) an.uuid = 'id-' + crypto.randomUUID();

                const temTeseNomeada = Boolean(an.tese && an.tese.trim() !== '');
                const docResumo = an.documento || 'Documento';
                const qtdCardsGrupo = 1 + (Array.isArray(an.itensCorrelacionados) ? an.itensCorrelacionados.length : 0);

                const option = document.createElement('option');
                option.value = `grupo:${an.uuid}`;
                option.dataset.temTese = temTeseNomeada ? 'true' : 'false';

                if (temTeseNomeada) {
                    option.textContent = `Grupo de Ideias #${contadorVisual} — ⚖️ Óbice/Tese: "${an.tese.trim()}" (${qtdCardsGrupo} card(s))`;
                } else {
                    option.textContent = `Grupo de Ideias #${contadorVisual} — ⚠️ [Sem Tese Nomeada] (${docResumo} • ${qtdCardsGrupo} card(s))`;
                }
                select.appendChild(option);
            });

            const optGlobal = document.createElement('option');
            optGlobal.value = 'global';
            optGlobal.dataset.temTese = 'true';
            optGlobal.textContent = '🌐 Converter em Diretrizes Globais do Tópico';
            select.appendChild(optGlobal);
        }

        aoTrocarDestinoUI(select.value);

        backdrop.style.display = 'block';
        requestAnimationFrame(() => backdrop.classList.add('active'));
        modal.style.display = 'flex';
    }

    function aoTrocarDestinoUI(valorSelecionado) {
        const select = document.getElementById('select-destino-nos-tese');
        const boxSemTese = document.getElementById('box-opcoes-grupo-sem-tese');
        if (!select || !boxSemTese) return;

        const opt = select.options[select.selectedIndex];
        const isGrupoSemTese = Boolean(
            opt && opt.dataset.temTese === 'false' && valorSelecionado && valorSelecionado.startsWith('grupo:')
        );
        boxSemTese.style.display = isGrupoSemTese ? 'block' : 'none';
    }

    function confirmarRedirecionamento() {
        if (!_itemAtual) return;
        const topico = topicos.find(t => t.id === _itemAtual.topicoId);
        if (!topico) return _fecharModal();

        const select = document.getElementById('select-destino-nos-tese');
        const destino = select ? select.value : 'global';
        const nosParaMover = _itemAtual.nos || [];
        const teseAntiga = _itemAtual.nomeTese;
        const classificacaoAntiga = _itemAtual.teseClassificacao || 'neutro';

        if (_itemAtual.modo === 'divisao_homonima') {
            const chaveNova = _itemAtual.chaveNovaHomonima;
            if (!topico.diretrizesPorObice) topico.diretrizesPorObice = {};

            if (destino === 'homonima:mover') {
                if (!Array.isArray(topico.diretrizesPorObice[chaveNova])) topico.diretrizesPorObice[chaveNova] = [];
                mesclarNosComSeguranca(topico.diretrizesPorObice[chaveNova], nosParaMover);
                delete topico.diretrizesPorObice[teseAntiga];
                exibirToast(`Nós movidos exclusivamente para "${chaveNova}"!`, 'sucesso');
            } else if (destino === 'homonima:copiar') {
                if (!Array.isArray(topico.diretrizesPorObice[chaveNova])) topico.diretrizesPorObice[chaveNova] = [];
                mesclarNosComSeguranca(topico.diretrizesPorObice[chaveNova], nosParaMover, true);
                exibirToast(`Nós copiados para "${chaveNova}" e mantidos em "${teseAntiga}"!`, 'sucesso');
            } else {
                exibirToast(`Nós mantidos apenas em "${teseAntiga}".`, 'info');
            }
        } else {
            if (topico.diretrizesPorObice && topico.diretrizesPorObice[teseAntiga]) {
                delete topico.diretrizesPorObice[teseAntiga];
            }

            if (destino === 'global') {
                if (!Array.isArray(topico.diretrizesGlobais)) topico.diretrizesGlobais = [];
                mesclarNosComSeguranca(topico.diretrizesGlobais, nosParaMover);
                exibirToast(`${nosParaMover.length} nó(s) transferido(s) para Diretrizes Globais!`, 'sucesso');
            } else if (destino.startsWith('grupo:')) {
                const uuidAlvo = destino.slice('grupo:'.length);
                const cardAlvo = topico.anotacoes.find(a => a && a.uuid === uuidAlvo);

                if (cardAlvo) {
                    if (!topico.diretrizesPorObice) topico.diretrizesPorObice = {};
                    const jaTemTeseNomeada = Boolean(cardAlvo.tese && cardAlvo.tese.trim() !== '');

                    if (jaTemTeseNomeada) {
                        const chaveDestino = obterChaveTese(cardAlvo);
                        if (!Array.isArray(topico.diretrizesPorObice[chaveDestino])) {
                            topico.diretrizesPorObice[chaveDestino] = [];
                        }
                        mesclarNosComSeguranca(topico.diretrizesPorObice[chaveDestino], nosParaMover);
                        exibirToast(`Nós mesclados ao Óbice/Tese "${chaveDestino}"!`, 'sucesso');
                    } else {
                        const inputNovoTitulo = document.getElementById('input-novo-titulo-tese-herdar');
                        const tituloEscolhido = inputNovoTitulo ? inputNovoTitulo.value.trim() : '';

                        if (tituloEscolhido !== '') {
                            cardAlvo.tese = tituloEscolhido;
                            if (!cardAlvo.teseClassificacao || cardAlvo.teseClassificacao === 'neutro') {
                                cardAlvo.teseClassificacao = classificacaoAntiga;
                            }
                        }

                        const chaveFinal = obterChaveTese(cardAlvo);
                        if (!Array.isArray(topico.diretrizesPorObice[chaveFinal])) {
                            topico.diretrizesPorObice[chaveFinal] = [];
                        }
                        mesclarNosComSeguranca(topico.diretrizesPorObice[chaveFinal], nosParaMover);
                        exibirToast(`Óbice/Tese "${chaveFinal}" e seus nós vinculados ao grupo escolhido!`, 'sucesso');
                    }
                }
            }
        }

        _salvamentoAdiado = true;
        _fecharModal();
        if (typeof renderizarTopicos === 'function') renderizarTopicos();
    }

    function descartarNosOrfaos() {
        if (!_itemAtual) return;
        if (!confirm(`Tem certeza que deseja excluir permanentemente os ${_itemAtual.nos.length} nó(s) de "${_itemAtual.nomeTese}"?`)) {
            return;
        }

        const topico = topicos.find(t => t.id === _itemAtual.topicoId);
        if (topico && topico.diretrizesPorObice) {
            delete topico.diretrizesPorObice[_itemAtual.nomeTese];
        }

        exibirToast('Nós de ideia da tese/óbice extinto foram excluídos.', 'info');
        _salvamentoAdiado = true;
        _fecharModal();
        if (typeof renderizarTopicos === 'function') renderizarTopicos();
    }

    function desfazerOperacao() {
        if (!_itemAtual) return;
        if (!_itemAtual.snapshotRollback) {
            _fecharModal();
            return;
        }

        const idxTopico = topicos.findIndex(t => t.id === _itemAtual.topicoId);
        if (idxTopico !== -1) {
            topicos[idxTopico] = _clonarTopicoLeveParaSnapshot(_itemAtual.snapshotRollback);
        }

        _filaOrfaos = _filaOrfaos.filter(i => i.topicoId !== _itemAtual.topicoId);
        _loteMultiploAtivo = false;
        _salvamentoAdiado = true;

        _fecharModal();
        if (typeof renderizarTopicos === 'function') renderizarTopicos();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        exibirToast('Alteração desfeita. O grupo de ideias e o Cartão de Óbice/Tese foram restaurados.', 'info');
    }

    function _fecharModal() {
        const backdrop = document.getElementById('redirecionar-nos-tese-backdrop');
        const modal = document.getElementById('modal-redirecionar-nos-tese');
        if (backdrop) {
            backdrop.classList.remove('active');
            setTimeout(() => { backdrop.style.display = 'none'; }, 250);
        }
        if (modal) modal.style.display = 'none';

        _itemAtual = null;
        if (_filaOrfaos.length > 0) {
            setTimeout(_processarProximoDaFila, 280);
        } else {
            _loteMultiploAtivo = false;
            _atualizarListenerBeforeUnload();
            if (_salvamentoAdiado && typeof salvarBackupAutomatico === 'function') {
                _salvamentoAdiado = false;
                salvarBackupAutomatico();
            }
        }
    }

    function validarInvariantes(topico) {
        const t = topico || (typeof topicos !== 'undefined' && window.TopicsManager ? topicos.find(x => x.id === TopicsManager.getActiveTabId()) : null);
        if (!t) return { ok: true, alertas: [] };

        const alertas = [];
        const ancoras = mapearTesesAncoradas(t);

        for (const [k, nos] of Object.entries(t.diretrizesPorObice || {})) {
            if (Array.isArray(nos) && nos.length > 0 && !ancoras.has(k)) {
                alertas.push(`Chave órfã em diretrizesPorObice: "${k}" (${nos.length} nós)`);
            }
        }

        (t.anotacoes || []).forEach((an, idx) => {
            (an.itensCorrelacionados || []).forEach((corr, cIdx) => {
                if (corr.tese || corr.teseClassificacao) {
                    alertas.push(`Tese fantasma no correlacionado [${idx}.${cIdx}]: "${corr.tese}"`);
                }
            });
        });

        return { ok: alertas.length === 0, alertas };
    }

    return {
        CHAVE_SEM_TESE,
        temDecisaoPendente,
        registrarSalvamentoAdiado,
        obterChaveTese,
        limparTeseFantasmaDeCard,
        mesclarNosComSeguranca,
        normalizarChavesDiretrizes,
        mapearTesesAncoradas,
        capturarEstadoAntes,
        verificarAposMutacao,
        perguntarDestinoRenomeacaoHomonima,
        inspecionarSessaoRestaurada,
        aoTrocarDestinoUI,
        confirmarRedirecionamento,
        descartarNosOrfaos,
        desfazerOperacao,
        validarInvariantes
    };
})();