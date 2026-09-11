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

    function _obterChaveStorageFiltro() {
        const tagDom = document.getElementById('tag-numero-processo');
        const numProcesso = tagDom && tagDom.textContent.trim() ? tagDom.textContent.trim() : 'padrao';
        return `juris_filtros_${numProcesso}`;
    }

    function _carregarRegrasFiltro() {
        try {
            const salvo = sessionStorage.getItem(_obterChaveStorageFiltro());
            return salvo ? JSON.parse(salvo) : {};
        } catch { return {}; }
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
    function _gerarMarkdown(topico) {
        const config = ESQUEMAS_CONTEXTO['ED'];
        const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;

        // Coleta de escopo global (Bubble-up)
        const barreirasAdmissibilidade = [];
        const jurisprudenciaVinculante = [];
        const vereditosLocaisInjetados = []; 
        const diretrizesGlobaisGerais = [];

        let md = `# ${config.tituloTopico}: **${(topico.nome || 'Não Nomeado').toUpperCase()}**\n\n`;

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
                const teseAtual = an.tese && an.tese.trim() !== '' ? an.tese.trim() : 'Argumentação Geral';
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
                    
                    // Avaliação OK: Utiliza o SSOT com renderHtml=false para garantir uma string limpa no payload da IA
                    const tituloVicio = window.JurisUtils.obterBadgeTeseCompleto(an.vicio || topico.vicio, an.tese, false) || 'Auditoria Geral';

                    md += `<analise_de_evidencia>\n`;
                    md += `[IDENTIFICADOR DA EVIDÊNCIA]: ${numIdeia}\n`;
                    md += `[VÍCIO VINCULADO]: ${_escapeXmlAttr(tituloVicio)}\n`;
                
                const faseContexto  = an.fase || an.documento || 'Não especificado';
                const poloContexto  = an.polo || 'N/A';
                md += `<contexto_processual>\nFase: ${faseContexto} | Polo: ${poloContexto} | Ref: ${refCitacao}\n</contexto_processual>\n\n`;

                md += `<fato_bruto_auditado>\n`;
                const docLabel = `**[${an.documento || 'Elemento'}] (${poloContexto}) ${refCitacao}:**`;

                if (an.tipo === 'texto') {
                    md += `- ${docLabel} ${_safeMD(an.conteudo, ' ')}\n`;
                } else if (an.tipo === 'imagem') {
                    const imgNome = _gerarNomeArquivoImagem(topico.id, numIdeia);
                    md += `- ${docLabel}\n  [IMAGEM FORNECIDA PARA CONFERÊNCIA]: (Nome: \`${imgNome}\`).\n  [APONTAMENTO DO ASSESSOR]: ${_safeMD(an.comentario || 'Verifique a falha estrutural demonstrada na imagem.', '\n  ')}\n`;
                } else if (an.tipo === 'audio') {
                    try {
                        const ad = JSON.parse(an.conteudo);
                        const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                        md += `- ${docLabel} [OITIVA REGISTRADA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).\n`;
                        if (an.comentario) md += `  [OBSERVAÇÃO]: ${_safeMD(an.comentario, '\n  ')}\n`;
                        if (ad.transcricao) md += `  [DEGRAVAÇÃO LITERAL]: "${_safeMD(ad.transcricao, '\n  ')}"\n`;
                    } catch (e) {
                        md += `- ${docLabel} [ÁUDIO] Resumo: ${_safeMD(an.comentario || 'Sem comentário.', '\n  ')}\n`;
                    }
                }

                // Sub-provas Correlacionadas (Confrontos)
                if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        const numSub = corrIdx + 1;
                        const cRefCitacao = _formatarCitacaoOficial(corr.pjeId, corr.pagina);
                        const cDocLabel = `  [CONFRONTO DIRETO ${numSub}]: [${corr.documento || 'Doc'}] (${corr.polo || 'Polo'}) ${cRefCitacao}:`;

                        if (corr.tipo === 'texto') {
                            md += `${cDocLabel} ${_safeMD(corr.comentario ? corr.comentario : (corr.conteudo || ''), ' ')}\n`;
                        } else if (corr.tipo === 'imagem') {
                            md += `${cDocLabel}\n    [IMAGEM ANEXA]: \`${_gerarNomeArquivoImagem(topico.id, numIdeia, numSub)}\`\n    [APONTAMENTO]: ${_safeMD(corr.comentario || 'Avalie a incongruência.', '\n    ')}\n`;
                        }
                    });
                }
                
                md += `</fato_bruto_auditado>\n\n`;

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
                            else if (intencao === 'fundamentacao') {
                                jurisprudenciaVinculante.push(`[Aplicável ao item ${numIdeia}${refContexto}]: ${textoSanitizado}`);
                            } else if (intencao === 'preliminar') {
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

        if (jurisprudenciaVinculante.length > 0) {
            md += `<base_legal_e_jurisprudencial>\n`;
            md += jurisprudenciaVinculante.map(c => `* ⚖️ ${c}`).join('\n') + '\n';
            md += `</base_legal_e_jurisprudencial>\n\n`;
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

        if (window.BalancaManager && !window.BalancaManager.executarGuardrailDeTarefas('gerar o pacote de exportação para a IA')) {
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
                    <span class="export-option-title">Matriz de Embargos (Juris Notes) + Imagens Anexas</span>
                    <span class="export-option-subtitle">Auditoria estrita de vícios e download das provas demarcadas.</span>
                </div>
            </label>
        `);

        if (topico.marcosExtracao && topico.marcosExtracao.length > 0) {
            const agrupados = topico.marcosExtracao.reduce((acc, curr) => {
                if(!acc[curr.docTipo]) acc[curr.docTipo] = {};
                acc[curr.docTipo][curr.fronteira] = curr;
                return acc;
            }, {});

            const svgPin = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;

            for (const [docTipo, limites] of Object.entries(agrupados)) {
                const hasInicio = !!limites.inicio;
                const hasFim = !!limites.fim;
                const isCompleto = hasInicio && hasFim;
                
                if (isCompleto) _documentosParaExtracaoCache[docTipo] = limites;
                
                const nomeF = getDocLabel(docTipo);
                
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
                            ${btnInicio}
                            ${btnFim}
                        </div>
                    </label>
                `);
            }
        }

        // Injeção Única no DOM (Alta Performance)
        container.innerHTML = htmlBuffer.join('');

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
                            ? window.JurisUtils.limparTextoPDF(textoBruto) 
                            : textoBruto;

                        // SANITIZAÇÃO DELEGADA — fonte única, compartilhada com o Gerador de Contexto IA
                        textoLimpo = aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim);

                        conteudoFinal += `<${tagName}>\n${textoLimpo}\n</${tagName}>\n\n`;
                    } catch (extraError) {
                        if (extraError.message && extraError.message.includes("CONCURRENCY_VIOLATION")) {
                            throw extraError; // Repassa erro fatal abortando a exportação
                        }
                        console.warn(`[ExportManager ED] Falha ao extrair ${docTipo}:`, extraError);
                        conteudoFinal += `<${tagName}>\n[AVISO DE SISTEMA: Falha na extração deste documento no PDF. Possível página corrompida.]\n</${tagName}>\n\n`;
                    }
                }
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

            // --- CÓDIGO REFATORADO (Substitui o bloco antigo de BalancaManager) ---
            if (window.BalancaManager && !window.BalancaManager.executarGuardrailDeTarefas('gerar o pacote de exportação de Embargos')) {
                _deps.exibirToast('Exportação interrompida pelo usuário.', 'aviso');
                return; // Aborta a exportação
            }
            // --- FIM DA REFATORAÇÃO ---

            try {
                // 1. Gera e baixa o Markdown
                const config = ESQUEMAS_CONTEXTO['ED'];
                const nomeSanitizado = (topicoAtivo.nome || 'Exportacao_ED').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                
                // Leitura de estado baseada no DOM (Sem depender de variáveis de janela)
                const tagDom = document.getElementById('tag-numero-processo');
                const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
                const baseStr = numProcesso ? `${config.prefixoArquivo}${numProcesso}_` : config.prefixoArquivo;
                
                const nomeArquivoFinal = `${baseStr}${nomeSanitizado}.md`;
                
                const payloadTexto = _gerarMarkdown(topicoAtivo);
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
        obterDadosDoTopicoAtivo: function() {
            const activeId = _deps.getActiveTabId();
            if (!activeId) return null;
// ... (linhas omitidas para brevidade) ...
            return {
                nome: topicoAtivo.nome || 'Vício Não Nomeado',
                markdown: _gerarMarkdown(topicoAtivo)
            };
        },
        abrirPainelExportacao, 
        fecharPainelExportacao, 
        gerarExportacaoPersonalizada,
        getDocLabel,
        aplicarFiltrosAvancados
    };

})();