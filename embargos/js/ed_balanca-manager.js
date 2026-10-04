/* ================================================
   ed_balanca-manager.js
   Módulo de Integração Segura de Painéis HTML Externos (ED)
   ================================================ */
window.BalancaManager = (function() {
    'use strict';
    
    let htmlState = null;
    let pendingTasksCount = 0;
    let _resolveStateRequest = null;

    // 1. GATEKEEPER E PONTE IPC
    window.addEventListener('message', function(event) {
        const iframe = document.getElementById('balanca-iframe');
        
        // Zero Trust Strict Validation
        if (!iframe || event.source !== iframe.contentWindow) return;

        const data = event.data;
        if (!data || typeof data !== 'object') return;

        // Roteador de Mensagens do Iframe
        switch (data.type) {
            case 'DOSSIE_GENERATED':
                if (data.html && typeof data.html === 'string') {
                    htmlState = data.html;
                    _renderIframeWithBridge(htmlState, true);
                    if (typeof window.salvarBackupAutomatico === 'function') window.salvarBackupAutomatico();
                }
                break;
                
            case 'DOSSIE_STATE_RESPONSE':
                // Iframe devolveu o estado atualizado após requisição
                if (data.html) htmlState = data.html;
                if (_resolveStateRequest) {
                    _resolveStateRequest();
                    _resolveStateRequest = null;
                }
                break;

            case 'DOSSIE_HOTKEY':
                // O Iframe capturou Alt+B ou Esc e repassou para o pai
                if (data.key === 'AltB' || data.key === 'Escape') {
                    fecharPainel(); // Aciona o fluxo de fechamento/salvamento seguro
                }
                break;
        }
    });

    // Atalho pai (quando o foco está FORA do iframe)
    document.addEventListener('keydown', function(e) {
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable;
            
            if (!isTyping) {
                e.preventDefault();
                const painel = document.getElementById('balanca-painel');
                if (painel && painel.style.display === 'flex') {
                    fecharPainel();
                } else {
                    htmlState ? abrirPainel() : resetToGenerator();
                }
            }
        }
    });

    // 2. FUNÇÃO DE INJEÇÃO SEGURA DA PONTE (Via DOMParser)
    function _renderIframeWithBridge(rawHtml, scrollToTrilha = false) {
        const iframe = document.getElementById('balanca-iframe');
        if (!iframe) return;

        try {
            // Evita manipulação frágil de strings usando DOMParser
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, 'text/html');
            
            // Script da Ponte (Roda no contexto isolado do iframe)
            const bridgeScript = doc.createElement('script');
            bridgeScript.id = 'jn-ipc-bridge';
            bridgeScript.textContent = `
                (function() {
                    // Ouve requisições do pai
                    window.addEventListener('message', function(e) {
                        if (e.data && e.data.type === 'REQUEST_STATE') {
                            const clone = document.documentElement.cloneNode(true);
                            
                            // Remove a própria ponte do clone para não poluir o HTML final
                            const bridge = clone.querySelector('#jn-ipc-bridge');
                            if (bridge) bridge.remove();

                            // Sincroniza inputs do DOM vivo para os atributos do clone
                            const liveTextareas = document.querySelectorAll('textarea');
                            clone.querySelectorAll('textarea').forEach((el, i) => {
                                el.textContent = liveTextareas[i].value;
                            });

                            const liveInputs = document.querySelectorAll('input');
                            clone.querySelectorAll('input').forEach((el, i) => {
                                const type = liveInputs[i].type;
                                if (type === 'checkbox' || type === 'radio') {
                                    if (liveInputs[i].checked) el.setAttribute('checked', 'checked');
                                    else el.removeAttribute('checked');
                                } else {
                                    el.setAttribute('value', liveInputs[i].value);
                                }
                            });

                            const liveSelects = document.querySelectorAll('select');
                            clone.querySelectorAll('select').forEach((select, i) => {
                                const liveOptions = liveSelects[i].options;
                                Array.from(select.options).forEach((opt, j) => {
                                    if (liveOptions[j].selected) opt.setAttribute('selected', 'selected');
                                    else opt.removeAttribute('selected');
                                });
                            });

                            // Serializa e envia com DOCTYPE
                            const finalHtml = '<!DOCTYPE html>\\n' + clone.outerHTML;
                            window.parent.postMessage({ type: 'DOSSIE_STATE_RESPONSE', html: finalHtml }, '*');
                        }
                        
                        if (e.data && e.data.type === 'SCROLL_TO_TRILHA') {
                            const alvo = document.getElementById('secao-trilha-julgamento') || 
                                         Array.from(document.querySelectorAll('h1, h2, h3, h4, div.section-title')).find(el => el.textContent.trim().toLowerCase().includes('trilha de julgamento'));
                            if (alvo) {
                                alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                alvo.classList.add('card-flash-focus');
                                setTimeout(() => alvo.classList.remove('card-flash-focus'), 1300);
                            }
                        }
                    });

                    // Interceptação de Atalhos
                    document.addEventListener('keydown', function(e) {
                        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
                            e.preventDefault();
                            window.parent.postMessage({ type: 'DOSSIE_HOTKEY', key: 'AltB' }, '*');
                        } else if (e.key === 'Escape') {
                            window.parent.postMessage({ type: 'DOSSIE_HOTKEY', key: 'Escape' }, '*');
                        }
                    });
                })();
            `;
            doc.body.appendChild(bridgeScript);
            
            // Reconstrução do HTML injetado
            const finalHtmlToRender = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
            
            // Setup do Load Listener (Apenas 1 por vez)
            const onLoad = () => {
                sincronizarContextoDossie(typeof topicos !== 'undefined' ? topicos : []);
                if (scrollToTrilha) {
                    iframe.contentWindow.postMessage({ type: 'SCROLL_TO_TRILHA' }, '*');
                }
                iframe.removeEventListener('load', onLoad);
            };
            
            iframe.addEventListener('load', onLoad);
            
            // Força reflow para garantir disparo do evento load
            iframe.removeAttribute('srcdoc');
            void iframe.offsetWidth;
            iframe.srcdoc = finalHtmlToRender;

        } catch (err) {
            console.error('[Juris Notes] Erro ao injetar ponte no Dossiê', err);
        }
    }

    function abrirPainel() {
        document.getElementById('balanca-modal-backdrop').style.display = 'block';
        document.getElementById('balanca-painel').style.display = 'flex';

        if (htmlState) {
            _renderIframeWithBridge(htmlState, true);
        } else {
            const iframe = document.getElementById('balanca-iframe');
            iframe.removeAttribute('srcdoc');
            iframe.src = '../dossie/index.html'; 
        }
    }

    // Fluxo de fechamento Assíncrono
    async function fecharPainel() {
        const iframe = document.getElementById('balanca-iframe');
        if (iframe && iframe.contentWindow && htmlState) {
            // Solicita estado ao Iframe e aguarda resposta via Promise (Timeout de 1s p/ segurança)
            await new Promise(resolve => {
                _resolveStateRequest = resolve;
                iframe.contentWindow.postMessage({ type: 'REQUEST_STATE' }, '*');
                setTimeout(resolve, 1000); // Fallback caso iframe trave
            });
        }
        
        atualizarInterface();
        document.getElementById('balanca-modal-backdrop').style.display = 'none';
        document.getElementById('balanca-painel').style.display = 'none';
        
        if (typeof window.salvarBackupAutomatico === 'function') window.salvarBackupAutomatico();
    }

    function sincronizarContextoDossie(topicosInjetados) {
        const iframe = document.getElementById('balanca-iframe');
        if (iframe && iframe.contentWindow) {
            // Resolve o "Scoping Trap": Usa o array injetado. Se não houver, tenta o escopo local com segurança.
            const arrayReferencia = topicosInjetados || (typeof topicos !== 'undefined' ? topicos : []);
            
            // Mapeamento limpo dos tópicos atuais da matriz
            const topicosAtivos = arrayReferencia.map(t => ({
                id: t.id,
                nome: t.nome,
                cor: t.cor
            }));
            iframe.contentWindow.postMessage({ type: 'SYNC_TOPICS', topicos: topicosAtivos }, '*');
        }
    }

    // Função protegida contra perda de dados
    function resetToGenerator() {
        if (htmlState !== null) {
            const confirmacao = confirm("⚠️ Atenção:\n\nIsso substituirá o Dossiê atual. Se você fez marcações de checkbox que não foram salvas no backup principal, elas serão perdidas.\n\nDeseja gerar um novo dossiê?");
            if (!confirmacao) return;
        }
        
        htmlState = null;
        pendingTasksCount = 0;
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) {
            iframe.removeAttribute('srcdoc');
            iframe.src = '../dossie/index.html';
        }
        abrirPainel();
        atualizarInterface();
    }

    // ==========================================
    // DELEGAÇÃO DE TAREFAS NATIVAS
    // ==========================================
    function avaliarTarefasPendentes() {
        const badge = document.getElementById('badge-tarefas');
        if(badge && badge.style.display !== 'none') {
            return parseInt(badge.textContent.replace('+', '')) || 0;
        }
        return 0;
    }

    // ==========================================
    // ATUALIZAÇÃO VISUAL CENTRALIZADA
    // ==========================================
    function atualizarInterface() {
        const btnBalanca = document.getElementById('btn-balanca-justica');
        const btnLembrete = document.getElementById('btn-lembretes-tarefa');
        
        if (!btnBalanca || !btnLembrete) return;

        // Regra 1: O ícone da balança só fica carregado se houver HTML
        if (htmlState) {
            btnBalanca.classList.add('is-loaded');
        } else {
            btnBalanca.classList.remove('is-loaded');
        }
        
        // Regra 2: Botão Lembretes independe da Balança agora
        btnLembrete.disabled = false;
    }

    function processarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            htmlState = e.target.result;
            _renderIframeWithBridge(htmlState, false);
            atualizarInterface(); // Atualiza UI ao carregar
            
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Painel HTML importado e ancorado com sucesso!', 'sucesso');
            }
            abrirPainel(); 
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    function getHtmlState() {
        // A leitura é síncrona pelo BackupManager baseada no cache atualizado via IPC
        return htmlState;
    }

    function restoreHtmlState(htmlData) {
        htmlState = htmlData || null;
        if (htmlState) {
            _renderIframeWithBridge(htmlState, false);
        }
        // Timeout breve para dar tempo da renderização e atualização visual
        setTimeout(atualizarInterface, 100); 
    }

    function resetarEstado() {
        htmlState = null;
        pendingTasksCount = 0;
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) iframe.srcdoc = '';
        atualizarInterface();
    }

    return { 
        abrirPainel, 
        fecharPainel, 
        processarUpload, 
        getHtmlState, 
        restoreHtmlState,
        resetarEstado,
        resetToGenerator,
        getPendingTasks: avaliarTarefasPendentes,
        sincronizarTopicos: sincronizarContextoDossie 
    };
})();