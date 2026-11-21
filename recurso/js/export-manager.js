/* ================================================
   export-manager.js
   Módulo de Formatação e Exportação: Markdown + Imagens
   Arquitetura: "Roteiro do Diretor" para o Mestre de Gabinete
   Versão: 3.1.1 - Produção (Com Buffers de Renderização)
   ================================================

   CORREÇÕES APLICADAS v3.0:
   [1] Fase Processual: Cada IDEIA agora expõe explicitamente
       seu contexto processual (fase/documento) como primeira linha,
       dando ao LLM a âncora narrativa para posicionar a prova
       corretamente dentro da estrutura da minuta.
   [2] Fila de Download Sequencial: O padrão frágil de setTimeout
       acumulativo foi substituído por um loop async/await encadeado,
       tornando o download de imagens determinístico e à prova de
       falha silenciosa.
   [3] Fallback de Título Instrucional: O fallback genérico
       'Análise Probatória' foi substituído por texto que instrui
       o LLM a inferir a tese, evitando que ele trate o rótulo
       como uma tese definida.
       
   CORREÇÕES APLICADAS v3.1:
   [4] Blindagem de Strings: Centralização de tratamento via helper _safeMD,
       impedindo que parágrafos inseridos pelo usuário quebrem as tags Markdown.
   [5] Recuperação de Contexto (SourceRef): Mapeamento dinâmico entre intenções 
       metodológicas e as sub-provas que as originaram.

   CORREÇÕES APLICADAS v3.1.1 (Hotfix):
   [6] Arquitetura de Buffers: Montagem Top-Down garantindo que as tags
       XML sejam lidas pela IA antes da matriz probatória, suprimindo tags vazias.
   ================================================ */

