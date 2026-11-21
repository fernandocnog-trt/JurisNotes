/* ================================================
   contrato-manager.js — v2.2
   Gerenciador de Parâmetros Contratuais Globais +
   Confrontação Inteligente de Controvérsia (Apoio)

   SEPARAÇÃO ESTRITA DE RESPONSABILIDADES:
   - _dados.periodos[0] (getDados/setDados):
     ÚNICO estado consumido pelo export-manager.js (IA).
   - _confronto (getConfronto/setConfronto):
     Estado de conferência salvo em metadata.contratoConfronto.
     Jamais vaza para a exportação externa.
   - Preferência da chave "Confrontar":
     Persistida em localStorage (escopo de UI do usuário).
   ================================================ */
window.ContratoManager = (function () {
    'use strict';

    const STORAGE_KEY_UI = 'juris_contrato_confronto_ui';
    const DEBOUNCE_BACKUP_MS = 450;

    // Configuração declarativa dos campos confrontáveis
    const CAMPOS_CONFRONTO = Object.freeze([
        { chave: 'inicio', rotulo: 'Data de Admissão', tipo: 'date' },
        { chave: 'fim',    rotulo: 'Data de Demissão', tipo: 'date' },
        { chave: 'funcao', rotulo: 'Função(ões)',      tipo: 'text' }
    ]);

    // Estado oficial do vínculo (ÚNICO estado lido pelo export-manager.js)
    let _dados = {
        periodos: [
            { inicio: '', fim: '', ajuizamento: '', funcao: '' }
        ]
    };

    // Estado versionado da ferramenta de apoio (Confrontação)
    let _confronto = _criarEstadoConfrontoVazio();
    let _etapaAtual = 0; // 0: Parâmetros | 1: Autora | 2: Ré | 3: Diagnóstico
    let _confrontoSujo = false;
    let _debounceTimer = null;
    let _limparConfirmTimer = null;
    let _delegacaoDiagnosticoVinculada = false;

    function _criarEstadoConfrontoVazio() {
        return {
            v: 1,
            defesa: 'contesta', // 'contesta' | 'nega_vinculo' | 'revelia'
            autora:       { inicio: '', fim: '', funcao: '' },
            re:           { inicio: '', fim: '', funcao: '' },
            posturaRe:    { inicio: '', fim: '', funcao: '' }, // '' | 'confirma' | 'diverge' | 'silente'
            ajusteManual: { inicio: null, fim: null, funcao: null } // null | 'incontroverso' | 'controvertido'
        };
    }

    /* ── Utilitários Privados ────────────────────────── */

    function _periodoAtivo() {
        if (!_dados.periodos || _dados.periodos.length === 0) {
            _dados.periodos = [{ inicio: '', fim: '', ajuizamento: '', funcao: '' }];
        }
        return _dados.periodos[0];
    }

    function _isModoConfrontoHabilitadoUI() {
        try {
            return localStorage.getItem(STORAGE_KEY_UI) === 'true';
        } catch {
            return false;
        }
    }

    function _salvarModoConfrontoUI(ativo) {
        try {
            localStorage.setItem(STORAGE_KEY_UI, ativo ? 'true' : 'false');
        } catch { /* fallback silencioso */ }
    }

    function _escaparSeguro(str) {
        if (!str) return '';
        if (window.TopicsManager && typeof window.TopicsManager.escaparHTML === 'function') {
            return window.TopicsManager.escaparHTML(str);
        }
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _formatarDataBR(dataISO) {
        if (!dataISO) return null;
        const partes = dataISO.split('-');
        if (partes.length !== 3) return dataISO;
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }

    function _normalizarTexto(str) {
        return String(str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .toLowerCase();
    }

    /**
     * Analisa listas de funções associando cada observação entre parênteses
     * ao seu cargo específico:
     * - Não quebra vírgulas dentro de parênteses (ex: "Encarregado (manutenção, limpeza)").
     * - Preserva a conjunção " e " em cargos da CBO (ex: "Auxiliar de Carga e Descarga").
     * - Distingue "A (2019); B" de "A; B (2019)" via mapa cargo -> conjunto de anotações.
     */
    function _analisarFuncoesTexto(str) {
        const bruto = String(str || '');
        const tokensParenteses = [];
        const marcado = bruto.replace(/\(([^)]*)\)/g, (_, conteudo) => {
            const idx = tokensParenteses.length;
            tokensParenteses.push(_normalizarTexto(conteudo));
            return ` __JP${idx}__ `;
        });

        const segmentos = marcado.split(/[;\n\/|,]+/);
        const cargosMap = new Map();
        let possuiAlgumaAnotacao = false;

        segmentos.forEach(seg => {
            const notasDoSegmento = [];
            const semMarcador = seg.replace(/__JP(\d+)__/g, (_, i) => {
                const nota = tokensParenteses[Number(i)];
                if (nota) notasDoSegmento.push(nota);
                return ' ';
            });

            let cargoBase = _normalizarTexto(semMarcador);
            // Fallback: se o segmento inteiro estava dentro de parênteses, trata-o como cargo-base
            if (!cargoBase && notasDoSegmento.length > 0) {
                cargoBase = notasDoSegmento.join(' ');
                notasDoSegmento.length = 0;
            }
            if (!cargoBase) return;

            if (!cargosMap.has(cargoBase)) cargosMap.set(cargoBase, new Set());
            const setNotas = cargosMap.get(cargoBase);
            notasDoSegmento.forEach(n => {
                setNotas.add(n);
                possuiAlgumaAnotacao = true;
            });
        });

        return {
            cargosBase: new Set(cargosMap.keys()),
            cargosMap,
            possuiAlgumaAnotacao
        };
    }

    function _conjuntosIguais(setA, setB) {
        return setA.size === setB.size && [...setA].every(x => setB.has(x));
    }

    function _anotacoesPorCargoIguais(fA, fR) {
        for (const cargo of fA.cargosBase) {
            const notasA = fA.cargosMap.get(cargo) || new Set();
            const notasR = fR.cargosMap.get(cargo) || new Set();
            if (!_conjuntosIguais(notasA, notasR)) return false;
        }
        return true;
    }

    function _valoresEfetivamenteEquivalentes(campoConfig, valA, valR) {
        if (!valA || !valR) return false;
        if (campoConfig.tipo === 'date') return valA === valR;
        const fA = _analisarFuncoesTexto(valA);
        const fR = _analisarFuncoesTexto(valR);
        return fA.cargosBase.size > 0 &&
            _conjuntosIguais(fA.cargosBase, fR.cargosBase) &&
            _anotacoesPorCargoIguais(fA, fR);
    }

    /**
     * Aritmética civil exata entre duas datas ISO.
     */
    function _calcularDiferencaCalendario(isoA, isoB) {
        const dA = new Date(isoA + 'T00:00:00');
        const dB = new Date(isoB + 'T00:00:00');
        if (isNaN(dA) || isNaN(dB)) return null;

        const [menor, maior] = dA <= dB ? [dA, dB] : [dB, dA];
        const totalDias = Math.round((maior - menor) / (1000 * 60 * 60 * 24));

        let anos = maior.getFullYear() - menor.getFullYear();
        let meses = maior.getMonth() - menor.getMonth();
        let dias = maior.getDate() - menor.getDate();

        if (dias < 0) {
            meses--;
            const ultimoDiaMesAnterior = new Date(maior.getFullYear(), maior.getMonth(), 0).getDate();
            dias += ultimoDiaMesAnterior;
        }
        if (meses < 0) {
            anos--;
            meses += 12;
        }

        const partes = [];
        if (anos > 0) partes.push(`${anos} ano${anos > 1 ? 's' : ''}`);
        if (meses > 0) partes.push(`${meses} ${meses > 1 ? 'meses' : 'mês'}`);
        if (dias > 0 || partes.length === 0) partes.push(`${dias} dia${dias !== 1 ? 's' : ''}`);

        return { anos, meses, dias, totalDias, texto: partes.join(', ') };
    }

    function _avaliarRiscoBienal() {
        const p = _periodoAtivo();
        if (!p.fim || !p.ajuizamento) return null;
        const dataFim = new Date(p.fim + 'T00:00:00');
        const dataAjuizamento = new Date(p.ajuizamento + 'T00:00:00');
        const doisAnosDepois = new Date(dataFim);
        doisAnosDepois.setFullYear(doisAnosDepois.getFullYear() + 2);
        return dataAjuizamento > doisAnosDepois;
    }

    function _confrontoPossuiDados() {
        if (_confronto.defesa !== 'contesta') return true;
        return CAMPOS_CONFRONTO.some(({ chave }) =>
            Boolean(_confronto.autora[chave] || _confronto.re[chave] || _confronto.posturaRe[chave] || _confronto.ajusteManual[chave])
        );
    }

    /* ── Persistência Segura (Debounce + Flush Único) ── */

    function _cancelarPersistenciaPendente() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
    }

    function _marcarConfrontoSujo() {
        _confrontoSujo = true;
        _cancelarPersistenciaPendente();
        _debounceTimer = setTimeout(() => {
            _debounceTimer = null;
            if (_confrontoSujo && typeof salvarBackupAutomatico === 'function') {
                _confrontoSujo = false;
                salvarBackupAutomatico();
            }
        }, DEBOUNCE_BACKUP_MS);
    }

    function _flushPersistenciaConfronto() {
        _cancelarPersistenciaPendente();
        if (_confrontoSujo && typeof salvarBackupAutomatico === 'function') {
            _confrontoSujo = false;
            salvarBackupAutomatico();
        }
    }

    function _resetarBotaoLimpar() {
        if (_limparConfirmTimer) {
            clearTimeout(_limparConfirmTimer);
            _limparConfirmTimer = null;
        }
        const btn = document.getElementById('btn-confronto-limpar');
        if (btn) {
            btn.dataset.confirming = 'false';
            btn.textContent = 'Limpar confronto';
            btn.classList.remove('is-confirming');
        }
    }

    /* ── Motor de Diagnóstico Jurídico Determinístico ── */

    function _analisarCampo(campoConfig) {
        const { chave, tipo } = campoConfig;
        const valAutora = (_confronto.autora[chave] || '').trim();
        const valRe = (_confronto.re[chave] || '').trim();
        const postura = _confronto.posturaRe[chave] || '';
        const defesa = _confronto.defesa || 'contesta';
        const ajuste = _confronto.ajusteManual[chave];

        let resultado = null;

        // 1. Base fática ausente na inicial
        if (!valAutora) {
            resultado = {
                status: 'pendente',
                tag: 'Pendente (Inicial)',
                detalhe: valRe
                    ? 'Apenas a Parte Ré informou este campo. Registre a alegação da inicial na Etapa 1 para concluir o confronto.'
                    : 'Falta informar a alegação da petição inicial na Etapa 1.',
                alertaAvisoPrevio: false,
                valorIncontroverso: null
            };
        }
        // 2. Revelia (Art. 844 da CLT)
        else if (defesa === 'revelia') {
            resultado = {
                status: 'presuncao',
                tag: 'Presunção (Revelia)',
                detalhe: 'Revelia da reclamada (art. 844 da CLT). Presunção relativa de veracidade dos fatos da inicial, a ser sopesada com a prova pré-constituída nos autos.',
                alertaAvisoPrevio: false,
                valorIncontroverso: null
            };
        }
        // 3. Negativa de vínculo empregatício (Art. 341, III, do CPC)
        else if (defesa === 'nega_vinculo') {
            resultado = {
                status: 'controvertido',
                tag: 'Controvertido (Nega Vínculo)',
                detalhe: 'A defesa nega a relação de emprego (art. 341, III, do CPC), tornando o marco contratual controvertido — salvo se a defesa admitir a prestação de serviços no mesmo período (ajuste manualmente abaixo se for o caso).',
                alertaAvisoPrevio: false,
                valorIncontroverso: null
            };
        }
        // 4. Contestação comum — postura explícita da Ré
        else if (postura === 'silente') {
            resultado = {
                status: 'presuncao',
                tag: 'Não Impugnado',
                detalhe: 'Ausência de impugnação específica (art. 341 do CPC). Presunção relativa de veracidade — conferir exceções legais e conjunto probatório.',
                alertaAvisoPrevio: false,
                valorIncontroverso: null
            };
        }
        else if (postura === 'confirma' && (!valRe || valRe === valAutora)) {
            resultado = {
                status: 'incontroverso',
                tag: 'Incontroverso',
                detalhe: 'Fato admitido pela defesa como incontroverso (art. 374, III, do CPC).',
                alertaAvisoPrevio: false,
                valorIncontroverso: valAutora
            };
        }
        else if (!valRe) {
            resultado = {
                status: 'pendente',
                tag: 'Pendente (Defesa)',
                detalhe: 'Aguardando preenchimento da Contestação na Etapa 2 (informe o dado ou clique em "Confirma" / "Não impugnou").',
                alertaAvisoPrevio: false,
                valorIncontroverso: null
            };
        }
        // 5. Comparação objetiva de Datas
        else if (tipo === 'date') {
            if (valAutora === valRe) {
                resultado = {
                    status: 'incontroverso',
                    tag: 'Incontroverso',
                    detalhe: 'Datas coincidentes entre Inicial e Contestação (art. 374, III, do CPC).',
                    alertaAvisoPrevio: false,
                    valorIncontroverso: valAutora
                };
            } else {
                const diff = _calcularDiferencaCalendario(valAutora, valRe);
                const possivelAvisoPrevio = chave === 'fim' && diff && diff.totalDias >= 28 && diff.totalDias <= 93;
                resultado = {
                    status: 'controvertido',
                    tag: 'Controvertido',
                    detalhe: diff
                        ? `Divergência de ${diff.texto} (${diff.totalDias} dias) entre Inicial e Contestação.`
                        : 'Datas divergentes entre as partes.',
                    alertaAvisoPrevio: possivelAvisoPrevio,
                    valorIncontroverso: null
                };
            }
        }
        // 6. Comparação inteligente de Funções (em duas camadas por cargo)
        else {
            const fA = _analisarFuncoesTexto(valAutora);
            const fR = _analisarFuncoesTexto(valRe);

            if (fA.cargosBase.size === 0 || fR.cargosBase.size === 0) {
                resultado = {
                    status: 'pendente',
                    tag: 'Pendente (Texto Inválido)',
                    detalhe: 'Um dos campos contém apenas pontuação/símbolos. Revise os textos informados.',
                    alertaAvisoPrevio: false,
                    valorIncontroverso: null
                };
            } else if (_conjuntosIguais(fA.cargosBase, fR.cargosBase)) {
                const notasIguais = _anotacoesPorCargoIguais(fA, fR);
                const ambosTemNotas = fA.possuiAlgumaAnotacao && fR.possuiAlgumaAnotacao;

                if (!notasIguais && ambosTemNotas) {
                    resultado = {
                        status: 'controvertido',
                        tag: 'Controvertido (Sugerido)',
                        detalhe: 'Os cargos-base coincidem, mas as observações entre parênteses (ex.: períodos ou atribuições por cargo) divergem. Confirme manualmente abaixo.',
                        alertaAvisoPrevio: false,
                        valorIncontroverso: null
                    };
                } else {
                    const detalheTexto = notasIguais
                        ? 'As funções coincidem integralmente após normalização de acentos e espaçamento.'
                        : 'Cargos-base coincidem (uma das partes inclui observação complementar entre parênteses).';
                    resultado = {
                        status: 'incontroverso',
                        tag: 'Incontroverso (Sugerido)',
                        detalhe: detalheTexto,
                        alertaAvisoPrevio: false,
                        valorIncontroverso: notasIguais ? valAutora : null
                    };
                }
            } else {
                const aContemR = [...fR.cargosBase].every(x => fA.cargosBase.has(x));
                const rContemA = [...fA.cargosBase].every(x => fR.cargosBase.has(x));
                resultado = {
                    status: 'controvertido',
                    tag: 'Controvertido (Sugerido)',
                    detalhe: (aContemR || rContemA)
                        ? 'Uma lista de funções engloba a outra — verificar evolução funcional, desvio ou acúmulo de função.'
                        : 'Descrições distintas entre as partes. Se forem funções sinônimas, ajuste manualmente abaixo.',
                    alertaAvisoPrevio: false,
                    valorIncontroverso: null
                };
            }
        }

        // 7. Precedência absoluta do ajuste manual do assessor
        if (ajuste === 'incontroverso') {
            const haDoisValoresDiferentes = Boolean(valAutora && valRe && !_valoresEfetivamenteEquivalentes(campoConfig, valAutora, valRe));
            resultado = {
                ...resultado,
                status: 'incontroverso',
                tag: 'Incontroverso (Manual)',
                ajustadoManualmente: true,
                valorIncontroverso: haDoisValoresDiferentes ? null : (valAutora || valRe || null)
            };
        } else if (ajuste === 'controvertido') {
            resultado = {
                ...resultado,
                status: 'controvertido',
                tag: 'Controvertido (Manual)',
                ajustadoManualmente: true,
                valorIncontroverso: null
            };
        }

        return resultado;
    }

    /**
     * Conferência cruzada passiva contra a Etapa 0 (somente quando há valor incontroverso unívoco).
     */
    function _detectarDivergenciaComOficial(campoConfig, analise) {
        if (analise.status !== 'incontroverso' || !analise.valorIncontroverso) return null;
        const valorOficial = (_periodoAtivo()[campoConfig.chave] || '').trim();
        if (!valorOficial) return null;

        if (campoConfig.tipo === 'date') {
            if (valorOficial !== analise.valorIncontroverso) {
                return `O Parâmetro Oficial salvo (${_formatarDataBR(valorOficial)}) difere do ponto incontroverso (${_formatarDataBR(analise.valorIncontroverso)}).`;
            }
        } else {
            const fOficial = _analisarFuncoesTexto(valorOficial);
            const fIncontr = _analisarFuncoesTexto(analise.valorIncontroverso);
            if (!_conjuntosIguais(fOficial.cargosBase, fIncontr.cargosBase)) {
                return 'A Função nos Parâmetros Oficiais difere da função marcada como incontroversa.';
            }
        }
        return null;
    }

    /* ── Hidratação e Sincronização de UI ────────────── */

    function _atualizarCtaEIndicadores() {
        const ativoUI = _isModoConfrontoHabilitadoUI();
        const temDados = _confrontoPossuiDados();

        const toggle = document.getElementById('toggle-contrato-confronto');
        const wrapper = document.getElementById('contrato-confronto-cta-wrapper');
        const dotCta = document.getElementById('badge-confronto-status');
        const dotHeader = document.getElementById('badge-confronto-header-dot');

        if (toggle) toggle.checked = ativoUI;
        if (wrapper) wrapper.style.display = ativoUI ? 'block' : 'none';
        if (dotCta) dotCta.style.display = temDados ? 'inline-block' : 'none';
        if (dotHeader) dotHeader.style.display = (!ativoUI && temDados) ? 'inline-block' : 'none';
    }

    function _sincronizarReferenciasAutoraNaEtapa2() {
        CAMPOS_CONFRONTO.forEach(({ chave, tipo }) => {
            const refEl = document.getElementById(`ref-autora-${chave}`);
            if (!refEl) return;
            const val = (_confronto.autora[chave] || '').trim();
            if (!val) {
                refEl.textContent = 'Inicial: não informado';
                refEl.classList.add('is-empty');
            } else {
                const exib = tipo === 'date' ? _formatarDataBR(val) : val;
                refEl.textContent = `Inicial: ${exib}`;
                refEl.classList.remove('is-empty');
            }
        });
    }

    function _sincronizarEtapa2UI() {
        const defesa = _confronto.defesa || 'contesta';
        document.querySelectorAll('input[name="contrato_defesa_global"]').forEach(r => {
            r.checked = (r.value === defesa);
        });

        const avisoEl = document.getElementById('contrato-defesa-global-aviso');
        const camposWrapper = document.getElementById('contrato-re-campos-wrapper');

        if (defesa === 'nega_vinculo') {
            if (camposWrapper) camposWrapper.style.display = 'none';
            if (avisoEl) {
                avisoEl.style.display = 'block';
                avisoEl.textContent = 'Defesa nega a relação de emprego (art. 341, III, do CPC). Os marcos alegados na inicial serão classificados como controvertidos — salvo se a defesa admitir a prestação de serviços no mesmo período (você poderá ajustar manualmente no Diagnóstico).';
            }
        } else if (defesa === 'revelia') {
            if (camposWrapper) camposWrapper.style.display = 'none';
            if (avisoEl) {
                avisoEl.style.display = 'block';
                avisoEl.textContent = 'Reclamada revel (art. 844 da CLT). Os fatos alegados na inicial serão sinalizados sob presunção relativa de veracidade no diagnóstico.';
            }
        } else {
            if (camposWrapper) camposWrapper.style.display = 'flex';
            if (avisoEl) avisoEl.style.display = 'none';
        }

        _sincronizarReferenciasAutoraNaEtapa2();

        CAMPOS_CONFRONTO.forEach(({ chave }) => {
            const input = document.getElementById(`input-confronto-re-${chave}`);
            const postura = _confronto.posturaRe[chave] || '';

            if (input) {
                input.value = _confronto.re[chave] || '';
                input.disabled = (postura === 'silente');
                input.classList.toggle('is-confirmed-input', postura === 'confirma');
            }

            document.querySelectorAll(`.btn-postura[data-field="${chave}"]`).forEach(btn => {
                btn.classList.toggle('is-selected', btn.dataset.postura === postura);
            });
        });
    }

    function _hidratarInputsConfronto() {
        CAMPOS_CONFRONTO.forEach(({ chave }) => {
            const elA = document.getElementById(`input-confronto-autora-${chave}`);
            if (elA) elA.value = _confronto.autora[chave] || '';
        });
        _sincronizarEtapa2UI();
    }

    function _vincularDelegacaoDiagnostico() {
        if (_delegacaoDiagnosticoVinculada) return;
        const lista = document.getElementById('confronto-resultado-lista');
        if (!lista) return;

        lista.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-override-status');
            if (!btn) return;
            const chave = btn.dataset.field;
            const novoAjuste = btn.dataset.ajuste;
            if (!chave) return;

            _confronto.ajusteManual[chave] = (novoAjuste === 'auto') ? null : novoAjuste;
            _marcarConfrontoSujo();
            _renderizarResultadoConfronto();
        });
        _delegacaoDiagnosticoVinculada = true;
    }

    function _renderizarResultadoConfronto() {
        _vincularDelegacaoDiagnostico();
        const listaEl = document.getElementById('confronto-resultado-lista');
        const summaryEl = document.getElementById('confronto-summary-pills');
        const subtitleEl = document.getElementById('confronto-defesa-subtitle');
        if (!listaEl || !summaryEl) return;

        const descDefesa = {
            contesta: 'Defesa contesta os termos do vínculo',
            nega_vinculo: 'Defesa nega a relação de emprego (art. 341, III, CPC)',
            revelia: 'Reclamada revel (art. 844 da CLT)'
        };
        if (subtitleEl) subtitleEl.textContent = descDefesa[_confronto.defesa] || descDefesa.contesta;

        const contadores = { incontroverso: 0, controvertido: 0, presuncao: 0, pendente: 0 };
        const icones = { incontroverso: '✔', controvertido: '⚡', presuncao: '◐', pendente: '—' };

        const cardsHtml = CAMPOS_CONFRONTO.map(campo => {
            const analise = _analisarCampo(campo);
            contadores[analise.status]++;

            const valAutora = (_confronto.autora[campo.chave] || '').trim();
            const valRe = (_confronto.re[campo.chave] || '').trim();
            const postura = _confronto.posturaRe[campo.chave] || '';
            const ajusteAtual = _confronto.ajusteManual[campo.chave];

            const autoraFmt = valAutora ? (campo.tipo === 'date' ? _formatarDataBR(valAutora) : valAutora) : null;
            let reFmt = null;
            if (_confronto.defesa === 'revelia') reFmt = 'Revelia (sem contestação)';
            else if (_confronto.defesa === 'nega_vinculo') reFmt = 'Nega o vínculo';
            else if (postura === 'silente') reFmt = 'Não impugnou especificamente';
            else if (valRe) reFmt = campo.tipo === 'date' ? _formatarDataBR(valRe) : valRe;

            const txtAutora = autoraFmt
                ? `<span class="confronto-val-text">${_escaparSeguro(autoraFmt)}</span>`
                : `<span class="confronto-val-text is-empty">Não informado</span>`;

            const txtRe = reFmt
                ? `<span class="confronto-val-text">${_escaparSeguro(reFmt)}</span>`
                : `<span class="confronto-val-text is-empty">Não informado</span>`;

            const alertaAvisoHtml = analise.alertaAvisoPrevio
                ? `<div class="confronto-aviso-pratico">💡 Diferença compatível com projeção do aviso prévio (30 a 90 dias — OJ 82 da SDI-1/TST). Se for apenas projeção, você pode confirmar como Incontroverso abaixo.</div>`
                : '';

            const alertaOficial = _detectarDivergenciaComOficial(campo, analise);
            const alertaOficialHtml = alertaOficial
                ? `<div class="confronto-aviso-pratico">⚠️ ${_escaparSeguro(alertaOficial)}</div>`
                : '';

            const btnAutoHtml = ajusteAtual
                ? `<button type="button" class="btn-override-status" data-field="${campo.chave}" data-ajuste="auto" title="Voltar para a análise automática">↺ Auto</button>`
                : '';

            return `
                <div class="confronto-card confronto-card--${analise.status}">
                    <div class="confronto-card-top">
                        <span class="confronto-field-name">${_escaparSeguro(campo.rotulo)}</span>
                        <span class="confronto-status-tag confronto-status-tag--${analise.status}">
                            <span aria-hidden="true">${icones[analise.status]}</span> ${_escaparSeguro(analise.tag)}
                        </span>
                    </div>
                    <div class="confronto-grid-values">
                        <div class="confronto-val-box">
                            <span class="confronto-val-label confronto-val-label--autora">Parte Autora</span>
                            ${txtAutora}
                        </div>
                        <div class="confronto-val-box">
                            <span class="confronto-val-label confronto-val-label--re">Parte Ré</span>
                            ${txtRe}
                        </div>
                    </div>
                    <div class="confronto-detail-note">${_escaparSeguro(analise.detalhe)}</div>
                    ${alertaAvisoHtml}
                    ${alertaOficialHtml}
                    <div class="confronto-override-bar">
                        <span class="confronto-override-label">${ajusteAtual ? 'Classificação ajustada manualmente:' : 'Confirmar / ajustar classificação:'}</span>
                        <div class="confronto-override-btns">
                            <button type="button" class="btn-override-status ${ajusteAtual === 'incontroverso' ? 'is-active-incontr' : ''}" data-field="${campo.chave}" data-ajuste="incontroverso">✔ Incontroverso</button>
                            <button type="button" class="btn-override-status ${ajusteAtual === 'controvertido' ? 'is-active-contr' : ''}" data-field="${campo.chave}" data-ajuste="controvertido">⚡ Controvertido</button>
                            ${btnAutoHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        listaEl.innerHTML = cardsHtml;

        const pills = [];
        if (contadores.incontroverso > 0) pills.push(`<span class="confronto-status-tag confronto-status-tag--incontroverso">✔ ${contadores.incontroverso} Incontroverso${contadores.incontroverso > 1 ? 's' : ''}</span>`);
        if (contadores.controvertido > 0) pills.push(`<span class="confronto-status-tag confronto-status-tag--controvertido">⚡ ${contadores.controvertido} Controvertido${contadores.controvertido > 1 ? 's' : ''}</span>`);
        if (contadores.presuncao > 0)     pills.push(`<span class="confronto-status-tag confronto-status-tag--presuncao">◐ ${contadores.presuncao} Presunção</span>`);
        if (contadores.pendente > 0)      pills.push(`<span class="confronto-status-tag confronto-status-tag--pendente">— ${contadores.pendente} Pendente${contadores.pendente > 1 ? 's' : ''}</span>`);
        summaryEl.innerHTML = pills.join('');
    }

    function _focarPrimeiroCampoDaEtapa(etapa) {
        requestAnimationFrame(() => {
            const pane = document.getElementById(`contrato-step-${etapa}`);
            if (!pane) return;
            const focoAlvo = pane.querySelector('input:not(:disabled), button:not(:disabled)');
            if (focoAlvo) focoAlvo.focus({ preventScroll: true });
        });
    }

    function _renderizarEtapa(etapa, moverFoco = false) {
        _etapaAtual = etapa;
        _resetarBotaoLimpar();

        const modal = document.getElementById('modal-contrato-config');
        const stepper = document.getElementById('contrato-stepper');
        const headerLabel = document.getElementById('contrato-header-label');

        const titulos = {
            0: 'Parâmetros do Vínculo',
            1: 'Confronto — Parte Autora',
            2: 'Confronto — Parte Ré',
            3: 'Diagnóstico de Controvérsia'
        };
        if (headerLabel) headerLabel.textContent = titulos[etapa] || titulos[0];
        if (stepper) stepper.style.display = etapa === 0 ? 'none' : 'flex';
        if (modal) modal.classList.toggle('is-confronto-wide', etapa === 3);

        for (let i = 0; i <= 3; i++) {
            const pane = document.getElementById(`contrato-step-${i}`);
            if (!pane) continue;
            const ativo = i === etapa;
            pane.style.display = ativo ? 'flex' : 'none';
            pane.classList.toggle('is-active', ativo);
        }

        if (stepper) {
            stepper.querySelectorAll('.contrato-step-pill').forEach(btn => {
                const stepNum = parseInt(btn.dataset.step, 10);
                const ativo = stepNum === etapa;
                btn.classList.toggle('is-active', ativo);
                btn.classList.toggle('is-done', stepNum < etapa);
                if (ativo) btn.setAttribute('aria-current', 'step');
                else btn.removeAttribute('aria-current');
            });
        }

        if (etapa === 0) _atualizarCtaEIndicadores();
        if (etapa === 2) _sincronizarEtapa2UI();
        if (etapa === 3) _renderizarResultadoConfronto();
        if (moverFoco) _focarPrimeiroCampoDaEtapa(etapa);
    }

    /* ── Ações Públicas de UI ────────────────────────── */

    function abrirModal() {
        const p = _periodoAtivo();
        document.getElementById('input-contrato-inicio').value = p.inicio || '';
        document.getElementById('input-contrato-fim').value = p.fim || '';
        document.getElementById('input-contrato-ajuizamento').value = p.ajuizamento || '';
        document.getElementById('input-contrato-funcao').value = p.funcao || '';

        _hidratarInputsConfronto();
        _atualizarCtaEIndicadores();
        _renderizarEtapa(0, true);

        document.getElementById('modal-contrato-backdrop').style.display = 'block';
        document.getElementById('modal-contrato-config').style.display = 'flex';

        if (typeof window.toggleFocoModal === 'function') window.toggleFocoModal(true);
    }

    function fecharModal({ silencioso = false } = {}) {
        _resetarBotaoLimpar();
        document.getElementById('modal-contrato-backdrop').style.display = 'none';
        document.getElementById('modal-contrato-config').style.display = 'none';
        _renderizarEtapa(0, false);

        if (typeof window.toggleFocoModal === 'function') window.toggleFocoModal(false);

        if (silencioso) {
            _cancelarPersistenciaPendente();
            _confrontoSujo = false;
        } else {
            _flushPersistenciaConfronto();
        }
    }

    function toggleModoConfronto(ativo) {
        _salvarModoConfrontoUI(!!ativo);
        _atualizarCtaEIndicadores();

        if (!ativo && _etapaAtual !== 0) {
            _renderizarEtapa(0, true);
        }
    }

    function irParaEtapa(etapaDestino) {
        _renderizarEtapa(etapaDestino, true);
    }

    function registrarInputAutora(chave, valor) {
        const valorAnterior = _confronto.autora[chave];
        _confronto.autora[chave] = valor;
        _confronto.ajusteManual[chave] = null;

        if (_confronto.posturaRe[chave] === 'confirma' && _confronto.re[chave] === valorAnterior) {
            _confronto.re[chave] = valor;
        }
        _marcarConfrontoSujo();
    }

    function definirPosturaDefesa(posturaGlobal) {
        _confronto.defesa = posturaGlobal;
        CAMPOS_CONFRONTO.forEach(({ chave }) => { _confronto.ajusteManual[chave] = null; });
        _sincronizarEtapa2UI();
        _marcarConfrontoSujo();
    }

    function definirPosturaCampo(chave, postura) {
        const atual = _confronto.posturaRe[chave];
        const novaPostura = (atual === postura) ? '' : postura;
        _confronto.posturaRe[chave] = novaPostura;
        _confronto.ajusteManual[chave] = null;

        if (novaPostura === 'confirma') {
            _confronto.re[chave] = _confronto.autora[chave] || '';
        } else if (novaPostura === 'silente') {
            _confronto.re[chave] = '';
        }

        _sincronizarEtapa2UI();
        if (novaPostura === 'diverge') {
            const input = document.getElementById(`input-confronto-re-${chave}`);
            if (input) input.focus();
        }
        _marcarConfrontoSujo();
    }

    function registrarInputRe(chave, valor) {
        _confronto.re[chave] = valor;
        _confronto.ajusteManual[chave] = null;

        const limpo = valor.trim();
        if (!limpo) {
            _confronto.posturaRe[chave] = '';
        } else {
            const valAutora = (_confronto.autora[chave] || '').trim();
            _confronto.posturaRe[chave] = (valAutora && limpo === valAutora) ? 'confirma' : 'diverge';
        }

        const input = document.getElementById(`input-confronto-re-${chave}`);
        if (input) input.classList.toggle('is-confirmed-input', _confronto.posturaRe[chave] === 'confirma');

        document.querySelectorAll(`.btn-postura[data-field="${chave}"]`).forEach(btn => {
            btn.classList.toggle('is-selected', btn.dataset.postura === _confronto.posturaRe[chave]);
        });
        _marcarConfrontoSujo();
    }

    function limparConfronto(btnEl) {
        const alvo = btnEl || document.getElementById('btn-confronto-limpar');
        if (alvo && alvo.dataset.confirming !== 'true') {
            alvo.dataset.confirming = 'true';
            alvo.textContent = 'Confirmar limpeza?';
            alvo.classList.add('is-confirming');
            clearTimeout(_limparConfirmTimer);
            _limparConfirmTimer = setTimeout(_resetarBotaoLimpar, 3500);
            return;
        }

        _resetarBotaoLimpar();
        _confronto = _criarEstadoConfrontoVazio();
        _hidratarInputsConfronto();
        _atualizarCtaEIndicadores();
        _renderizarResultadoConfronto();
        _marcarConfrontoSujo();
        if (typeof exibirToast === 'function') exibirToast('Dados da confrontação limpos.', 'info');
    }

    function salvar() {
        const p = _periodoAtivo();
        p.inicio = document.getElementById('input-contrato-inicio').value;
        p.fim = document.getElementById('input-contrato-fim').value;
        p.ajuizamento = document.getElementById('input-contrato-ajuizamento').value;
        p.funcao = document.getElementById('input-contrato-funcao').value.trim();

        _atualizarUI();
        fecharModal({ silencioso: true });

        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        exibirToast('Parâmetros contratuais salvos com sucesso.', 'sucesso');
    }

    function _atualizarUI() {
        const btn = document.getElementById('btn-contrato-trabalho');
        const txt = document.getElementById('contrato-status-text');
        if (!btn || !txt) return;

        const p = _periodoAtivo();
        const possuiDados = p.inicio || p.fim || p.ajuizamento || p.funcao;

        btn.classList.toggle('has-data', !!possuiDados);
        txt.textContent = possuiDados ? 'Dados Salvos' : 'Contrato';

        const riscoBienal = _avaliarRiscoBienal();
        btn.classList.toggle('alerta-prescricao', riscoBienal === true);

        if (possuiDados) {
            let tooltip = 'Parâmetros Atuais:\n';
            tooltip += `Admissão: ${_formatarDataBR(p.inicio) || 'Não inf.'}\n`;
            tooltip += `Demissão: ${_formatarDataBR(p.fim) || 'Não inf.'}\n`;
            tooltip += `Ajuizamento: ${_formatarDataBR(p.ajuizamento) || 'Não inf.'}\n`;
            tooltip += `Função: ${p.funcao || 'Não inf.'}`;
            if (riscoBienal === true) tooltip += '\n\n⚠ Possível prescrição bienal — verificar (considerar projeção do aviso, OJ 83 SDI-1/TST).';
            btn.title = tooltip;
        } else {
            btn.title = 'Adicionar Parâmetros do Contrato';
        }
    }

    /* ── API Pública ─────────────────────────────────── */
    return {
        abrirModal,
        fecharModal,
        salvar,
        toggleModoConfronto,
        irParaEtapa,
        registrarInputAutora,
        definirPosturaDefesa,
        definirPosturaCampo,
        registrarInputRe,
        limparConfronto,

        // Contrato imutável com export-manager.js
        getDados: () => {
            const p = _periodoAtivo();
            return { inicio: p.inicio, fim: p.fim, ajuizamento: p.ajuizamento, funcao: p.funcao };
        },

        setDados: (novosDadosFlat) => {
            _dados = {
                periodos: [
                    novosDadosFlat
                        ? { inicio: '', fim: '', ajuizamento: '', funcao: '', ...novosDadosFlat }
                        : { inicio: '', fim: '', ajuizamento: '', funcao: '' }
                ]
            };
            _atualizarUI();
        },

        // Persistência isolada para backup-manager.js
        getConfronto: () => ({
            v: 1,
            defesa:       _confronto.defesa,
            autora:       { ..._confronto.autora },
            re:           { ..._confronto.re },
            posturaRe:    { ..._confronto.posturaRe },
            ajusteManual: { ..._confronto.ajusteManual }
        }),

        setConfronto: (dadosSalvos) => {
            _cancelarPersistenciaPendente();
            _confrontoSujo = false;
            if (!dadosSalvos || typeof dadosSalvos !== 'object') {
                _confronto = _criarEstadoConfrontoVazio();
            } else {
                const base = _criarEstadoConfrontoVazio();
                _confronto = {
                    v: 1,
                    defesa:       ['contesta', 'nega_vinculo', 'revelia'].includes(dadosSalvos.defesa) ? dadosSalvos.defesa : 'contesta',
                    autora:       { ...base.autora,       ...(dadosSalvos.autora || {}) },
                    re:           { ...base.re,           ...(dadosSalvos.re || {}) },
                    posturaRe:    { ...base.posturaRe,    ...(dadosSalvos.posturaRe || {}) },
                    ajusteManual: { ...base.ajusteManual, ...(dadosSalvos.ajusteManual || {}) }
                };
            }
            _hidratarInputsConfronto();
            _atualizarCtaEIndicadores();
        }
    };
})();