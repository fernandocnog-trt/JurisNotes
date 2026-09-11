/* ================================================
   document-views.js  —  v1.0
   Visões de Documento (Outline e Minuta)
   
   Dependências Críticas:
   - window.TopicsManager (API Pública: getActiveTabId, escaparHTML, renderizarMarkdownSeguro)
   - window.topicos (Estado Global Read-Only)
   - window.exibirToast (Feedback de UI Global)
   ================================================ */

/* ================================================
   VISÃO ESTRUTURADA (OUTLINE MODE) - REFINADO v3.1.0
   ================================================ */
window.OutlineViewManager = (function() {
    'use strict';

    function abrir() {
        const activeId = TopicsManager.getActiveTabId();
        if (!activeId) {
            exibirToast('Selecione um tópico primeiro.', 'aviso');
            return;
        }
        const topico = topicos.find(t => t.id === activeId);
        if (!topico) return;
        
        const contentEl = document.getElementById('outline-view-content');
        if (contentEl) {
            contentEl.innerHTML = _construirHTML(topico);
        }
        document.getElementById('outline-view-backdrop').style.display = 'block';
        document.getElementById('outline-view-modal').style.display = 'flex';
    }

    function fechar() {
        const backdrop = document.getElementById('outline-view-backdrop');
        const modal = document.getElementById('outline-view-modal');
        if (backdrop) backdrop.style.display = 'none';
        if (modal) modal.style.display = 'none';
    }

    function _render(texto) {
        return TopicsManager.renderizarMarkdownSeguro(TopicsManager.escaparHTML(texto || ''));
    }

    function _obterRotuloIntencao(intencao) {
        const mapa = {
            'comando': 'Comando IA',
            'texto': 'Texto Fixo',
            'premissa': 'Premissa',
            'fundamentacao': 'Base Legal',
            'refutacao': 'Refutação',
            'preliminar': 'Prejudicial',
            'veredito': 'Veredito',
            'jurisprudencia': 'Jurisprudência',
            'degravacao': 'Degravação'
        };
        return mapa[intencao] || 'Diretriz';
    }

    function _processarSubNos(subAnotacoes, margemLeft = '28px') {
        if (!subAnotacoes || subAnotacoes.length === 0) return '';
        let html = '';
        subAnotacoes.forEach(sub => {
            if (sub.intencao === 'nota') return;
            const intencaoKey = sub.intencao || 'premissa';
            const rotulo = _obterRotuloIntencao(intencaoKey);
            html += `
            <div class="outline-sub-item" style="margin-left: ${margemLeft};">
                <span class="outline-intent-chip intent-${intencaoKey}">${rotulo}</span>
                <span class="outline-content-text">${_render(sub.texto)}</span>
            </div>`;
        });
        return html;
    }

    function _gerarBlocoConteudo(item) {
        if (item.tipo === 'imagem') {
            return `<img src="${item.conteudo}" class="outline-img-preview" alt="Prova Visual">`;
        }
        if (item.tipo === 'audio') {
            try {
                const ad = JSON.parse(item.conteudo);
                const role = TopicsManager.escaparHTML(ad.role || ad.oradorStr || 'Orador Desconhecido');
                const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;
                const tempoStr = `${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}`;
                const transcricao = ad.transcricao 
                    ? `<strong>Degravação:</strong> "${_render(ad.transcricao).replace(/\n/g, '<br>')}"` 
                    : '<em>Sem degravação cadastrada.</em>';
                return `
                <div class="outline-audio-box">
                    <div>🎙️ <strong>Oitiva de Audiência:</strong> ${role} (⏱️ ${tempoStr})</div>
                    <div style="margin-top:4px;">${transcricao}</div>
                </div>`;
            } catch (e) {
                return `<div class="outline-audio-box" style="color:#d32f2f;">Erro na leitura do áudio.</div>`;
            }
        }
        return `<div class="outline-content-text" style="font-style: italic; font-size: 0.92rem; color: #334155;">"${_render(item.conteudo)}"</div>`;
    }

    function _construirHTML(topico) {
        let html = `
        <div style="margin-bottom: 20px;">
            <div class="outline-title" style="margin-bottom: 4px;">Tópico: ${TopicsManager.escaparHTML(topico.nome)}</div>
            <p style="font-size: 0.8rem; color: #64748b;">Visão linear compilada para estruturação de minutas e prompts de IA.</p>
        </div>`;
        
        if (topico.alegacoes || topico.fundamentos || topico.veredito) {
            html += `<div class="outline-section-block" id="sec-preambulo">
                <div class="outline-h2-bar no-copy">
                    <span class="outline-h2-title">📋 Relatório e Posições do Processo</span>
                    <button class="btn-copy-section no-copy" onclick="OutlineViewManager.copiarTrechoElemento('sec-preambulo')">📋 Copiar Seção</button>
                </div>
                <div class="outline-section-body">`;
            if (topico.alegacoes) {
                html += `<div style="margin-bottom: 12px;">
                    <div style="font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: #f57c00; margin-bottom: 2px;">Razões Recursais (Recorrente)</div>
                    <div class="outline-content-text">${_render(topico.alegacoes)}</div>
                </div>`;
            }
            if (topico.fundamentos) {
                html += `<div style="margin-bottom: 12px;">
                    <div style="font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: #3949ab; margin-bottom: 2px;">Fundamentos da Sentença (Origem)</div>
                    <div class="outline-content-text">${_render(topico.fundamentos)}</div>
                </div>`;
            }
            if (topico.veredito) {
                html += `<div>
                    <div style="font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: #e65100; margin-bottom: 2px;">Veredito Pretendido / Conclusão</div>
                    <div class="outline-content-text">${_render(topico.veredito)}</div>
                </div>`;
            }
            html += `</div></div>`;
        }

        if (topico.diretrizesGlobais && topico.diretrizesGlobais.length > 0) {
            const diretrizesVisiveis = topico.diretrizesGlobais.filter(d => d.intencao !== 'nota');
            if (diretrizesVisiveis.length > 0) {
                html += `<div class="outline-section-block" id="sec-globais">
                    <div class="outline-h2-bar no-copy">
                        <span class="outline-h2-title">🌐 Diretrizes Globais do Tópico</span>
                        <button class="btn-copy-section no-copy" onclick="OutlineViewManager.copiarTrechoElemento('sec-globais')">📋 Copiar Seção</button>
                    </div>
                    <div class="outline-section-body">`;
                diretrizesVisiveis.forEach(dir => {
                    const intencaoKey = dir.intencao || 'premissa';
                    const rotulo = _obterRotuloIntencao(intencaoKey);
                    html += `
                    <div class="outline-sub-item" style="margin-left:0; margin-bottom:8px;">
                        <span class="outline-intent-chip intent-${intencaoKey}">${rotulo}</span>
                        <span class="outline-content-text">${_render(dir.texto)}</span>
                    </div>`;
                });
                html += `</div></div>`;
            }
        }

        html += `<div class="outline-section-block" id="sec-matriz">
            <div class="outline-h2-bar no-copy">
                <span class="outline-h2-title">📑 Matriz Probatória e Teses Jurídicas</span>
                <button class="btn-copy-section no-copy" onclick="OutlineViewManager.copiarTrechoElemento('sec-matriz')">📋 Copiar Seção</button>
            </div>
            <div class="outline-section-body">`;
            
        if (topico.anotacoes.length === 0) {
            html += `<p style="color: #94a3b8; font-style: italic; font-size: 0.85rem;">Nenhuma prova cadastrada na matriz deste tópico.</p>`;
        }
        
        let ultimaTese = null;
        topico.anotacoes.forEach(an => {
            const teseAtual = an.tese || "Provas sem agrupamento de tese";
            if (teseAtual !== ultimaTese) {
                html += `<div style="margin-top: 20px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px dashed #cbd5e1;">
                    <span style="font-weight: 800; color: #6a1b9a; font-size: 0.95rem;">⚖️ Tese: ${TopicsManager.escaparHTML(teseAtual)}</span>
                </div>`;
                if (topico.diretrizesPorTese && topico.diretrizesPorTese[teseAtual]) {
                    const dirTeseVisiveis = topico.diretrizesPorTese[teseAtual].filter(d => d.intencao !== 'nota');
                    dirTeseVisiveis.forEach(dir => {
                        const intencaoKey = dir.intencao || 'premissa';
                        const rotulo = _obterRotuloIntencao(intencaoKey);
                        html += `
                        <div class="outline-sub-item" style="margin-left: 12px; margin-bottom: 6px;">
                            <span class="outline-intent-chip intent-${intencaoKey}">${rotulo}</span>
                            <span class="outline-content-text">${_render(dir.texto)}</span>
                        </div>`;
                    });
                }
                ultimaTese = teseAtual;
            }
            const docSeguro = TopicsManager.escaparHTML(an.documento || an.polo || 'Documento');
            const refMeta = an.pagina ? ` (fl. ${TopicsManager.escaparHTML(String(an.pagina))})` : '';
            html += `
            <div class="outline-card">
                <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <span class="outline-meta-tag">${docSeguro}</span>
                    <span style="font-size: 0.78rem; color: #64748b; font-weight: 600;">${refMeta}</span>
                </div>
                ${_gerarBlocoConteudo(an)}
                ${an.comentario ? `<div style="margin-top: 6px; font-size: 0.82rem; color: #475569;"><strong>Obs:</strong> ${_render(an.comentario)}</div>` : ''}
            </div>`;
            html += _processarSubNos(an.subAnotacoes, '24px');
            if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                an.itensCorrelacionados.forEach(corr => {
                    const cDocSeguro = TopicsManager.escaparHTML(corr.documento || corr.polo || 'Documento');
                    const cRefMeta = corr.pagina ? ` (fl. ${TopicsManager.escaparHTML(String(corr.pagina))})` : '';
                    html += `
                    <div class="outline-card correlacionado">
                        <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span class="outline-meta-tag" style="background: #e2e8f0;">${cDocSeguro}</span>
                            <span style="font-size: 0.78rem; color: #64748b; font-weight: 600;">${cRefMeta}</span>
                        </div>
                        ${_gerarBlocoConteudo(corr)}
                        ${corr.comentario ? `<div style="margin-top: 6px; font-size: 0.82rem; color: #475569;"><strong>Obs:</strong> ${_render(corr.comentario)}</div>` : ''}
                    </div>`;
                    html += _processarSubNos(corr.subAnotacoes, '40px');
                });
            }
        });
        html += `</div></div>`;
        return html;
    }

    async function copiarTudo() {
        const contentEl = document.getElementById('outline-view-content');
        if (!contentEl) return;
        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll('.no-copy, .btn-copy-section').forEach(el => el.remove());
        try {
            const clipboardItem = new ClipboardItem({
                'text/plain': new Blob([clone.innerText.trim()], { type: 'text/plain' }),
                'text/html': new Blob([clone.innerHTML], { type: 'text/html' })
            });
            await navigator.clipboard.write([clipboardItem]);
            exibirToast('Documento completo copiado para o Word/PJe (sem controles visuais)!', 'sucesso');
        } catch (err) {
            navigator.clipboard.writeText(clone.innerText.trim()).then(() => {
                exibirToast('Texto simples copiado com sucesso.', 'info');
            });
        }
    }

    function copiarComoMarkdown() {
        const activeId = TopicsManager.getActiveTabId();
        const topico = topicos.find(t => t.id === activeId);
        if (!topico) return;
        let md = `# TÓPICO: ${topico.nome.toUpperCase()}\n\n`;
        if (topico.alegacoes) md += `## RAZÕES RECURSAIS\n${topico.alegacoes}\n\n`;
        if (topico.fundamentos) md += `## FUNDAMENTOS DA SENTENÇA\n${topico.fundamentos}\n\n`;
        if (topico.veredito) md += `## VEREDITO PRETENDIDO\n${topico.veredito}\n\n`;
        if (topico.diretrizesGlobais?.length > 0) {
            const globaisVisiveis = topico.diretrizesGlobais.filter(d => d.intencao !== 'nota');
            if (globaisVisiveis.length > 0) {
                md += `## DIRETRIZES GLOBAIS\n`;
                globaisVisiveis.forEach(d => {
                    md += `- [${(d.intencao || 'diretriz').toUpperCase()}]: ${d.texto}\n`;
                });
                md += `\n`;
            }
        }
        md += `## MATRIZ PROBATÓRIA E TESES\n`;
        let ultimaTese = null;
        topico.anotacoes.forEach((an, i) => {
            const tese = an.tese || "Geral";
            if (tese !== ultimaTese) {
                md += `\n### TESE: ${tese}\n`;
                ultimaTese = tese;
            }
            const fl = an.pagina ? ` (fl. ${an.pagina})` : '';
            md += `\n* PROVA ${i + 1}: ${an.documento || an.polo || 'Elemento'}${fl}\n`;
            if (an.tipo === 'texto') md += `  > "${an.conteudo}"\n`;
            if (an.subAnotacoes) {
                an.subAnotacoes.forEach(sub => {
                    if (sub.intencao !== 'nota') md += `  - [${(sub.intencao || 'nó').toUpperCase()}]: ${sub.texto}\n`;
                });
            }
        });
        navigator.clipboard.writeText(md.trim()).then(() => {
            exibirToast('Estrutura Markdown copiada para IA (sem controles visuais)!', 'sucesso');
        });
    }

    function copiarTrechoElemento(idElemento) {
        const el = document.getElementById(idElemento);
        if (!el) return;
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.no-copy, .btn-copy-section').forEach(b => b.remove());
        navigator.clipboard.writeText(clone.innerText.trim()).then(() => {
            exibirToast('Seção copiada sem controles visuais!', 'sucesso');
        });
    }

    return { abrir, fechar, copiarTudo, copiarComoMarkdown, copiarTrechoElemento };
})();

