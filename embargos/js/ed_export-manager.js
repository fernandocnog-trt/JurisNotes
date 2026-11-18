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

    const CHAVE_TESE_SEM_NOME = 'Tese Não Nomeada';
    const STORAGE_KEY_AUDITORIA = 'juris_ed_auditoria_critica_ia';
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

    function gerarLembreteFinalHierarquia(topico, opcoes = {}) {
        const auditoria = opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva();
        const temCheckpointSaida = topico && Array.isArray(topico.anotacoes) && topico.anotacoes.some(a => a && a.tipo === 'checkpoint_saida');

        let fecho = `\n<lembrete_final_de_hierarquia_e_auditoria>\n`;
        fecho += `1. SOBERANIA DECISÓRIA (EMBARGOS): Redija o voto obedecendo estritamente às premissas, textos fixos, normas e julgados validados em <diretrizes_de_auditoria_do_assessor>, <direcionamentos_por_vicio> e <premissas_globais_da_auditoria> (Precedência: Veredito > Global > Vício > Local).\n`;
        fecho += `2. REGRA NORMATIVA E DE CONTEXTO: Ignore como verdade fática alegações unilaterais de <contexto_processual_nao_vinculante> ou de inteiros teores. Use primeiro as normas e julgados dos Nós de Ideia (locais, do vício ou globais). Fora deles, só cite dispositivo de lei seca de cuja redação tenha certeza ou norma aplicada na decisão compatível com o Nó de Ideia, marcando cada citação extra-nó com [CONFERIR]. Nunca cite súmula, OJ, ementa ou número de precedente fora de um Nó de Ideia.\n`;
        if (auditoria) {
            fecho += `3. ORDEM DE ENCERRAMENTO OBRIGATÓRIA: (1º) Redija a minuta seguindo fielmente os Nós de Ideia; (2º) Logo após a minuta, emita a seção isolada "### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]" (apontando erro material grosseiro, intempestividade, risco de rejulgamento ou contradição frontal com os autos, ou declarando "Nenhuma inconsistência material ou processual grave detectada.")`;
            fecho += temCheckpointSaida
                ? `; (3º) Por último, encerre com o bloco "CHECKPOINT DE CONTINUIDADE" exigido pela ponte de saída.\n`
                : `.\n`;
        }
        fecho += `</lembrete_final_de_hierarquia_e_auditoria>\n`;
        return fecho;
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
     * Motor Privado de Geração de Payload (Roteiro do Diretor em XML/MD)
     * OTIMIZADO COM BUFFERS CONDICIONAIS E MAPEAMENTO LÉXICO
     */
    function _gerarMarkdown(topico, opcoes = {}) {
        const config = ESQUEMAS_CONTEXTO['ED'];
        const modoPrompt = opcoes.modo || 'minuta';
        const incluirNomesImagens = opcoes.incluirNomesImagens !== undefined ? opcoes.incluirNomesImagens : true;
        const auditoriaAtiva = modoPrompt === 'acervo'
            ? false
            : (opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva());

        const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;

        // Coleta de escopo global (Bubble-up)
        const barreirasAdmissibilidade = [];
        const vereditosLocaisInjetados = []; 
        const diretrizesGlobaisGerais = [];

        let md = `<!-- [ESQUEMA JN-ED v4.1 — HIERARQUIA EPISTEMOLÓGICA ESTRITA] -->\n`;
        md += `# ${config.tituloTopico}: **${(topico.nome || 'Não Nomeado').toUpperCase()}**\n\n`;

        md += `<hierarquia_epistemologica_e_regras_de_auditoria>\n`;
        md += `[REGRA DE OURO]: Este pacote separa rigorosamente CONTEXTO PROCESSUAL (não-vinculante) de NÓS DE IDEIA DO GABINETE (verdade e diretriz absoluta). Nunca presuma fatos fora destes blocos.\n\n`;
        md += `1. TABELA DE ESTATUTOS DO <contexto_processual_nao_vinculante>:\n`;
        md += `   - [ALEGACAO_EMBARGOS_OU_RECURSO]: Razões de embargos/recurso. Serve APENAS para delimitar o vício alegado e aferir inovação. NÃO é prova de erro ou omissão.\n`;
        md += `   - [CONTRAMINUTA_OU_CONTRARRAZOES]: Resistência da parte contrária e preliminares. NÃO é fato provado.\n`;
        md += `   - [LIMITES_DA_LIDE_ALEGACAO]: Inicial, contestação, impugnação ou manifestação de parte. Serve apenas para aferir limites objetivos da lide.\n`;
        md += `   - [DECISAO_EMBARGADA_OU_ORIGEM]: Decisão sob auditoria. Prevalece no que for mantida pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia prevalece.\n`;
        md += `   - [ATO_JUDICIAL_OFICIAL]: Certidões, despachos e atos oficiais (interpretados segundo os Nós de Ideia).\n`;
        md += `   - [ELEMENTO_PROBATORIO_BRUTO]: Prova documental/pericial/oral cuja valoração subordina-se estritamente aos Nós de Ideia (em ED é vedado rejulgamento fático).\n\n`;
        md += `2. REGRA DE BLINDAGEM NORMATIVA E MARCADOR [CONFERIR]:\n`;
        md += `   - A citação de norma ou julgado pela parte não é motivo para adotá-lo.\n`;
        md += `   - Use primeiro as normas e julgados fornecidos nos Nós de Ideia (locais, do vício ou globais). Fora deles, você só pode citar dispositivo de lei seca de cuja redação tenha certeza ou norma aplicada na decisão (compatível com o Nó de Ideia), marcando cada citação extra-nó com [CONFERIR].\n`;
        md += `   - Nunca cite súmula, OJ, ementa ou número de precedente que não esteja em um Nó de Ideia.\n\n`;
        md += `3. SOBERANIA DOS NÓS DE IDEIA (<diretrizes_de_auditoria_do_assessor>, <direcionamentos_por_vicio>, <premissas_globais_da_auditoria>):\n`;
        md += `   - Tudo o que o assistente definiu nos Nós de Ideia constitui a VERDADE FÁTICA PACIFICADA e a DIRETRIZ ABSOLUTA do gabinete (Precedência: Veredito > Global > Vício > Local).\n`;
        md += `</hierarquia_epistemologica_e_regras_de_auditoria>\n\n`;

        if (auditoriaAtiva) {
            md += `<protocolo_de_senso_critico_e_auditoria>\n`;
            md += `[OBEDIÊNCIA INTEGRAL NA MINUTA + AUDITORIA ISOLADA AO FINAL]:\n`;
            md += `- Na minuta, cumpra 100% do enquadramento determinado pelo assistente nos Nós de Ideia. Nunca desobedeça a um Nó de Ideia dentro do texto do voto.\n`;
            md += `- Contudo, audite friamente os Nós de Ideia frente aos autos. Se detectar erro material grosseiro (ex: inversão de polos, efeito modificativo sem oitiva prévia quando exigível, intempestividade evidente, tentativa de rejulgamento fático sob pretexto de vício) ou contradição frontal com prova cabal dos autos:\n`;
            md += `  1. Mantenha o cumprimento da diretriz na minuta;\n`;
            md += `  2. Ao final da minuta (e ANTES do bloco de Checkpoint de Continuidade, se houver), crie obrigatoriamente a seção isolada:\n`;
            md += `     "### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]"\n`;
            md += `  3. Caso haja inconsistência grave, descreva-a citando IDs/folhas para confirmação humana. Caso não haja nenhuma anomalia, escreva exatamente: "Nenhuma inconsistência material ou processual grave detectada."\n`;
            md += `</protocolo_de_senso_critico_e_auditoria>\n\n`;
        }

        // 1. COMPILAÇÃO DO ROTEIRO ESTRUTURAL
        md += `<roteiro_diretor_llm>\n`;
        md += `  <incidente_processual>Embargos de Declaração</incidente_processual>\n`;
        md += `  <diretriz_cognitiva_vinculante>${config.diretrizIA}</diretriz_cognitiva_vinculante>\n`;
        md += `</roteiro_diretor_llm>\n\n`;

        md += `## SEÇÃO I — ESCOPO DA AUDITORIA\n\n`;
        md += `<escopo_auditoria>\n`;
        md += `  <alegacao_vicio>\n${_safeMD(topico.alegacoes || 'Nenhum vício apontado.')}\n  </alegacao_vicio>\n`;
        md += `  <decisao_embargada>\n${_safeMD(topico.fundamentos || 'Nenhum trecho da decisão embargada colado.')}\n  </decisao_embargada>\n`;
        md += `</escopo_auditoria>\n\n`;

        // [INÍCIO DA INSERÇÃO] - Injeção dos Dados do Contrato de Trabalho para a IA
        if (window.ContratoManager) {
            const dadosContrato = window.ContratoManager.getDados();
            if (dadosContrato.admissao || dadosContrato.demissao || dadosContrato.funcao) {
                md += `<contexto_fatico_vinculo_empregaticio>\n`;
                if (dadosContrato.funcao) md += `  [Função Exercida]: ${dadosContrato.funcao}\n`;
                if (dadosContrato.admissao) {
                    // Formata a data (de YYYY-MM-DD para DD/MM/YYYY) para a IA ler de forma nativa
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
        // [FIM DA INSERÇÃO]

        // 2. INJEÇÃO DAS DIRETRIZES GLOBAIS DA IA
        if (topico.diretrizesGlobais && topico.diretrizesGlobais.length > 0) {
            const globaisValidas = topico.diretrizesGlobais.filter(dir => dir.intencao !== 'nota');
            if (globaisValidas.length > 0) {
                md += `<premissas_globais_da_auditoria>\n`;
                globaisValidas.forEach(dir => {
                    md += `  - [REGRA GERAL]: ${_safeMD(dir.texto, '\n  ')}\n`; // Correção de blockquote
                });
                md += `</premissas_globais_da_auditoria>\n\n`;
            }
        }

        // CORREÇÃO: BUFFER CONDICIONAL E MAPEAMENTO DE VÍCIO
        let bufferVicios = '';
        if (topico.diretrizesPorVicio && Object.keys(topico.diretrizesPorVicio).length > 0) {
            Object.keys(topico.diretrizesPorVicio).forEach(nomeVicio => {
                const diretrizes = topico.diretrizesPorVicio[nomeVicio];
                if (diretrizes && diretrizes.length > 0) {
                    const diretrizesValidas = diretrizes.filter(dir => dir.intencao !== 'nota');
                    if (diretrizesValidas.length > 0) {
                        
                        // [NOVO] MAPEAMENTO ESTRUTURAL PARA A IA: Sincronia perfeita com a UI
                        const tesesVinculadas = topico.anotacoes
                            .filter(an => (an.vicio || topico.vicio) === nomeVicio && an.tese && an.tese.trim() !== '')
                            .map(an => an.tese.trim());
                        
                        const tesesUnicas = [...new Set(tesesVinculadas)];
                        const stringTeses = tesesUnicas.length > 0 ? tesesUnicas.join(' | ') : 'Aguardando definição do usuário na Matriz.';

                        bufferVicios += `<vicio_alvo>\n`;
                        bufferVicios += `[NOME DO VÍCIO]: ${_escapeXmlAttr(nomeVicio)}\n`;
                        bufferVicios += `[TESES RECURSAIS ENVOLVIDAS]: ${_escapeXmlAttr(stringTeses)}\n`;
                        
                        diretrizesValidas.forEach(dir => {
                             bufferVicios += `[INSTRUÇÃO DE ANÁLISE]: ${_safeMD(dir.texto, '\n')}\n`;
                        });
                        bufferVicios += `</vicio_alvo>\n\n`;
                    }
                }
            });
        }
        
        if (bufferVicios.trim() !== '') {
            md += `<direcionamentos_por_vicio>\n[ATENÇÃO IA]: Aplique estas métricas estritas ao auditar o vício correspondente.\n\n${bufferVicios}</direcionamentos_por_vicio>\n\n`;
        }

        md += `## SEÇÃO II — ${config.rotuloSeccao}\n`;
        md += `*Atenção IA: Aqui estão as provas documentais do vício formal. É proibido reavaliar o mérito originário da causa baseando-se nestes extratos.*\n\n`;

        if (!topico.anotacoes || topico.anotacoes.length === 0) {
            md += `*Nenhum elemento processual foi anexado para auditoria.*\n`;
        } else {
            // [NOVO CÓDIGO: Máquina de estado para controle de tags XML]
            let ultimaTeseExportada = null;

            // 3. ITERAÇÃO PROFUNDA COM ENVELOPAMENTO XML
            topico.anotacoes.forEach((an, idx) => {
                // INTERCEPTADOR DE MÓDULOS DE CONTINUIDADE (HANDOFF RAG)
                if (an.tipo === 'checkpoint_saida') {
                    const meta = an.metaHandoff;
                    md += `\n⛓️ PONTE DE CONTINUIDADE (SAÍDA) + COMANDO DE GERAÇÃO PARCIAL\n`;
                    md += `→ CONTINUA NO TÓPICO: "${meta.alvo}"\n`;
                    md += `→ COMANDO DE GERAÇÃO PARCIAL: ao auditar este vício, NÃO escreva conclusão, pedidos finais ou parágrafo de fecho; interrompa após a última seção e encerre com bloco "CHECKPOINT DE CONTINUIDADE" contendo [ID] CHK-${meta.slug}-v${meta.versao}, [STATUS], [JÁ REDIGIDO], [PREMISSAS FIXADAS], [PENDÊNCIAS].\n`;
                    md += `→ ORDEM DE LEITURA: processe este contexto integralmente e só então abra o contexto de "${meta.alvo}", tratando-o como capítulo continuado.\n\n`;
                    return;
                } else if (an.tipo === 'checkpoint_entrada') {
                    const meta = an.metaHandoff;
                    md += `\n⛓️ PONTE DE CONTINUIDADE (CHEGADA) + COMANDO DE RETOMADA\n`;
                    md += `← ORIGEM: continuação direta da auditoria "${meta.origem}" via checkpoint CHK-${meta.slug}-v${meta.versao}.\n`;
                    md += `← VEDAÇÃO: não re-provar nem reescrever itens de [JÁ REDIGIDO] do checkpoint; remeta-os como "conforme estabelecido na etapa anterior".\n`;
                    md += `← WORKFLOW: antes de redigir, localizar o checkpoint CHK-${meta.slug}-v${meta.versao} e aplicar o [COMANDO DE CONTINUAÇÃO DE MINUTA — HANDOFF].\n\n`;
                    return;
                }

                const teseAtual = (an.tese && an.tese.trim() !== '') ? an.tese.trim() : CHAVE_TESE_SEM_NOME;
                const vicioAtual = an.vicio || topico.vicio || 'Nao Especificado';

                // Lógica Cirúrgica: Fechar grupo anterior e abrir novo grupo se houver quebra
                if (teseAtual !== ultimaTeseExportada) {
                    if (ultimaTeseExportada !== null) {
                        md += `</grupo_tese>\n\n`; // Fecha o cluster anterior
                    }
                    md += `<grupo_tese vicio_investigado="${_escapeXmlAttr(vicioAtual)}" delimitacao_faticas_da_tese="${_escapeXmlAttr(teseAtual)}">\n`;
                    ultimaTeseExportada = teseAtual;
                }

                const numIdeia = idx + 1;
                const refCitacao = _formatarCitacaoOficial(an.pjeId, an.pagina);
                const estatutoMestre = _obterEstatutoEpistemologico(an);
                    
                // Avaliação OK: Utiliza o SSOT com renderHtml=false para garantir uma string limpa no payload da IA
                const tituloVicio = window.JurisUtils.obterBadgeTeseCompleto(an.vicio || topico.vicio, an.tese, false) || 'Auditoria Geral';

                md += `<analise_de_evidencia>\n`;
                md += `[IDENTIFICADOR DA EVIDÊNCIA]: ${numIdeia}\n`;
                md += `[VÍCIO VINCULADO]: ${_escapeXmlAttr(tituloVicio)}\n`;
                md += `[TESE VINCULADA]: ${_escapeXmlAttr(teseAtual)}\n`;
                
                const faseContexto  = an.fase || an.documento || 'Não especificado';
                const poloContexto  = an.polo || 'N/A';
                md += `<contexto_processual>\nFase: ${faseContexto} | Polo: ${poloContexto} | Ref: ${refCitacao} | Estatuto: ${estatutoMestre}\n</contexto_processual>\n\n`;

                md += `<contexto_processual_nao_vinculante>\n`;
                md += `[INSTRUÇÃO DE LEITURA]: Capte os elementos abaixo segundo seu [ESTATUTO] na tabela do topo. Em ED é vedado reexame fático; aplique com soberania absoluta as <diretrizes_de_auditoria_do_assessor>.\n\n`;
                const docLabel = `**[ESTATUTO: ${estatutoMestre}] [${an.documento || 'Elemento'}] (${poloContexto}) ${refCitacao}:**`;

                if (an.tipo === 'texto') {
                    const conteudoSeguro = _sanitizarContraInjecao(an.conteudo);
                    md += `- ${docLabel} ${_safeMD(conteudoSeguro, ' ')}\n`;
                    if (an.comentario) {
                        md += `  [APONTAMENTO DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}\n`;
                    }
                } else if (an.tipo === 'imagem') {
                    const imgRef = incluirNomesImagens
                        ? `(Nome: \`${_gerarNomeArquivoImagem(topico.id, numIdeia)}\`)`
                        : `[Recorte visual — ${refCitacao}]`;
                    md += `- ${docLabel}\n  [IMAGEM FORNECIDA PARA CONFERÊNCIA]: ${imgRef}.\n  [APONTAMENTO DO ASSESSOR]: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Verifique a falha estrutural demonstrada na imagem.'), '\n  ')}\n`;
                } else if (an.tipo === 'audio') {
                    try {
                        const ad = JSON.parse(an.conteudo);
                        const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                        md += `- ${docLabel} [OITIVA REGISTRADA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                        if (an.comentario) md += `  [OBSERVAÇÃO]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}\n`;
                        if (ad.transcricao) md += `  [DEGRAVAÇÃO LITERAL]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n  ')}"\n`;
                    } catch (e) {
                        md += `- ${docLabel} [ÁUDIO] Resumo: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Sem comentário.'), '\n  ')}\n`;
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
                            md += `${cDocLabel} ${_safeMD(corrConteudoSeguro, ' ')}\n`;
                            if (corr.comentario) {
                                md += `    [APONTAMENTO DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}\n`;
                            }
                        } else if (corr.tipo === 'imagem') {
                            const cImgRef = incluirNomesImagens
                                ? `\`${_gerarNomeArquivoImagem(topico.id, numIdeia, numSub)}\``
                                : `[Recorte visual — ${cRefCitacao}]`;
                            md += `${cDocLabel}\n    [IMAGEM ANEXA]: ${cImgRef}\n    [APONTAMENTO]: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Avalie a incongruência.'), '\n    ')}\n`;
                        } else if (corr.tipo === 'audio') {
                            try {
                                const ad = JSON.parse(corr.conteudo);
                                const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                                md += `${cDocLabel} [OITIVA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                                if (corr.comentario) md += `    [OBSERVAÇÃO]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}\n`;
                                if (ad.transcricao) md += `    [DEGRAVAÇÃO LITERAL]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n    ')}"\n`;
                            } catch (e) {
                                md += `${cDocLabel} [ÁUDIO] Contexto: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Ausente.'), '\n    ')}\n`;
                            }
                        }
                    });
                }
                
                md += `</contexto_processual_nao_vinculante>\n\n`;

                // CORREÇÃO: CONSOLIDAÇÃO DE DIRETRIZES LOCAIS EM UM ÚNICO BUFFER
                let bufferDiretrizesLocais = '';

                const processarNos = (listaNos, refContexto) => {
                    if (!listaNos || listaNos.length === 0) return;
                    
                    const nosValidos = listaNos.filter(sub => sub.intencao !== 'nota');
                    if (nosValidos.length === 0) return;

                    nosValidos.forEach((sub) => {
                        const intencao = sub.intencao || 'fallback';

                        // Tratamento assíncrono para texto literal (Verbatim)
                        if (intencao === 'texto') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO DE CÓPIA EXATA${refContexto}]\nTranscreva o bloco de texto abaixo exatamente como ele está escrito, palavra por palavra. Não altere a formatação e não parafraseie.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else if (intencao === 'jurisprudencia') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO: APLICAÇÃO DE JURISPRUDÊNCIA${refContexto}]\nTranscreva a ementa/julgado abaixo exatamente como fornecida (cópia literal). Em seguida, obrigatoriamente crie um parágrafo conectivo explicando de forma sucinta por que este julgado se amolda perfeitamente aos fatos incontroversos deste tópico.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else if (intencao === 'fundamentacao') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO: APLICAÇÃO DE LEI SECA / NORMA${refContexto}]\nTranscreva a legislação abaixo exatamente como fornecida (cópia literal). Em seguida, obrigatoriamente crie um parágrafo conectivo explicando de forma sucinta como esta lei incide e se aplica aos fatos incontroversos específicos deste tópico.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else if (intencao === 'degravacao') {
                            const textoExato = _stripInternalTags(sub.texto);
                            bufferDiretrizesLocais += `\n[INSTRUÇÃO: ANCORAGEM DE DEPOIMENTO ORAL${refContexto}]\nATENÇÃO: O trecho abaixo é um recorte curado pelo assessor extraído da transcrição da audiência já fornecida. Utilize este trecho exato entre aspas como a "prova cabal" (bala de prata) para sustentar a tese, atribuindo a fala ao orador correspondente.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                        } else {
                            const textoSanitizado = _safeMD(sub.texto, '\n');
                            
                            if (intencao === 'premissa') {
                                bufferDiretrizesLocais += `[CONSTATAÇÃO FORMAL INQUESTIONÁVEL${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'refutacao') {
                                bufferDiretrizesLocais += `[AFASTAMENTO DO VÍCIO OBRIGATÓRIO - INEXISTÊNCIA DE FALHA${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'comando') {
                                bufferDiretrizesLocais += `[COMANDO DE REDAÇÃO ESTRITO${refContexto}]: ${textoSanitizado}\n`;
                            } else if (intencao === 'fallback') {
                                bufferDiretrizesLocais += `[CONTEXTO FÁTICO COMPLEMENTAR PARA AUDITORIA${refContexto}]: ${textoSanitizado}\n`;
                            } 
                            // Escopo Global: Bubble-up
                            else if (intencao === 'preliminar') {
                                barreirasAdmissibilidade.push(`[Item ${numIdeia}${refContexto}]: ${textoSanitizado}`);
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
                            processarNos(corr.subAnotacoes, ` (Anexo: ${corr.documento || 'Documento'})`);
                        }
                    });
                }

                // Só abre a tag se de fato houverem regras locais (evita a maldição da tag vazia)
                if (bufferDiretrizesLocais.trim() !== '') {
                    md += `<diretrizes_de_auditoria_do_assessor>\n${bufferDiretrizesLocais}</diretrizes_de_auditoria_do_assessor>\n`;
                }

                md += `</analise_de_evidencia>\n\n`;
            });

            // [NOVO CÓDIGO: Trava de segurança no final do loop]
            // Garante o fechamento da última tag de grupo aberta
            if (ultimaTeseExportada !== null) {
                md += `</grupo_tese>\n\n`;
            }
        }

        // 4. INJEÇÃO GLOBAL (Bordas do Payload)
        if (barreirasAdmissibilidade.length > 0) {
            md += `<barreiras_de_admissibilidade_dos_embargos>\n`;
            md += `*Atenção IA: Resolva estes óbices (ex: intempestividade, inovação) ANTES de auditar o mérito dos embargos.*\n`;
            md += barreirasAdmissibilidade.map(c => `* 🛑 ${c}`).join('\n') + '\n';
            md += `</barreiras_de_admissibilidade_dos_embargos>\n\n`;
        }

        if ((topico.veredito && topico.veredito.trim() !== '') || vereditosLocaisInjetados.length > 0) {
            md += `<${config.tagVeredito}>\n`;
            md += `*Atenção IA: As instruções abaixo ditam o resultado final da auditoria deste embargo.*\n`;
            
            if (topico.veredito && topico.veredito.trim() !== '') {
                md += `[CONCLUSÃO OBRIGATÓRIA GERAL]: ${topico.veredito.replace(/\n/g, ' ')}\n`;
            }
            
            vereditosLocaisInjetados.forEach(v => {
                md += `[CONCLUSÃO PARCIAL ESPECÍFICA]: ${v}\n`;
            });
            
            md += `\n*Redija o dispositivo final (Acolher/Rejeitar, com ou sem efeito modificativo) obedecendo estritamente a este veredito.*\n`;
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

                // 2. Prepara e dispara fila de imagens
                const filaDeDownloads = [];
                topicoAtivo.anotacoes.forEach((an, idx) => {
                    const numIdeia = idx + 1;
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
        CHAVE_TESE_SEM_NOME,
        enveloparTeorIntegral,
        gerarLembreteFinalHierarquia,
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