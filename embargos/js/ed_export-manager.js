/**
 * ============================================================================
 * ed_export-manager.js — v6.0 Core Architect (Refatorado)
 * Módulo Orquestrador de Payload Estruturado para Modelos de Linguagem (LLM)
 * ============================================================================
 */
window.ExportManager = (function () {
    'use strict';

    // Armazém local para as dependências injetadas pelo orquestrador (app-core)
    let _deps = {
        getTopicos: () => [],
        exibirToast: () => {},
        getActiveTabId: () => null
    };

    // SINGLE SOURCE OF TRUTH — marcadores de sanitização (LGPD)
    const MARCADOR_OFICIAL_LGPD = '\n\n[AVISO DE SISTEMA: Dados sensíveis (ex: endereços) ou estruturais (cabeçalhos) foram ocultados pela Borracha Mágica para adequação à LGPD.]\n\n';
    const MARCADOR_RUIDOS = '\n\n[AVISO DE SISTEMA: Dados estruturais ocultados.]\n\n';

    const SCHEMA_EXPORT_VERSAO = 'JN-ED-5.0';
    const TITULO_SECAO_AUDITORIA = '### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]';
    const CHAVE_TESE_SEM_NOME = 'Tese Não Nomeada';
    const STORAGE_KEY_AUDITORIA = 'juris_ed_auditoria_critica_ia';
    let _docConfigMapCache = null;

    /**
     * Fonte Única de Verdade (SSOT) dos regimes editoriais dos Nós de Ideia (Painel ED).
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
            console.warn('[ExportManager ED] Falha ao persistir preferência de auditoria:', e);
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
            if (docUpper.includes('EMBARGOS') || docUpper.includes('RECURSO') || docUpper.includes('AGRAVO')) natureza = 'alegacao_recurso';
            else if (docUpper.includes('CONTRAMINUTA') || docUpper.includes('CONTRARRAZ')) natureza = 'alegacao_contrarrazoes';
            else if (docUpper.includes('INICIAL') || docUpper.includes('CONTESTA') || docUpper.includes('IMPUGNA') || docUpper.includes('MANIFESTA')) natureza = 'alegacao_postulatoria';
            else if (docUpper.includes('SENTENÇA') || docUpper.includes('ACÓRDÃO')) natureza = 'decisao_recorrida';
            else if (docUpper.includes('LAUDO') || docUpper.includes('AUDIÊNCIA') || docUpper.includes('ATA') || item.tipo === 'audio') natureza = 'prova_autos';
            else if (poloUpper.includes('JUÍZO') || poloUpper.includes('TRIBUNAL') || poloUpper.includes('AUXILIAR')) natureza = 'ato_judicial_oficial';
            else natureza = 'alegacao_postulatoria';
        }

        const mapaCodigos = {
            'alegacao_recurso': 'ALEGACAO_EMBARGOS_OU_RECURSO',
            'alegacao_contrarrazoes': 'CONTRAMINUTA_OU_CONTRARRAZOES',
            'alegacao_postulatoria': 'LIMITES_DA_LIDE_ALEGACAO',
            'decisao_recorrida': 'DECISAO_EMBARGADA_OU_ORIGEM',
            'ato_judicial_oficial': 'ATO_JUDICIAL_OFICIAL',
            'prova_autos': 'ELEMENTO_PROBATORIO_BRUTO'
        };

        return mapaCodigos[natureza] || 'LIMITES_DA_LIDE_ALEGACAO';
    }

    function enveloparTeorIntegral(docTipo, textoLimpo, polo = null) {
        if (!textoLimpo) return '';
        const strTexto = String(textoLimpo).trim();

        if (strTexto.includes('estatuto_epistemologico=')) {
            const regexBlocoEnvelopado = /<([A-ZÀ-ÖØ-Ý0-9_]+)(?:\s+polo="[^"]*")?\s+estatuto_epistemologico="[^"]+">[\s\S]*?<\/\1>/gi;
            let ultimoIndice = 0;
            let resultado = '';
            let match;

            while ((match = regexBlocoEnvelopado.exec(strTexto)) !== null) {
                const trechoLivreAntes = strTexto.slice(ultimoIndice, match.index).trim();
                if (trechoLivreAntes) {
                    resultado += enveloparTeorIntegral(docTipo, trechoLivreAntes, polo) + '\n\n';
                }
                resultado += match[0] + '\n\n';
                ultimoIndice = regexBlocoEnvelopado.lastIndex;
            }

            const trechoLivreDepois = strTexto.slice(ultimoIndice).trim();
            if (trechoLivreDepois) {
                resultado += enveloparTeorIntegral(docTipo, trechoLivreDepois, polo);
            }
            return resultado.trim();
        }

        const tag = String(docTipo || 'DOCUMENTO').toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý0-9_]/gi, '_');
        const textoSeguro = _sanitizarContraInjecao(strTexto);
        const attrPolo = (polo && polo !== 'Comum') ? ` polo="${_escapeXmlAttr(String(polo).replace(/\s+/g, '_'))}"` : '';

        const tokens = new Set(
            tag.normalize('NFD')
               .replace(/[\u0300-\u036f]/g, '')
               .split('_')
               .filter(Boolean)
        );
        const temAlgumToken = (...lista) => lista.some(t => tokens.has(t));

        let estatuto = 'PECA_OU_DOCUMENTO_COMPLEMENTAR_NAO_VINCULANTE';
        let diretrizLeitura = 'Peça ou documento complementar extraído dos autos. Subordine sua leitura e valoração estritamente às diretrizes dos Nós de Ideia.';

        if (temAlgumToken('DECISAO', 'SENTENCA', 'ACORDAO')) {
            estatuto = 'DECISAO_EMBARGADA_OU_ORIGEM';
            diretrizLeitura = 'Inteiro teor da decisão judicial. Use para auditar o vício alegado e aferir premissas da decisão embargada. Prevalece apenas no que for mantido pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia revoga e substitui o entendimento.';
        } else if (temAlgumToken('EMBARGOS', 'CONTRAMINUTA', 'RECURSO', 'RO', 'AGRAVO', 'AP', 'CONTRARRAZOES', 'INICIAL', 'CONTESTACAO', 'IMPUGNACAO', 'MANIFESTACAO', 'RAZOES')) {
            estatuto = 'ALEGACAO_DE_PARTE_NAO_VINCULANTE';
            diretrizLeitura = 'Inteiro teor de peça processual unilateral de parte. NÃO é verdade fática nem prova do vício. Use APENAS para aferir os limites dos embargos/lide e eventuais óbices (intempestividade/inovação). A citação de norma ou julgado pela parte não é motivo para adotá-lo.';
        } else if (temAlgumToken('LAUDO', 'PERICIA', 'PERICIAL', 'AUDIENCIA', 'ATA', 'OITIVA', 'DEPOIMENTO', 'PROVA')) {
            estatuto = 'ELEMENTO_PROBATORIO_BRUTO';
            diretrizLeitura = 'Inteiro teor de elemento probatório/pericial dos autos. Em Embargos de Declaração é proibido reexaminar o mérito fático; use apenas conforme estritamente delimitado nos Nós de Ideia.';
        } else if (temAlgumToken('ATOS', 'SECRETARIA', 'CERTIDAO', 'CERTIDOES')) {
            estatuto = 'ATO_JUDICIAL_OFICIAL';
            diretrizLeitura = 'Certidão ou ato oficial da secretaria/juízo (ex: aferição de tempestividade ou erro material). Interprete segundo os Nós de Ideia.';
        }

        return `<${tag}${attrPolo} estatuto_epistemologico="${estatuto}">\n[DIRETRIZ DE LEITURA CONTIDA]: ${diretrizLeitura}\n\n${textoSeguro}\n\n[FIM DE ${tag} — RETORNE À SOBERANIA DOS NÓS DE IDEIA]\n</${tag}>`;
    }

    /**
     * Detector resiliente de checkpoint: usa JurisIndexUtils.ehCheckpoint quando disponível
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
     * Constrói o mapa índice físico -> número visual da Evidência/Ideia (idêntico à tela e ao PDF),
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
     * Gera a legenda única de regimes editoriais calibrada para Embargos de Declaração (JN-ED-5.0).
     * @param {Object} [opts] - { modo: 'completo' | 'somente_nos', auditoria?: boolean }
     */
    function gerarLegendaRegimesRedacionais(opts = {}) {
        const modo = opts.modo || 'completo';
        const isCompleto = modo === 'completo';
        const auditoriaAtiva = typeof opts.auditoria === 'boolean'
            ? opts.auditoria
            : isAuditoriaCriticaAtiva();

        const linhas = [
            `<protocolo_editorial_minuta versao="${SCHEMA_EXPORT_VERSAO}" incidente="embargos_de_declaracao">`,
            'Você atuará na redação de minuta de decisão/acórdão de Embargos de Declaração trabalhistas (auditoria estrita de higidez formal: omissão, contradição, obscuridade, erro material, manifesto equívoco ou pré-questionamento), refletindo exclusivamente o convencimento do Relator/Magistrado. É VEDADO reexaminar provas de mérito fático ou promover o rejulgamento da causa sob pretexto de vício.',
            '',
            'LEGENDA DE REGIMES DOS NÓS DE IDEIA (aplique conforme a tag [REGIME: ...] de cada item):',
            '- [REGIME: LITERAL] (Texto Fixo): reproduza a redação exatamente como escrita, sem parafrasear.',
            '- [REGIME: LITERAL_MOVEL] (Jurisprudência Exata / Degravação Curada): preserve integralmente o teor literal citado, mas tenha liberdade para ordenar sua posição e redigir parágrafos/frases de transição.',
            '- [REGIME: ORDEM] (Comando Direto): cumpra integralmente a instrução operacional na elaboração da minuta; NÃO transcreva o enunciado da ordem.',
            '- [REGIME: CONCLUSAO_VINCULANTE] (Veredito Parcial): adote obrigatoriamente este desfecho decisório na fundamentação e conclusão do ponto (acolhimento/rejeição, com ou sem efeito modificativo).',
            '- [REGIME: DESENVOLVER] (Premissa Lógica): NÃO copie literalmente. Use como constatação/ponto de partida e tom do Relator; desenvolva a análise formal do vício em linguagem fluida e clara de acórdão, insira conectores de coesão/coerência, ajuste frases e reordene pontos se melhorar a sequência lógica.',
            '- [REGIME: DESENVOLVER_REFUTAR] (Refutação): desenvolva livremente com coesão forense, cumprindo a função específica de afastar o vício alegado e demonstrar a higidez da decisão embargada.',
            '- [REGIME: DESENVOLVER_PREJUDICIAL] (Filtro / Prejudicial): desenvolva livremente e posicione a barreira de admissibilidade/prejudicial (ex.: intempestividade, inovação, preclusão) logicamente antes do exame do vício.',
            '- [REGIME: LASTRO] (Lei Seca): utilize como pano de fundo normativo integrado organicamente à fundamentação (evite transcrição mecânica integral do artigo se desnecessária).',
            '- [REGIME: CONTEXTO_VALIDADO]: fato/constatação processual já validada pelo assistente para integrar a auditoria do vício.',
            '',
            'BLINDAGEM ANTI-ALUCINAÇÃO E MINUTA LIMPA (OBRIGATÓRIO):',
            '- PROIBIDO inventar ou citar de memória qualquer ementa, número de precedente, súmula ou OJ fora dos Nós de Ideia.',
            '- PROIBIDO criar ou inserir avisos editoriais no corpo da minuta ("[CONFERIR]", "[VERIFICAR]", "[ERRO PRESCRICIONAL...]", "[DADO INSUFICIENTE...]"). Preserve intactos apenas colchetes originais de citações literais ("[...]", "[sic]") e o marcador "[DADO PESSOAL OCULTADO - LGPD]".',
            (isCompleto && auditoriaAtiva)
                ? '- Exceção controlada (sem avisos inline): admite-se referenciar (a) artigo basilar vigente (CLT/CPC/CF — ex.: art. 897-A da CLT, art. 1.022 do CPC) ou norma já aplicada na decisão embargada sem transcrever redação de memória, ou (b) Súmula/OJ/artigo verificado em fonte normativa oficial anexa ao ambiente (ex.: CLT/TST no NotebookLM) convergente com o Nó de Ideia — listando obrigatoriamente cada item na seção final de Auditoria com a origem e as primeiras 6 a 8 palavras do parágrafo onde aparece.'
                : '- Auditoria desativada (ou modo enxuto): utilize EXCLUSIVAMENTE as normas e julgados fornecidos nos Nós de Ideia; ficam vedadas citações normativas externas sem trilha de conferência.'
        ];

        linhas.push('', 'REGRAS DE PRECEDÊNCIA EM CASO DE CONFLITO:');

        if (isCompleto) {
            linhas.push(
                '1. Eixo Decisório (cabimento e resultado dos embargos): Veredito > Diretriz Global > Diretriz do Vício / Tese > Nó Local. Qualquer conflito que afete o resultado segue o eixo decisório; o Veredito NUNCA é contrariado, nem mesmo por texto literal.',
                '2. Eixo Editorial (forma e exceções): fora de conflito de resultado, [LITERAL]/[LITERAL_MOVEL] prevalecem sobre paráfrase; entre dois [ORDEM], o comando mais específico (Local > Tese/Vício > Global) prevalece como exceção pontual.'
            );
            if (auditoriaAtiva) {
                linhas.push(
                    '3. Transparência de Conflito: sempre que detectar conflito entre nós ou entre nó e Veredito, aplique a precedência acima para concluir a minuta e REGISTRE o conflito na seção de Auditoria citando o nº da Ideia.'
                );
            }
            linhas.push(
                '',
                'REGRA DOS CARTÕES DE CONTEXTO (<contexto_processual> / <contexto_processual_nao_vinculante>):',
                '- Trechos extraídos dos Embargos, Contraminuta, Decisão Embargada ou peças dos autos representam a perspectiva da parte ou o julgado sob auditoria — NUNCA são prova automática do vício nem substituem a convicção do Relator.',
                '- Utilize-os exclusivamente para delimitar o vício alegado, verificar se o julgado embargado já enfrentou o ponto, aferir tempestividade, inovação, preclusão ou tentativa de rejulgamento fático.'
            );
        } else {
            linhas.push(
                '1. Eixo Decisório (cabimento e resultado dos embargos): Veredito Parcial > Diretriz Global > Diretriz do Vício / Tese > Nó Local. Qualquer conflito que afete o resultado segue o eixo decisório; o Veredito Parcial NUNCA é contrariado, nem mesmo por texto literal.',
                '2. Eixo Editorial (forma e exceções): fora de conflito de resultado, [LITERAL]/[LITERAL_MOVEL] prevalecem sobre paráfrase; entre dois [ORDEM], o comando mais específico (Local > Tese/Vício > Global) prevalece como exceção pontual.'
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

        const textoBase = _stripInternalTags(String(no.texto || ''));
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
            '<barreiras_de_admissibilidade_dos_embargos>',
            'Analise e desenvolva as barreiras de admissibilidade / prejudiciais abaixo antes do exame do vício alegado:',
            ...itens,
            '</barreiras_de_admissibilidade_dos_embargos>\n'
        ].join('\n');
    }

    /**
     * Preâmbulo condicional para Embargos de Declaração (JN-ED-5.0):
     * Emite <decisao_embargada> ANTES de <vicio_alegado> (padrão TRT-23), seguido de <veredito_e_conclusao>.
     */
    function _compilarPreambuloCondicional(topico, filaVereditosLocais = []) {
        const limpar = (txt) => _stripInternalTags(String(txt || '')).trim();

        const campos = [
            {
                chave: 'fundamentos',
                tag: 'decisao_embargada',
                posicao: 'ABERTURA_RELATORIO',
                notaFixo: 'Redação já revisada pelo assistente para síntese da decisão embargada. Reproduza o texto fielmente como relato do julgado sob auditoria (não vincula o desfecho dos embargos).',
                notaAberto: 'Campo não preenchido: sintetize objetivamente o ponto da decisão embargada a partir dos cartões de contexto correspondentes.'
            },
            {
                chave: 'alegacoes',
                tag: 'vicio_alegado',
                posicao: 'ABERTURA_RELATORIO',
                notaFixo: 'Redação já revisada pelo assistente para abertura do tópico. Reproduza o texto fielmente, ciente de que expressa o vício apontado pelo EMBARGANTE (não a convicção do Relator).',
                notaAberto: 'Campo não preenchido: sintetize objetivamente o vício apontado nos embargos a partir dos cartões de contexto correspondentes.'
            },
            {
                chave: 'veredito',
                tag: 'veredito_e_conclusao',
                posicao: 'FECHO_DISPOSITIVO',
                notaFixo: 'Dispositivo/conclusão dos embargos já definido e revisado pelo assistente (acolher/rejeitar, com ou sem efeito modificativo). Reproduza fielmente no fechamento do tópico. Nunca contrarie este resultado.',
                notaAberto: 'CAMPO DELEGADO À IA: o assistente deixou o veredito em aberto intencionalmente. Elabore o desfecho completo dos embargos (acolhimento/rejeição, com ou sem efeito modificativo) com base nos Nós de Ideia e nos autos.'
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
     * Preâmbulo neutro para modo === 'acervo' (sem ordens de minuta).
     */
    function _compilarPreambuloAcervo(topico, filaVereditosLocais = []) {
        const limpar = (txt) => _stripInternalTags(String(txt || '')).trim();

        const fundamentos = limpar(topico?.fundamentos);
        const alegacoes = limpar(topico?.alegacoes);
        const veredito = limpar(topico?.veredito);
        const vereditosLocais = (filaVereditosLocais || [])
            .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
            .filter(Boolean);

        if (!fundamentos && !alegacoes && !veredito && vereditosLocais.length === 0) return '';

        const out = ['<escopo_auditoria>'];
        if (fundamentos) out.push(`<decisao_embargada>\n${fundamentos}\n</decisao_embargada>`);
        if (alegacoes) out.push(`<vicio_alegado>\n${alegacoes}\n</vicio_alegado>`);
        if (veredito) out.push(`<veredito_pretendido>\n${veredito}\n</veredito_pretendido>`);
        if (vereditosLocais.length > 0) {
            out.push('<vereditos_parciais_locais>');
            out.push(...vereditosLocais);
            out.push('</vereditos_parciais_locais>');
        }
        out.push('</escopo_auditoria>\n');
        return out.join('\n');
    }

    function gerarLembreteFinalHierarquia(topico, opcoes = {}) {
        const auditoriaAtiva = typeof opcoes.auditoria === 'boolean'
            ? opcoes.auditoria
            : isAuditoriaCriticaAtiva();

        const vereditoDelegado = !(topico && topico.veredito && topico.veredito.trim() !== '');
        const possuiCheckpointSaida = Boolean(
            topico && Array.isArray(topico.anotacoes) && topico.anotacoes.some(a => a && a.tipo === 'checkpoint_saida')
        );

        const linhas = [
            '\n<fechamento_editorial_e_controle>',
            'CHECKLIST DE EXECUÇÃO (RECENCY GUARD — EMBARGOS DE DECLARAÇÃO):',
            '1. RIGIDEZ: Preserve literalmente o Preâmbulo preenchido (1º Decisão Embargada; 2º Vício Alegado; ao fim, Veredito), [TEXTO FIXO], [JURISPRUDÊNCIA EXATA] e [DEGRAVAÇÃO CURADA] (nestes dois últimos, ordene livremente e redija transições fluidas). O Veredito (acolhimento/rejeição, com ou sem efeito modificativo) nunca pode ser contrariado.',
            '2. LIBERDADE E ESCOPO DO ED: NÃO copie mecanicamente [PREMISSA LÓGICA], [REFUTAÇÃO] nem [FILTRO / PREJUDICIAL] — desenvolva argumentação jurídica coesa sob a lente de auditoria formal dos Embargos de Declaração (vedado rejulgamento fático), reordenando trechos se melhorar a lógica, e integre [LEI SECA] como pano de fundo.',
            '3. CONTEXTO: Jamais adote alegações de <contexto_processual_nao_vinculante> ou inteiros teores como prova do vício ou convicção do Relator.',
            '4. ANTI-ALUCINAÇÃO E MINUTA LIMPA: NUNCA invente ou cite de memória súmula, OJ, ementa ou precedente fora dos Nós de Ideia. NUNCA crie avisos editoriais inline ("[CONFERIR]", "[VERIFICAR]", "[ERRO PRESCRICIONAL...]"). Preserve intactos apenas colchetes originais de citações literais ("[...]", "[sic]") e o marcador "[DADO PESSOAL OCULTADO - LGPD]".'
        ];

        if (auditoriaAtiva) {
            linhas.push(
                '',
                '<auditoria_critica ativa="true">',
                `OBRIGATÓRIO — APÓS CONCLUIR A MINUTA LIMPA${possuiCheckpointSaida ? ' (E ANTES DO CHECKPOINT DE CONTINUIDADE)' : ''}:`,
                `Crie uma seção final isolada (após linha divisória ---) com o título exato: "${TITULO_SECAO_AUDITORIA}" (uso interno — não integrar ao acórdão/decisão).`,
                'Atue como revisor jurídico crítico independente, sempre citando o nº da Ideia (conforme a numeração acima), Id. e folha (fl.) quando aplicável:',
                '1. LASTRO FÁTICO — Distinga expressamente entre: (a) ponto "NÃO LOCALIZADO NOS RECORTES FORNECIDOS" (pode constar em páginas não recortadas) e (b) ponto "CONTRARIADO POR ELEMENTO FORNECIDO" (contradição direta com a decisão embargada ou peça presente no contexto);',
                '2. CONFLITOS ENTRE DIRETRIZES — Se detectou conflito entre nós ou entre nó (mesmo literal) e Veredito, reporte o conflito indicando o nº da Ideia afetada;',
                '3. LIMITES DOS EMBARGOS E VÍCIOS PROCESSUAIS — Alerte sobre intempestividade evidente, risco de rejulgamento/reexame fático indevido sob pretexto de vício, efeito modificativo sem oitiva prévia da parte contrária (art. 897-A, § 2º, da CLT), julgamento extra/ultra/citra petita, inovação recursal, inversão de polos, preclusão ou erro material;',
                '4. NORMAS INVOCADAS FORA DOS NÓS — Liste eventuais artigos de lei autônomos ou súmulas/OJs de fonte normativa oficial anexa citados na minuta, indicando a origem ("lei seca autônoma" ou "fonte oficial anexa") e as primeiras 6 a 8 palavras do parágrafo onde aparecem (ex.: "Art. 897-A da CLT [lei seca autônoma] — parágrafo iniciado por: \'Os embargos de declaração...\'");'
            );

            if (vereditoDelegado) {
                linhas.push(
                    '5. JUSTIFICATIVA DO VEREDITO DELEGADO (OBRIGATÓRIO): Como o campo Veredito/Conclusão foi deixado em aberto, declare qual desfecho adotou (acolhimento/rejeição, com ou sem efeito modificativo) e quais Nós de Ideia o fundamentaram.'
                );
            }

            linhas.push(
                'Se não houver anomalia, conflito, norma autônoma nem veredito delegado a justificar, escreva exatamente: "Nenhuma inconsistência material, processual ou de cabimento detectada."',
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
        // Sanitização simétrica em ambos os lados (elimina falsos alarmes com LGPD ativo)
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

        if (topico.fundamentos) adicionar('Preâmbulo — Decisão Embargada', topico.fundamentos);
        if (topico.alegacoes) adicionar('Preâmbulo — Vício Alegado', topico.alegacoes);
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

        const anotacoesReais = (topico.anotacoes || []).filter(an => an && !_ehCheckpoint(an));

        if (topico.diretrizesPorVicio && Object.keys(topico.diretrizesPorVicio).length > 0) {
            const viciosAncorados = new Set(
                anotacoesReais.map(an => String(an.vicio || topico.vicio || 'omissao').trim())
            );
            if (anotacoesReais.length === 0 && topico.vicio) {
                viciosAncorados.add(String(topico.vicio).trim());
            }
            Object.entries(topico.diretrizesPorVicio).forEach(([nomeVicio, lista]) => {
                const chaveLimpa = String(nomeVicio).trim();
                if (viciosAncorados.has(chaveLimpa)) {
                    inspecionarLista(lista, `Vício: ${chaveLimpa}`);
                }
            });
        }

        if (topico.diretrizesPorTese && Object.keys(topico.diretrizesPorTese).length > 0) {
            const tesesAncoradas = window.ThesisGuard
                ? ThesisGuard.mapearTesesAncoradas(topico)
                : new Set(
                    anotacoesReais.map(a => (a.tese && a.tese.trim() !== '') ? a.tese.trim() : CHAVE_TESE_SEM_NOME)
                );
            Object.entries(topico.diretrizesPorTese).forEach(([tese, lista]) => {
                const chaveNorm = tese.trim() || CHAVE_TESE_SEM_NOME;
                if (tesesAncoradas.has(chaveNorm)) {
                    inspecionarLista(lista, `Tese: ${chaveNorm}`);
                }
            });
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

    // SINGLE SOURCE OF TRUTH — Rol de Peças do Extrator Inteligente
    const DOC_EXTRATOR_CONFIG = [
        { value: 'decisao', label: 'Decisão Embargada (Sentença/Acórdão)', grupo: 'Alvos Principais' },
        { value: 'embargos', label: 'Inteiro Teor dos Embargos', grupo: 'Alvos Principais' },
        { value: 'recurso_ordinario', label: 'Recurso Ordinário', grupo: 'Peças de Confronto' },
        { value: 'contrarrazoes', label: 'Contrarrazões ao RO', grupo: 'Peças de Confronto' },
        { value: 'contraminuta', label: 'Contraminuta aos EDs', grupo: 'Peças de Confronto' },
        { value: 'peticao_inicial', label: 'Petição Inicial', grupo: 'Peças de Confronto' },
        { value: 'contestacao', label: 'Contestação', grupo: 'Peças de Confronto' },
        { value: 'impugnacao_contestacao', label: 'Impugnação à Contestação', grupo: 'Peças de Confronto' },
        { value: 'audiencia_instrucao', label: 'Audiência de Instrução', grupo: 'Provas e Atos' },
        { value: 'sentenca_primeiro_grau', label: 'Sentença de 1º Grau (Origem)', grupo: 'Provas e Atos' },
        { value: 'laudo_pericial', label: 'Laudo Pericial', grupo: 'Provas e Atos' },
        { value: 'atos_secretaria', label: 'Atos da Secretaria / Certidões', grupo: 'Provas e Atos' }
    ];

    function getDocLabel(value) {
        const doc = DOC_EXTRATOR_CONFIG.find(d => d.value === value);
        return doc ? doc.label : (value ? value.toUpperCase() : 'DESCONHECIDO');
    }

    let _regrasDeLimpezaCache = null;

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

    // CONFIGURAÇÃO CENTRALIZADA DE CONTEXTOS PROCESSUAIS (Arquitetura Base-2)
    const ESQUEMAS_CONTEXTO = {
        'RO': {
            prefixoArquivo: "Pacote_JurisNotes_",
            tituloTopico: "TÓPICO RECURSAL PRINCIPAL",
            rotuloSeccao: "MATRIZ DIALÉTICA DE MÉRITO",
            tagAlegacao: "teses_recursais",
            tagFundamento: "fundamentos_da_origem",
            tagVeredito: "decisao_magistrado_pretendida",
            diretrizIA: "Analise o efeito devolutivo amplo. Avalie o confronto dialético entre as razões do recurso e os fundamentos da sentença de primeiro grau."
        },
        'ED': {
            prefixoArquivo: "Pacote_ED_JurisNotes_",
            tituloTopico: "VÍCIO EMBARGADO (AUDITORIA ESTRITA)",
            rotuloSeccao: "MATRIZ DE HIGIDEZ ESTRUTURAL",
            tagAlegacao: "vicio_alegado",
            tagFundamento: "decisao_embargada",
            tagVeredito: "veredito_assessor",
            diretrizIA: "Atue estritamente sob a lente de auditoria da higidez formal da decisão. Limite-se a sanar Omissão, Contradição ou Erro Material. É EXPRESSAMENTE PROIBIDO reexaminar provas de mérito fático ou promover o rejulgamento da causa. Adote os princípios do Visual Law e Linguagem Simples: formalidade acessível, clareza absoluta e eliminação de hermetismos jurídicos."
        }
    };

    /**
     * Remove sintaxes exclusivas de renderização da UI (ex: [[size:2]])
     * Evita vazamento de pseudo-código inútil para o LLM.
     */
    function _stripInternalTags(texto) {
        if (!texto) return '';
        return String(texto).replace(/\[\[\/?size(:\d)?\]\]/g, '');
    }

    /**
     * Sanitiza conteúdo para evitar quebras no Markdown
     */
    function _safeMD(str, prefixo = '') {
        if (!str) return '';
        const textoLimpo = _stripInternalTags(String(str));
        return textoLimpo.replace(/\n/g, prefixo);
    }

    /**
     * Sanitiza atributos para injeção segura em tags XML.
     * Previne quebra de payload por aspas duplas no nome do vício.
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
     * Formata a citação oficial de referência cruzada.
     */
    function _formatarCitacaoOficial(pjeId, pagina) {
        const strId = pjeId   ? `Id ${pjeId}`   : 'Id não idt.';
        const strFl = pagina  ? `fl ${pagina}`  : 'fl não idt.';
        return `(${strId} - ${strFl})`;
    }

    /**
     * Gera nome estruturado para download de imagens
     */
    function _gerarNomeArquivoImagem(topicoId, numIdeia, numSub = null) {
        const hierarquia = numSub ? `${numIdeia}_sub_${numSub}` : `${numIdeia}`;
        return `Evidencia_ED_${topicoId}_Card_${hierarquia}.png`;
    }

    /**
     * Motor Privado de Geração de Payload (Protocolo JN-ED-5.0 — Montagem Determinística em 2 Fases)
     */
    function _gerarMarkdown(topico, opcoes = {}) {
        const config = ESQUEMAS_CONTEXTO['ED'];
        const modoPrompt = opcoes.modo || 'minuta';
        const incluirNomesImagens = opcoes.incluirNomesImagens !== undefined ? opcoes.incluirNomesImagens : true;
        const auditoriaAtiva = modoPrompt === 'acervo'
            ? false
            : (opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva());

        const safeFormatTime = (sec) => window.AudioManager?.formatTime
            ? window.AudioManager.formatTime(sec)
            : `${Math.floor(sec / 60)}' ${Math.floor(sec % 60)}''`;

        // ====================================================================
        // FASE A — COLETA E SERIALIZAÇÃO EM PASSAGEM ÚNICA O(N)
        // ====================================================================
        const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);
        const filaPreliminares = [];
        const filaVereditosLocais = [];
        const bufferGlobais = [];
        const bufferViciosTeses = [];
        const bufferMatriz = [];

        // A.1 — Diretrizes Globais
        (topico.diretrizesGlobais || []).forEach(dir => {
            _rotearNoParaSecao(dir, 'Diretriz Global', filaPreliminares, filaVereditosLocais, bufferGlobais);
        });

        // A.2 — Diretrizes por Vício e por Tese (apenas chaves ancoradas na Matriz)
        const anotacoesValidas = (topico.anotacoes || []).filter(an => an && !_ehCheckpoint(an));

        if (topico.diretrizesPorVicio && Object.keys(topico.diretrizesPorVicio).length > 0) {
            const viciosAncorados = new Set(
                anotacoesValidas.map(an => String(an.vicio || topico.vicio || 'omissao').trim())
            );
            if (anotacoesValidas.length === 0 && topico.vicio) {
                viciosAncorados.add(String(topico.vicio).trim());
            }

            Object.keys(topico.diretrizesPorVicio).forEach(nomeVicio => {
                const chaveVicioLimpa = String(nomeVicio).trim();
                if (!viciosAncorados.has(chaveVicioLimpa)) return;

                const diretrizes = topico.diretrizesPorVicio[nomeVicio];
                if (!Array.isArray(diretrizes) || diretrizes.length === 0) return;

                const bufferVicioLocal = [];
                diretrizes.forEach(dir => {
                    _rotearNoParaSecao(dir, `Vício: ${chaveVicioLimpa}`, filaPreliminares, filaVereditosLocais, bufferVicioLocal);
                });

                if (bufferVicioLocal.length > 0) {
                    const tesesVinculadas = anotacoesValidas
                        .filter(an => String(an.vicio || topico.vicio || 'omissao').trim() === chaveVicioLimpa && an.tese && an.tese.trim() !== '')
                        .map(an => window.ThesisGuard ? ThesisGuard.obterChaveTese(an) : an.tese.trim());

                    const tesesUnicas = [...new Set(tesesVinculadas)];
                    const stringTeses = tesesUnicas.length > 0 ? tesesUnicas.join(' | ') : 'Aguardando definição do usuário na Matriz.';

                    bufferViciosTeses.push(
                        `<vicio_alvo>\n` +
                        `[NOME DO VÍCIO]: ${_escapeXmlAttr(chaveVicioLimpa)}\n` +
                        `[TESES RECURSAIS ENVOLVIDAS]: ${_escapeXmlAttr(stringTeses)}\n` +
                        `${bufferVicioLocal.join('\n\n')}\n` +
                        `</vicio_alvo>`
                    );
                }
            });
        }

        if (topico.diretrizesPorTese && Object.keys(topico.diretrizesPorTese).length > 0) {
            const tesesAncoradas = window.ThesisGuard
                ? ThesisGuard.mapearTesesAncoradas(topico)
                : new Set(
                    anotacoesValidas.map(a => (a.tese && a.tese.trim() !== '') ? a.tese.trim() : CHAVE_TESE_SEM_NOME)
                );

            for (const [nomeTese, diretrizes] of Object.entries(topico.diretrizesPorTese)) {
                const chaveNormalizada = nomeTese.trim() || CHAVE_TESE_SEM_NOME;
                if (!tesesAncoradas.has(chaveNormalizada)) continue;
                if (!Array.isArray(diretrizes) || diretrizes.length === 0) continue;

                const bufferTeseLocal = [];
                diretrizes.forEach(dir => {
                    _rotearNoParaSecao(dir, `Tese: ${chaveNormalizada}`, filaPreliminares, filaVereditosLocais, bufferTeseLocal);
                });

                if (bufferTeseLocal.length > 0) {
                    bufferViciosTeses.push(
                        `<tese_alvo>\n` +
                        `[NOME DA TESE]: ${_escapeXmlAttr(chaveNormalizada)}\n` +
                        `${bufferTeseLocal.join('\n\n')}\n` +
                        `</tese_alvo>`
                    );
                }
            }
        }

        // A.3 — Matriz de Higidez Estrutural e Evidências (com numeração visual unificada)
        if (!topico.anotacoes || topico.anotacoes.length === 0) {
            bufferMatriz.push('*Nenhum elemento processual foi anexado para auditoria.*\n');
        } else {
            let ultimaTeseExportada = null;

            topico.anotacoes.forEach((an, idx) => {
                if (!an) return;

                // Interceptador de módulos de continuidade (Handoff RAG)
                if (an.tipo === 'checkpoint_saida') {
                    if (ultimaTeseExportada !== null) {
                        bufferMatriz.push('</grupo_tese>\n');
                        ultimaTeseExportada = null;
                    }
                    const meta = an.metaHandoff;
                    const posAuditoria = auditoriaAtiva
                        ? ` (após a seção isolada "${TITULO_SECAO_AUDITORIA}")`
                        : '';
                    bufferMatriz.push(
                        `\n⛓️ PONTE DE CONTINUIDADE (SAÍDA) + COMANDO DE GERAÇÃO PARCIAL\n` +
                        `→ CONTINUA NO TÓPICO: "${meta.alvo}"\n` +
                        `→ COMANDO DE GERAÇÃO PARCIAL: ao auditar este vício, NÃO escreva conclusão, pedidos finais ou parágrafo de fecho; interrompa após a última seção e encerre${posAuditoria} com bloco "CHECKPOINT DE CONTINUIDADE" contendo [ID] CHK-${meta.slug}-v${meta.versao}, [STATUS], [JÁ REDIGIDO], [PREMISSAS FIXADAS], [PENDÊNCIAS].\n` +
                        `→ ORDEM DE LEITURA: processe este contexto integralmente e só então abra o contexto de "${meta.alvo}", tratando-o como capítulo continuado.\n`
                    );
                    return;
                } else if (an.tipo === 'checkpoint_entrada') {
                    if (ultimaTeseExportada !== null) {
                        bufferMatriz.push('</grupo_tese>\n');
                        ultimaTeseExportada = null;
                    }
                    const meta = an.metaHandoff;
                    bufferMatriz.push(
                        `\n⛓️ PONTE DE CONTINUIDADE (CHEGADA) + COMANDO DE RETOMADA\n` +
                        `← ORIGEM: continuação direta da auditoria "${meta.origem}" via checkpoint CHK-${meta.slug}-v${meta.versao}.\n` +
                        `← VEDAÇÃO: não re-provar nem reescrever itens de [JÁ REDIGIDO] do checkpoint; remeta-os como "conforme estabelecido na etapa anterior".\n` +
                        `← WORKFLOW: antes de redigir, localizar o checkpoint CHK-${meta.slug}-v${meta.versao} e aplicar o [COMANDO DE CONTINUAÇÃO DE MINUTA — HANDOFF].\n`
                    );
                    return;
                }

                const teseAtual = window.ThesisGuard
                    ? ThesisGuard.obterChaveTese(an)
                    : ((an.tese && an.tese.trim() !== '') ? an.tese.trim() : CHAVE_TESE_SEM_NOME);
                const vicioAtual = an.vicio || topico.vicio || 'Nao Especificado';

                if (teseAtual !== ultimaTeseExportada) {
                    if (ultimaTeseExportada !== null) {
                        bufferMatriz.push('</grupo_tese>\n');
                    }
                    bufferMatriz.push(`<grupo_tese vicio_investigado="${_escapeXmlAttr(vicioAtual)}" delimitacao_faticas_da_tese="${_escapeXmlAttr(teseAtual)}">`);
                    ultimaTeseExportada = teseAtual;
                }

                const numIdeia = mapaVisuais.get(idx);
                const refCitacao = _formatarCitacaoOficial(an.pjeId, an.pagina);
                const estatutoMestre = _obterEstatutoEpistemologico(an);
                const tituloVicio = (window.JurisUtils && typeof window.JurisUtils.obterBadgeTeseCompleto === 'function')
                    ? (window.JurisUtils.obterBadgeTeseCompleto(an.vicio || topico.vicio, an.tese, false) || 'Auditoria Geral')
                    : (an.vicio || topico.vicio || 'Auditoria Geral');

                const faseContexto = an.fase || an.documento || 'Não especificado';
                const poloContexto = an.polo || 'N/A';

                const linhasCard = [
                    '<analise_de_evidencia>',
                    `[IDENTIFICADOR DA EVIDÊNCIA]: ${numIdeia}`,
                    `[VÍCIO VINCULADO]: ${_escapeXmlAttr(tituloVicio)}`,
                    `[TESE VINCULADA]: ${_escapeXmlAttr(teseAtual)}`,
                    `<contexto_processual>`,
                    `Fase: ${faseContexto} | Polo: ${poloContexto} | Ref: ${refCitacao} | Estatuto: ${estatutoMestre}`,
                    `</contexto_processual>`,
                    '',
                    '<contexto_processual_nao_vinculante>'
                ];

                const docLabel = `**[ESTATUTO: ${estatutoMestre}] [${an.documento || 'Elemento'}] (${poloContexto}) ${refCitacao}:**`;

                if (an.tipo === 'texto') {
                    const conteudoSeguro = _sanitizarContraInjecao(an.conteudo);
                    linhasCard.push(`- ${docLabel} ${_safeMD(conteudoSeguro, ' ')}`);
                    if (an.comentario) {
                        linhasCard.push(`  [APONTAMENTO DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}`);
                    }
                } else if (an.tipo === 'imagem') {
                    const imgRef = incluirNomesImagens
                        ? `(Nome: \`${_gerarNomeArquivoImagem(topico.id, numIdeia)}\`)`
                        : `[Recorte visual — ${refCitacao}]`;
                    linhasCard.push(`- ${docLabel}\n  [IMAGEM FORNECIDA PARA CONFERÊNCIA]: ${imgRef}.\n  [APONTAMENTO DO ASSESSOR]: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Verifique a falha estrutural demonstrada na imagem.'), '\n  ')}`);
                } else if (an.tipo === 'audio') {
                    try {
                        const ad = JSON.parse(an.conteudo);
                        const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                        linhasCard.push(`- ${docLabel} [OITIVA REGISTRADA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).`);
                        if (an.comentario) linhasCard.push(`  [OBSERVAÇÃO]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}`);
                        if (ad.transcricao) linhasCard.push(`  [DEGRAVAÇÃO LITERAL]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n  ')}"`);
                    } catch (e) {
                        linhasCard.push(`- ${docLabel} [ÁUDIO] Resumo: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Sem comentário.'), '\n  ')}`);
                    }
                }

                // Sub-provas Correlacionadas (Confrontos)
                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        const numSub = corrIdx + 1;
                        const cRefCitacao = _formatarCitacaoOficial(corr.pjeId, corr.pagina);
                        const estatutoCorr = _obterEstatutoEpistemologico(corr);
                        const cDocLabel = `  [CONFRONTO DIRETO ${numSub} — ESTATUTO: ${estatutoCorr}]: [${corr.documento || 'Doc'}] (${corr.polo || 'Polo'}) ${cRefCitacao}:`;

                        if (corr.tipo === 'texto') {
                            const corrConteudoSeguro = _sanitizarContraInjecao(corr.conteudo || '');
                            linhasCard.push(`${cDocLabel} ${_safeMD(corrConteudoSeguro, ' ')}`);
                            if (corr.comentario) {
                                linhasCard.push(`    [APONTAMENTO DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}`);
                            }
                        } else if (corr.tipo === 'imagem') {
                            const cImgRef = incluirNomesImagens
                                ? `\`${_gerarNomeArquivoImagem(topico.id, numIdeia, numSub)}\``
                                : `[Recorte visual — ${cRefCitacao}]`;
                            linhasCard.push(`${cDocLabel}\n    [IMAGEM ANEXA]: ${cImgRef}\n    [APONTAMENTO]: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Avalie a incongruência.'), '\n    ')}`);
                        } else if (corr.tipo === 'audio') {
                            try {
                                const ad = JSON.parse(corr.conteudo);
                                const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                                linhasCard.push(`${cDocLabel} [OITIVA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).`);
                                if (corr.comentario) linhasCard.push(`    [OBSERVAÇÃO]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}`);
                                if (ad.transcricao) linhasCard.push(`    [DEGRAVAÇÃO LITERAL]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n    ')}"`);
                            } catch (e) {
                                linhasCard.push(`${cDocLabel} [ÁUDIO] Contexto: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Ausente.'), '\n    ')}`);
                            }
                        }
                    });
                }

                linhasCard.push('</contexto_processual_nao_vinculante>');

                // Roteamento uniforme dos Nós de Ideia locais (mestre + correlacionados)
                const bufferDiretrizesLocais = [];
                const refCardMestre = _montarRefContextoCard(an, numIdeia);
                (an.subAnotacoes || []).forEach(sub => {
                    _rotearNoParaSecao(sub, refCardMestre, filaPreliminares, filaVereditosLocais, bufferDiretrizesLocais);
                });

                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        const refCardCorr = _montarRefContextoCard(corr, numIdeia, corrIdx);
                        (corr.subAnotacoes || []).forEach(sub => {
                            _rotearNoParaSecao(sub, refCardCorr, filaPreliminares, filaVereditosLocais, bufferDiretrizesLocais);
                        });
                    });
                }

                if (bufferDiretrizesLocais.length > 0) {
                    linhasCard.push('');
                    linhasCard.push('<diretrizes_de_auditoria_do_assessor>');
                    linhasCard.push(bufferDiretrizesLocais.join('\n\n'));
                    linhasCard.push('</diretrizes_de_auditoria_do_assessor>');
                }

                linhasCard.push('</analise_de_evidencia>\n');
                bufferMatriz.push(linhasCard.join('\n'));
            });

            if (ultimaTeseExportada !== null) {
                bufferMatriz.push('</grupo_tese>\n');
            }
        }

        // ====================================================================
        // FASE B — CONCATENAÇÃO ORDENADA DO DOCUMENTO FINAL O(1)
        // ====================================================================
        const partesDoc = [
            `<!-- [ESQUEMA ${SCHEMA_EXPORT_VERSAO} — REGIMES EDITORIAIS E AUDITORIA DE EMBARGOS] -->`,
            `# ${config.tituloTopico}: **${(topico.nome || 'Não Nomeado').toUpperCase()}**\n`
        ];

        if (modoPrompt !== 'acervo') {
            partesDoc.push(gerarLegendaRegimesRedacionais({ modo: 'completo', auditoria: auditoriaAtiva }));

            partesDoc.push(
                `<roteiro_diretor_llm>\n` +
                `  <incidente_processual>Embargos de Declaração</incidente_processual>\n` +
                `  <diretriz_cognitiva_vinculante>${config.diretrizIA}</diretriz_cognitiva_vinculante>\n` +
                `</roteiro_diretor_llm>\n`
            );

            // Injeção objetiva dos dados do Contrato de Trabalho (quando preenchidos no Painel ED)
            // Consome EXCLUSIVAMENTE getDados() (Parâmetros Oficiais); jamais lê getConfronto()
            if (window.ContratoManager) {
                const dadosContrato = window.ContratoManager.getDados();
                const admissao = dadosContrato ? (dadosContrato.inicio || dadosContrato.admissao || '') : '';
                const demissao = dadosContrato ? (dadosContrato.fim || dadosContrato.demissao || '') : '';
                const ajuizamento = dadosContrato ? (dadosContrato.ajuizamento || '') : '';
                const funcao = dadosContrato ? (dadosContrato.funcao || '') : '';

                if (admissao || demissao || ajuizamento || funcao) {
                    const formatarIsoBr = (iso) => {
                        const arr = String(iso).split('-');
                        return arr.length === 3 ? `${arr[2]}/${arr[1]}/${arr[0]}` : iso;
                    };
                    const contratoLinhas = ['<contexto_fatico_vinculo_empregaticio>'];
                    if (funcao) {
                        contratoLinhas.push(`  [Função Exercida]: ${_safeMD(funcao, ' ')}`);
                    }
                    if (admissao) {
                        contratoLinhas.push(`  [Data de Admissão]: ${formatarIsoBr(admissao)}`);
                    }
                    if (demissao) {
                        contratoLinhas.push(`  [Data de Demissão]: ${formatarIsoBr(demissao)}`);
                    }
                    if (ajuizamento) {
                        contratoLinhas.push(`  [Data de Ajuizamento da Ação]: ${formatarIsoBr(ajuizamento)}`);
                    }
                    contratoLinhas.push('</contexto_fatico_vinculo_empregaticio>\n');
                    partesDoc.push(contratoLinhas.join('\n'));
                }
            }

            partesDoc.push(`## SEÇÃO I — ESCOPO DA AUDITORIA\n`);
            partesDoc.push(_compilarPreambuloCondicional(topico, filaVereditosLocais));
        } else {
            const preambuloAcervo = _compilarPreambuloAcervo(topico, filaVereditosLocais);
            if (preambuloAcervo) partesDoc.push(preambuloAcervo);
        }

        // Barreiras de admissibilidade / prejudiciais (promovidas de globais, vícios, teses e locais)
        const blocoPreliminares = _compilarBlocoPreliminares(filaPreliminares);
        if (blocoPreliminares) partesDoc.push(blocoPreliminares);

        // Diretrizes Globais
        if (bufferGlobais.length > 0) {
            partesDoc.push(
                `<premissas_globais_da_auditoria>\n${bufferGlobais.join('\n\n')}\n</premissas_globais_da_auditoria>\n`
            );
        }

        // Direcionamentos por Vício e por Tese
        if (bufferViciosTeses.length > 0) {
            partesDoc.push(
                `<direcionamentos_por_vicio>\n${bufferViciosTeses.join('\n\n')}\n</direcionamentos_por_vicio>\n`
            );
        }

        // Matriz de Higidez Estrutural
        partesDoc.push(
            `## SEÇÃO II — ${config.rotuloSeccao}\n` +
            `*Atenção IA: Elementos processuais de contexto para auditoria do vício formal (vedado rejulgamento do mérito originário).*\n`
        );
        partesDoc.push(bufferMatriz.join('\n'));

        return partesDoc.join('\n');
    }

    /**
     * Download seguro do arquivo Markdown
     */
    function _downloadArquivo(nomeArquivo, conteudoTexto, mimeType = 'text/markdown;charset=utf-8;') {
        const blob = new Blob([conteudoTexto], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", nomeArquivo);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Download sequencial seguro de imagens (Herdado do RO - Previne bloqueio de navegador)
     */
    async function _downloadImagemSegura(base64Data, nomeArquivoBase) {
        try {
            const response = await fetch(base64Data);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nomeArquivoBase;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise(resolve => setTimeout(resolve, 50));
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(`[ExportManager ED] Falha ao baixar imagem "${nomeArquivoBase}":`, e);
        }
    }

    async function _executarFilaDeDownloads(fila) {
        if (!fila || fila.length === 0) return;
        _deps.exibirToast(`Iniciando download de ${fila.length} evidência(s)...`, 'info');
        for (const item of fila) {
            await _downloadImagemSegura(item.dados, item.nome);
            await new Promise(resolve => setTimeout(resolve, 650)); // Delay estratégico
        }
        _deps.exibirToast('Todas as evidências foram baixadas.', 'sucesso');
    }

    // ─── HUB DE EXPORTAÇÃO RAG (ED) ─────────────────────────────────────────
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
                    <span class="export-option-title">Matriz de Embargos (Juris Notes) + Imagens Anexas</span>
                    <span class="export-option-subtitle">Auditoria estrita de vícios e download das provas demarcadas.</span>
                </div>
            </label>
        `);

        if (topico.marcosExtracao && topico.marcosExtracao.length > 0) {
            const agrupados = topico.marcosExtracao.reduce((acc, curr) => {
                const poloSufixo = (curr.polo && curr.polo !== 'Comum') ? curr.polo : 'Comum';
                const compositeKey = `${curr.docTipo}|${poloSufixo}`;
                if(!acc[compositeKey]) acc[compositeKey] = {};
                acc[compositeKey][curr.fronteira] = curr;
                return acc;
            }, {});

            const svgPin = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;

            for (const [compositeKey, limites] of Object.entries(agrupados)) {
                const [docTipo, poloDaPeca] = compositeKey.split('|');
                const hasInicio = !!limites.inicio;
                const hasFim = !!limites.fim;
                const isCompleto = hasInicio && hasFim;
                
                if (isCompleto) _documentosParaExtracaoCache[compositeKey] = limites;
                
                let nomeF = getDocLabel(docTipo);
                if (poloDaPeca !== 'Comum') nomeF += ` (${poloDaPeca})`;
                
                const regras = _carregarRegrasFiltro();
                const hasRegra = !!regras[docTipo];
                
                const svgEraser = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
                const btnBorracha = `<button type="button" class="pin-eraser-btn trigger-borracha ${hasRegra ? 'is-active' : ''}" data-doc-tipo="${docTipo}" data-doc-nome="${_escapeXmlAttr(nomeF)}" title="Borracha Mágica">${svgEraser}</button>`;
                
                const btnInicio = hasInicio 
                    ? `<button type="button" class="pin-action-btn pin-start-active" onclick="event.preventDefault(); event.stopPropagation(); excluirMarcadorExtracao('${topico.id}', '${docTipo}', 'inicio', '${poloDaPeca}');" title="Excluir Início (Fl. ${limites.inicio.pagina})">${svgPin}</button>`
                    : `<button type="button" class="pin-action-btn pin-missing" title="Falta Marcador de Início">${svgPin}</button>`;
                    
                const btnFim = hasFim 
                    ? `<button type="button" class="pin-action-btn pin-end-active" onclick="event.preventDefault(); event.stopPropagation(); excluirMarcadorExtracao('${topico.id}', '${docTipo}', 'fim', '${poloDaPeca}');" title="Excluir Fim (Fl. ${limites.fim.pagina})">${svgPin}</button>`
                    : `<button type="button" class="pin-action-btn pin-missing" title="Falta Marcador de Fim">${svgPin}</button>`;

                const statusTexto = isCompleto 
                    ? `Conteúdo capturado entre as fls. ${limites.inicio.pagina} e ${limites.fim.pagina}.`
                    : `<span style="color:#c62828; font-weight:700;">⚠️ Extração bloqueada: Faltam marcadores.</span>`;

                htmlBuffer.push(`
                    <label class="export-option-card ${!isCompleto ? 'locked-option' : ''}">
                        <input type="checkbox" value="${compositeKey}" class="extra-doc-checkbox export-control-checkbox" ${isCompleto ? 'checked' : 'disabled'}>
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

        const chkExport = document.getElementById('chk-export-auditoria-critica');
        if (chkExport) chkExport.checked = isAuditoriaCriticaAtiva();

        if (container.dataset.exportEventsBound !== 'true') {
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
                    const btnAtual = document.getElementById('btn-gerar-arquivo-exportacao');
                    if (!btnAtual) return;
                    const totalChecked = container.querySelectorAll('.export-control-checkbox:checked').length;
                    if (totalChecked === 0) {
                        btnAtual.disabled = true;
                        btnAtual.style.opacity = '0.4';
                        btnAtual.style.cursor = 'not-allowed';
                    } else {
                        btnAtual.disabled = false;
                        btnAtual.style.opacity = '1';
                        btnAtual.style.cursor = 'pointer';
                    }
                }
            });

            container.dataset.exportEventsBound = 'true';
        }

        document.getElementById('export-avancado-backdrop').style.display = 'block';
        document.getElementById('modal-exportacao-avancada').style.display = 'block';

        const btnExportar = document.getElementById('btn-gerar-arquivo-exportacao');
        if (btnExportar) {
            btnExportar.disabled = false;
            btnExportar.style.opacity = '1';
            btnExportar.style.cursor = 'pointer';
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
        
        if (texto.length > 0 && texto.length < 20) {
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
        
        if (texto.length >= 20) {
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
        _deps.exibirToast('⏳ Iniciando extração de dados em segundo plano...', 'info');

        try {
            let conteudoFinal = "";
            const elMatriz = document.getElementById('checkbox-matriz-export');
            const incluirMatriz = elMatriz && elMatriz.checked;
            const checkboxesDocsExtra = Array.from(document.querySelectorAll('.extra-doc-checkbox:checked'));
            const config = ESQUEMAS_CONTEXTO['ED'];

            // 1. Injeção de Contexto (Obrigatório para o LLM não se perder)
            if (incluirMatriz) {
                conteudoFinal += _gerarMarkdown(topico) + "\n\n";
            } else {
                const nomeTopicoFormatado = (topico.nome || 'Não Nomeado').toUpperCase();
                conteudoFinal += `# ${config.tituloTopico}: **${nomeTopicoFormatado}**\n`;
                conteudoFinal += `[AVISO DE SISTEMA]: O usuário optou por não enviar a matriz de embargos. Use os documentos integrais abaixo para análise.\n\n`;
            }

            // 2. Anexação dos Documentos Complementares
            if (checkboxesDocsExtra.length > 0) {
                conteudoFinal += "<!-- ==========================================\n";
                conteudoFinal += incluirMatriz 
                    ? "     DOCUMENTOS COMPLEMENTARES ANEXOS\n" 
                    : "     TEOR INTEGRAL DE PEÇAS E DOCUMENTOS\n";
                conteudoFinal += "     ========================================== -->\n\n";

                // Orquestração da fila de documentos com progresso
                for (let idx = 0; idx < checkboxesDocsExtra.length; idx++) {
                    const cb = checkboxesDocsExtra[idx];
                    const compositeKey = cb.value;
                    const [docTipo, poloDaPeca] = compositeKey.split('|');
                    const limites = _documentosParaExtracaoCache[compositeKey];
                    
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
                            ? window.JurisUtils.limparTextoPDF(textoBruto) 
                            : textoBruto;

                        // SANITIZAÇÃO DELEGADA — fonte única, compartilhada com o Gerador de Contexto IA
                        textoLimpo = aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim);

                        conteudoFinal += enveloparTeorIntegral(docTipo, textoLimpo, poloDaPeca) + "\n\n";
                    } catch (extraError) {
                        if (extraError.message && extraError.message.includes("CONCURRENCY_VIOLATION")) {
                            throw extraError; // Repassa erro fatal abortando a exportação
                        }
                        console.warn(`[ExportManager ED] Falha ao extrair ${docTipo}:`, extraError);
                        const tagNameError = docTipo.toUpperCase();
                        conteudoFinal += `<${tagNameError}>\n[AVISO DE SISTEMA: Falha na extração deste documento no PDF. Possível página corrompida.]\n</${tagNameError}>\n\n`;
                    }
                }
            }

            if (incluirMatriz) {
                conteudoFinal += gerarLembreteFinalHierarquia(topico);
            }

            // 3. Fila de Downloads Visuais (Restrita à Matriz — sincronizada com mapa visual)
            const filaDeDownloads = [];
            if (incluirMatriz) {
                const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);
                (topico.anotacoes || []).forEach((an, idx) => {
                    if (_ehCheckpoint(an)) return;
                    const numIdeia = mapaVisuais.get(idx);
                    if (an.tipo === 'imagem') {
                        filaDeDownloads.push({ dados: an.conteudo, nome: _gerarNomeArquivoImagem(topico.id, numIdeia) });
                    }
                    if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                        an.itensCorrelacionados.forEach((corr, corrIdx) => {
                            if (corr.tipo === 'imagem') {
                                filaDeDownloads.push({ dados: corr.conteudo, nome: _gerarNomeArquivoImagem(topico.id, numIdeia, corrIdx + 1) });
                            }
                        });
                    }
                });
            }

            // 4. Fechamento e Download Dinâmico
            const nomeSanitizado = (topico.nome || 'Exportacao_ED').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const tagDom = document.getElementById('tag-numero-processo');
            const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
            const baseStr = numProcesso ? `${config.prefixoArquivo}${numProcesso}_` : config.prefixoArquivo;

            const sufixoArquivo = incluirMatriz ? "_CONTEXTO_RAG.txt" : "_TEOR_INTEGRAL.txt";

            _downloadArquivo(`${baseStr}${nomeSanitizado}${sufixoArquivo}`, conteudoFinal, 'text/plain;charset=utf-8;');
            
            if(filaDeDownloads.length > 0) {
                _deps.exibirToast('Texto exportado. Iniciando imagens...', 'info');
                _executarFilaDeDownloads(filaDeDownloads);
            } else {
                _deps.exibirToast('✅ Arquivo gerado com sucesso!', 'sucesso');
            }

            // Gatilho visual acionado DEPOIS que a exportação do arquivo finaliza
            if (window.TaskManager && typeof window.TaskManager.sinalizarTarefasPendentes === 'function') {
                window.TaskManager.sinalizarTarefasPendentes();
            }

        } catch (error) {
            console.error('[ExportManager ED] Erro fatal na exportação:', error);
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
     *   1. Automática — remove ruído estrutural repetido entre páginas (cabeçalhos/rodapés).
     *   2. Manual — aplica a regra fuzzy cadastrada pelo usuário na Borracha Mágica.
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

    // ========================================================================
    // API PÚBLICA
    // ========================================================================
    return {
        init: function (dependencies) {
            _deps = { ..._deps, ...dependencies };
        },

        exportarTopicoAtivo: async function () {
            const activeTabId = _deps.getActiveTabId();
            
            if (!activeTabId) {
                _deps.exibirToast("Selecione um tópico de Embargos antes de exportar.", 'aviso');
                return;
            }

            const topicosArray = _deps.getTopicos();
            const topicoAtivo = topicosArray.find(t => t.id === activeTabId);

            if (!topicoAtivo || !topicoAtivo.anotacoes || topicoAtivo.anotacoes.length === 0) {
                _deps.exibirToast("O tópico está vazio ou inválido.", 'aviso');
                return;
            }

            try {
                // 1. Gera e baixa o Markdown
                const config = ESQUEMAS_CONTEXTO['ED'];
                const nomeSanitizado = (topicoAtivo.nome || 'Exportacao_ED').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                
                // Leitura de estado baseada no DOM (Sem depender de variáveis de janela)
                const tagDom = document.getElementById('tag-numero-processo');
                const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
                const baseStr = numProcesso ? `${config.prefixoArquivo}${numProcesso}_` : config.prefixoArquivo;
                
                const nomeArquivoFinal = `${baseStr}${nomeSanitizado}.md`;
                
                const payloadTexto = _gerarMarkdown(topicoAtivo) + gerarLembreteFinalHierarquia(topicoAtivo);
                _downloadArquivo(nomeArquivoFinal, payloadTexto);

                _deps.exibirToast('Payload de ED gerado! Preparando imagens...', 'sucesso');

                // 2. Prepara e dispara fila de imagens (sincronizada com mapa visual)
                const filaDeDownloads = [];
                const mapaVisuais = _construirMapaVisualExport(topicoAtivo.anotacoes);
                (topicoAtivo.anotacoes || []).forEach((an, idx) => {
                    if (_ehCheckpoint(an)) return;
                    const numIdeia = mapaVisuais.get(idx);
                    if (an.tipo === 'imagem') {
                        filaDeDownloads.push({ dados: an.conteudo, nome: _gerarNomeArquivoImagem(topicoAtivo.id, numIdeia) });
                    }
                    if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                        an.itensCorrelacionados.forEach((corr, corrIdx) => {
                            if (corr.tipo === 'imagem') {
                                filaDeDownloads.push({ dados: corr.conteudo, nome: _gerarNomeArquivoImagem(topicoAtivo.id, numIdeia, corrIdx + 1) });
                            }
                        });
                    }
                });

                await _executarFilaDeDownloads(filaDeDownloads);

                // Gatilho visual acionado DEPOIS de todos os arquivos baixados
                if (window.TaskManager && typeof window.TaskManager.sinalizarTarefasPendentes === 'function') {
                    window.TaskManager.sinalizarTarefasPendentes();
                }

            } catch (error) {
                console.error('[ExportManager ED] Erro crítico na exportação:', error);
                _deps.exibirToast('Erro ao exportar Embargos. Verifique o console.', 'erro');
            }
        },

        /**
         * Retorna os dados do tópico ativo de forma segura para consumo da UI.
         * Atua como Single Source of Truth, mantendo a regra de negócio blindada.
         * @returns {{ nome: string, markdown: string } | null}
         */
        obterDadosDoTopicoAtivo: function(opcoes = {}) {
            const activeId = _deps.getActiveTabId();
            if (!activeId) return null;

            // [CORREÇÃO]: Busca a lista de tópicos injetada e filtra o ativo
            const topicosArray = _deps.getTopicos();
            const topicoAtivo = topicosArray.find(t => t.id === activeId);

            // Trava de segurança extra
            if (!topicoAtivo) {
                console.warn('[ExportManager] Tópico ativo não localizado na memória.');
                return null;
            }

            const temAnotacoes = Array.isArray(topicoAtivo.anotacoes) && topicoAtivo.anotacoes.length > 0;
            const temPreambuloOuGlobal = Boolean(
                topicoAtivo.alegacoes ||
                topicoAtivo.fundamentos ||
                topicoAtivo.veredito ||
                (Array.isArray(topicoAtivo.diretrizesGlobais) && topicoAtivo.diretrizesGlobais.length > 0)
            );

            if (!temAnotacoes && !(opcoes.permitirSemAnotacoes && temPreambuloOuGlobal)) {
                return null;
            }

            return {
                nome: topicoAtivo.nome || 'Vício Não Nomeado',
                markdown: _gerarMarkdown(topicoAtivo, opcoes)
            };
        },
        SCHEMA_EXPORT_VERSAO,
        TITULO_SECAO_AUDITORIA,
        REGIME_INTENCOES,
        CHAVE_TESE_SEM_NOME,
        enveloparTeorIntegral,
        gerarLegendaRegimesRedacionais,
        formatarNoEditorialMarkdown,
        gerarLembreteFinalHierarquia,
        verificarAncorasLiteraisNoRascunho,
        isAuditoriaCriticaAtiva,
        setAuditoriaCriticaAtiva,
        abrirPainelExportacao, 
        fecharPainelExportacao, 
        gerarExportacaoPersonalizada,
        getDocLabel,
        aplicarFiltrosAvancados,
        abrirModalFiltro,
        fecharModalFiltro,
        validarTamanhoFiltro,
        salvarFiltro,
        limparFiltro,
        copiarChaveHandoff: function() {
            const activeId = _deps.getActiveTabId();
            const topico = _deps.getTopicos().find(t => t.id === activeId);
            
            if (!topico || !topico.volumeData || !topico.volumeData.chkId) {
                _deps.exibirToast('A aba atual não é um Volume de Continuação.', 'aviso');
                return;
            }
            
            const chave = `[COMANDO DE CONTINUAÇÃO DE MINUTA — HANDOFF]\nVocê receberá, nesta ordem: (1) o checkpoint ${topico.volumeData.chkId} da auditoria parcial; (2) o CONTEXTO RAG do tópico "${topico.nome}".\nPassos obrigatórios: 1. MANIFESTO: diga onde parou e escopo. AGUARDE aprovação. 2. CHECAGEM: se o ID não for ${topico.volumeData.chkId}, PARE. 3. CONTINUAÇÃO: redija SOMENTE o trecho continuado, sem reescrever o já redigido.`;
            
            navigator.clipboard.writeText(chave).then(() => {
                _deps.exibirToast('Chave de Handoff copiada! Cole na IA antes do Export.', 'sucesso');
            }).catch(err => {
                _deps.exibirToast('Erro ao copiar a Chave.', 'erro');
            });
        }
    };

})();