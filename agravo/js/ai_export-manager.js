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

    // SINGLE SOURCE OF TRUTH — marcadores de sanitização (LGPD) e chave canônica
    const MARCADOR_OFICIAL_LGPD = '\n\n[AVISO DE SISTEMA: Dados sensíveis (ex: endereços) ou estruturais (cabeçalhos) foram ocultados pela Borracha Mágica para adequação à LGPD.]\n\n';
    const MARCADOR_RUIDOS = '\n\n[AVISO DE SISTEMA: Dados estruturais ocultados.]\n\n';
    const CHAVE_OBICE_SEM_NOME = 'Óbice Não Nomeado';
    const CHAVE_TESE_SEM_NOME = CHAVE_OBICE_SEM_NOME;
    const STORAGE_KEY_AUDITORIA = 'juris_auditoria_critica_ia';
    let _docConfigMapCache = null;

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
            console.warn('[ExportManager AI] Falha ao persistir preferência de auditoria:', e);
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
        },
        // INJEÇÃO DA NOVA MATRIZ COGNITIVA
        'AI': {
            prefixoArquivo: "Pacote_AI_JurisNotes_",
            tituloTopico: "AUDITORIA DE ADMISSIBILIDADE (AGRAVO DE INSTRUMENTO)",
            rotuloSeccao: "MATRIZ DE VERIFICAÇÃO DE PRESSUPOSTOS",
            tagAlegacao: "fundamentos_do_agravo",
            tagFundamento: "decisao_denegatoria_originaria",
            tagVeredito: "veredito_assessor_admissibilidade",
            diretrizIA: "Atue como auditor rigoroso de pressupostos processuais. Seu objetivo é analisar estritamente se o Agravo de Instrumento merece ser conhecido (destrancando o recurso originário) com base em tempestividade, adequação, preparo e representação. Não avalie o mérito da causa principal. Preste extrema atenção à natureza do documento anexado (Ex: Guias comprovam preparo; Certidões e Manifestações comprovam tempestividade; Procurações provam representação). Justifique a admissibilidade cruzando o tipo da prova com o pressuposto alegado."
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
        const modulo = window.JURIS_MODULE || 'AI';
        return `Evidencia_${modulo}_${topicoId}_Card_${hierarquia}.png`;
    }

    /**
     * Remove padrões de prompt injection e forjamento de tags XML em textos do PDF.
     */
    function _sanitizarContraInjecao(texto) {
        if (!texto) return '';
        return String(texto)
            .replace(/</g, '‹')
            .replace(/>/g, '›')
            .replace(/\[\s*(NÓ DE IDEIA|DIRETRIZ|ESTATUTO|VERDADE|COMANDO|PREMISSA|INSTRUÇÃO)/gi, '($1')
            .replace(/\b(IA|Modelo|GPT|LLM)\s*:/gi, '[SISTEMA]')
            .replace(/\bignore\s+(tudo|o\s+que|as\s+instru[çc][õo]es|o\s+prompt)\b/gi, '[FILTRADO]')
            .replace(/(^|[.!?\n])\s*(nova\s+)?instru[çc][aã]o\s*:/gim, '$1 [FILTRADO]:');
    }

    /**
     * Classifica de forma determinística O(1) o estatuto epistemológico do cartão no AI.
     */
    function _obterEstatutoEpistemologico(item) {
        const docUpper = String(item.documento || '').trim().toUpperCase();
        const poloUpper = String(item.polo || '').trim().toUpperCase();

        const mapa = _obterMapaDocConfig();
        const configEntry = mapa.get(docUpper) || null;
        let natureza = configEntry ? configEntry.natureza : null;

        if (natureza === 'hibrido_polo') {
            if (poloUpper.includes('JUÍZO') || poloUpper.includes('TRIBUNAL') || poloUpper.includes('SECRETARIA')) {
                natureza = 'ato_judicial_oficial';
            } else {
                natureza = 'alegacao_postulatoria';
            }
        }

        if (!natureza) {
            if (docUpper.includes('AGRAVO') || docUpper.includes('RECURSO')) natureza = 'alegacao_recurso';
            else if (docUpper.includes('CONTRAMINUTA') || docUpper.includes('CONTRARRAZ')) natureza = 'alegacao_contrarrazoes';
            else if (docUpper.includes('DENEGAT') || docUpper.includes('ADMISSIBILIDADE') || docUpper.includes('MONOCR') || docUpper.includes('ACÓRDÃO') || docUpper.includes('INTERLOCUT') || docUpper.includes('SENTENÇA')) natureza = 'decisao_recorrida';
            else if (docUpper.includes('CERTID') || docUpper.includes('SECRETARIA') || docUpper.includes('JUÍZO')) natureza = 'ato_judicial_oficial';
            else if (docUpper.includes('GUIA') || docUpper.includes('COMPROVANTE') || docUpper.includes('PROCURA') || docUpper.startsWith('DOCUMENTO:') || docUpper.includes('PROVA DOCUMENTAL') || item.tipo === 'audio') natureza = 'prova_autos';
            else if (docUpper.includes('MANIFESTA')) natureza = 'alegacao_postulatoria';
            else if (poloUpper.includes('JUÍZO') || poloUpper.includes('SECRETARIA') || poloUpper.includes('TRIBUNAL')) natureza = 'ato_judicial_oficial';
            else natureza = 'prova_autos';
        }

        const mapaCodigos = {
            'alegacao_recurso': 'ALEGACAO_RECURSAL',
            'alegacao_contrarrazoes': 'CONTRARRAZOES_DEFESA_RECURSAL',
            'alegacao_postulatoria': 'LIMITES_DA_LIDE_ALEGACAO',
            'decisao_recorrida': 'DECISAO_RECORRIDA_ORIGEM',
            'ato_judicial_oficial': 'ATO_JUDICIAL_OFICIAL',
            'prova_autos': 'ELEMENTO_PROBATORIO_BRUTO'
        };

        return mapaCodigos[natureza] || 'ELEMENTO_PROBATORIO_BRUTO';
    }

    /**
     * Envelopa e sanitiza inteiros teores extraídos por alfinetes ou colados manualmente.
     * Usa tokenização por palavra inteira para evitar colisões (ex: "ATA" em "CONTRATANTE").
     */
    function enveloparTeorIntegral(docTipo, textoLimpo) {
        if (!textoLimpo) return '';
        const strTexto = String(textoLimpo).trim();

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

        const tag = String(docTipo || 'DOCUMENTO').toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý0-9_]/gi, '_');
        const textoSeguro = _sanitizarContraInjecao(strTexto);

        const tokens = new Set(
            tag.normalize('NFD')
               .replace(/[\u0300-\u036f]/g, '')
               .split('_')
               .filter(Boolean)
        );
        const temAlgumToken = (...lista) => lista.some(t => tokens.has(t));

        let estatuto = 'PECA_OU_DOCUMENTO_COMPLEMENTAR_NAO_VINCULANTE';
        let diretrizLeitura = 'Peça ou documento complementar extraído dos autos. Subordine sua leitura e valoração estritamente às diretrizes dos Nós de Ideia.';

        if (temAlgumToken('SENTENCA', 'DECISAO', 'ACORDAO', 'DESPACHO')) {
            estatuto = 'DECISAO_RECORRIDA_ORIGEM';
            diretrizLeitura = 'Inteiro teor da decisão denegatória/origem. Use para relatório e aferição de dialeticidade. Prevalece apenas no que for mantido pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia revoga e substitui o entendimento da origem.';
        } else if (temAlgumToken('RECURSO', 'RO', 'AGRAVO', 'AP', 'CONTRARRAZOES', 'CONTRAMINUTA', 'INICIAL', 'CONTESTACAO', 'IMPUGNACAO', 'EMBARGOS', 'MANIFESTACAO', 'RAZOES')) {
            estatuto = 'ALEGACAO_DE_PARTE_NAO_VINCULANTE';
            diretrizLeitura = 'Inteiro teor de peça processual unilateral de parte. NÃO é verdade fática. Use APENAS para aferir limites do agravo/recurso, dialeticidade ou inovação recursal. A citação de norma ou julgado pela parte não é motivo para adotá-lo.';
        } else if (temAlgumToken('CERTIDAO', 'GUIA', 'CUSTAS', 'PREPARO', 'PROCURACAO', 'LAUDO', 'PERICIA', 'PERICIAL', 'ATA', 'OITIVA', 'DEPOIMENTO', 'PROVA')) {
            estatuto = 'ELEMENTO_PROBATORIO_BRUTO';
            diretrizLeitura = 'Inteiro teor de certidão/comprovante/elemento probatório dos autos. Sua valoração jurídica e conclusão subordinam-se estritamente ao enquadramento fixado nos Nós de Ideia.';
        }

        return `<${tag} estatuto_epistemologico="${estatuto}">\n[DIRETRIZ DE LEITURA CONTIDA]: ${diretrizLeitura}\n\n${textoSeguro}\n\n[FIM DE ${tag} — RETORNE À SOBERANIA DOS NÓS DE IDEIA]\n</${tag}>`;
    }

    /**
     * Gera âncora cognitiva final para neutralizar viés de recência após peças longas.
     */
    function gerarLembreteFinalHierarquia(topico, opcoes = {}) {
        const auditoria = opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva();
        const temCheckpointSaida = topico && Array.isArray(topico.anotacoes) && topico.anotacoes.some(a => a && a.tipo === 'checkpoint_saida');

        let fecho = `\n<lembrete_final_de_hierarquia_e_auditoria>\n`;
        fecho += `1. SOBERANIA DECISÓRIA: Construa a fundamentação obedecendo estritamente às premissas, textos fixos, normas e julgados validados em <diretrizes_de_auditoria_do_assessor>, <direcionamentos_por_pressuposto> e <premissas_globais_de_admissibilidade> (Precedência: Veredito > Global > Óbice/Pressuposto > Local).\n`;
        fecho += `2. REGRA NORMATIVA E DE CONTEXTO: Ignore como verdade fática alegações unilaterais de <contexto_processual_nao_vinculante> ou de inteiros teores. Use primeiro as normas e julgados dos Nós de Ideia (locais, do óbice ou globais). Fora deles, só cite dispositivo de lei seca de cuja redação tenha certeza ou norma aplicada na decisão de origem compatível com o Nó de Ideia, marcando cada citação extra-nó com [CONFERIR]. Nunca cite súmula, OJ, ementa ou número de precedente fora de um Nó de Ideia.\n`;
        if (auditoria) {
            fecho += `3. ORDEM DE ENCERRAMENTO OBRIGATÓRIA: (1º) Redija a minuta seguindo fielmente os Nós de Ideia; (2º) Logo após a minuta, emita a seção isolada "### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]" (apontando erro material grosseiro de prazo/preparo/representação, prescrição ou prova cabal contrária nos autos, ou declarando "Nenhuma inconsistência material ou prescricional grave detectada.")`;
            fecho += temCheckpointSaida
                ? `; (3º) Por último, encerre com o bloco "CHECKPOINT DE CONTINUIDADE" exigido pela ponte de saída.\n`
                : `.\n`;
        }
        fecho += `</lembrete_final_de_hierarquia_e_auditoria>\n`;
        return fecho;
    }

    /**
     * Motor Privado de Geração de Payload (Roteiro do Diretor em XML/MD)
     * OTIMIZADO PARA AGRAVO DE INSTRUMENTO (Admissibilidade + Hierarquia Epistemológica)
     */
    function _gerarMarkdown(topico, opcoes = {}) {
        const modoPrompt = opcoes.modo || 'minuta';
        const incluirNomesImagens = opcoes.incluirNomesImagens !== undefined ? opcoes.incluirNomesImagens : true;
        const auditoriaAtiva = modoPrompt === 'acervo'
            ? false
            : (opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva());

        const moduleContext = window.JURIS_MODULE || 'AI'; 
        const config = ESQUEMAS_CONTEXTO[moduleContext];
        const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;

        const barreirasAdmissibilidade = [];
        const jurisprudenciaVinculante = [];
        const vereditosLocaisInjetados = []; 

        let md = `<!-- [ESQUEMA JN v4.0 — HIERARQUIA EPISTEMOLÓGICA ESTRITA (AI)] -->\n`;
        md += `# ${config.tituloTopico}: **${(topico.nome || 'Não Nomeado').toUpperCase()}**\n\n`;

        // 1. COMPILAÇÃO DO ROTEIRO ESTRUTURAL E HIERARQUIA EPISTEMOLÓGICA
        md += `<roteiro_diretor_llm>\n`;
        md += `  <incidente_processual>Agravo de Instrumento</incidente_processual>\n`;
        md += `  <diretriz_cognitiva_vinculante>${config.diretrizIA}</diretriz_cognitiva_vinculante>\n`;
        md += `</roteiro_diretor_llm>\n\n`;

        md += `<hierarquia_epistemologica_e_regras_de_julgamento>\n`;
        md += `[REGRA DE OURO]: Este pacote separa rigorosamente CONTEXTO PROCESSUAL (não-vinculante) de NÓS DE IDEIA DO GABINETE (verdade e diretriz absoluta). Nunca presuma fatos fora destes blocos.\n\n`;
        md += `1. TABELA DE ESTATUTOS DO <contexto_processual_nao_vinculante> (CARTÕES PRINCIPAIS E CORRELACIONADOS):\n`;
        md += `   - [ALEGACAO_RECURSAL]: Minuta de agravo ou recurso trancado. Serve APENAS para relatar o inconformismo, delimitar o escopo e aferir dialeticidade ou inovação. NÃO é fato provado.\n`;
        md += `   - [CONTRARRAZOES_DEFESA_RECURSAL]: Contraminuta/contrarrazões. NÃO é fato provado.\n`;
        md += `   - [LIMITES_DA_LIDE_ALEGACAO]: Manifestações unilaterais das partes. NÃO é fato provado.\n`;
        md += `   - [DECISAO_RECORRIDA_ORIGEM]: Despacho denegatório ou decisão agravada. Serve de base para o relatório e aferição da dialeticidade. Prevalece apenas no que for mantido pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia revoga e substitui o entendimento da origem.\n`;
        md += `   - [ATO_JUDICIAL_OFICIAL]: Certidões de intimação/publicação, termos da secretaria e atos do juízo (dotados de fé pública, interpretados segundo os Nós de Ideia).\n`;
        md += `   - [ELEMENTO_PROBATORIO_BRUTO]: Guias de custas/depósito, comprovantes bancários, apólices, procurações e documentos. Sua valoração jurídica e conclusão subordinam-se estritamente aos Nós de Ideia.\n\n`;
        md += `2. REGRA DE BLINDAGEM NORMATIVA E MARCADOR [CONFERIR]:\n`;
        md += `   - A citação de norma ou julgado pela parte não é motivo para adotá-lo. Enfrente os argumentos da parte de forma técnica e fria, sem tomá-los por verdadeiros.\n`;
        md += `   - Use primeiro as normas e julgados fornecidos nos Nós de Ideia (locais, do óbice ou globais). Fora deles, você só pode citar dispositivo de lei seca de cuja redação tenha certeza ou norma já aplicada na decisão agravada (compatível com o Nó de Ideia), e deve marcar cada citação desse tipo com [CONFERIR].\n`;
        md += `   - Nunca cite súmula, OJ, ementa ou número de precedente que não esteja em um Nó de Ideia.\n\n`;
        md += `3. SOBERANIA DOS NÓS DE IDEIA (<diretrizes_de_auditoria_do_assessor>, <direcionamentos_por_pressuposto>, <premissas_globais_de_admissibilidade>):\n`;
        md += `   - Tudo o que o assistente definiu nos Nós de Ideia constitui a VERDADE FÁTICA PACIFICADA e a DIRETRIZ ABSOLUTA do gabinete (Precedência em caso de conflito: Veredito > Global > Óbice/Pressuposto > Local).\n`;
        md += `</hierarquia_epistemologica_e_regras_de_julgamento>\n\n`;

        if (auditoriaAtiva) {
            md += `<protocolo_de_senso_critico_e_auditoria>\n`;
            md += `[OBEDIÊNCIA INTEGRAL NA MINUTA + AUDITORIA ISOLADA AO FINAL]:\n`;
            md += `- Na minuta, cumpra 100% do enquadramento determinado pelo assistente nos Nós de Ideia. Nunca desobedeça a um Nó de Ideia dentro do texto do voto.\n`;
            md += `- Contudo, audite friamente os Nós de Ideia frente aos elementos objetivos do processo. Se detectar erro material grosseiro (ex: contagem equivocada de prazo frente à certidão de intimação, divergência de valor/vencimento em guia ou seguro-garantia, irregularidade de representação flagrante, inversão de polos), prescrição evidente ou contradição frontal com certidão/comprovante anexado:\n`;
            md += `  1. Mantenha o cumprimento da diretriz na minuta;\n`;
            md += `  2. Ao final da minuta (e ANTES do bloco de Checkpoint de Continuidade, se houver), crie obrigatoriamente a seção isolada:\n`;
            md += `     "### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]"\n`;
            md += `  3. Caso haja inconsistência grave, descreva-a citando IDs/folhas para confirmação humana. Caso não haja nenhuma anomalia, escreva exatamente: "Nenhuma inconsistência material ou prescricional grave detectada."\n`;
            md += `</protocolo_de_senso_critico_e_auditoria>\n\n`;
        }

        md += `## SEÇÃO I — ESCOPO DO TRANCAMENTO\n\n`;
        md += `<${config.tagAlegacao}>\n[CONTEXTO NÃO-VINCULANTE — SÍNTESE DO INCONFORMISMO]:\n${_safeMD(topico.alegacoes || 'Nenhum argumento do agravo descrito.')}\n</${config.tagAlegacao}>\n\n`;
        md += `<${config.tagFundamento}>\n[BASE PARA DIALETICIDADE — DECISÃO DE ORIGEM]:\n${_safeMD(topico.fundamentos || 'Nenhum trecho da decisão denegatória colado.')}\n</${config.tagFundamento}>\n\n`;

        if (window.ContratoManager) {
            const dadosContrato = window.ContratoManager.getDados();
            if (dadosContrato.admissao || dadosContrato.demissao || dadosContrato.funcao) {
                md += `<contexto_fatico_vinculo_empregaticio>\n`;
                if (dadosContrato.funcao) md += `  [Função Exercida]: ${dadosContrato.funcao}\n`;
                if (dadosContrato.admissao) {
                    const admArr = dadosContrato.admissao.split('-');
                    md += `  [Data de Admissão]: ${admArr.length === 3 ? `${admArr[2]}/${admArr[1]}/${admArr[0]}` : dadosContrato.admissao}\n`;
                }
                if (dadosContrato.demissao) {
                    const demArr = dadosContrato.demissao.split('-');
                    md += `  [Data de Demissão]: ${demArr.length === 3 ? `${demArr[2]}/${demArr[1]}/${demArr[0]}` : dadosContrato.demissao}\n`;
                }
                md += `</contexto_fatico_vinculo_empregaticio>\n\n`;
            }
        }

        // 2. INJEÇÃO DAS DIRETRIZES GLOBAIS
        if (topico.diretrizesGlobais && topico.diretrizesGlobais.length > 0) {
            const globaisValidas = topico.diretrizesGlobais.filter(dir => dir.intencao !== 'nota');
            if (globaisValidas.length > 0) {
                md += `<premissas_globais_de_admissibilidade>\n`;
                globaisValidas.forEach(dir => {
                    md += `  [${(dir.intencao === 'fundamentacao' ? 'LEI SECA GLOBAL' : dir.intencao || 'REGRA DE AUDITORIA GERAL').toUpperCase()}]: ${_safeMD(dir.texto, '\n  ')}\n`;
                });
                md += `</premissas_globais_de_admissibilidade>\n\n`;
            }
        }

        // CORREÇÃO CRÍTICA AI: Lê topico.diretrizesPorObice (usado pelo ai_topics-manager.js) além dos fallbacks
        let bufferPressupostos = '';
        const diretrizesPorTeseOuVicio = topico.diretrizesPorObice || topico.diretrizesPorTese || topico.diretrizesPorVicio || {};
        
        if (Object.keys(diretrizesPorTeseOuVicio).length > 0) {
            const tesesAncoradas = window.ThesisGuard
                ? ThesisGuard.mapearTesesAncoradas(topico)
                : new Set(
                    (topico.anotacoes || [])
                        .filter(a => a && !(a.tipo && a.tipo.startsWith('checkpoint')))
                        .map(a => (a.tese && a.tese.trim() !== '') ? a.tese.trim() : CHAVE_OBICE_SEM_NOME)
                );

            Object.keys(diretrizesPorTeseOuVicio).forEach(nomePressuposto => {
                const chaveNormalizada = nomePressuposto.trim() || CHAVE_OBICE_SEM_NOME;
                if (!tesesAncoradas.has(chaveNormalizada)) return;

                const diretrizes = diretrizesPorTeseOuVicio[nomePressuposto];
                if (diretrizes && diretrizes.length > 0) {
                    const diretrizesValidas = diretrizes.filter(dir => dir.intencao !== 'nota');
                    if (diretrizesValidas.length > 0) {
                        bufferPressupostos += `  <pressuposto_alvo>\n`;
                        bufferPressupostos += `    [NOME DO PRESSUPOSTO]: ${_escapeXmlAttr(chaveNormalizada)}\n`;
                        diretrizesValidas.forEach(dir => {
                             bufferPressupostos += `    [${(dir.intencao || 'MÉTRICA DE VALIDAÇÃO').toUpperCase()} — DIRETRIZ VINCULANTE DO ÓBICE]: ${_safeMD(dir.texto, '\n    ')}\n`;
                        });
                        bufferPressupostos += `  </pressuposto_alvo>\n`;
                    }
                }
            });
        }
        
        if (bufferPressupostos.trim() !== '') {
            md += `<direcionamentos_por_pressuposto>\n[ATENÇÃO IA]: Aplique estas métricas vinculantes do gabinete ao auditar o respectivo óbice/pressuposto.\n\n${bufferPressupostos}</direcionamentos_por_pressuposto>\n\n`;
        }
        
        md += `## SEÇÃO II — ${config.rotuloSeccao}\n`;
        md += `[ATENÇÃO IA]: Confronte o <contexto_processual_nao_vinculante> aplicando com peso absoluto as <diretrizes_de_auditoria_do_assessor>. É VEDADO julgar o mérito originário da causa.\n\n`;

        if (!topico.anotacoes || topico.anotacoes.length === 0) {
            md += `*Nenhum documento foi anexado para auditoria de admissibilidade.*\n`;
        } else {
            // 3. ITERAÇÃO DE EVIDÊNCIAS (Provas do Agravo)
            topico.anotacoes.forEach((an, idx) => {
                if (an.tipo === 'checkpoint_saida') {
                    const meta = an.metaHandoff;
                    md += `\n⛓️ PONTE DE CONTINUIDADE (SAÍDA) + COMANDO DE GERAÇÃO PARCIAL\n`;
                    md += `→ CONTINUA NO TÓPICO: "${meta.alvo}"\n`;
                    md += `→ COMANDO DE GERAÇÃO PARCIAL: ao redigir a minuta deste tópico, NÃO escreva conclusão, pedidos finais ou parágrafo de fecho; interrompa após a última seção do escopo (e após a seção [AUDITORIA DE QUALIDADE DO GABINETE], se ativa) e encerre por último com o bloco "CHECKPOINT DE CONTINUIDADE" contendo [ID] CHK-${meta.slug}-v${meta.versao}, [STATUS], [JÁ REDIGIDO], [PREMISSAS FIXADAS], [PENDÊNCIAS], [PONTO DE RETOMADA], [VEDAÇÕES].\n\n`;
                    return;
                } else if (an.tipo === 'checkpoint_entrada') {
                    const meta = an.metaHandoff;
                    md += `\n⛓️ PONTE DE CONTINUIDADE (CHEGADA) + COMANDO DE RETOMADA\n`;
                    md += `← ORIGEM: continuação direta do tópico "${meta.origem}" via minuta parcial com checkpoint CHK-${meta.slug}-v${meta.versao}.\n\n`;
                    return;
                }

                const numIdeia = idx + 1;
                const refCitacao = _formatarCitacaoOficial(an.pjeId, an.pagina);
                // Unificado com CHAVE_OBICE_SEM_NOME ("Óbice Não Nomeado") para casar 1:1 com <direcionamentos_por_pressuposto>
                const pressupostoContexto = window.ThesisGuard
                    ? ThesisGuard.obterChaveTese(an)
                    : ((an.tese && an.tese.trim() !== '') ? an.tese.trim() : CHAVE_OBICE_SEM_NOME);
                const estatutoMestre = _obterEstatutoEpistemologico(an);

                md += `<analise_de_evidencia>\n`;
                md += `[IDENTIFICADOR DA EVIDÊNCIA]: ${numIdeia}\n`;
                md += `[PRESSUPOSTO VINCULADO]: ${_escapeXmlAttr(pressupostoContexto)}\n`;
                if (an.vicio || topico.vicio) {
                    md += `[MODALIDADE DE ÓBICE]: ${_escapeXmlAttr(an.vicio || topico.vicio)}\n`;
                }
                
                const faseContexto  = an.fase || an.documento || 'Não especificado';
                const poloContexto  = an.polo || 'N/A';
                md += `<contexto_processual>\nFase: ${faseContexto} | Origem Documento: ${poloContexto} | Ref: ${refCitacao} | Estatuto: ${estatutoMestre}\n</contexto_processual>\n\n`;

                md += `<contexto_processual_nao_vinculante>\n`;
                md += `[INSTRUÇÃO DE LEITURA]: Capte os elementos abaixo segundo seu [ESTATUTO] na tabela do topo. PROIBIDO cópia literal, exceto se houver comando explícito em contrário nas diretrizes.\n\n`;
                const docLabel = `**[ESTATUTO: ${estatutoMestre}] [${an.documento || 'Comprovante'}] (${an.polo || 'Sem polo'}) ${refCitacao}:**`;

                if (an.tipo === 'texto') {
                    md += `- ${docLabel} ${_safeMD(_sanitizarContraInjecao(an.conteudo), ' ')}\n`;
                    if (an.comentario) {
                        md += `  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}\n`;
                    }
                } else if (an.tipo === 'imagem') {
                    const imgRef = incluirNomesImagens
                        ? `(Nome: \`${_gerarNomeArquivoImagem(topico.id, numIdeia)}\`)`
                        : `[Recorte visual — ${refCitacao}]`;
                    md += `- ${docLabel}\n  [IMAGEM DE COMPROVANTE FORNECIDA]: ${imgRef}.\n  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Verifique o dado contido nesta guia/certidão conforme Nós de Ideia.'), '\n  ')}\n`;
                } else if (an.tipo === 'audio') {
                    try {
                        const ad = JSON.parse(an.conteudo);
                        const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                        md += `- ${docLabel} [OITIVA DE AUDIÊNCIA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                        if (an.comentario) md += `  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}\n`;
                        if (ad.transcricao) md += `  [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n  ')}"\n`;
                    } catch (e) {
                        md += `- ${docLabel} [ÁUDIO REGISTRADO] Resumo: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Sem comentário.'), '\n  ')}\n`;
                    }
                }

                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        const numSub = corrIdx + 1;
                        const cRefCitacao = _formatarCitacaoOficial(corr.pjeId, corr.pagina);
                        const estatutoCorr = _obterEstatutoEpistemologico(corr);
                        const cDocLabel = `  [CONFRONTO DIRETO ${numSub} — ESTATUTO: ${estatutoCorr}]: [${corr.documento || 'Doc'}] (${corr.polo || 'Polo'}) ${cRefCitacao}:`;

                        if (corr.tipo === 'texto') {
                            md += `${cDocLabel} ${_safeMD(_sanitizarContraInjecao(corr.conteudo || ''), ' ')}\n`;
                            if (corr.comentario) {
                                md += `    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}\n`;
                            }
                        } else if (corr.tipo === 'imagem') {
                            const cImgRef = incluirNomesImagens
                                ? `\`${_gerarNomeArquivoImagem(topico.id, numIdeia, numSub)}\``
                                : `[Recorte visual — ${cRefCitacao}]`;
                            md += `${cDocLabel}\n    [IMAGEM ANEXA]: ${cImgRef}\n    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Avalie a validade conforme os Nós de Ideia.'), '\n    ')}\n`;
                        } else if (corr.tipo === 'audio') {
                            try {
                                const ad = JSON.parse(corr.conteudo);
                                const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                                md += `${cDocLabel} [OITIVA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                                if (corr.comentario) md += `    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}\n`;
                                if (ad.transcricao) md += `    [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n    ')}"\n`;
                            } catch (e) {
                                md += `${cDocLabel} [ÁUDIO] Contexto: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Ausente.'), '\n    ')}\n`;
                            }
                        }
                    });
                }
                
                md += `</contexto_processual_nao_vinculante>\n\n`;

                let bufferDiretrizesLocais = '';

                const processarNos = (listaNos, refContexto) => {
                    if (!listaNos || listaNos.length === 0) return;
                    
                    const nosValidos = listaNos.filter(sub => sub.intencao !== 'nota');
                    if (nosValidos.length === 0) return;

                    nosValidos.forEach((sub) => {
                        const intencao = sub.intencao || 'premissa'; 
                        
                        if (intencao === 'texto') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO DE CÓPIA EXATA${refContexto}]\nTranscreva o bloco de texto abaixo exatamente como ele está escrito, palavra por palavra. Não altere a formatação e não parafraseie.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else if (intencao === 'jurisprudencia') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO: APLICAÇÃO DE JURISPRUDÊNCIA${refContexto}]\nTranscreva a ementa/julgado abaixo exatamente como fornecida (cópia literal). Em seguida, obrigatoriamente crie um parágrafo conectivo explicando de forma sucinta por que este julgado se amolda perfeitamente às premissas fáticas validadas deste tópico.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else if (intencao === 'fundamentacao') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO: APLICAÇÃO DE LEI SECA / NORMA${refContexto}]\nTranscreva a legislação abaixo exatamente como fornecida (cópia literal). Em seguida, obrigatoriamente crie um parágrafo conectivo explicando de forma sucinta como esta lei incide e se aplica às premissas validadas deste tópico.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else if (intencao === 'degravacao') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO: ANCORAGEM DE DEPOIMENTO ORAL${refContexto}]\nATENÇÃO: O trecho abaixo é um recorte curado pelo assessor extraído da transcrição da audiência. Utilize este trecho exato entre aspas como prova cabal para sustentar a tese, atribuindo a fala ao orador correspondente.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else {
                            const textoSanitizado = _safeMD(sub.texto, '\n');

                            if (intencao === 'premissa') {
                                bufferDiretrizesLocais += `[CONSTATAÇÃO FORMAL INQUESTIONÁVEL E FATO PACIFICADO PELO GABINETE${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'refutacao') {
                                bufferDiretrizesLocais += `[AFASTAMENTO DO ÓBICE - PRESSUPOSTO ATENDIDO${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'comando') {
                                bufferDiretrizesLocais += `[COMANDO DE REDAÇÃO ESTRITO${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'fallback') {
                                bufferDiretrizesLocais += `[CONTEXTO COMPLEMENTAR VALIDADO${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'preliminar') {
                                barreirasAdmissibilidade.push(`[Óbice extrínseco ${numIdeia}${refContexto}]: ${textoSanitizado}`);
                            } else if (intencao === 'veredito') {
                                vereditosLocaisInjetados.push(`[Auditoria da Ideia ${numIdeia}${refContexto}]: ${textoSanitizado}`);
                            }
                        }
                    });
                };

                processarNos(an.subAnotacoes, '');

                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr) => {
                        if (corr.subAnotacoes && corr.subAnotacoes.length > 0) {
                            processarNos(corr.subAnotacoes, ` (Anexo: ${corr.documento || 'Comprovante'})`);
                        }
                    });
                }

                if (bufferDiretrizesLocais.trim() !== '') {
                    md += `<diretrizes_de_auditoria_do_assessor>\n[PESO ABSOLUTO]: Os Nós de Ideia abaixo constituem a verdade fática e jurídica validada pelo gabinete para esta evidência, prevalecendo sobre quaisquer alegações contrárias das partes ou da decisão agravada.\n${bufferDiretrizesLocais}</diretrizes_de_auditoria_do_assessor>\n`;
                }

                md += `</analise_de_evidencia>\n\n`;
            });
        }

        // 4. INJEÇÃO GLOBAL (Bordas do Payload)
        if (barreirasAdmissibilidade.length > 0) {
            md += `<barreiras_intransponiveis_ao_agravo>\n`;
            md += `[ATENÇÃO IA]: Óbices fatais validados pelo gabinete (ex: preclusão, erro grosseiro). Aplique ANTES de analisar os demais requisitos.\n`;
            md += barreirasAdmissibilidade.map(c => `[ÓBICE]: ${c}`).join('\n') + '\n';
            md += `</barreiras_intransponiveis_ao_agravo>\n\n`;
        }

        if (jurisprudenciaVinculante.length > 0) {
            md += `<base_legal_e_jurisprudencial>\n`;
            md += jurisprudenciaVinculante.map(c => `[BASE LEGAL]: ${c}`).join('\n') + '\n';
            md += `</base_legal_e_jurisprudencial>\n\n`;
        }

        if ((topico.veredito && topico.veredito.trim() !== '') || vereditosLocaisInjetados.length > 0) {
            md += `<${config.tagVeredito}>\n`;
            md += `[ATENÇÃO IA]: Estas instruções ditam o veredito vinculante da admissibilidade do recurso.\n`;
            
            if (topico.veredito && topico.veredito.trim() !== '') {
                md += `[CONCLUSÃO OBRIGATÓRIA GERAL]: ${topico.veredito.replace(/\n/g, ' ')}\n`;
            }
            
            vereditosLocaisInjetados.forEach(v => {
                md += `[CONCLUSÃO PARCIAL ESPECÍFICA]: ${v}\n`;
            });
            
            md += `\n[INSTRUÇÃO DE CONCLUSÃO]: Redija o dispositivo final (Conhecer/Não Conhecer, Dar/Negar Provimento ao Agravo para destrancar o recurso principal) obedecendo estritamente a este veredito.\n`;
            md += `</${config.tagVeredito}>\n`;
        }

        return md;
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

    // ─── HUB DE EXPORTAÇÃO RAG ──────────────────────────────────────────────
    let _documentosParaExtracaoCache = {};

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

        const moduloAtual = window.JURIS_MODULE === 'ED' ? 'Embargos' : 'Agravo';
        if (window.BalancaManager && !window.BalancaManager.executarGuardrailDeTarefas(`gerar o pacote de exportação de ${moduloAtual}`)) {
            _deps.exibirToast('Exportação interrompida pelo usuário.', 'aviso');
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
                sentenca: "Decisão / Sentença", recurso_autora: "Agravo (Autora)", recurso_re: "Agravo (Ré)",
                contrarrazões_autora: "Contraminuta (Autora)", contrarrazões_re: "Contraminuta (Ré)",
                inicial: "Recurso Ordinário"
            };

            const svgPin = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;

            for (const [docTipo, limites] of Object.entries(agrupados)) {
                const hasInicio = !!limites.inicio;
                const hasFim = !!limites.fim;
                const isCompleto = hasInicio && hasFim;
                
                if (isCompleto) _documentosParaExtracaoCache[docTipo] = limites;
                
                const nomeF = docNomes[docTipo] || docTipo.toUpperCase();
                
                const regras = _carregarRegrasFiltro();
                const hasRegra = !!regras[docTipo];
                
                const svgEraser = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
                const btnBorracha = `<button type="button" class="pin-eraser-btn trigger-borracha ${hasRegra ? 'is-active' : ''}" data-doc-tipo="${docTipo}" data-doc-nome="${_escapeXmlAttr(nomeF)}" title="Borracha Mágica">${svgEraser}</button>`;
                
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

        container.innerHTML = htmlBuffer.join('');
        
        // Delegação de Eventos para os botões da Borracha Mágica
        container.addEventListener('click', function(e) {
            const btnBorrachaTarget = e.target.closest('.trigger-borracha');
            if (btnBorrachaTarget) {
                e.preventDefault();
                const docTipo = btnBorrachaTarget.getAttribute('data-doc-tipo');
                const docNome = btnBorrachaTarget.getAttribute('data-doc-nome');
                abrirModalFiltro(docTipo, docNome);
            }
        });

        document.getElementById('export-avancado-backdrop').style.display = 'block';
        document.getElementById('modal-exportacao-avancada').style.display = 'block';

        const btnExportar = document.getElementById('btn-gerar-arquivo-exportacao');
        btnExportar.disabled = false;
        btnExportar.style.opacity = '1';

        container.addEventListener('change', function(e) {
            if (e.target && e.target.classList.contains('export-control-checkbox')) {
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
        const topicos = _deps.getTopicos();
        const topico = topicos.find(t => t.id === _deps.getActiveTabId());
        
        const btn = document.getElementById('btn-gerar-arquivo-exportacao');
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Extraindo Dados do PDF...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.7';

        try {
            let conteudoFinal = "";
            const elMatriz = document.getElementById('checkbox-matriz-export');
            const incluirMatriz = elMatriz && elMatriz.checked;
            const checkboxesDocsExtra = document.querySelectorAll('.extra-doc-checkbox:checked');
            const config = ESQUEMAS_CONTEXTO[window.JURIS_MODULE || 'AI'];

            // 1. Injeção de Contexto (Obrigatório para o LLM não se perder)
            if (incluirMatriz) {
                conteudoFinal += _gerarMarkdown(topico) + "\n\n";
            } else {
                const nomeTopicoFormatado = (topico.nome || 'Não Nomeado').toUpperCase();
                conteudoFinal += `# ${config.tituloTopico}: **${nomeTopicoFormatado}**\n`;
                conteudoFinal += `[AVISO DE SISTEMA]: O usuário optou por não enviar a matriz probatória. Use os documentos integrais abaixo para análise.\n\n`;
            }

            // 2. Anexação dos Documentos Complementares
            if (checkboxesDocsExtra.length > 0) {
                conteudoFinal += "<!-- ==========================================\n";
                conteudoFinal += incluirMatriz 
                    ? "     DOCUMENTOS COMPLEMENTARES ANEXOS\n" 
                    : "     TEOR INTEGRAL DE PEÇAS E DOCUMENTOS\n";
                conteudoFinal += "     ========================================== -->\n\n";

                for (const cb of checkboxesDocsExtra) {
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
                            null, // Callback de progress UI não era passado aqui no original
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
                        console.warn(`[ExportManager AI] Falha ao extrair ${docTipo}:`, extraError);
                        conteudoFinal += `<${tagName}>\n[AVISO DE SISTEMA: Falha na extração. Possível página corrompida.]\n</${tagName}>\n\n`;
                    }
                }
            }

            if (incluirMatriz) {
                conteudoFinal += gerarLembreteFinalHierarquia(topico);
            }

            // 3. Fila de Downloads Visuais (Restrita à Matriz)
            const filaDeDownloads = [];
            if (incluirMatriz) {
                topico.anotacoes.forEach((an, idx) => {
                    const numIdeia = idx + 1;
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
            const nomeBase = topico.nome || 'Exportacao_AI';
            const nomeSanitizado = nomeBase.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const tagDom = document.getElementById('tag-numero-processo');
            const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
            const prefixoProcessoStr = numProcesso ? `${numProcesso}_` : '';
            
            const sufixoArquivo = incluirMatriz ? "_CONTEXTO_RAG.txt" : "_TEOR_INTEGRAL.txt";
            const nomeArquivoFinal = `${config.prefixoArquivo}${prefixoProcessoStr}${nomeSanitizado}${sufixoArquivo}`;

            _downloadArquivo(nomeArquivoFinal, conteudoFinal, 'text/plain;charset=utf-8;');
            
            if(filaDeDownloads.length > 0) {
                _deps.exibirToast('Texto exportado. Iniciando imagens...', 'info');
                _executarFilaDeDownloads(filaDeDownloads);
            } else {
                _deps.exibirToast('Arquivo gerado com sucesso!', 'sucesso');
            }
            
            fecharPainelExportacao();

        } catch (error) {
            console.error(`[ExportManager AI] Erro fatal na exportação:`, error);
            _deps.exibirToast('Erro crítico ao gerar arquivo. Verifique o console.', 'erro');
        } finally {
            btn.innerHTML = originalText;
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        }
    }

    // ========================================================================
    // API PÚBLICA
    // ========================================================================
    
    function obterDadosDoTopicoAtivo(opcoes = {}) {
        const activeTabId = _deps.getActiveTabId();
        if (!activeTabId) return null;

        const topicosArray = _deps.getTopicos();
        if (!topicosArray || !Array.isArray(topicosArray)) return null;

        const topicoAtivo = topicosArray.find(t => t.id === activeTabId);
        if (!topicoAtivo) return null;

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
            nome: topicoAtivo.nome || 'Tópico Sem Nome',
            markdown: _gerarMarkdown(topicoAtivo, opcoes)
        };
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
        // Alterado de removerTrechoFuzzy (pesado) para a Regex tolerante para garantir 
        // a mesma estabilidade da limpeza alcançada no módulo RO.
        const regras = _carregarRegrasFiltro();
        if (regras[docTipo] && window.JurisUtils && window.JurisUtils.criarRegexDeRepeticao) {
            const regex = window.JurisUtils.criarRegexDeRepeticao(regras[docTipo]);
            if (regex) {
                // Remove o texto e deixa uma quebra de linha invisível para não poluir os tokens da IA
                textoProcessado = textoProcessado.replace(regex, '\n');
            }
        }

        // 3. CAMADA DE TERMOS CURTOS (LGPD) — Consome a função pura sem acoplamento com o DOM do modal
        if (window.QuickRedactManager && typeof window.QuickRedactManager.sanitizarString === 'function') {
            textoProcessado = window.QuickRedactManager.sanitizarString(textoProcessado);
        }

        return textoProcessado;
    }

    return {
        CHAVE_OBICE_SEM_NOME,
        CHAVE_TESE_SEM_NOME,
        obterDadosDoTopicoAtivo,
        abrirPainelExportacao,
        fecharPainelExportacao,
        gerarExportacaoPersonalizada,
        aplicarFiltrosAvancados,
        enveloparTeorIntegral,
        gerarLembreteFinalHierarquia,
        isAuditoriaCriticaAtiva,
        setAuditoriaCriticaAtiva,
        abrirModalFiltro,
        fecharModalFiltro,
        validarTamanhoFiltro,
        salvarFiltro,
        limparFiltro,
        
        init: function (dependencies) {
            _deps = { ..._deps, ...dependencies };
        },

        // Função legada mantida no objeto de retorno caso haja dependências antigas
        exportarTopicoAtivo: async function () {
            abrirPainelExportacao();
        }
    };

})();