/* ================================================
   VISÃO DE MINUTA (LEITURA FLUIDA)
   ================================================ */
window.MinutaViewManager = (function() {
    'use strict';
    const INTENCOES_PERMITIDAS = ['comando', 'texto', 'premissa', 'preliminar', 'refutacao', 'jurisprudencia', 'degravacao'];

    function abrir() {
        const activeId = TopicsManager.getActiveTabId();
        if (!activeId) {
            exibirToast('Selecione um tópico primeiro.', 'aviso');
            return;
        }
        const topico = topicos.find(t => t.id === activeId);
        if (!topico) return;
        
        const contentEl = document.getElementById('minuta-view-content');
        if (contentEl) contentEl.innerHTML = _construirHTML(topico);
        
        document.getElementById('minuta-view-backdrop').style.display = 'block';
        document.getElementById('minuta-view-modal').style.display = 'flex';
    }

    function fechar() {
        document.getElementById('minuta-view-backdrop').style.display = 'none';
        document.getElementById('minuta-view-modal').style.display = 'none';
        const contentEl = document.getElementById('minuta-view-content');
        if (contentEl) contentEl.innerHTML = ''; 
    }

    function _render(texto) {
        return TopicsManager.renderizarMarkdownSeguro(TopicsManager.escaparHTML(texto || ''));
    }

    function _processarNo(noItem) {
        const intencao = noItem.intencao || 'premissa';
        if (!INTENCOES_PERMITIDAS.includes(intencao)) return '';
        const textoHTML = _render(noItem.texto);
        
        if (intencao === 'comando') return `<div class="minuta-comando-card">${textoHTML}</div>`;
        if (intencao === 'jurisprudencia') return `<div class="minuta-juris-block">${textoHTML}</div>`;
        if (intencao === 'degravacao') return `<div class="minuta-audio-block">"${textoHTML}"</div>`;
        
        return `<div class="minuta-text-block">${textoHTML}</div>`;
    }

    function _construirHTML(topico) {
        let html = `
        <div style="margin-bottom: 24px;">
            <div class="doc-modal__topic-title">Tópico: ${TopicsManager.escaparHTML(topico.nome)}</div>
            <p class="doc-modal__topic-subtitle">Pré-visualização da extração linear da minuta.</p>
        </div>`;
        
        let nodesEncontrados = false;
        if (topico.diretrizesGlobais?.length > 0) {
            topico.diretrizesGlobais.forEach(dir => {
                const nodeHtml = _processarNo(dir);
                if(nodeHtml) { html += nodeHtml; nodesEncontrados = true; }
            });
        }
        
        let ultimaTese = null;
        topico.anotacoes.forEach(an => {
            const teseAtual = an.tese || "Provas sem agrupamento de tese";
            if (teseAtual !== ultimaTese) {
                topico.diretrizesPorTese?.[teseAtual]?.forEach(dir => {
                    const nodeHtml = _processarNo(dir);
                    if(nodeHtml) { html += nodeHtml; nodesEncontrados = true; }
                });
                ultimaTese = teseAtual;
            }
            an.subAnotacoes?.forEach(sub => {
                const nodeHtml = _processarNo(sub);
                if(nodeHtml) { html += nodeHtml; nodesEncontrados = true; }
            });
            an.itensCorrelacionados?.forEach(corr => {
                corr.subAnotacoes?.forEach(sub => {
                    const nodeHtml = _processarNo(sub);
                    if(nodeHtml) { html += nodeHtml; nodesEncontrados = true; }
                });
            });
        });
        
        if (!nodesEncontrados) {
            html += `<p style="color: #94a3b8; font-style: italic;">Nenhum nó de ideia elegível para a minuta foi encontrado neste tópico.</p>`;
        }
        return html;
    }

    async function copiarTexto() {
        const contentEl = document.getElementById('minuta-view-content');
        if (!contentEl) return;
        const clone = contentEl.cloneNode(true);
        clone.querySelector('h2')?.remove();
        const plainText = clone.innerText.trim();
        const htmlText = clone.innerHTML;
        try {
            const clipboardItem = new ClipboardItem({
                'text/plain': new Blob([plainText], { type: 'text/plain' }),
                'text/html': new Blob([htmlText], { type: 'text/html' })
            });
            await navigator.clipboard.write([clipboardItem]);
            exibirToast('Texto copiado com formatação preservada!', 'sucesso');
        } catch (err) {
            const textArea = document.createElement("div");
            textArea.contentEditable = true;
            textArea.innerHTML = htmlText;
            textArea.style.position = "fixed";
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            const range = document.createRange();
            range.selectNodeContents(textArea);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("copy");
            document.body.removeChild(textArea);
            exibirToast('Texto copiado (Modo Legado).', 'info');
        }
    }

    function copiarComoMarkdown() {
        const activeId = TopicsManager.getActiveTabId();
        const topico = topicos.find(t => t.id === activeId);
        if (!topico) return;
        let md = `# Tópico: ${topico.nome}\n\n`;
        let nodesEncontrados = false;
        
        function _processarNoMd(noItem) {
            const intencao = noItem.intencao || 'premissa';
            if (!INTENCOES_PERMITIDAS.includes(intencao)) return '';
            nodesEncontrados = true;
            let texto = noItem.texto.trim();
            if (intencao === 'comando') {
                return `> **COMANDO / INSTRUÇÃO:**\n> ${texto}\n\n`;
            }
            if (intencao === 'jurisprudencia') {
                return `> **JURISPRUDÊNCIA:**\n> ${texto}\n\n`;
            }
            if (intencao === 'degravacao') {
                return `> **DESTAQUE DE PROVA ORAL:**\n> "${texto}"\n\n`;
            }
            return `${texto}\n\n`;
        }
        
        if (topico.diretrizesGlobais?.length > 0) {
            topico.diretrizesGlobais.forEach(dir => { md += _processarNoMd(dir); });
        }
        
        let ultimaTese = null;
        topico.anotacoes.forEach(an => {
            const teseAtual = an.tese || "Provas sem agrupamento de tese";
            if (teseAtual !== ultimaTese) {
                topico.diretrizesPorTese?.[teseAtual]?.forEach(dir => { md += _processarNoMd(dir); });
                ultimaTese = teseAtual;
            }
            an.subAnotacoes?.forEach(sub => { md += _processarNoMd(sub); });
            an.itensCorrelacionados?.forEach(corr => {
                corr.subAnotacoes?.forEach(sub => { md += _processarNoMd(sub); });
            });
        });
        
        if (!nodesEncontrados) {
            md += `*Nenhum nó de ideia elegível para a minuta foi encontrado neste tópico.*\n`;
        }
        
        navigator.clipboard.writeText(md.trim()).then(() => {
            exibirToast('Minuta copiada em Markdown para IA!', 'sucesso');
        });
    }

    return { abrir, fechar, copiarTexto, copiarComoMarkdown };
})();