window.ExportManager = (function () {
    'use strict';

    let _deps = {};
    let _regrasDeLimpezaCache = null;

    // SINGLE SOURCE OF TRUTH — marcadores de sanitização (LGPD)
    // Únicos em todo o módulo; nenhuma outra função deve redeclarar estas strings.
    const MARCADOR_OFICIAL_LGPD = '\n\n[AVISO DE SISTEMA: Dados sensíveis (ex: endereços) ou estruturais (cabeçalhos) foram ocultados pela Borracha Mágica para adequação à LGPD.]\n\n';
    const MARCADOR_RUIDOS = '\n\n[AVISO DE SISTEMA: Dados estruturais ocultados.]\n\n';
    const CHAVE_TESE_SEM_NOME = 'Tese Não Nomeada';
    const STORAGE_KEY_AUDITORIA = 'juris_auditoria_critica_ia';
    const SCHEMA_EXPORT_VERSAO = 'JN-5.0';
    const TITULO_SECAO_AUDITORIA = '### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]';
    let _docConfigMapCache = null;

    /**
     * Fonte Única de Verdade (SSOT) dos regimes editoriais dos Nós de Ideia.
     */
    const REGIME_INTENCOES = Object.freeze({
        texto:          { regime: 'LITERAL',                 categoriaUI: 'literal',  tag: 'TEXTO FIXO' },
        jurisprudencia: { regime: 'LITERAL_MOVEL',           categoriaUI: 'literal',  tag: 'JURISPRUDÊNCIA EXATA' },
        degravacao:     { regime: 'LITERAL_MOVEL',           categoriaUI: 'literal',  tag: 'DEGRAVAÇÃO CURADA' },
        comando:        { regime: 'ORDEM',                   categoriaUI: 'ordem',    tag: 'COMANDO DIRETO' },
        veredito:       { regime: 'CONCLUSAO_VINCULANTE',    categoriaUI: 'ordem',    tag: 'VEREDITO PARCIAL' },
        premissa:       { regime: 'DESENVOLVER',             categoriaUI: 'livre',    tag: 'PREMISSA LÓGICA' },
        refutacao:      { regime: 'DESENVOLVER_REFUTAR',     categoriaUI: 'livre',    tag: 'REFUTAÇÃO' },
        preliminar:     { regime: 'DESENVOLVER_PREJUDICIAL', categoriaUI: 'livre',    tag: 'FILTRO / PREJUDICIAL' },
        fundamentacao:  { regime: 'LASTRO',                  categoriaUI: 'livre',    tag: 'LEI SECA' },
        fallback:       { regime: 'CONTEXTO_VALIDADO',       categoriaUI: 'livre',    tag: 'CONTEXTO FÁTICO VALIDADO' },
        nota:           { regime: 'EXCLUIDO',                categoriaUI: 'excluido', tag: null }
    });

    /**
     * Detector resiliente de checkpoint: usa JurisIndexUtils.ehCheckpoint quando carregado
     * e faz fallback determinístico para an.tipo.startsWith('checkpoint').
     */
    function _ehCheckpoint(an) {
        if (!an) return false;
        if (typeof window.JurisIndexUtils?.ehCheckpoint === 'function') {
            return window.JurisIndexUtils.ehCheckpoint(an);
        }
        return Boolean(an.tipo && an.tipo.startsWith('checkpoint'));
    }

    /**
     * Constrói o mapa índice físico -> número visual da Ideia (idêntico à tela e aos badges do PDF),
     * pulando checkpoints para eliminar o deslocamento off-by-one em Volumes II+.
     */
    function _construirMapaVisualExport(anotacoes) {
        if (typeof window.JurisIndexUtils?.construirMapaVisual === 'function') {
            return window.JurisIndexUtils.construirMapaVisual(anotacoes || []);
        }
        const mapa = new Map();
        let contador = 1;
        (anotacoes || []).forEach((an, idx) => {
            if (!_ehCheckpoint(an)) {
                mapa.set(idx, contador++);
            }
        });
        return mapa;
    }

    /**
     * Gera a legenda única de regimes editoriais (definida uma vez no topo para economia de tokens).
     * @param {Object} [opts] - { modo: 'completo' | 'somente_nos', auditoria?: boolean }
     */
    function gerarLegendaRegimesRedacionais(opts = {}) {
        const modo = opts.modo || 'completo';
        const isCompleto = modo === 'completo';
        const auditoriaAtiva = typeof opts.auditoria === 'boolean'
            ? opts.auditoria
            : isAuditoriaCriticaAtiva();

        const linhas = [
            `<protocolo_editorial_minuta versao="${SCHEMA_EXPORT_VERSAO}">`,
            'Você atuará na redação de minuta de acórdão trabalhista (2º Grau), refletindo exclusivamente o convencimento do Desembargador Relator.',
            '',
            'LEGENDA DE REGIMES DOS NÓS DE IDEIA (aplique conforme a tag [REGIME: ...] de cada item):',
            '- [REGIME: LITERAL] (Texto Fixo): reproduza a redação exatamente como escrita, sem parafrasear.',
            '- [REGIME: LITERAL_MOVEL] (Jurisprudência Exata / Degravação Curada): preserve integralmente o teor literal citado, mas tenha liberdade para ordenar sua posição e redigir parágrafos/frases de transição.',
            '- [REGIME: ORDEM] (Comando Direto): cumpra integralmente a instrução operacional na elaboração da minuta; NÃO transcreva o enunciado da ordem.',
            '- [REGIME: CONCLUSAO_VINCULANTE] (Veredito Parcial): adote obrigatoriamente este desfecho decisório na fundamentação e conclusão do ponto.',
            '- [REGIME: DESENVOLVER] (Premissa Lógica): NÃO copie literalmente. Use como ponto de partida e tom do Relator; desenvolva a camada argumentativa em linguagem de acórdão, insira conectores de coesão/coerência, ajuste frases e reordene pontos se melhorar a sequência lógica.',
            '- [REGIME: DESENVOLVER_REFUTAR] (Refutação): desenvolva livremente com coesão forense, cumprindo a função específica de rebater frontalmente a tese recursal indicada na origem do nó.',
            '- [REGIME: DESENVOLVER_PREJUDICIAL] (Filtro / Prejudicial): desenvolva livremente e posicione a análise logicamente antes do mérito.',
            '- [REGIME: LASTRO] (Lei Seca): utilize como pano de fundo normativo integrado organicamente à fundamentação (evite transcrição mecânica integral do artigo se desnecessária).',
            '- [REGIME: CONTEXTO_VALIDADO]: fato já validado pelo assistente para integrar o raciocínio.',
            '',
            'BLINDAGEM ANTI-ALUCINAÇÃO E MINUTA LIMPA (OBRIGATÓRIO):',
            '- PROIBIDO inventar ou citar de memória qualquer ementa, número de precedente, súmula ou OJ fora dos Nós de Ideia.',
            '- PROIBIDO criar ou inserir avisos editoriais no corpo da minuta ("[CONFERIR]", "[VERIFICAR]", "[ERRO PRESCRICIONAL...]", "[DADO INSUFICIENTE...]"). Preserve intactos apenas colchetes originais de citações literais ("[...]", "[sic]") e o marcador "[DADO PESSOAL OCULTADO - LGPD]".',
            (isCompleto && auditoriaAtiva)
                ? '- Exceção controlada (sem avisos inline): admite-se referenciar (a) artigo basilar vigente (CLT/CPC/CF) ou já aplicado na sentença sem transcrever redação de memória, ou (b) Súmula/OJ/artigo verificado em fonte normativa oficial anexa ao ambiente (ex.: CLT/TST no NotebookLM) convergente com o Nó de Ideia — listando obrigatoriamente cada item na seção final de Auditoria com a origem e as primeiras 6 a 8 palavras do parágrafo onde aparece.'
                : '- Auditoria desativada (ou modo enxuto): utilize EXCLUSIVAMENTE as normas e julgados fornecidos nos Nós de Ideia; ficam vedadas citações normativas externas sem trilha de conferência.'
        ];

        linhas.push('', 'REGRAS DE PRECEDÊNCIA EM CASO DE CONFLITO:');

        if (isCompleto) {
            linhas.push(
                '1. Eixo Decisório (mérito e resultado): Veredito > Diretriz Global > Diretriz de Tese > Nó Local. Qualquer conflito que afete o resultado segue o eixo decisório; o Veredito NUNCA é contrariado, nem mesmo por texto literal.',
                '2. Eixo Editorial (forma e exceções): fora de conflito de resultado, [LITERAL]/[LITERAL_MOVEL] prevalecem sobre paráfrase; entre dois [ORDEM], o comando mais específico (Local > Tese > Global) prevalece como exceção pontual.'
            );
            if (auditoriaAtiva) {
                linhas.push(
                    '3. Transparência de Conflito: sempre que detectar conflito entre nós ou entre nó e Veredito, aplique a precedência acima para concluir a minuta e REGISTRE o conflito na seção de Auditoria citando o nº da Ideia.'
                );
            }
            linhas.push(
                '',
                'REGRA DOS CARTÕES DE CONTEXTO (<contexto_processual> / <contexto_processual_nao_vinculante>):',
                '- Trechos extraídos de peças das partes ou da sentença representam a visão do advogado ou do Juízo de 1º Grau — NUNCA a convicção do Relator.',
                '- Utilize-os exclusivamente para delimitar a lide (inicial/contestação), identificar as teses do recurso, aferir inovação recursal, falta de dialeticidade e adequação da valoração probatória.'
            );
        } else {
            linhas.push(
                '1. Eixo Decisório (mérito e resultado): Veredito Parcial > Diretriz Global > Diretriz de Tese > Nó Local. Qualquer conflito que afete o resultado segue o eixo decisório; o Veredito Parcial NUNCA é contrariado, nem mesmo por texto literal.',
                '2. Eixo Editorial (forma e exceções): fora de conflito de resultado, [LITERAL]/[LITERAL_MOVEL] prevalecem sobre paráfrase; entre dois [ORDEM], o comando mais específico (Local > Tese > Global) prevalece como exceção pontual.'
            );
        }

        linhas.push('</protocolo_editorial_minuta>\n');
        return linhas.join('\n');
    }

    /**
     * Formata um único Nó de Ideia com rastreabilidade (refContexto),
     * sem indentação de 4 espaços e sem tags internas do editor.
     */
    function formatarNoEditorialMarkdown(no, refContexto = '') {
        if (!no || no.intencao === 'nota') return '';
        const chave = no.intencao || 'premissa';
        const meta = REGIME_INTENCOES[chave] || REGIME_INTENCOES.premissa;
        if (meta.regime === 'EXCLUIDO') return '';

        const textoBase = typeof _stripInternalTags === 'function'
            ? _stripInternalTags(String(no.texto || ''))
            : String(no.texto || '');
        const textoLimpo = textoBase.trim();
        if (!textoLimpo) return '';

        const origemLimpa = String(refContexto || '').trim();
        const sufixoOrigem = origemLimpa ? ` | Origem: ${origemLimpa}` : '';

        return `- **[${meta.tag} | REGIME: ${meta.regime}${sufixoOrigem}]**\n${textoLimpo}`;
    }

    function _montarRefContextoCard(item, numIdeiaVisual, subIndiceCorr = null) {
        const doc = (item?.documento || item?.polo || 'Documento').trim();
        const fl = item?.pagina ? `, fl. ${item.pagina}` : '';
        const prefixoIdeia = subIndiceCorr !== null ? `Ideia ${numIdeiaVisual}.${subIndiceCorr + 1}` : `Ideia ${numIdeiaVisual}`;
        return `${prefixoIdeia} — ${doc}${fl}`;
    }

    function _rotearNoParaSecao(no, refContexto, filaPreliminares, filaVereditosLocais, bufferLocal) {
        if (!no || no.intencao === 'nota') return;
        const chave = no.intencao || 'premissa';
        const meta = REGIME_INTENCOES[chave] || REGIME_INTENCOES.premissa;
        if (meta.regime === 'EXCLUIDO') return;

        if (chave === 'preliminar') {
            filaPreliminares.push({ no, refContexto });
            return;
        }
        if (chave === 'veredito') {
            filaVereditosLocais.push({ no, refContexto });
            return;
        }

        const formatado = formatarNoEditorialMarkdown(no, refContexto);
        if (formatado) bufferLocal.push(formatado);
    }

    function _compilarBlocoPreliminares(filaPreliminares) {
        if (!Array.isArray(filaPreliminares) || filaPreliminares.length === 0) return '';

        const itens = filaPreliminares
            .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
            .filter(Boolean);

        if (itens.length === 0) return '';

        return [
            '<questoes_preliminares_e_prejudiciais>',
            'Analise e desenvolva as questões abaixo antes do mérito principal:',
            ...itens,
            '</questoes_preliminares_e_prejudiciais>\n'
        ].join('\n');
    }

    function _compilarPreambuloCondicional(topico, filaVereditosLocais = []) {
        const limpar = (txt) => (typeof _stripInternalTags === 'function'
            ? _stripInternalTags(String(txt || ''))
            : String(txt || '')).trim();

        const campos = [
            {
                chave: 'fundamentos',
                tag: 'fundamentos_da_origem',
                posicao: 'ABERTURA_RELATORIO',
                notaFixo: 'Redação já revisada pelo assistente para síntese da sentença. Reproduza o texto fielmente como relato do julgado de origem (não vincula o mérito do 2º Grau).',
                notaAberto: 'Campo não preenchido: sintetize os fundamentos da origem a partir dos cartões da sentença/decisão recorrida.'
            },
            {
                chave: 'alegacoes',
                tag: 'razoes_recursais',
                posicao: 'ABERTURA_RELATORIO',
                notaFixo: 'Redação já revisada pelo assistente para abertura do tópico. Reproduza o texto fielmente, ciente de que expressa a pretensão do RECORRENTE (não a convicção do Relator).',
                notaAberto: 'Campo não preenchido: sintetize as razões recursais a partir dos cartões de contexto do recurso.'
            },
            {
                chave: 'veredito',
                tag: 'veredito_e_conclusao',
                posicao: 'FECHO_DISPOSITIVO',
                notaFixo: 'Dispositivo/conclusão já definido e revisado pelo assistente. Reproduza fielmente no fechamento do tópico. Nunca contrarie este resultado.',
                notaAberto: 'CAMPO DELEGADO À IA: o assistente deixou o veredito em aberto intencionalmente. Elabore a conclusão completa e seus desdobramentos jurídicos com base nos Nós de Ideia e nos autos.'
            }
        ];

        const out = ['<preambulo_da_minuta>'];

        campos.forEach(c => {
            const val = limpar(topico?.[c.chave]);
            if (val) {
                out.push(`<${c.tag} posicao="${c.posicao}" status="TEXTO_FIXO_NAO_ALTERAR">`);
                out.push(`[ORIENTAÇÃO]: ${c.notaFixo}`);
                out.push(val);
                out.push(`</${c.tag}>`);
            } else {
                out.push(`<${c.tag} posicao="${c.posicao}" status="EM_ABERTO_LIBERDADE_DELEGADA">`);
                out.push(`[ORIENTAÇÃO]: ${c.notaAberto}`);
                out.push(`</${c.tag}>`);
            }
        });

        if (Array.isArray(filaVereditosLocais) && filaVereditosLocais.length > 0) {
            const linhasVereditos = filaVereditosLocais
                .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
                .filter(Boolean);
            if (linhasVereditos.length > 0) {
                out.push('<vereditos_parciais_vinculantes status="OBRIGATORIO">');
                out.push(...linhasVereditos);
                out.push('</vereditos_parciais_vinculantes>');
            }
        }

        out.push('</preambulo_da_minuta>\n');
        return out.join('\n');
    }

    /**
     * Preâmbulo neutro para modo === 'acervo' (Prompt Mestre):
     * Preserva Razões Recursais, Fundamentos, Veredito e Vereditos Parciais Locais sem ordens de minuta.
     */
    function _compilarPreambuloAcervo(topico, filaVereditosLocais = []) {
        const limpar = (txt) => (typeof _stripInternalTags === 'function'
            ? _stripInternalTags(String(txt || ''))
            : String(txt || '')).trim();

        const alegacoes = limpar(topico?.alegacoes);
        const fundamentos = limpar(topico?.fundamentos);
        const veredito = limpar(topico?.veredito);
        const vereditosLocais = (filaVereditosLocais || [])
            .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
            .filter(Boolean);

        if (!alegacoes && !fundamentos && !veredito && vereditosLocais.length === 0) return '';

        const out = ['<relatorio_do_conflito>'];
        if (alegacoes) out.push(`<razoes_recursais>\n${alegacoes}\n</razoes_recursais>`);
        if (fundamentos) out.push(`<fundamentos_da_origem>\n${fundamentos}\n</fundamentos_da_origem>`);
        if (veredito) out.push(`<veredito_pretendido>\n${veredito}\n</veredito_pretendido>`);
        if (vereditosLocais.length > 0) {
            out.push('<vereditos_parciais_locais>');
            out.push(...vereditosLocais);
            out.push('</vereditos_parciais_locais>');
        }
        out.push('</relatorio_do_conflito>\n');
        return out.join('\n');
    }

    function _sanitizarComLgpdSeAtivo(str) {
        const bruto = String(str || '');
        if (window.QuickRedactManager && typeof window.QuickRedactManager.sanitizarString === 'function') {
            return window.QuickRedactManager.sanitizarString(bruto);
        }
        return bruto;
    }

    function _normalizarParaComparacaoLiteral(str) {
        return _sanitizarComLgpdSeAtivo(str)
            .replace(/\[\[(?:u|\/u|size:\d+|\/size)\]\]/gi, '')
            .replace(/[*_`>]/g, '')
            .replace(/[“”«»]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function verificarAncorasLiteraisNoRascunho(topico, textoRascunho) {
        const rascunhoNorm = _normalizarParaComparacaoLiteral(textoRascunho);
        if (!topico || !rascunhoNorm) {
            return { total: 0, encontrados: 0, ausentes: [] };
        }

        const ancoras = [];
        const adicionar = (origem, textoBruto) => {
            const limpo = String(textoBruto || '').trim();
            if (limpo.length < 8) return;
            ancoras.push({ origem, texto: limpo, norm: _normalizarParaComparacaoLiteral(limpo) });
        };

        if (topico.alegacoes) adicionar('Preâmbulo — Razões Recursais', topico.alegacoes);
        if (topico.fundamentos) adicionar('Preâmbulo — Fundamentos da Origem', topico.fundamentos);
        if (topico.veredito) adicionar('Preâmbulo — Veredito / Conclusão', topico.veredito);

        const inspecionarLista = (lista, origem) => {
            (lista || []).forEach(no => {
                if (!no || no.intencao === 'nota') return;
                const meta = REGIME_INTENCOES[no.intencao];
                if (meta && (meta.regime === 'LITERAL' || meta.regime === 'LITERAL_MOVEL')) {
                    adicionar(`${meta.tag} (${origem})`, no.texto);
                }
            });
        };

        inspecionarLista(topico.diretrizesGlobais, 'Diretriz Global');
        if (topico.diretrizesPorTese) {
            Object.entries(topico.diretrizesPorTese).forEach(([tese, lista]) => inspecionarLista(lista, `Tese: ${tese}`));
        }

        const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);
        (topico.anotacoes || []).forEach((an, idx) => {
            if (_ehCheckpoint(an)) return;
            const numVisual = mapaVisuais.get(idx);
            inspecionarLista(an.subAnotacoes, _montarRefContextoCard(an, numVisual));
            (an.itensCorrelacionados || []).forEach((ic, cIdx) => {
                inspecionarLista(ic.subAnotacoes, _montarRefContextoCard(ic, numVisual, cIdx));
            });
        });

        const ausentes = [];
        let encontrados = 0;

        ancoras.forEach(a => {
            if (rascunhoNorm.includes(a.norm)) encontrados++;
            else ausentes.push({ origem: a.origem, preview: a.texto.slice(0, 90) });
        });

        return { total: ancoras.length, encontrados, ausentes };
    }

    function isAuditoriaCriticaAtiva() {
        try {
            const val = localStorage.getItem(STORAGE_KEY_AUDITORIA);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    }

    function setAuditoriaCriticaAtiva(ativo) {
        try {
            localStorage.setItem(STORAGE_KEY_AUDITORIA, ativo ? 'true' : 'false');
        } catch (e) {
            console.warn('[ExportManager] Falha ao persistir preferência de auditoria:', e);
        }
    }

    function _obterMapaDocConfig() {
        if (_docConfigMapCache) return _docConfigMapCache;
        if (!Array.isArray(window.DOC_CONFIG)) return new Map();
        _docConfigMapCache = new Map(
            window.DOC_CONFIG.map(d => [String(d.label || '').trim().toUpperCase(), d])
        );
        return _docConfigMapCache;
    }

    function _obterChaveStorageFiltro() {
        const tagDom = document.getElementById('tag-numero-processo');
        const numProcesso = tagDom && tagDom.textContent.trim() ? tagDom.textContent.trim() : 'padrao';
        return `juris_filtros_${numProcesso}`;
    }

    function _carregarRegrasFiltro() {
        if (_regrasDeLimpezaCache) return _regrasDeLimpezaCache;
        try {
            const salvo = sessionStorage.getItem(_obterChaveStorageFiltro());
            _regrasDeLimpezaCache = salvo ? JSON.parse(salvo) : {};
        } catch { _regrasDeLimpezaCache = {}; }
        return _regrasDeLimpezaCache;
    }

    function _salvarRegrasFiltro() {
        if (!_regrasDeLimpezaCache) return;
        sessionStorage.setItem(_obterChaveStorageFiltro(), JSON.stringify(_regrasDeLimpezaCache));
    }

    // ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────

    function init(dependencies) {
        _deps = dependencies;
    }

    // ─── UTILITÁRIOS PRIVADOS ─────────────────────────────────────────────────

    /**
     * Formata a citação oficial de referência cruzada com os PDFs anexos.
     * Padrão esperado pelo Mestre de Gabinete: (Id Y - fl X)
     */
    function _formatarCitacaoOficial(pjeId, pagina) {
        const strId = pjeId   ? `Id ${pjeId}`   : 'Id não idt.';
        const strFl = pagina  ? `fl ${pagina}`  : 'fl não idt.';
        return `(${strId} - ${strFl})`;
    }

    /**
     * Gera nome de arquivo de imagem com hierarquia e metadados PJe.
     * CRÍTICO: O nome gerado aqui DEVE ser idêntico ao usado no MD e no download.
     */
    function _gerarNomeArquivoImagem(ideiaNum, subNum, pjeId, pagina) {
        const strId      = pjeId   ? `_Id_${pjeId}`   : '';
        const strFl      = pagina  ? `_fl_${pagina}`  : '';
        const hierarquia = subNum  ? `${ideiaNum}.${subNum}` : `${ideiaNum}`;
        return `Recorte_Prova_${hierarquia}${strId}${strFl}.png`;
    }

    /**
     * [CORREÇÃO #2] Download seguro de imagem a partir de base64.
     * Retorna uma Promise para permitir encadeamento na fila sequencial.
     */
    async function _downloadImagemSegura(base64Data, nomeArquivoBase) {
        try {
            const response = await fetch(base64Data);
            const blob     = await response.blob();
            const url      = URL.createObjectURL(blob);
            const link     = document.createElement('a');
            link.href      = url;
            link.download  = nomeArquivoBase;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            // Aguarda 1 tick antes de revogar, garantindo que o browser
            // já iniciou o download antes de liberar o objeto URL.
            await new Promise(resolve => setTimeout(resolve, 50));
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(`[ExportManager] Falha ao baixar imagem "${nomeArquivoBase}":`, e);
        }
    }

    /**
     * [CORREÇÃO #2] Executa a fila de downloads de forma sequencial e segura.
     * Cada download aguarda a conclusão do anterior + pausa de 650ms.
     * Chamada sem await na função pública para não bloquear a UI.
     * @param {{ dados: string, nome: string }[]} fila
     */
    async function _executarFilaDeDownloads(fila) {
        if (!fila || fila.length === 0) return;
        _deps.exibirToast(`Iniciando download de ${fila.length} imagem(ns)...`, 'info');
        for (const item of fila) {
            await _downloadImagemSegura(item.dados, item.nome);
            // Pausa entre downloads para evitar colisão no gerenciador do browser.
            await new Promise(resolve => setTimeout(resolve, 650));
        }
        _deps.exibirToast('Todas as imagens foram baixadas.', 'sucesso');
    }

    /**
     * Remove sintaxes exclusivas de renderização da UI (ex: [[size:2]])
     * Evita vazamento de pseudo-código inútil para o LLM.
     */
    function _stripInternalTags(texto) {
        if (!texto) return '';
        return texto.replace(/\[\[\/?size(:\d)?\]\]/g, '');
    }

    /**
     * Sanitiza textos livres do usuário para injeção segura.
     * CORREÇÃO: Default alterado de '\n  > ' para '\n  ' para evitar Markdown blockquote.
     * @param {string} texto Conteúdo bruto.
     * @param {string} prefixo Prefixo estrutural.
     */
    function _safeMD(texto, prefixo = '\n  ') {
        if (!texto) return '';
        const textoLimpo = _stripInternalTags(texto);
        return textoLimpo.replace(/\n/g, prefixo);
    }

    /**
     * Sanitiza atributos para injeção segura em tags XML.
     * Previne quebra de payload por aspas duplas no nome da tese.
     */
    function _escapeXmlAttr(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Remove padrões de prompt injection de forma cirúrgica.
     * Evita bloqueio de palavras comuns no meio jurídico (ex: "ignore", "modelo").
     */
    function _sanitizarContraInjecao(texto) {
        if (!texto) return '';
        return String(texto)
            // Impede abertura/fechamento forjado de tags XML em textos extraídos do PDF
            .replace(/</g, '‹')
            .replace(/>/g, '›')
            // Impede falsificação de marcadores de autoridade do sistema
            .replace(/\[\s*(NÓ DE IDEIA|DIRETRIZ|ESTATUTO|VERDADE|COMANDO|PREMISSA|INSTRUÇÃO)/gi, '($1')
            // Intercepta comandos diretos para a IA
            .replace(/\b(IA|Modelo|GPT|LLM)\s*:/gi, '[SISTEMA]')
            // Intercepta expressões de jailbreak/injection
            .replace(/\bignore\s+(tudo|o\s+que|as\s+instru[çc][õo]es|o\s+prompt)\b/gi, '[FILTRADO]')
            // Intercepta injeção de novas regras de sistema
            .replace(/(^|[.!?\n])\s*(nova\s+)?instru[çc][aã]o\s*:/gim, '$1 [FILTRADO]:');
    }

    /**
     * Limita trechos massivos para proteger a janela de contexto do LLM.
     * Limite ajustado para 4000 caracteres (~1.5 laudas) para evitar corte de cláusulas críticas.
     */
    function _truncarTextoParaIA(texto, limite = 4000) {
        if (!texto || texto.length <= limite) return texto;
        return texto.substring(0, limite) + 
            `\n\n[⚠️ TRECHO TRUNCADO: O assessor destacou um bloco longo. Trabalhe com a ideia central extraída da parte acima.]`;
    }

    /**
     * Achata a hierarquia da anotação (Mestre + Correlacionados) para
     * inferência de contexto processual.
     * ATUALIZAÇÃO: Radar de palavras-chave expandido para cobrir os novos atos de Execução.
     */
    function _inferirContextoProcessual(anotacoes) {
        const todosDocumentos = anotacoes.flatMap(an => {
            const docs = [an.documento || ''];
            if (an.itensCorrelacionados) {
                docs.push(...an.itensCorrelacionados.map(ic => ic.documento || ''));
            }
            return docs;
        });

        // 1. Termos internos fixos (não selecionáveis na UI, mas que podem constar em nomes de documentos legados)
        const termosBase = ['Sentença de Execução', 'Cálculos', 'Liquidação', 'Penhora', 'Bacenjud', 'Sisbajud', 'Impugnação aos Cálculos'];
        
        // 2. Extrai dinamicamente as labels da UI marcadas como Execução
        const labelsExecucaoUI = window.DOC_CONFIG ? 
            window.DOC_CONFIG.filter(d => d.isExecucao).map(d => d.label) : [];

        // 3. União dos arrays (Fallback + Dinâmico)
        const palavrasChaveExecucao = [...termosBase, ...labelsExecucaoUI];

        return {
            isExecucao: todosDocumentos.some(doc => palavrasChaveExecucao.some(palavra => doc.includes(palavra))),
            isAI: todosDocumentos.some(d => d.includes('Agravo de Instrumento'))
        };
    }

    // ─── GERADOR DE MARKDOWN E HIERARQUIA EPISTEMOLÓGICA ─────────────────────

    /**
     * Classifica de forma determinística O(1) o estatuto epistemológico do cartão
     * consultando o Map de window.DOC_CONFIG e desempatando pelo polo quando necessário.
     */
    function _obterEstatutoEpistemologico(item) {
        const docUpper = String(item.documento || '').trim().toUpperCase();
        const poloUpper = String(item.polo || '').trim().toUpperCase();

        const mapa = _obterMapaDocConfig();
        const configEntry = mapa.get(docUpper) || null;
        let natureza = configEntry ? configEntry.natureza : null;

        if (natureza === 'calculo_liquidacao') {
            const isOficial = poloUpper.includes('JUÍZO') || poloUpper.includes('PERITO') || poloUpper.includes('AUXILIAR');
            natureza = isOficial ? 'prova_autos' : 'alegacao_postulatoria';
        } else if (natureza === 'hibrido_polo') {
            if (poloUpper.includes('JUÍZO')) natureza = 'ato_judicial_oficial';
            else if (poloUpper.includes('PERITO') || poloUpper.includes('AUXILIAR')) natureza = 'prova_autos';
            else natureza = 'alegacao_postulatoria';
        }

        if (!natureza) {
            if (docUpper.includes('RECURSO') || docUpper.includes('AGRAVO')) natureza = 'alegacao_recurso';
            else if (docUpper.includes('CONTRARRAZ') || docUpper.includes('CONTRAMINUTA')) natureza = 'alegacao_contrarrazoes';
            else if (docUpper.includes('INICIAL') || docUpper.includes('CONTESTA') || docUpper.includes('IMPUGNA') || docUpper.includes('EMBARGOS')) natureza = 'alegacao_postulatoria';
            else if (docUpper.includes('SENTENÇA') || docUpper.includes('ACÓRDÃO')) natureza = 'decisao_recorrida';
            else if (docUpper.includes('LAUDO') || docUpper.includes('ATA') || item.tipo === 'audio') natureza = 'prova_autos';
            else if (poloUpper.includes('JUÍZO') || poloUpper.includes('AUXILIAR')) natureza = 'ato_judicial_oficial';
            else natureza = 'alegacao_postulatoria';
        }

        const mapaCodigos = {
            'alegacao_recurso': 'ALEGACAO_RECURSAL',
            'alegacao_contrarrazoes': 'CONTRARRAZOES_DEFESA_RECURSAL',
            'alegacao_postulatoria': 'LIMITES_DA_LIDE_ALEGACAO',
            'decisao_recorrida': 'DECISAO_RECORRIDA_ORIGEM',
            'ato_judicial_oficial': 'ATO_JUDICIAL_OFICIAL',
            'prova_autos': 'ELEMENTO_PROBATORIO_BRUTO'
        };

        return mapaCodigos[natureza] || 'LIMITES_DA_LIDE_ALEGACAO';
    }

    /**
     * Envelopa e sanitiza inteiros teores extraídos por alfinetes ou colados manualmente.
     * Usa tokenização por palavra inteira para evitar colisões (ex: "ATA" em "CONTRATANTE")
     * e suporta campos com múltiplos blocos já envelopados ou texto manual adicionado.
     */
    function enveloparTeorIntegral(docTipo, textoLimpo) {
        if (!textoLimpo) return '';
        const strTexto = String(textoLimpo).trim();

        // Se o texto já contém blocos envelopados, preserva os blocos existentes e
        // envelopa/sanitiza apenas eventuais trechos livres colados manualmente fora deles
        if (strTexto.includes('estatuto_epistemologico=')) {
            const regexBlocoEnvelopado = /<([A-ZÀ-ÖØ-Ý0-9_]+)\s+estatuto_epistemologico="[^"]+">[\s\S]*?<\/\1>/gi;
            let ultimoIndice = 0;
            let resultado = '';
            let match;

            while ((match = regexBlocoEnvelopado.exec(strTexto)) !== null) {
                const trechoLivreAntes = strTexto.slice(ultimoIndice, match.index).trim();
                if (trechoLivreAntes) {
                    resultado += enveloparTeorIntegral(docTipo, trechoLivreAntes) + '\n\n';
                }
                resultado += match[0] + '\n\n';
                ultimoIndice = regexBlocoEnvelopado.lastIndex;
            }

            const trechoLivreDepois = strTexto.slice(ultimoIndice).trim();
            if (trechoLivreDepois) {
                resultado += enveloparTeorIntegral(docTipo, trechoLivreDepois);
            }
            return resultado.trim();
        }

        // Preserva letras acentuadas válidas em XML (ex: CONTRARRAZÕES_AUTORA)
        const tag = String(docTipo || 'DOCUMENTO').toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý0-9_]/gi, '_');
        const textoSeguro = _sanitizarContraInjecao(strTexto);

        // Tokenização sem acentos por palavra inteira (evita "ATA" bater em "CONTRATANTE")
        const tokens = new Set(
            tag.normalize('NFD')
               .replace(/[\u0300-\u036f]/g, '')
               .split('_')
               .filter(Boolean)
        );
        const temAlgumToken = (...lista) => lista.some(t => tokens.has(t));

        let estatuto = 'PECA_OU_DOCUMENTO_COMPLEMENTAR_NAO_VINCULANTE';
        let diretrizLeitura = 'Peça ou documento complementar extraído dos autos. Subordine sua leitura e valoração estritamente às diretrizes dos Nós de Ideia.';

        if (temAlgumToken('SENTENCA', 'DECISAO', 'ACORDAO')) {
            estatuto = 'DECISAO_RECORRIDA_ORIGEM';
            diretrizLeitura = 'Inteiro teor da decisão de origem. Use para relatório e aferição de dialeticidade. Prevalece apenas no que for mantido pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia revoga e substitui o entendimento da origem.';
        } else if (temAlgumToken('RECURSO', 'RO', 'AGRAVO', 'AP', 'CONTRARRAZOES', 'CONTRAMINUTA', 'INICIAL', 'CONTESTACAO', 'IMPUGNACAO', 'EMBARGOS', 'MANIFESTACAO', 'RAZOES')) {
            estatuto = 'ALEGACAO_DE_PARTE_NAO_VINCULANTE';
            diretrizLeitura = 'Inteiro teor de peça processual unilateral de parte. NÃO é verdade fática. Use APENAS para aferir limites do pedido/recurso, dialeticidade ou inovação recursal. A citação de norma ou julgado pela parte não é motivo para adotá-lo.';
        } else if (temAlgumToken('LAUDO', 'PERICIA', 'PERICIAL', 'ATA', 'OITIVA', 'DEPOIMENTO', 'PROVA')) {
            estatuto = 'ELEMENTO_PROBATORIO_BRUTO';
            diretrizLeitura = 'Inteiro teor de elemento probatório/pericial dos autos. Sua valoração jurídica e conclusão subordinam-se estritamente ao enquadramento fixado nos Nós de Ideia.';
        }

        return `<${tag} estatuto_epistemologico="${estatuto}">\n[DIRETRIZ DE LEITURA CONTIDA]: ${diretrizLeitura}\n\n${textoSeguro}\n\n[FIM DE ${tag} — RETORNE À SOBERANIA DOS NÓS DE IDEIA]\n</${tag}>`;
    }

    /**
     * Gera âncora cognitiva final (Recency Guard) e protocolo de Auditoria Limpa.
     */
    function gerarLembreteFinalHierarquia(topico, opts = {}) {
        const auditoriaAtiva = typeof opts.auditoria === 'boolean'
            ? opts.auditoria
            : isAuditoriaCriticaAtiva();

        const vereditoDelegado = !(topico && topico.veredito && topico.veredito.trim() !== '');
        const possuiCheckpointSaida = Boolean(
            topico && Array.isArray(topico.anotacoes) && topico.anotacoes.some(a => a && a.tipo === 'checkpoint_saida')
        );

        const linhas = [
            '\n<fechamento_editorial_e_controle>',
            'CHECKLIST DE EXECUÇÃO (RECENCY GUARD):',
            '1. RIGIDEZ: Preserve literalmente o Preâmbulo preenchido (1º Fundamentos da Origem; 2º Razões Recursais; ao fim, Veredito), [TEXTO FIXO], [JURISPRUDÊNCIA EXATA] e [DEGRAVAÇÃO CURADA] (nestes dois últimos, ordene livremente e redija transições fluidas). O Veredito nunca pode ser contrariado.',
            '2. LIBERDADE: NÃO copie mecanicamente [PREMISSA LÓGICA], [REFUTAÇÃO] nem [FILTRO / PREJUDICIAL] — desenvolva argumentação jurídica coesa, reordenando trechos se melhorar a lógica do acórdão, e integre [LEI SECA] como pano de fundo.',
            '3. CONTEXTO: Jamais adote alegações de <contexto_processual> / <contexto_processual_nao_vinculante> como convicção do Relator.',
            '4. ANTI-ALUCINAÇÃO E MINUTA LIMPA: NUNCA invente ou cite de memória súmula, OJ, ementa ou precedente fora dos Nós de Ideia. NUNCA crie avisos editoriais inline ("[CONFERIR]", "[VERIFICAR]", "[ERRO PRESCRICIONAL...]"). Preserve intactos apenas colchetes originais de citações literais ("[...]", "[sic]") e o marcador "[DADO PESSOAL OCULTADO - LGPD]".'
        ];

        if (auditoriaAtiva) {
            linhas.push(
                '',
                '<auditoria_critica ativa="true">',
                `OBRIGATÓRIO — APÓS CONCLUIR A MINUTA LIMPA${possuiCheckpointSaida ? ' (E ANTES DO CHECKPOINT DE CONTINUIDADE)' : ''}:`,
                `Crie uma seção final isolada (após linha divisória ---) com o título exato: "${TITULO_SECAO_AUDITORIA}" (uso interno — não integrar ao acórdão).`,
                'Atue como revisor jurídico crítico independente, sempre citando o nº da Ideia (conforme a numeração acima), Id. e folha (fl.) quando aplicável:',
                '1. LASTRO FÁTICO — Distinga expressamente entre: (a) ponto "NÃO LOCALIZADO NOS RECORTES FORNECIDOS" (pode constar em páginas não recortadas) e (b) ponto "CONTRARIADO POR ELEMENTO FORNECIDO" (contradição direta com prova/peça presente no contexto);',
                '2. CONFLITOS ENTRE DIRETRIZES — Se detectou conflito entre nós ou entre nó (mesmo literal) e Veredito, reporte o conflito indicando o nº da Ideia afetada;',
                '3. VÍCIOS PROCESSUAIS, LIMITES DA LIDE E PRESCRIÇÃO — Alerte sobre matéria não arguida (extra/ultra/citra petita), cerceamento de defesa, nulidade, ausência de interesse recursal, inovação recursal, falta de dialeticidade, preclusão, inversão de polos, reformatio in pejus, prescrição bienal/quinquenal (ou ausência de dados contratuais suficientes para aferi-la) e erro material;',
                '4. NORMAS INVOCADAS FORA DOS NÓS — Liste eventuais artigos de lei autônomos ou súmulas/OJs de fonte normativa oficial anexa citados na minuta, indicando a origem ("lei seca autônoma" ou "fonte oficial anexa") e as primeiras 6 a 8 palavras do parágrafo onde aparecem (ex.: "Art. 818, II, da CLT [lei seca autônoma] — parágrafo iniciado por: \'Quanto ao ônus probatório...\'");'
            );

            if (vereditoDelegado) {
                linhas.push(
                    '5. JUSTIFICATIVA DO VEREDITO DELEGADO (OBRIGATÓRIO): Como o campo Veredito/Conclusão foi deixado em aberto, declare qual desfecho adotou e quais Nós de Ideia o fundamentaram.'
                );
            }

            linhas.push(
                'Se não houver anomalia, conflito, norma autônoma nem veredito delegado a justificar, escreva exatamente: "Nenhuma inconsistência material, processual ou prescricional detectada."',
                '</auditoria_critica>'
            );
        } else {
            linhas.push(
                '5. AUDITORIA DESATIVADA: utilize EXCLUSIVAMENTE as normas e julgados fornecidos nos Nós de Ideia; ficam vedadas citações normativas externas.',
                '<auditoria_critica ativa="false" />'
            );
        }

        linhas.push('</fechamento_editorial_e_controle>\n');
        return linhas.join('\n');
    }

    /**
     * Constrói o payload Markdown completo (Protocolo JN-5.0 — Montagem em 2 Fases).
     * @param {Object} topico Tópico ativo.
     * @param {Object} [opcoes] { modo: 'minuta'|'acervo', auditoria: boolean, incluirNomesImagens: boolean }
     */
    function _gerarMarkdown(topico, opcoes = {}) {
        const modoPrompt = opcoes.modo || 'minuta';
        const isAcervo = modoPrompt === 'acervo';
        const incluirNomesImagens = opcoes.incluirNomesImagens !== undefined ? opcoes.incluirNomesImagens : true;
        const auditoriaAtiva = isAcervo
            ? false
            : (opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva());

        const safeFormatTime = (sec) => window.AudioManager?.formatTime
            ? window.AudioManager.formatTime(sec)
            : `${Math.floor(sec / 60)}' ${Math.floor(sec % 60)}''`;

        // ══════════════════════════════════════════════════════════════════════
        // FASE A — COLETA & SERIALIZAÇÃO DOS BLOCOS INTERNOS (PASSAGEM ÚNICA)
        // ══════════════════════════════════════════════════════════════════════
        const anotacoes = Array.isArray(topico.anotacoes) ? topico.anotacoes : [];
        const mapaVisuais = _construirMapaVisualExport(anotacoes);
        const filaPreliminares = [];
        const filaVereditosLocais = [];
        const bufferGlobais = [];
        const bufferTeses = [];
        const bufferMatriz = [];

        // A.1 — Diretrizes Globais
        (topico.diretrizesGlobais || []).forEach(dir => {
            _rotearNoParaSecao(dir, 'Diretriz Global', filaPreliminares, filaVereditosLocais, bufferGlobais);
        });

        // A.2 — Diretrizes por Tese (ancoradas nos cartões reais)
        if (topico.diretrizesPorTese) {
            const tesesAncoradas = window.ThesisGuard
                ? ThesisGuard.mapearTesesAncoradas(topico)
                : new Set(
                    anotacoes
                        .filter(a => a && !_ehCheckpoint(a))
                        .map(a => (a.tese && a.tese.trim() !== '') ? a.tese.trim() : CHAVE_TESE_SEM_NOME)
                );

            for (const [nomeTese, diretrizes] of Object.entries(topico.diretrizesPorTese)) {
                const chaveNormalizada = nomeTese.trim() || CHAVE_TESE_SEM_NOME;
                if (!tesesAncoradas.has(chaveNormalizada)) continue;

                if (Array.isArray(diretrizes) && diretrizes.length > 0) {
                    const bufferNosTese = [];
                    diretrizes.forEach(dir => {
                        _rotearNoParaSecao(dir, `Tese: ${chaveNormalizada}`, filaPreliminares, filaVereditosLocais, bufferNosTese);
                    });

                    if (bufferNosTese.length > 0) {
                        bufferTeses.push(
                            `<tese_alvo>\n[NOME DA TESE]: ${_escapeXmlAttr(chaveNormalizada)}\n${bufferNosTese.join('\n')}\n</tese_alvo>\n`
                        );
                    }
                }
            }
        }

        // A.3 — Matriz Dialética e Provas (com numeração visual unificada)
        anotacoes.forEach((an, index) => {
            if (!an) return;

            if (an.tipo === 'checkpoint_saida') {
                const meta = an.metaHandoff;
                bufferMatriz.push(
                    `\n⛓️ PONTE DE CONTINUIDADE (SAÍDA) + COMANDO DE GERAÇÃO PARCIAL\n` +
                    `→ CONTINUA NO TÓPICO: "${meta.alvo}"\n` +
                    `→ COMANDO DE GERAÇÃO PARCIAL: ao redigir a minuta deste tópico, NÃO escreva conclusão, pedidos finais ou parágrafo de fecho; interrompa após a última seção do escopo (e após a seção "${TITULO_SECAO_AUDITORIA}", se ativa) e encerre por último com o bloco "CHECKPOINT DE CONTINUIDADE" contendo [ID] CHK-${meta.slug}-v${meta.versao}, [STATUS], [JÁ REDIGIDO], [PREMISSAS FIXADAS], [PENDÊNCIAS], [PONTO DE RETOMADA], [VEDAÇÕES].\n` +
                    `→ ORDEM DE LEITURA: processe este contexto integralmente e só então abra o contexto de "${meta.alvo}", tratando-o como capítulo continuado.\n`
                );
                return;
            } else if (an.tipo === 'checkpoint_entrada') {
                const meta = an.metaHandoff;
                bufferMatriz.push(
                    `\n⛓️ PONTE DE CONTINUIDADE (CHEGADA) + COMANDO DE RETOMADA\n` +
                    `← ORIGEM: continuação direta do tópico "${meta.origem}" via minuta parcial com checkpoint CHK-${meta.slug}-v${meta.versao}.\n` +
                    `← VEDAÇÃO: não re-provar nem reescrever itens de [JÁ REDIGIDO]/[PREMISSAS FIXADAS] do checkpoint; remeta-os como "conforme estabelecido no tópico recursal anterior".\n` +
                    `← WORKFLOW: antes de redigir, localizar o checkpoint CHK-${meta.slug}-v${meta.versao} e aplicar o [COMANDO DE CONTINUAÇÃO DE MINUTA — HANDOFF].\n`
                );
                return;
            }

            if (_ehCheckpoint(an)) return;

            const numVisual = mapaVisuais.get(index);
            const refCitacao = _formatarCitacaoOficial(an.pjeId, an.pagina);
            const tituloIdeia = window.ThesisGuard
                ? ThesisGuard.obterChaveTese(an)
                : ((an.tese && an.tese.trim() !== '') ? an.tese.trim() : CHAVE_TESE_SEM_NOME);
            const estatutoMestre = _obterEstatutoEpistemologico(an);

            const faseContexto = an.fase || an.documento || 'Não especificado';
            const poloContexto = an.polo || 'N/A';

            const cardLines = [
                '<analise_da_prova>',
                `[IDENTIFICADOR DA IDEIA]: ${numVisual}`,
                `[TESE VINCULADA]: ${_escapeXmlAttr(tituloIdeia)}`,
                `<contexto_processual>\nFase: ${faseContexto} | Polo: ${poloContexto} | Referência: ${refCitacao} | Estatuto: ${estatutoMestre}\n</contexto_processual>`,
                '',
                '<contexto_processual_nao_vinculante>'
            ];

            const docLabel = `**[ESTATUTO: ${estatutoMestre}] [${an.documento || 'Elemento'}] (${an.polo || 'Sem polo'}) ${refCitacao}:**`;

            if (an.tipo === 'texto') {
                const conteudoSeguro = _sanitizarContraInjecao(an.conteudo);
                const conteudoProcessado = _truncarTextoParaIA(conteudoSeguro);
                cardLines.push(`- ${docLabel} ${conteudoProcessado.replace(/\n/g, ' ')}`);
                if (an.comentario) {
                    cardLines.push(`  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}`);
                }
            } else if (an.tipo === 'imagem') {
                const imgRef = incluirNomesImagens
                    ? `(Nome: \`${_gerarNomeArquivoImagem(numVisual, null, an.pjeId, an.pagina)}\`)`
                    : `[Recorte visual — ${refCitacao}]`;
                cardLines.push(
                    `- ${docLabel}\n  [IMAGEM FORNECIDA]: ${imgRef}.\n  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Integrar à fundamentação conforme Nós de Ideia.'), '\n  ')}`
                );
            } else if (an.tipo === 'audio') {
                try {
                    const ad = JSON.parse(an.conteudo);
                    const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                    cardLines.push(`- ${docLabel} [OITIVA DE AUDIÊNCIA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).`);
                    if (an.comentario) cardLines.push(`  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}`);
                    if (ad.transcricao) cardLines.push(`  [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n  ')}"`);
                } catch (e) {
                    cardLines.push(`- ${docLabel} [ÁUDIO] Resumo: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Sem comentário.'), '\n  ')}`);
                }
            }

            if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                an.itensCorrelacionados.forEach((corr, corrIdx) => {
                    const numSub = corrIdx + 1;
                    const cRefCitacao = _formatarCitacaoOficial(corr.pjeId, corr.pagina);
                    const estatutoCorr = _obterEstatutoEpistemologico(corr);
                    const cDocLabel = `  [CONFRONTO PROBATÓRIO ${numSub} — ESTATUTO: ${estatutoCorr}]: [${corr.documento || 'Doc'}] (${corr.polo || 'Polo'}) ${cRefCitacao}:`;

                    if (corr.tipo === 'texto') {
                        const corrConteudoSeguro = _sanitizarContraInjecao(corr.conteudo || '');
                        const corrConteudoProcessado = _truncarTextoParaIA(corrConteudoSeguro);
                        cardLines.push(`${cDocLabel} ${_safeMD(corrConteudoProcessado, ' ')}`);
                        if (corr.comentario) {
                            cardLines.push(`    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}`);
                        }
                    } else if (corr.tipo === 'imagem') {
                        const cImgRef = incluirNomesImagens
                            ? `\`${_gerarNomeArquivoImagem(numVisual, numSub, corr.pjeId, corr.pagina)}\``
                            : `[Recorte visual — ${cRefCitacao}]`;
                        cardLines.push(
                            `${cDocLabel}\n    [IMAGEM ANEXA]: ${cImgRef}\n    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Analise a ligação técnica conforme os Nós de Ideia.'), '\n    ')}`
                        );
                    } else if (corr.tipo === 'audio') {
                        try {
                            const ad = JSON.parse(corr.conteudo);
                            const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                            cardLines.push(`${cDocLabel} [OITIVA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).`);
                            if (corr.comentario) cardLines.push(`    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}`);
                            if (ad.transcricao) cardLines.push(`    [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n    ')}"`);
                        } catch (e) {
                            cardLines.push(`${cDocLabel} [ÁUDIO] Contexto: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Ausente.'), '\n    ')}`);
                        }
                    }
                });
            }

            cardLines.push('</contexto_processual_nao_vinculante>');

            const bufferLocal = [];
            const refMestre = _montarRefContextoCard(an, numVisual);
            (an.subAnotacoes || []).forEach(sub => {
                _rotearNoParaSecao(sub, refMestre, filaPreliminares, filaVereditosLocais, bufferLocal);
            });

            if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                an.itensCorrelacionados.forEach((corr, corrIdx) => {
                    if (corr.subAnotacoes && corr.subAnotacoes.length > 0) {
                        const refCorr = _montarRefContextoCard(corr, numVisual, corrIdx);
                        corr.subAnotacoes.forEach(sub => {
                            _rotearNoParaSecao(sub, refCorr, filaPreliminares, filaVereditosLocais, bufferLocal);
                        });
                    }
                });
            }

            if (bufferLocal.length > 0) {
                cardLines.push('', '<diretrizes_vinculantes_do_assessor>', ...bufferLocal, '</diretrizes_vinculantes_do_assessor>');
            }

            cardLines.push('</analise_da_prova>\n');
            bufferMatriz.push(cardLines.join('\n'));
        });

        // ══════════════════════════════════════════════════════════════════════
        // FASE B — CONCATENAÇÃO ORDENADA DO DOCUMENTO FINAL (TOP-DOWN)
        // ══════════════════════════════════════════════════════════════════════
        const partesDoc = [];

        partesDoc.push(
            `<!-- [ESQUEMA ${SCHEMA_EXPORT_VERSAO} — PROTOCOLO EDITORIAL POR REGIMES] -->\n` +
            `# TÓPICO RECURSAL: **${(topico.nome || 'Tópico Sem Nome').toUpperCase()}**\n`
        );

        if (!isAcervo) {
            partesDoc.push(gerarLegendaRegimesRedacionais({ modo: 'completo', auditoria: auditoriaAtiva }));

            const contexto = _inferirContextoProcessual(anotacoes);
            if (contexto.isExecucao) {
                partesDoc.push(
                    `<diretriz_cognitiva_ia>\n*ALERTA:* O conjunto probatório deste tópico refere-se à **FASE DE EXECUÇÃO** (ex: Agravo de Petição). Seu raciocínio jurídico DEVE ser restrito aos limites da coisa julgada, cálculos de liquidação e preclusão. Atos de "Juízo / Tribunal" ou "Auxiliar da Justiça" representam atos oficiais e possuem presunção de veracidade.\n</diretriz_cognitiva_ia>\n`
                );
            } else if (contexto.isAI) {
                partesDoc.push(
                    `<diretriz_cognitiva_ia>\n*ALERTA:* O foco deste tópico é um **Agravo de Instrumento**. Sua redação deve focar primariamente em destrancar ou manter o trancamento do recurso principal, avaliando estritamente pressupostos de admissibilidade.\n</diretriz_cognitiva_ia>\n`
                );
            } else {
                partesDoc.push(
                    `<diretriz_cognitiva_ia>\n*CONTEXTO PROCEDIMENTAL:* O foco deste tópico é a **Fase de Conhecimento** (ex: Recurso Ordinário). Analise o mérito da controvérsia confrontando o contexto processual das partes e da sentença conforme os regimes editoriais dos Nós de Ideia.\n</diretriz_cognitiva_ia>\n`
                );
            }

            const dadosContrato = window.ContratoManager ? window.ContratoManager.getDados() : null;
            if (dadosContrato && (dadosContrato.inicio || dadosContrato.fim)) {
                const formatarData = (d) => d ? d.split('-').reverse().join('/') : 'Não informado';
                const instrucaoPrescricaoContrato = auditoriaAtiva
                    ? `Use estes marcos objetivos para aferir prescrição bienal (2 anos do término) e quinquenal (5 anos retroativos do ajuizamento, somente se a data de ajuizamento foi informada). JAMAIS insira tags ou avisos prescricionais no corpo da minuta; se faltar a data de ajuizamento ou houver erro prescricional evidente, registre o alerta EXCLUSIVAMENTE na seção final "${TITULO_SECAO_AUDITORIA}".`
                    : 'Referência fática objetiva do vínculo contratual (subordinada aos Nós de Ideia). Não insira avisos editoriais ou marcadores prescricionais no corpo da minuta.';

                const contratoLinhas = [
                    '<parametros_contratuais>',
                    '[MARCO PRESCRICIONAL DO CONTRATO DE TRABALHO]:',
                    'O Assessor definiu os seguintes parâmetros incontroversos de vínculo:',
                    `- Início do contrato: ${formatarData(dadosContrato.inicio)}`,
                    `- Término do contrato: ${formatarData(dadosContrato.fim)}`,
                    `- Data de ajuizamento da ação: ${formatarData(dadosContrato.ajuizamento)}`,
                    `- Função(ões): ${_safeMD(dadosContrato.funcao || 'Não informada', ' ')}`,
                    '',
                    `INSTRUÇÃO: ${instrucaoPrescricaoContrato}`,
                    '</parametros_contratuais>\n'
                ];

                partesDoc.push(contratoLinhas.join('\n'));
            }

            partesDoc.push(_compilarPreambuloCondicional(topico, filaVereditosLocais));
        } else {
            const preambuloAcervo = _compilarPreambuloAcervo(topico, filaVereditosLocais);
            if (preambuloAcervo) partesDoc.push(preambuloAcervo);
        }

        const blocoPreliminares = _compilarBlocoPreliminares(filaPreliminares);
        if (blocoPreliminares) partesDoc.push(blocoPreliminares);

        if (bufferGlobais.length > 0) {
            partesDoc.push(
                [
                    '<diretrizes_globais_do_topico>',
                    'Diretrizes globais do gabinete aplicáveis a todo o tópico (aplique o regime de cada nó):',
                    '',
                    ...bufferGlobais,
                    '</diretrizes_globais_do_topico>\n'
                ].join('\n')
            );
        }

        if (bufferTeses.length > 0) {
            partesDoc.push(
                `<direcionamentos_por_tese>\nDiretrizes do gabinete aplicáveis à tese correspondente (aplique o regime de cada nó):\n\n${bufferTeses.join('\n')}</direcionamentos_por_tese>\n`
            );
        }

        partesDoc.push(
            `<matriz_dialetica_e_provas>\n${bufferMatriz.join('\n')}</matriz_dialetica_e_provas>\n`
        );

        return partesDoc.join('\n');
    }

    // ─── DOWNLOAD DE ARQUIVO MARKDOWN ─────────────────────────────────────────

    function _downloadArquivo(nomeArquivo, conteudo, mimeType = 'text/markdown;charset=utf-8;') {
        const blob = new Blob([conteudo], { type: mimeType });
        const link = document.createElement('a');
        const url  = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', nomeArquivo);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // ─── FUNÇÃO PÚBLICA PRINCIPAL ─────────────────────────────────────────────

    /**
     * Exporta o tópico ativo como pacote completo:
     *   1. Markdown estruturado (.md) — o "Roteiro do Diretor"
     *   2. Imagens referenciadas (.png) — baixadas em fila sequencial segura
     */
    function exportarTopicoAtivo() {
        const activeId = _deps.getActiveTabId();
        if (!activeId) {
            _deps.exibirToast('Selecione um tópico antes de exportar.', 'aviso');
            return;
        }

        const topico = _deps.getTopicos().find(t => t.id === activeId);
        if (!topico || topico.anotacoes.length === 0) {
            _deps.exibirToast('O tópico está vazio ou é inválido.', 'aviso');
            return;
        }

        // INJETAR O ALERTA AQUI: Dispara a notificação de tarefas em paralelo com a exportação
        if (window.TaskManager && typeof window.TaskManager.sinalizarTarefasPendentes === 'function') {
            window.TaskManager.sinalizarTarefasPendentes();
        }

        try {
            // ── Passo 1: Gerar e baixar o Markdown ──────────────────────────
            const markdownConteudo = _gerarMarkdown(topico) + gerarLembreteFinalHierarquia(topico);
            
            // Tratamento extra seguro para garantir que a propriedade nome exista
            const nomeBase = topico.nome || 'Exportacao_JurisNotes';
            
            const nomeSanitizado = nomeBase
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/gi, '_')
                .toLowerCase();

            // Leitura de estado baseada no DOM (Sem depender de variáveis de janela)
            const tagDom = document.getElementById('tag-numero-processo');
            const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
            const prefixoStr = numProcesso ? `${numProcesso}_` : '';

            // Baixa o arquivo com o número inserido (ex: 0541-68.2025_nome_topico.md)
            _downloadArquivo(`${prefixoStr}${nomeSanitizado}.md`, markdownConteudo);
            _deps.exibirToast('Pacote Markdown exportado! Preparando imagens...', 'sucesso');

            // ── Passo 2: Montar e executar a fila de imagens ──
            const filaDeDownloads = [];
            const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);

            topico.anotacoes.forEach((an, index) => {
                if (_ehCheckpoint(an)) return;
                const numVisual = mapaVisuais.get(index);

                if (an.tipo === 'imagem') {
                    filaDeDownloads.push({
                        dados: an.conteudo,
                        nome:  _gerarNomeArquivoImagem(numVisual, null, an.pjeId, an.pagina),
                    });
                }

                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        if (corr.tipo === 'imagem') {
                            filaDeDownloads.push({
                                dados: corr.conteudo,
                                nome:  _gerarNomeArquivoImagem(numVisual, corrIdx + 1, corr.pjeId, corr.pagina),
                            });
                        }
                    });
                }
            });

            _executarFilaDeDownloads(filaDeDownloads);

        } catch (error) {
            console.error('[ExportManager] Erro ao gerar exportação:', error);
            _deps.exibirToast('Erro ao gerar exportação. Verifique o console.', 'erro');
        }
    }

    // ─── API PÚBLICA ──────────────────────────────────────────────────────────

    /**
     * Retorna os dados do tópico ativo de forma segura para consumo da UI.
     * Atua como Single Source of Truth, mantendo a regra de negócio blindada.
     * @param {Object} [opcoes] { modo: 'minuta'|'acervo', auditoria: boolean, incluirNomesImagens: boolean, permitirSemAnotacoes: boolean }
     * @returns {{ nome: string, markdown: string } | null}
     */
    function obterDadosDoTopicoAtivo(opcoes = {}) {
        const activeId = _deps.getActiveTabId();
        if (!activeId) return null;

        const topicos = _deps.getTopicos();
        if (!topicos || !Array.isArray(topicos)) return null;

        const topico = topicos.find(t => t.id === activeId);
        if (!topico) return null;

        const temAnotacoes = Array.isArray(topico.anotacoes) && topico.anotacoes.length > 0;
        const temPreambuloOuGlobal = Boolean(
            topico.alegacoes ||
            topico.fundamentos ||
            topico.veredito ||
            (Array.isArray(topico.diretrizesGlobais) && topico.diretrizesGlobais.length > 0)
        );

        if (!temAnotacoes && !(opcoes.permitirSemAnotacoes && temPreambuloOuGlobal)) {
            return null;
        }

        return {
            nome: topico.nome || 'Tópico Sem Nome',
            markdown: _gerarMarkdown(topico, opcoes)
        };
    }

    // ─── HUB DE EXPORTAÇÃO RAG ──────────────────────────────────────────────
    let _documentosParaExtracaoCache = {};
    let _isExporting = false; // Trava de concorrência global da exportação

    function abrirPainelExportacao() {
        const activeId = _deps.getActiveTabId();
        if (!activeId) {
            _deps.exibirToast('Selecione um tópico antes de exportar.', 'aviso');
            return;
        }

        const topico = _deps.getTopicos().find(t => t.id === activeId);
        if (!topico || topico.anotacoes.length === 0) {
            _deps.exibirToast('O tópico está vazio ou inválido.', 'aviso');
            return;
        }

        const container = document.getElementById('export-options-container');
        _documentosParaExtracaoCache = {};

        const htmlBuffer = [];

        htmlBuffer.push(`
            <label class="export-option-card matriz-destaque-ro">
                <input type="checkbox" id="checkbox-matriz-export" class="export-control-checkbox" checked>
                <div class="export-option-details">
                    <span class="export-option-title">Matriz Probatória (Juris Notes) + Imagens Anexas</span>
                    <span class="export-option-subtitle">Teses, diretrizes e o download das provas visuais demarcadas.</span>
                </div>
            </label>
        `);

        if (topico.marcosExtracao && topico.marcosExtracao.length > 0) {
            const agrupados = topico.marcosExtracao.reduce((acc, curr) => {
                if(!acc[curr.docTipo]) acc[curr.docTipo] = {};
                acc[curr.docTipo][curr.fronteira] = curr;
                return acc;
            }, {});

            const docNomes = {
                sentenca: "Sentença / Decisão", 
                agravo_peticao_exequente: "Agravo de Petição (Exequente)",
                agravo_peticao_executada: "Agravo de Petição (Executada)",
                agravo_peticao_terceiro: "Agravo de Petição (Terceiro)",
                contraminuta_agravo: "Contraminuta (ao Agravo)",
                recurso_autora: "Recurso (Autora)", 
                recurso_re: "Recurso (Ré)",
                contrarrazões_autora: "Contrarrazões (Autora)", 
                contrarrazões_re: "Contrarrazões (Ré)",
                inicial: "Petição Inicial", 
                contestacao: "Contestação"
            };

            const svgPin = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;

            for (const [docTipo, limites] of Object.entries(agrupados)) {
                const hasInicio = !!limites.inicio;
                const hasFim = !!limites.fim;
                const isCompleto = hasInicio && hasFim;
                
                // Só salva no cache de extração se estiver completo
                if (isCompleto) _documentosParaExtracaoCache[docTipo] = limites;
                
                const nomeF = docNomes[docTipo] || docTipo.toUpperCase();
                
                const regras = _carregarRegrasFiltro();
                const hasRegra = !!regras[docTipo];
                
                const svgEraser = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
                const btnBorracha = `<button type="button" class="pin-eraser-btn trigger-borracha ${hasRegra ? 'is-active' : ''}" data-doc-tipo="${docTipo}" data-doc-nome="${_escapeXmlAttr(nomeF)}" title="Borracha Mágica">${svgEraser}</button>`;
                
                // Renderização dos botões de ação isolados (com preventDefault para não engatilhar o checkbox)
                const btnInicio = hasInicio 
                    ? `<button type="button" class="pin-action-btn pin-start-active" onclick="event.preventDefault(); event.stopPropagation(); excluirMarcadorExtracao('${topico.id}', '${docTipo}', 'inicio');" title="Excluir Início (Fl. ${limites.inicio.pagina})">${svgPin}</button>`
                    : `<button type="button" class="pin-action-btn pin-missing" title="Falta Marcador de Início">${svgPin}</button>`;
                    
                const btnFim = hasFim 
                    ? `<button type="button" class="pin-action-btn pin-end-active" onclick="event.preventDefault(); event.stopPropagation(); excluirMarcadorExtracao('${topico.id}', '${docTipo}', 'fim');" title="Excluir Fim (Fl. ${limites.fim.pagina})">${svgPin}</button>`
                    : `<button type="button" class="pin-action-btn pin-missing" title="Falta Marcador de Fim">${svgPin}</button>`;

                const statusTexto = isCompleto 
                    ? `Conteúdo capturado entre as fls. ${limites.inicio.pagina} e ${limites.fim.pagina}.`
                    : `<span style="color:#c62828; font-weight:700;">⚠️ Extração bloqueada: Faltam marcadores.</span>`;

                htmlBuffer.push(`
                    <label class="export-option-card ${!isCompleto ? 'locked-option' : ''}">
                        <input type="checkbox" value="${docTipo}" class="extra-doc-checkbox export-control-checkbox" ${isCompleto ? 'checked' : 'disabled'}>
                        <div class="export-option-details">
                            <span class="export-option-title">Teor Integral: ${nomeF}</span>
                            <span class="export-option-subtitle">${statusTexto}</span>
                        </div>
                        <div class="export-pin-controls">
                            ${btnBorracha}
                            ${btnInicio}
                            ${btnFim}
                        </div>
                    </label>
                `);
            }
        }

        // Injeção Única no DOM (Alta Performance)
        container.innerHTML = htmlBuffer.join('');
        _sincronizarHubExportacaoAoAbrir();

        document.getElementById('export-avancado-backdrop').style.display = 'block';
        document.getElementById('modal-exportacao-avancada').style.display = 'block';

        const btnExportar = document.getElementById('btn-gerar-arquivo-exportacao');
        if (btnExportar) {
            btnExportar.disabled = false;
            btnExportar.style.opacity = '1';
            btnExportar.style.cursor = 'pointer';
        }
    }

    function _sincronizarHubExportacaoAoAbrir() {
        const chkExport = document.getElementById('chk-export-auditoria-critica');
        if (chkExport) chkExport.checked = isAuditoriaCriticaAtiva();

        const container = document.getElementById('export-options-container');
        if (container && container.dataset.exportEventsBound !== 'true') {
            container.addEventListener('click', function(e) {
                const btnBorrachaTarget = e.target.closest('.trigger-borracha');
                if (btnBorrachaTarget) {
                    e.preventDefault();
                    const docTipo = btnBorrachaTarget.getAttribute('data-doc-tipo');
                    const docNome = btnBorrachaTarget.getAttribute('data-doc-nome');
                    abrirModalFiltro(docTipo, docNome);
                }
            });

            container.addEventListener('change', function(e) {
                if (e.target && e.target.classList.contains('export-control-checkbox')) {
                    const btnExportar = document.getElementById('btn-gerar-arquivo-exportacao');
                    if (!btnExportar) return;
                    const totalChecked = container.querySelectorAll('.export-control-checkbox:checked').length;
                    if (totalChecked === 0) {
                        btnExportar.disabled = true;
                        btnExportar.style.opacity = '0.4';
                        btnExportar.style.cursor = 'not-allowed';
                    } else {
                        btnExportar.disabled = false;
                        btnExportar.style.opacity = '1';
                        btnExportar.style.cursor = 'pointer';
                    }
                }
            });

            container.dataset.exportEventsBound = 'true';
        }
    }

    function fecharPainelExportacao() {
        document.getElementById('export-avancado-backdrop').style.display = 'none';
        document.getElementById('modal-exportacao-avancada').style.display = 'none';
    }

    function abrirModalFiltro(docTipo, nomeDocAmigavel) {
        const regras = _carregarRegrasFiltro();
        document.getElementById('hidden-doc-tipo-filtro').value = docTipo;
        document.getElementById('label-doc-filtro').textContent = nomeDocAmigavel;
        document.getElementById('textarea-filtro-repeticao').value = regras[docTipo] || '';
        validarTamanhoFiltro();
        
        document.getElementById('filtro-repeticao-backdrop').style.display = 'block';
        document.getElementById('modal-filtro-repeticao').style.display = 'block';
    }

    function fecharModalFiltro() {
        document.getElementById('filtro-repeticao-backdrop').style.display = 'none';
        document.getElementById('modal-filtro-repeticao').style.display = 'none';
    }

    function validarTamanhoFiltro() {
        const texto = document.getElementById('textarea-filtro-repeticao').value.trim();
        const btnSalvar = document.getElementById('btn-salvar-filtro');
        const aviso = document.getElementById('aviso-tamanho-filtro');
        
        if (texto.length > 0 && texto.length < 30) {
            btnSalvar.disabled = true;
            btnSalvar.style.opacity = '0.5';
            aviso.style.display = 'block';
        } else {
            btnSalvar.disabled = false;
            btnSalvar.style.opacity = '1';
            aviso.style.display = 'none';
        }
    }

    function salvarFiltro() {
        const docTipo = document.getElementById('hidden-doc-tipo-filtro').value;
        const texto = document.getElementById('textarea-filtro-repeticao').value.trim();
        const regras = _carregarRegrasFiltro();
        
        if (texto.length >= 30) {
            regras[docTipo] = texto;
            _salvarRegrasFiltro();
            _deps.exibirToast('Regra de limpeza salva para esta peça!', 'sucesso');
        } else if (texto.length === 0) {
            delete regras[docTipo];
            _salvarRegrasFiltro();
            _deps.exibirToast('Regra desativada.', 'info');
        }
        
        fecharModalFiltro();
        abrirPainelExportacao();
    }

    function limparFiltro() {
        document.getElementById('textarea-filtro-repeticao').value = '';
        salvarFiltro();
    }

    async function gerarExportacaoPersonalizada() {
        if (_isExporting) {
            _deps.exibirToast('Uma exportação já está em andamento. Aguarde.', 'aviso');
            return;
        }
        
        _isExporting = true;
        const topicos = _deps.getTopicos();
        const topico = topicos.find(t => t.id === _deps.getActiveTabId());
        
        // UX: Fecha o modal IMEDIATAMENTE para liberar a tela para o usuário
        fecharPainelExportacao();
        
        // INJETAR O ALERTA AQUI: Após o modal fechar, garantindo visibilidade total
        if (window.TaskManager && typeof window.TaskManager.sinalizarTarefasPendentes === 'function') {
            window.TaskManager.sinalizarTarefasPendentes();
        }

        _deps.exibirToast('⏳ Iniciando extração de dados em segundo plano...', 'info');

        try {
            let conteudoFinal = "";
            const elMatriz = document.getElementById('checkbox-matriz-export');
            const incluirMatriz = elMatriz && elMatriz.checked;
            const elAuditHub = document.getElementById('chk-export-auditoria-critica');
            const auditoriaHub = elAuditHub ? elAuditHub.checked : isAuditoriaCriticaAtiva();
            const checkboxesDocsExtra = Array.from(document.querySelectorAll('.extra-doc-checkbox:checked'));

            // 1. Injeção de Contexto (Obrigatório para o LLM não se perder)
            if (incluirMatriz) {
                conteudoFinal += _gerarMarkdown(topico, { auditoria: auditoriaHub }) + "\n\n";
            } else {
                const nomeTopicoFormatado = (topico.nome || 'Tópico Sem Nome').toUpperCase();
                conteudoFinal += `# TÓPICO RECURSAL: **${nomeTopicoFormatado}**\n`;
                conteudoFinal += `[AVISO DE SISTEMA]: O usuário optou por não enviar a matriz probatória. Use os documentos integrais abaixo para análise.\n\n`;
            }

            // 2. Anexação dos Documentos Complementares
            if (checkboxesDocsExtra.length > 0) {
                conteudoFinal += "<!-- ==========================================\n";
                conteudoFinal += incluirMatriz 
                    ? "     DOCUMENTOS COMPLEMENTARES ANEXOS\n" 
                    : "     TEOR INTEGRAL DE PEÇAS E DOCUMENTOS\n";
                conteudoFinal += "     ========================================== -->\n\n";

                // Orquestração da fila de documentos
                for (let idx = 0; idx < checkboxesDocsExtra.length; idx++) {
                    const cb = checkboxesDocsExtra[idx];
                    const docTipo = cb.value;
                    const limites = _documentosParaExtracaoCache[docTipo];
                    const tagName = docTipo.toUpperCase();
                    
                    try {
                        const pInicio = Math.min(limites.inicio.pagina, limites.fim.pagina);
                        const pFim = Math.max(limites.inicio.pagina, limites.fim.pagina);
                        const amostrasMap = new Map();

                        const textoBruto = await window.PdfEngine.extrairTextoPorRegiao(
                            limites.inicio, 
                            limites.fim,
                            (atual, totalPagsDoc) => {
                                const docNumber = idx + 1;
                                _deps.exibirToast(`⏳ Processando Peça ${docNumber}/${checkboxesDocsExtra.length} (Pág ${atual} de ${totalPagsDoc})...`, 'info');
                            },
                            (pageNum, rawText) => {
                                if (pageNum === pInicio + 1 || pageNum === pInicio + 2 || pageNum === pFim - 1) {
                                    amostrasMap.set(pageNum, rawText);
                                }
                            }
                        );
                        
                        let textoLimpo = (window.JurisUtils && window.JurisUtils.limparTextoPDF) 
                            ? window.JurisUtils.limparTextoPDF(textoBruto) : textoBruto;

                        // SANITIZAÇÃO DELEGADA — fonte única, compartilhada com o Gerador de Contexto IA
                        textoLimpo = aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim);

                        conteudoFinal += enveloparTeorIntegral(docTipo, textoLimpo) + "\n\n";
                        
                    } catch (extraError) {
                        if (extraError.message && extraError.message.includes("CONCURRENCY_VIOLATION")) {
                            throw extraError; // Repassa erro fatal para cima abortando o processo
                        }
                        console.warn(`[ExportManager] Falha ao extrair ${docTipo}:`, extraError);
                        conteudoFinal += `<${tagName}>\n[AVISO DE SISTEMA: Falha na extração. Possível página corrompida.]\n</${tagName}>\n\n`;
                    }
                }
            }

            if (incluirMatriz) {
                conteudoFinal += gerarLembreteFinalHierarquia(topico, { auditoria: auditoriaHub });
            }

            // 3. Fila de Downloads Visuais (Restrita à Matriz)
            const filaDeDownloads = [];
            if (incluirMatriz) {
                const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);
                topico.anotacoes.forEach((an, index) => {
                    if (_ehCheckpoint(an)) return;
                    const numVisual = mapaVisuais.get(index);
                    if (an.tipo === 'imagem') filaDeDownloads.push({ dados: an.conteudo, nome: _gerarNomeArquivoImagem(numVisual, null, an.pjeId, an.pagina) });
                    if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                        an.itensCorrelacionados.forEach((corr, corrIdx) => {
                            if (corr.tipo === 'imagem') filaDeDownloads.push({ dados: corr.conteudo, nome: _gerarNomeArquivoImagem(numVisual, corrIdx + 1, corr.pjeId, corr.pagina) });
                        });
                    }
                });
            }

            // 4. Fechamento e Download Dinâmico
            const nomeBase = topico.nome || 'Exportacao_JurisNotes';
            const nomeSanitizado = nomeBase.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const tagDom = document.getElementById('tag-numero-processo');
            const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
            const prefixoStr = numProcesso ? `${numProcesso}_` : '';
            
            const sufixoArquivo = incluirMatriz ? "_CONTEXTO_RAG.txt" : "_TEOR_INTEGRAL.txt";

            _downloadArquivo(`${prefixoStr}${nomeSanitizado}${sufixoArquivo}`, conteudoFinal, 'text/plain;charset=utf-8;');
            
            if(filaDeDownloads.length > 0) {
                _deps.exibirToast('Texto exportado. Iniciando imagens...', 'info');
                _executarFilaDeDownloads(filaDeDownloads);
            } else {
                _deps.exibirToast('✅ Arquivo gerado com sucesso!', 'sucesso');
            }

        } catch (error) {
            console.error('[ExportManager] Erro fatal na exportação:', error);
            if (error.message && error.message.includes("CONCURRENCY_VIOLATION")) {
                _deps.exibirToast('Exportação abortada: O documento PDF foi alterado.', 'erro');
            } else {
                _deps.exibirToast('Erro crítico ao gerar arquivo. Verifique o console.', 'erro');
            }
        } finally {
            // LIBERA A TRAVA EM QUALQUER CENÁRIO
            _isExporting = false;
        }
    }

    /**
     * Aplica as duas camadas de sanitização (LGPD) sobre um texto extraído do PDF:
     *   1. Automática — remove ruído estrutural repetido entre páginas (cabeçalhos/rodapés),
     *      detectado por comparação de amostras (descobrirRuidosEstruturais).
     *   2. Manual — aplica a regra fuzzy cadastrada pelo usuário na Borracha Mágica.
     *
     * Esta é a ÚNICA implementação dessa regra de negócio no sistema. Tanto a exportação
     * em TXT quanto o Gerador de Contexto para IA devem chamar esta função — nunca replicar
     * a lógica localmente — garantindo paridade absoluta entre os dois fluxos.
     *
     * @param {string} textoLimpo Texto já normalizado por JurisUtils.limparTextoPDF.
     * @param {string} docTipo Identificador do documento (ex: 'sentenca', 'recurso_autora').
     * @param {Map<number,string>|null} amostrasMap Amostras de páginas cruas, coletadas via
     *        o callback onPageRawText de PdfEngine.extrairTextoPorRegiao. Pode ser null/vazio
     *        se o chamador não tiver capturado amostras (a camada automática é então ignorada).
     * @param {number} pInicio Número da primeira página do documento.
     * @param {number} pFim Número da última página do documento.
     * @returns {string} Texto sanitizado.
     */
    function aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim) {
        let textoProcessado = textoLimpo;

        // 1. CAMADA AUTOMÁTICA (Ruído Estrutural)
        if (window.JurisUtils && window.JurisUtils.descobrirRuidosEstruturais && amostrasMap && amostrasMap.size > 0) {
            let textoA = amostrasMap.get(pInicio + 1) || "";
            let textoB = amostrasMap.get(pInicio + 2) || amostrasMap.get(pFim - 1) || "";

            if (textoA && textoB) {
                textoA = window.JurisUtils.limparTextoPDF(textoA);
                textoB = window.JurisUtils.limparTextoPDF(textoB);
                const esqueletosAutonomos = window.JurisUtils.descobrirRuidosEstruturais(textoA, textoB);

                esqueletosAutonomos.forEach(esqueleto => {
                    textoProcessado = window.JurisUtils.removerTrechoFuzzy(textoProcessado, esqueleto, MARCADOR_RUIDOS, true);
                });
            }
        }

        // 2. CAMADA MANUAL (Regras da Borracha Mágica — LGPD)
        const regras = _carregarRegrasFiltro();
        if (regras[docTipo] && window.JurisUtils && window.JurisUtils.removerTrechoFuzzy) {
            textoProcessado = window.JurisUtils.removerTrechoFuzzy(textoProcessado, regras[docTipo], MARCADOR_OFICIAL_LGPD, false);
        }

        // 3. CAMADA DE TERMOS CURTOS (LGPD) — Consome a função pura sem acoplamento com o DOM do modal
        if (window.QuickRedactManager && typeof window.QuickRedactManager.sanitizarString === 'function') {
            textoProcessado = window.QuickRedactManager.sanitizarString(textoProcessado);
        }

        return textoProcessado;
    }

    /**
     * Helper Privado: Fallback de clipboard robusto (Anti-HTTP/Localhost)
     */
    async function _copiarParaAreaDeTransferencia(texto) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(texto);
                return true;
            } else {
                throw new Error("Clipboard API indisponível ou contexto inseguro");
            }
        } catch (err) {
            // Fallback síncrono para navegadores legados ou ambientes sem HTTPS (file://)
            const textArea = document.createElement("textarea");
            textArea.value = texto;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                textArea.remove();
                return true;
            } catch (fallbackErr) {
                textArea.remove();
                return false;
            }
        }
    }

    /**
     * NOVA FUNCIONALIDADE: Orquestra a geração do Prompt Mestre com Contexto
     */
    async function gerarPromptMestre() {
        const btn = document.getElementById('btn-gerar-prompt-mestre');
        const ideiaInput = document.getElementById('ctx-ideia-bruta');
        
        // Guardrail de Concorrência (Evita duplo clique e race conditions)
        if (btn) { btn.disabled = true; }

        try {
            let ideiaBruta = ideiaInput ? ideiaInput.value.trim() : '';

            if (!ideiaBruta) {
                _deps.exibirToast('Por favor, digite sua ideia ou raciocínio bruto primeiro.', 'aviso');
                return;
            }

            // Sanitização de Prompt Injection (Protege o LLM de jailbreak)
            ideiaBruta = _sanitizarContraInjecao(ideiaBruta);

            _deps.exibirToast('Montando arquitetura do prompt...', 'info');

            // Usa a Single Source of Truth no modo 'acervo' (desativa protocolo de auditoria de minuta)
            const dadosTopico = obterDadosDoTopicoAtivo({ modo: 'acervo', auditoria: false });
            let contextoEstruturado = "";
            
            if (dadosTopico && dadosTopico.markdown) {
                contextoEstruturado = dadosTopico.markdown;
            } else {
                contextoEstruturado = "[AVISO DE SISTEMA: A matriz probatória está vazia no momento. Gere a diretriz usando variáveis genéricas baseadas apenas na SITUAÇÃO FÁTICA.]";
            }

            // Guardrail de Limite de Tokens (Avisa, mas não bloqueia a ação do usuário)
            const limiteCaracteresAviso = 35000;
            if (contextoEstruturado.length > limiteCaracteresAviso) {
                _deps.exibirToast('Aviso: O processo é muito extenso. A IA pode truncar a resposta final.', 'aviso');
            }

            const promptFinal = `# PERSONA E CONTEXTO DE SISTEMA\nAtue como um Arquiteto de Conhecimento Jurídico especialista na plataforma "Juris Notes". Minha rotina consiste em analisar processos judiciais e salvar "Modelos de Diretrizes" no Acervo. Fornecerei a você uma [SITUAÇÃO FÁTICA/IDEIA DO ASSESSOR] e o [CONTEXTO ATUAL DO SISTEMA] em formato XML. \n\nSua missão é gerar uma Diretriz Estruturada cruzando a minha ideia com a matriz probatória do sistema.\n\n# INSTRUÇÕES DE LEITURA DO CONTEXTO\n- Leia atentamente as tags <matriz_dialetica_e_provas>, <analise_da_prova>, <contexto_processual> e <contexto_processual_nao_vinculante> fornecidas abaixo.\n- Utilize a nomenclatura exata das partes e provas encontradas nas tags para dar precisão máxima à sua resposta.\n\n# REGRAS DO SISTEMA (Classificação Obrigatória)\n1. ESCOPOS POSSÍVEIS (Escolha um):\n- GLOBAL: Afeta todo o texto.\n- TESE: Regras para um grupo temático.\n- PROVA: Comando pontual sobre prova específica.\n\n2. INTENÇÕES POSSÍVEIS (Escolha uma):\nCOMANDO DIRETO, PREMISSA LÓGICA, REFUTAÇÃO, FUNDAMENTAÇÃO, PRELIMINAR / PREJUDICIAL, VEREDITO, TEXTO FIXO.\n\n# REGRAS DE REDAÇÃO\n- Redação concisa, enxuta e cirúrgica.\n- Use **negrito** (formatação \`**palavra**\`) APENAS para destacar o núcleo lógico da ideia.\n- Para informações variáveis, crie Fantasmas de Preenchimento: [NOME_DA_TESTEMUNHA].\n\n# FORMATO DE SAÍDA OBRIGATÓRIO (Exclusivo)\n**TÍTULO DO MODELO:** [Tema - Subtema - Especificidade]\n**TAGS:** [Exatamente 3 palavras-chave]\n**ESCOPO IDEAL:** [Sua escolha]\n**INTENÇÃO SUGERIDA:** [Sua escolha]\n**CONTEÚDO DA DIRETRIZ:** [Seu texto estruturado final]\n\n---\n### [SITUAÇÃO FÁTICA / IDEIA DO ASSESSOR]\n${ideiaBruta}\n\n### [CONTEXTO ATUAL DO SISTEMA]\n${contextoEstruturado}`;

            // Execução assíncrona da cópia com Fallback
            const copiadoComSucesso = await _copiarParaAreaDeTransferencia(promptFinal);
            
            if (copiadoComSucesso) {
                _deps.exibirToast('✅ Prompt Mestre copiado! Cole no seu LLM.', 'sucesso');
                if (ideiaInput) ideiaInput.value = ''; // Limpeza de UX
            } else {
                _deps.exibirToast('Erro ao acessar a área de transferência. Tente novamente.', 'erro');
            }
        } catch (error) {
            console.error('[ExportManager] Erro ao gerar Prompt Mestre:', error);
            _deps.exibirToast('Erro crítico ao montar o prompt.', 'erro');
        } finally {
            // Libera o botão em qualquer cenário (sucesso ou falha)
            if (btn) { btn.disabled = false; }
        }
    }

    function copiarChaveHandoff() {
        const activeId = _deps.getActiveTabId();
        const topico = _deps.getTopicos().find(t => t.id === activeId);
        
        if (!topico || !topico.volumeData || !topico.volumeData.chkId) {
            _deps.exibirToast('A aba atual não é um Volume de Continuação.', 'aviso');
            return;
        }
        
        const chave = `[COMANDO DE CONTINUAÇÃO DE MINUTA — HANDOFF]\nVocê receberá, nesta ordem: (1) o checkpoint ${topico.volumeData.chkId} da minuta parcial; (2) o CONTEXTO RAG do tópico "${topico.nome}".\nPassos obrigatórios: 1. MANIFESTO: diga onde parou e escopo. AGUARDE aprovação. 2. CHECAGEM: se o ID não for ${topico.volumeData.chkId}, PARE. 3. CONTINUAÇÃO: redija SOMENTE o trecho continuado, sem reescrever o já redigido.`;
        
        navigator.clipboard.writeText(chave).then(() => {
            _deps.exibirToast('Chave de Handoff copiada! Cole na IA antes do Export.', 'sucesso');
        }).catch(err => {
            _deps.exibirToast('Erro ao copiar a Chave.', 'erro');
        });
    }

    return { 
        init, 
        exportarTopicoAtivo, 
        obterDadosDoTopicoAtivo, 
        abrirPainelExportacao, 
        fecharPainelExportacao, 
        gerarExportacaoPersonalizada,
        abrirModalFiltro,
        fecharModalFiltro,
        validarTamanhoFiltro,
        salvarFiltro,
        limparFiltro,
        aplicarFiltrosAvancados,
        gerarPromptMestre,
        copiarChaveHandoff,
        CHAVE_TESE_SEM_NOME,
        REGIME_INTENCOES,
        TITULO_SECAO_AUDITORIA,
        gerarLegendaRegimesRedacionais,
        formatarNoEditorialMarkdown,
        verificarAncorasLiteraisNoRascunho,
        enveloparTeorIntegral,
        gerarLembreteFinalHierarquia,
        isAuditoriaCriticaAtiva,
        setAuditoriaCriticaAtiva
    };

})();
