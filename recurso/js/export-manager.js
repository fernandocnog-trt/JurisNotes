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
     * Gera âncora cognitiva final para neutralizar viés de recência após peças longas.
     */
    function gerarLembreteFinalHierarquia(topico, opcoes = {}) {
        const auditoria = opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva();
        const temCheckpointSaida = topico && Array.isArray(topico.anotacoes) && topico.anotacoes.some(a => a && a.tipo === 'checkpoint_saida');

        let fecho = `\n<lembrete_final_de_hierarquia_e_auditoria>\n`;
        fecho += `1. SOBERANIA DECISÓRIA: Construa a fundamentação obedecendo estritamente às premissas, textos fixos, normas e julgados validados em <diretrizes_vinculantes_do_assessor>, <direcionamentos_por_tese> e <diretrizes_globais_do_topico> (Precedência: Veredito > Global > Tese > Local).\n`;
        fecho += `2. REGRA NORMATIVA E DE CONTEXTO: Ignore como verdade fática alegações unilaterais de <contexto_processual_nao_vinculante> ou de inteiros teores. Use primeiro as normas e julgados dos Nós de Ideia (locais, da tese ou globais). Fora deles, só cite dispositivo de lei seca de cuja redação tenha certeza ou norma aplicada na sentença compatível com o Nó de Ideia, marcando cada citação extra-nó com [CONFERIR]. Nunca cite súmula, OJ, ementa ou número de precedente fora de um Nó de Ideia.\n`;
        if (auditoria) {
            fecho += `3. ORDEM DE ENCERRAMENTO OBRIGATÓRIA: (1º) Redija a minuta seguindo fielmente os Nós de Ideia; (2º) Logo após a minuta, emita a seção isolada "### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]" (apontando erro material grosseiro, prescrição ou prova cabal contrária, ou declarando "Nenhuma inconsistência material ou prescricional grave detectada.")`;
            fecho += temCheckpointSaida
                ? `; (3º) Por último, encerre com o bloco "CHECKPOINT DE CONTINUIDADE" exigido pela ponte de saída.\n`
                : `.\n`;
        }
        fecho += `</lembrete_final_de_hierarquia_e_auditoria>\n`;
        return fecho;
    }

    /**
     * Constrói o payload Markdown completo ("Roteiro do Diretor").
     * @param {Object} topico Tópico ativo.
     * @param {Object} [opcoes] { modo: 'minuta'|'acervo', auditoria: boolean, incluirNomesImagens: boolean }
     */
    function _gerarMarkdown(topico, opcoes = {}) {
        const modoPrompt = opcoes.modo || 'minuta';
        const incluirNomesImagens = opcoes.incluirNomesImagens !== undefined ? opcoes.incluirNomesImagens : true;
        const auditoriaAtiva = modoPrompt === 'acervo'
            ? false
            : (opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva());

        const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;

        const preliminaresInjetadas = [];
        const vereditosLocaisInjetados = [];
        const diretrizesGlobaisGerais = [];

        if (topico.diretrizesGlobais) {
            topico.diretrizesGlobais
                .filter(dir => dir.intencao !== 'nota')
                .forEach(dir => {
                    if (dir.intencao === 'preliminar') preliminaresInjetadas.push(`[DIRETRIZ GLOBAL]: ${_safeMD(dir.texto)}`);
                    else if (dir.intencao === 'veredito') vereditosLocaisInjetados.push(`[DIRETRIZ GLOBAL]: ${_safeMD(dir.texto)}`);
                    else {
                        diretrizesGlobaisGerais.push(`[${(dir.intencao === 'fundamentacao' ? 'LEI SECA GLOBAL' : dir.intencao || 'PREMISSA GLOBAL').toUpperCase()}]: ${_safeMD(dir.texto)}`);
                    }
                });
        }

        let mdCabecalho = `<!-- [ESQUEMA JN v4.0 — HIERARQUIA EPISTEMOLÓGICA ESTRITA] -->\n`;
        mdCabecalho += `# TÓPICO RECURSAL: **${(topico.nome || 'Tópico Sem Nome').toUpperCase()}**\n\n`;

        let mdHierarquia = `<hierarquia_epistemologica_e_regras_de_julgamento>\n`;
        mdHierarquia += `[REGRA DE OURO]: Este pacote separa rigorosamente CONTEXTO PROCESSUAL (não-vinculante) de NÓS DE IDEIA DO GABINETE (verdade e diretriz absoluta). Nunca presuma fatos fora destes blocos.\n\n`;
        mdHierarquia += `1. TABELA DE ESTATUTOS DO <contexto_processual_nao_vinculante> (CARTÕES PRINCIPAIS E CORRELACIONADOS):\n`;
        mdHierarquia += `   - [ALEGACAO_RECURSAL]: Razões de recurso/agravo. Serve APENAS para relatar o inconformismo, delimitar o efeito devolutivo e aferir interesse recursal ou inovação. NÃO é fato provado.\n`;
        mdHierarquia += `   - [CONTRARRAZOES_DEFESA_RECURSAL]: Resistência recursal e preliminares de não conhecimento. NÃO é fato provado.\n`;
        mdHierarquia += `   - [LIMITES_DA_LIDE_ALEGACAO]: Inicial, contestação, impugnação ou embargos. Serve APENAS para verificar limites objetivos da lide (causa de pedir/defesa) e preclusão/inovação. NÃO é fato provado.\n`;
        mdHierarquia += `   - [DECISAO_RECORRIDA_ORIGEM]: Sentença ou decisão atacada. Serve de base para o relatório e aferição da dialeticidade. Prevalece apenas no que for mantido pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia revoga e substitui o entendimento da origem.\n`;
        mdHierarquia += `   - [ATO_JUDICIAL_OFICIAL]: Título executivo, despachos e ordens constritivas oficiais (dotados de fé pública, interpretados segundo os Nós de Ideia).\n`;
        mdHierarquia += `   - [ELEMENTO_PROBATORIO_BRUTO]: Ata, oitiva, laudo ou documento. É prova bruta cuja valoração e conclusão jurídica subordinam-se estritamente aos Nós de Ideia (locais, da tese ou globais).\n\n`;
        mdHierarquia += `2. REGRA DE BLINDAGEM NORMATIVA E MARCADOR [CONFERIR]:\n`;
        mdHierarquia += `   - A citação de norma ou julgado pela parte não é motivo para adotá-lo. Enfrente os argumentos da parte de forma técnica e fria, sem tomá-los por verdadeiros.\n`;
        mdHierarquia += `   - Use primeiro as normas e julgados fornecidos nos Nós de Ideia (locais, da tese ou globais). Fora deles, você só pode citar dispositivo de lei seca de cuja redação tenha certeza ou norma já aplicada na sentença (compatível com o Nó de Ideia), e deve marcar cada citação desse tipo com [CONFERIR].\n`;
        mdHierarquia += `   - Nunca cite súmula, OJ, ementa ou número de precedente que não esteja em um Nó de Ideia.\n\n`;
        mdHierarquia += `3. SOBERANIA DOS NÓS DE IDEIA (<diretrizes_vinculantes_do_assessor>, <direcionamentos_por_tese>, <diretrizes_globais_do_topico>):\n`;
        mdHierarquia += `   - Tudo o que o assistente definiu nos Nós de Ideia constitui a VERDADE FÁTICA PACIFICADA e a DIRETRIZ ABSOLUTA do gabinete (Precedência em caso de conflito: Veredito > Global > Tese > Local).\n`;
        mdHierarquia += `</hierarquia_epistemologica_e_regras_de_julgamento>\n\n`;

        if (auditoriaAtiva) {
            mdHierarquia += `<protocolo_de_senso_critico_e_auditoria>\n`;
            mdHierarquia += `[OBEDIÊNCIA INTEGRAL NA MINUTA + AUDITORIA ISOLADA AO FINAL]:\n`;
            mdHierarquia += `- Na minuta, cumpra 100% do enquadramento determinado pelo assistente nos Nós de Ideia. Nunca desobedeça a um Nó de Ideia dentro do texto do voto.\n`;
            mdHierarquia += `- Contudo, audite friamente os Nós de Ideia frente ao processo. Se detectar erro material grosseiro (ex: inversão de polos, reforma em prejuízo do único recorrente, inovação recursal flagrante, ausência de interesse recursal), prescrição evidente, contradição entre dois Nós de Ideia ou prova cabal nos autos que refute frontalmente a premissa do assistente:\n`;
            mdHierarquia += `  1. Mantenha o cumprimento da diretriz na minuta;\n`;
            mdHierarquia += `  2. Ao final da minuta (e ANTES do bloco de Checkpoint de Continuidade, se houver), crie obrigatoriamente a seção isolada:\n`;
            mdHierarquia += `     "### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]"\n`;
            mdHierarquia += `  3. Caso haja inconsistência grave, descreva-a citando IDs/folhas para confirmação humana. Caso não haja nenhuma anomalia, escreva exatamente: "Nenhuma inconsistência material ou prescricional grave detectada."\n`;
            mdHierarquia += `</protocolo_de_senso_critico_e_auditoria>\n\n`;
        }

        let mdDiretrizesTeses = '';
        let bufferTeses = '';

        if (topico.diretrizesPorTese) {
            const tesesAncoradas = window.ThesisGuard
                ? ThesisGuard.mapearTesesAncoradas(topico)
                : new Set(
                    (topico.anotacoes || [])
                        .filter(a => a && !(a.tipo && a.tipo.startsWith('checkpoint')))
                        .map(a => (a.tese && a.tese.trim() !== '') ? a.tese.trim() : CHAVE_TESE_SEM_NOME)
                );

            for (const [nomeTese, diretrizes] of Object.entries(topico.diretrizesPorTese)) {
                const chaveNormalizada = nomeTese.trim() || CHAVE_TESE_SEM_NOME;
                if (!tesesAncoradas.has(chaveNormalizada)) continue;

                if (diretrizes && diretrizes.length > 0) {
                    const diretrizesValidas = diretrizes.filter(dir => dir.intencao !== 'nota');

                    if (diretrizesValidas.length > 0) {
                        bufferTeses += `<tese_alvo>\n`;
                        bufferTeses += `[NOME DA TESE]: ${_escapeXmlAttr(chaveNormalizada)}\n`;
                        diretrizesValidas.forEach(dir => {
                            bufferTeses += `[${(dir.intencao || 'PREMISSA').toUpperCase()} — DIRETRIZ VINCULANTE DA TESE]: ${_safeMD(dir.texto, '\n')}\n`;
                        });
                        bufferTeses += `</tese_alvo>\n\n`;
                    }
                }
            }
        }

        if (bufferTeses.trim() !== '') {
            mdDiretrizesTeses = `<direcionamentos_por_tese>\n[ATENÇÃO IA]: Regras estritas e vinculantes do gabinete aplicáveis ao momento em que redigir a tese correspondente.\n\n${bufferTeses}</direcionamentos_por_tese>\n\n`;
        }

        let mdMatriz = `<matriz_dialetica_e_provas>\n[ATENÇÃO IA]: Confronte o <contexto_processual_nao_vinculante> aplicando com peso absoluto as <diretrizes_vinculantes_do_assessor>. Nunca presuma fatos fora destes blocos.\n\n`;

        topico.anotacoes.forEach((an, index) => {
            if (an.tipo === 'checkpoint_saida') {
                const meta = an.metaHandoff;
                mdMatriz += `\n⛓️ PONTE DE CONTINUIDADE (SAÍDA) + COMANDO DE GERAÇÃO PARCIAL\n`;
                mdMatriz += `→ CONTINUA NO TÓPICO: "${meta.alvo}"\n`;
                mdMatriz += `→ COMANDO DE GERAÇÃO PARCIAL: ao redigir a minuta deste tópico, NÃO escreva conclusão, pedidos finais ou parágrafo de fecho; interrompa após a última seção do escopo (e após a seção [AUDITORIA DE QUALIDADE DO GABINETE], se ativa) e encerre por último com o bloco "CHECKPOINT DE CONTINUIDADE" contendo [ID] CHK-${meta.slug}-v${meta.versao}, [STATUS], [JÁ REDIGIDO], [PREMISSAS FIXADAS], [PENDÊNCIAS], [PONTO DE RETOMADA], [VEDAÇÕES].\n`;
                mdMatriz += `→ ORDEM DE LEITURA: processe este contexto integralmente e só então abra o contexto de "${meta.alvo}", tratando-o como capítulo continuado.\n\n`;
                return;
            } else if (an.tipo === 'checkpoint_entrada') {
                const meta = an.metaHandoff;
                mdMatriz += `\n⛓️ PONTE DE CONTINUIDADE (CHEGADA) + COMANDO DE RETOMADA\n`;
                mdMatriz += `← ORIGEM: continuação direta do tópico "${meta.origem}" via minuta parcial com checkpoint CHK-${meta.slug}-v${meta.versao}.\n`;
                mdMatriz += `← VEDAÇÃO: não re-provar nem reescrever itens de [JÁ REDIGIDO]/[PREMISSAS FIXADAS] do checkpoint; remeta-os como "conforme estabelecido no tópico recursal anterior".\n`;
                mdMatriz += `← WORKFLOW: antes de redigir, localizar o checkpoint CHK-${meta.slug}-v${meta.versao} e aplicar o [COMANDO DE CONTINUAÇÃO DE MINUTA — HANDOFF].\n\n`;
                return;
            }

            const numIdeia = index + 1;
            const refCitacao = _formatarCitacaoOficial(an.pjeId, an.pagina);
            // Unificado com CHAVE_TESE_SEM_NOME ("Tese Não Nomeada") para casar 1:1 com <direcionamentos_por_tese>
            const tituloIdeia = window.ThesisGuard
                ? ThesisGuard.obterChaveTese(an)
                : ((an.tese && an.tese.trim() !== '') ? an.tese.trim() : CHAVE_TESE_SEM_NOME);
            const estatutoMestre = _obterEstatutoEpistemologico(an);

            mdMatriz += `<analise_da_prova>\n`;
            mdMatriz += `[IDENTIFICADOR DA IDEIA]: ${numIdeia}\n`;
            mdMatriz += `[TESE VINCULADA]: ${_escapeXmlAttr(tituloIdeia)}\n`;

            const faseContexto = an.fase || an.documento || 'Não especificado';
            const poloContexto = an.polo || 'N/A';
            mdMatriz += `<contexto_processual>\nFase: ${faseContexto} | Polo: ${poloContexto} | Referência: ${refCitacao} | Estatuto: ${estatutoMestre}\n</contexto_processual>\n\n`;

            mdMatriz += `<contexto_processual_nao_vinculante>\n`;
            mdMatriz += `[INSTRUÇÃO DE LEITURA]: Capte os elementos abaixo segundo seu [ESTATUTO] na tabela do topo. PROIBIDO cópia literal, exceto se houver comando explícito em contrário nas diretrizes.\n\n`;

            const docLabel = `**[ESTATUTO: ${estatutoMestre}] [${an.documento || 'Elemento'}] (${an.polo || 'Sem polo'}) ${refCitacao}:**`;

            if (an.tipo === 'texto') {
                const conteudoSeguro = _sanitizarContraInjecao(an.conteudo);
                const conteudoProcessado = _truncarTextoParaIA(conteudoSeguro);
                mdMatriz += `- ${docLabel} ${conteudoProcessado.replace(/\n/g, ' ')}\n`;
                if (an.comentario) {
                    mdMatriz += `  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}\n`;
                }
            } else if (an.tipo === 'imagem') {
                const imgRef = incluirNomesImagens
                    ? `(Nome: \`${_gerarNomeArquivoImagem(numIdeia, null, an.pjeId, an.pagina)}\`)`
                    : `[Recorte visual — ${refCitacao}]`;
                mdMatriz += `- ${docLabel}\n  [IMAGEM FORNECIDA]: ${imgRef}.\n  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Integrar à fundamentação conforme Nós de Ideia.'), '\n  ')}\n`;
            } else if (an.tipo === 'audio') {
                try {
                    const ad = JSON.parse(an.conteudo);
                    const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                    mdMatriz += `- ${docLabel} [OITIVA DE AUDIÊNCIA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                    if (an.comentario) mdMatriz += `  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}\n`;
                    if (ad.transcricao) mdMatriz += `  [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n  ')}"\n`;
                } catch (e) {
                    mdMatriz += `- ${docLabel} [ÁUDIO] Resumo: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Sem comentário.'), '\n  ')}\n`;
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
                        mdMatriz += `${cDocLabel} ${_safeMD(corrConteudoProcessado, ' ')}\n`;
                        if (corr.comentario) {
                            mdMatriz += `    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}\n`;
                        }
                    } else if (corr.tipo === 'imagem') {
                        const cImgRef = incluirNomesImagens
                            ? `\`${_gerarNomeArquivoImagem(numIdeia, numSub, corr.pjeId, corr.pagina)}\``
                            : `[Recorte visual — ${cRefCitacao}]`;
                        mdMatriz += `${cDocLabel}\n    [IMAGEM ANEXA]: ${cImgRef}\n    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Analise a ligação técnica conforme os Nós de Ideia.'), '\n    ')}\n`;
                    } else if (corr.tipo === 'audio') {
                        try {
                            const ad = JSON.parse(corr.conteudo);
                            const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                            mdMatriz += `${cDocLabel} [OITIVA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                            if (corr.comentario) mdMatriz += `    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}\n`;
                            if (ad.transcricao) mdMatriz += `    [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n    ')}"\n`;
                        } catch (e) {
                            mdMatriz += `${cDocLabel} [ÁUDIO] Contexto: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Ausente.'), '\n    ')}\n`;
                        }
                    }
                });
            }

            mdMatriz += `</contexto_processual_nao_vinculante>\n\n`;

            let localNodesBuffer = '';

            const processarNos = (listaNos, refContexto) => {
                if (!listaNos || listaNos.length === 0) return;

                const nosValidos = listaNos.filter(sub => sub.intencao !== 'nota');
                if (nosValidos.length === 0) return;

                nosValidos.forEach((sub) => {
                    const intencao = sub.intencao || 'premissa';

                    if (intencao === 'texto') {
                        const textoExato = _stripInternalTags(sub.texto);
                        localNodesBuffer += `\n[INSTRUÇÃO DE CÓPIA EXATA${refContexto}]\nTranscreva o bloco de texto abaixo exatamente como ele está escrito, palavra por palavra. Não altere a formatação e não parafraseie.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                    } else if (intencao === 'jurisprudencia') {
                        const textoExato = _stripInternalTags(sub.texto);
                        localNodesBuffer += `\n[INSTRUÇÃO: APLICAÇÃO DE JURISPRUDÊNCIA${refContexto}]\nTranscreva a ementa/julgado abaixo exatamente como fornecida (cópia literal). Em seguida, obrigatoriamente crie um parágrafo conectivo explicando de forma sucinta por que este julgado se amolda perfeitamente às premissas fáticas validadas deste tópico.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                    } else if (intencao === 'fundamentacao') {
                        const textoExato = _stripInternalTags(sub.texto);
                        localNodesBuffer += `\n[INSTRUÇÃO: APLICAÇÃO DE LEI SECA / NORMA${refContexto}]\nTranscreva a legislação abaixo exatamente como fornecida (cópia literal). Em seguida, obrigatoriamente crie um parágrafo conectivo explicando de forma sucinta como esta lei incide e se aplica às premissas fáticas validadas deste tópico.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                    } else if (intencao === 'degravacao') {
                        const textoExato = _stripInternalTags(sub.texto);
                        localNodesBuffer += `\n[INSTRUÇÃO: ANCORAGEM DE DEPOIMENTO ORAL${refContexto}]\nATENÇÃO: O trecho abaixo é um recorte curado pelo assessor extraído da transcrição da audiência. Utilize este trecho exato entre aspas como a "prova cabal" (bala de prata) para sustentar a tese, atribuindo a fala ao orador correspondente.\n<texto_verbatim>\n${textoExato}\n</texto_verbatim>\n\n`;
                    } else {
                        const textoSanitizado = _safeMD(sub.texto, '\n');
                        if (intencao === 'premissa') {
                            localNodesBuffer += `[PREMISSA LÓGICA INQUESTIONÁVEL E FATO PACIFICADO PELO GABINETE${refContexto}]: ${textoSanitizado}\n`;
                        } else if (intencao === 'refutacao') {
                            localNodesBuffer += `[INSTRUÇÃO: AFASTAMENTO DE TESE${refContexto}]: ${textoSanitizado}\n`;
                        } else if (intencao === 'comando') {
                            localNodesBuffer += `[COMANDO DE EXECUÇÃO ESTRITA${refContexto}]: ${textoSanitizado}\n`;
                        } else if (intencao === 'fallback') {
                            localNodesBuffer += `[CONTEXTO FÁTICO COMPLEMENTAR VALIDADO${refContexto}]: ${textoSanitizado}\n`;
                        } else if (intencao === 'preliminar') {
                            preliminaresInjetadas.push(`[Referência da Ideia ${numIdeia}${refContexto}]: ${textoSanitizado}`);
                        } else if (intencao === 'veredito') {
                            vereditosLocaisInjetados.push(`[Baseado na Ideia ${numIdeia}${refContexto}]: ${textoSanitizado}`);
                        }
                    }
                });
            };

            processarNos(an.subAnotacoes, '');

            if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                an.itensCorrelacionados.forEach((corr) => {
                    if (corr.subAnotacoes && corr.subAnotacoes.length > 0) {
                        const docNome = corr.documento || corr.tipo;
                        const focoContexto = ` (Foco na Prova: ${docNome} ${corr.pagina ? 'fl.' + corr.pagina : ''})`;
                        processarNos(corr.subAnotacoes, focoContexto);
                    }
                });
            }

            if (localNodesBuffer.trim() !== '') {
                mdMatriz += `<diretrizes_vinculantes_do_assessor>\n[PESO ABSOLUTO]: Os Nós de Ideia abaixo constituem a verdade fática e jurídica validada pelo gabinete para esta ideia, prevalecendo sobre quaisquer alegações contrárias das partes ou da sentença.\n${localNodesBuffer}</diretrizes_vinculantes_do_assessor>\n`;
            }

            mdMatriz += `</analise_da_prova>\n\n`;
        });

        mdMatriz += `</matriz_dialetica_e_provas>\n`;

        let mdTags = '';
        const contexto = _inferirContextoProcessual(topico.anotacoes);

        if (contexto.isExecucao) {
            mdTags += `<diretriz_cognitiva_ia>\n*ALERTA:* O conjunto probatório deste tópico refere-se à **FASE DE EXECUÇÃO** (ex: Agravo de Petição). Seu raciocínio jurídico DEVE ser restrito aos limites da coisa julgada, cálculos de liquidação e preclusão. Atos de "Juízo / Tribunal" ou "Auxiliar da Justiça" representam atos oficiais e possuem presunção de veracidade.\n</diretriz_cognitiva_ia>\n\n`;
        } else if (contexto.isAI) {
            mdTags += `<diretriz_cognitiva_ia>\n*ALERTA:* O foco deste tópico é um **Agravo de Instrumento**. Sua redação deve focar primariamente em destrancar ou manter o trancamento do recurso principal, avaliando estritamente pressupostos de admissibilidade.\n</diretriz_cognitiva_ia>\n\n`;
        } else {
            mdTags += `<diretriz_cognitiva_ia>\n*ALERTA DE SISTEMA:* O foco deste tópico é a **Fase de Conhecimento** (ex: Recurso Ordinário). Analise o mérito da controvérsia confrontando o contexto não-vinculante das partes e da sentença sob a soberania absoluta das diretrizes fixadas nos Nós de Ideia.\n</diretriz_cognitiva_ia>\n\n`;
        }

        if (preliminaresInjetadas.length > 0) {
            mdTags += `<questoes_preliminares_e_prejudiciais>\n`;
            mdTags += `*Atenção IA: Você DEVE redigir e resolver estas questões temporais/processuais validadas pelo gabinete ANTES de iniciar a análise de mérito da Matriz Dialética.*\n`;
            mdTags += preliminaresInjetadas.map(c => `* ⏳ ${c}`).join('\n') + '\n';
            mdTags += `</questoes_preliminares_e_prejudiciais>\n\n`;
        }

        if (topico.alegacoes || topico.fundamentos) {
            mdTags += `<relatorio_do_conflito>\n`;
            mdTags += `*Atenção IA: Utilize estas sínteses para redigir a introdução do tópico recursal e aferir a dialeticidade. Trata-se de panorama das alegações e da decisão de origem, subordinado aos Nós de Ideia.*\n\n`;
            if (topico.alegacoes) {
                mdTags += `**Teses Recursais (O que a parte pede — Contexto Não-Vinculante):**\n${_safeMD(topico.alegacoes, '\n')}\n\n`;
            }
            if (topico.fundamentos) {
                mdTags += `**Fundamentos da Origem (Por que o juiz decidiu assim — Base para Dialeticidade):**\n${_safeMD(topico.fundamentos, '\n')}\n\n`;
            }
            mdTags += `</relatorio_do_conflito>\n\n`;
        }

        let mdVeredito = '';
        if ((topico.veredito && topico.veredito.trim() !== '') || vereditosLocaisInjetados.length > 0) {
            mdVeredito += `<decisao_magistrado_pretendida>\n`;
            mdVeredito += `*Atenção IA: As instruções abaixo ditam o resultado final vinculante do recurso. Siga-as para redigir o dispositivo.*\n`;

            if (topico.veredito) mdVeredito += `* CONTEXTO GERAL: ${topico.veredito.replace(/\n/g, ' ')}\n`;

            vereditosLocaisInjetados.forEach(v => {
                mdVeredito += `* CONCLUSÃO PARCIAL: ${v}\n`;
            });

            mdVeredito += `</decisao_magistrado_pretendida>\n\n`;
        }

        let mdDiretrizesGlobais = '';
        if (diretrizesGlobaisGerais.length > 0) {
            mdDiretrizesGlobais += `<diretrizes_globais_do_topico>\n`;
            mdDiretrizesGlobais += `*Atenção IA: Regras vinculantes do gabinete aplicáveis a TODO o recurso. Obedeça a elas independentemente da tese atual.*\n\n`;
            diretrizesGlobaisGerais.forEach(dir => {
                mdDiretrizesGlobais += `- ${dir}\n`;
            });
            mdDiretrizesGlobais += `</diretrizes_globais_do_topico>\n\n`;
        }

        const dadosContrato = window.ContratoManager ? window.ContratoManager.getDados() : null;
        let mdContrato = '';
        if (dadosContrato && (dadosContrato.inicio || dadosContrato.fim)) {
            const formatarData = (d) => d ? d.split('-').reverse().join('/') : 'Não informado';
            const temAjuizamento = !!dadosContrato.ajuizamento;

            mdContrato += `<parametros_contratuais>\n`;
            mdContrato += `[ALERTA DE SISTEMA - MARCO PRESCRICIONAL]:\n`;
            mdContrato += `O Assessor definiu os seguintes parâmetros incontroversos de vínculo:\n`;
            mdContrato += `- Início do contrato: ${formatarData(dadosContrato.inicio)}\n`;
            mdContrato += `- Término do contrato: ${formatarData(dadosContrato.fim)}\n`;
            mdContrato += `- Data de ajuizamento da ação: ${formatarData(dadosContrato.ajuizamento)}\n`;
            mdContrato += `- Função(ões): ${_safeMD(dadosContrato.funcao || 'Não informada', ' ')}\n\n`;

            mdContrato += `INSTRUÇÃO ESTRITA: Durante a análise do mérito e das parcelas deferidas, avalie a prescrição:\n`;
            mdContrato += `- PRESCRIÇÃO BIENAL: verifique se a "Data de ajuizamento" está a mais de 2 anos do "Término do contrato". Se estiver, TODO o direito de ação está prescrito.\n`;
            if (temAjuizamento) {
                mdContrato += `- PRESCRIÇÃO QUINQUENAL: são inexigíveis parcelas vencidas há mais de 5 anos contados retroativamente da "Data de ajuizamento" informada acima.\n`;
            } else {
                mdContrato += `- PRESCRIÇÃO QUINQUENAL: a "Data de ajuizamento" não foi informada — NÃO calcule o marco quinquenal; apenas sinalize [DADO INSUFICIENTE PARA PRESCRIÇÃO QUINQUENAL] caso essa análise seja relevante ao tópico.\n`;
            }
            if (auditoriaAtiva) {
                mdContrato += `Se identificar parcela deferida por diretriz do assistente fora de qualquer um destes limites, mantenha a diretriz na minuta, mas emita destaque explícito [ERRO PRESCRICIONAL IDENTIFICADO] na seção final [AUDITORIA DE QUALIDADE DO GABINETE], explicando o motivo.\n`;
            } else {
                mdContrato += `Se identificar parcela deferida fora de qualquer um destes limites, emita um destaque explícito [ERRO PRESCRICIONAL IDENTIFICADO], explicando o motivo.\n`;
            }
            mdContrato += `</parametros_contratuais>\n\n`;
        }

        return mdCabecalho + mdHierarquia + mdTags + mdContrato + mdVeredito + mdDiretrizesGlobais + mdDiretrizesTeses + mdMatriz;
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

            topico.anotacoes.forEach((an, index) => {
                const numIdeia = index + 1;

                if (an.tipo === 'imagem') {
                    filaDeDownloads.push({
                        dados: an.conteudo,
                        nome:  _gerarNomeArquivoImagem(numIdeia, null, an.pjeId, an.pagina),
                    });
                }

                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        if (corr.tipo === 'imagem') {
                            filaDeDownloads.push({
                                dados: corr.conteudo,
                                nome:  _gerarNomeArquivoImagem(numIdeia, corrIdx + 1, corr.pjeId, corr.pagina),
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
            const checkboxesDocsExtra = Array.from(document.querySelectorAll('.extra-doc-checkbox:checked'));

            // 1. Injeção de Contexto (Obrigatório para o LLM não se perder)
            if (incluirMatriz) {
                conteudoFinal += _gerarMarkdown(topico) + "\n\n";
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
                conteudoFinal += gerarLembreteFinalHierarquia(topico);
            }

            // 3. Fila de Downloads Visuais (Restrita à Matriz)
            const filaDeDownloads = [];
            if (incluirMatriz) {
                topico.anotacoes.forEach((an, index) => {
                    const numIdeia = index + 1;
                    if (an.tipo === 'imagem') filaDeDownloads.push({ dados: an.conteudo, nome: _gerarNomeArquivoImagem(numIdeia, null, an.pjeId, an.pagina) });
                    if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                        an.itensCorrelacionados.forEach((corr, corrIdx) => {
                            if (corr.tipo === 'imagem') filaDeDownloads.push({ dados: corr.conteudo, nome: _gerarNomeArquivoImagem(numIdeia, corrIdx + 1, corr.pjeId, corr.pagina) });
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
        enveloparTeorIntegral,
        gerarLembreteFinalHierarquia,
        isAuditoriaCriticaAtiva,
        setAuditoriaCriticaAtiva
    };

})();
