/* ================================================
   ai_balanca-manager.js
   Módulo de Integração Segura de Painéis HTML Externos (AI)
   ================================================ */
window.BalancaManager = (function() {
    'use strict';
    
    let htmlState = null;
    let pendingTasksCount = 0;
    let _resolveStateRequest = null;

    function obterTemaModulo() {
        const metaModulo = document.querySelector('meta[name="juris-module"]');
        const module = metaModulo ? metaModulo.content : 'ai';
        return ['ro', 'ed', 'ai'].includes(module) ? module : 'ai';
    }

    function urlDoGerador() {
        return `../dossie/index.html?theme=${obterTemaModulo()}`;
    }

    // Garante que o sandbox do iframe permita o download do dossiê empacotado
    function _garantirPermissoesSandbox(iframe) {
        if (iframe && iframe.hasAttribute('sandbox')) {
            const permissoesAtuais = iframe.getAttribute('sandbox') || '';
            if (!permissoesAtuais.includes('allow-downloads')) {
                iframe.setAttribute('sandbox', (permissoesAtuais + ' allow-downloads allow-modals').trim());
            }
        }
    }

    // 1. GATEKEEPER E PONTE IPC (Compatível com Iframe em Sandbox)
    window.addEventListener('message', function(event) {
        const iframe = document.getElementById('balanca-iframe');
        
        // Validação por referência de janela (funciona mesmo com origin "null" de sandbox)
        if (!iframe || event.source !== iframe.contentWindow) return;

        const data = event.data;
        if (!data || typeof data !== 'object') return;

        switch (data.type) {
            case 'DOSSIE_GENERATED':
                if (data.html && typeof data.html === 'string') {
                    htmlState = data.html;
                    _renderIframeWithBridge(htmlState, true);
                    atualizarInterface();
                    if (typeof window.salvarBackupAutomatico === 'function') {
                        window.salvarBackupAutomatico();
                    }
                    if (typeof window.exibirToast === 'function') {
                        window.exibirToast('Dossiê vinculado com sucesso!', 'sucesso');
                    }
                }
                break;
                
            case 'DOSSIE_STATE_RESPONSE':
                if (data.html) htmlState = data.html;
                if (_resolveStateRequest) {
                    _resolveStateRequest();
                    _resolveStateRequest = null;
                }
                break;

            case 'DOSSIE_HOTKEY':
                if (data.key === 'AltB' || data.key === 'Escape') {
                    fecharPainel();
                }
                break;
        }
    });

    // Atalho Alt + B protegido e inteligente (quando o foco está no painel pai)
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

    // 2. FUNÇÃO DE INJEÇÃO SEGURA DA PONTE E DO TEMA (Via DOMParser)
    function _renderIframeWithBridge(rawHtml, scrollToTrilha = false) {
        const iframe = document.getElementById('balanca-iframe');
        if (!iframe) return;

        _garantirPermissoesSandbox(iframe);

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, 'text/html');
            
            // Carimba o tema do módulo (ai) no elemento <html>
            doc.documentElement.setAttribute('data-theme', obterTemaModulo());

            // Remove ponte anterior se já existir para evitar duplicidade
            const oldBridge = doc.getElementById('jn-ipc-bridge');
            if (oldBridge) oldBridge.remove();

            // Script da Ponte (Roda no contexto isolado do iframe)
            const bridgeScript = doc.createElement('script');
            bridgeScript.id = 'jn-ipc-bridge';
            bridgeScript.textContent = `
                (function() {
                    window.addEventListener('message', function(e) {
                        if (e.data && e.data.type === 'REQUEST_STATE') {
                            const clone = document.documentElement.cloneNode(true);
                            
                            const bridge = clone.querySelector('#jn-ipc-bridge');
                            if (bridge) bridge.remove();

                            const liveTextareas = document.querySelectorAll('textarea');
                            clone.querySelectorAll('textarea').forEach((el, i) => {
                                if (liveTextareas[i]) el.textContent = liveTextareas[i].value;
                            });

                            const liveInputs = document.querySelectorAll('input');
                            clone.querySelectorAll('input').forEach((el, i) => {
                                if (!liveInputs[i]) return;
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
                                if (!liveSelects[i]) return;
                                const liveOptions = liveSelects[i].options;
                                Array.from(select.options).forEach((opt, j) => {
                                    if (liveOptions[j] && liveOptions[j].selected) opt.setAttribute('selected', 'selected');
                                    else opt.removeAttribute('selected');
                                });
                            });

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
            
            const finalHtmlToRender = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
            htmlState = finalHtmlToRender;
            
            const onLoad = () => {
                sincronizarContextoDossie(typeof topicos !== 'undefined' ? topicos : []);
                if (scrollToTrilha && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'SCROLL_TO_TRILHA' }, '*');
                }
                iframe.removeEventListener('load', onLoad);
            };
            
            iframe.addEventListener('load', onLoad);
            
            iframe.removeAttribute('src');
            iframe.removeAttribute('srcdoc');
            void iframe.offsetWidth;
            iframe.srcdoc = finalHtmlToRender;

        } catch (err) {
            console.error('[Juris Notes AI] Erro ao injetar ponte no Dossiê:', err);
        }
    }

    function abrirPainel() {
        document.getElementById('balanca-modal-backdrop').style.display = 'block';
        document.getElementById('balanca-painel').style.display = 'flex';

        const iframe = document.getElementById('balanca-iframe');
        _garantirPermissoesSandbox(iframe);

        if (htmlState) {
            _renderIframeWithBridge(htmlState, true);
        } else if (iframe) {
            iframe.removeAttribute('srcdoc');
            iframe.src = urlDoGerador();
        }
    }

    async function fecharPainel() {
        const iframe = document.getElementById('balanca-iframe');
        if (iframe && iframe.contentWindow && htmlState) {
            await new Promise(resolve => {
                _resolveStateRequest = resolve;
                iframe.contentWindow.postMessage({ type: 'REQUEST_STATE' }, '*');
                setTimeout(resolve, 1000);
            });
        }
        
        atualizarInterface();
        document.getElementById('balanca-modal-backdrop').style.display = 'none';
        document.getElementById('balanca-painel').style.display = 'none';
        
        if (typeof window.salvarBackupAutomatico === 'function') {
            window.salvarBackupAutomatico();
        }
    }

    function sincronizarContextoDossie(topicosInjetados) {
        const iframe = document.getElementById('balanca-iframe');
        if (iframe && iframe.contentWindow) {
            const arrayReferencia = topicosInjetados || (typeof topicos !== 'undefined' ? topicos : []);
            const topicosAtivos = arrayReferencia.map(t => ({
                id: t.id,
                nome: t.nome,
                cor: t.cor
            }));
            iframe.contentWindow.postMessage({ 
                type: 'SYNC_TOPICS', 
                theme: obterTemaModulo(),
                topicos: topicosAtivos 
            }, '*');
        }
    }

    function resetToGenerator() {
        if (htmlState !== null) {
            const confirmacao = confirm("⚠️ Atenção:\n\nIsso substituirá o Dossiê atual. Se você fez marcações de checkbox que não foram salvas no backup principal, elas serão perdidas.\n\nDeseja gerar um novo dossiê?");
            if (!confirmacao) return;
        }
        
        htmlState = null;
        pendingTasksCount = 0;
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) {
            _garantirPermissoesSandbox(iframe);
            iframe.removeAttribute('srcdoc');
            iframe.src = urlDoGerador();
        }
        abrirPainel();
        atualizarInterface();
    }

    function avaliarTarefasPendentes() {
        const badge = document.getElementById('badge-tarefas');
        if (badge && badge.style.display !== 'none') {
            return parseInt(badge.textContent.replace('+', '')) || 0;
        }
        return 0;
    }

    function atualizarInterface() {
        const btnBalanca = document.getElementById('btn-balanca-justica');
        const btnLembrete = document.getElementById('btn-lembretes-tarefa');
        
        if (!btnBalanca || !btnLembrete) return;

        if (htmlState) {
            btnBalanca.classList.add('is-loaded');
        } else {
            btnBalanca.classList.remove('is-loaded');
        }
        
        btnLembrete.disabled = false;
    }

    function processarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            htmlState = e.target.result;
            _renderIframeWithBridge(htmlState, false);
            atualizarInterface();
            
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Painel HTML importado e ancorado com sucesso!', 'sucesso');
            }
            abrirPainel(); 
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    function getHtmlState() {
        return htmlState;
    }

    function restoreHtmlState(htmlData) {
        htmlState = htmlData || null;
        if (htmlState) {
            _renderIframeWithBridge(htmlState, false);
        }
        setTimeout(atualizarInterface, 100); 
    }

    function resetarEstado() {
        htmlState = null;
        pendingTasksCount = 0;
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) iframe.srcdoc = '';
        atualizarInterface();
    }

    function executarGuardrailDeTarefas(acaoDesejada) {
        const count = avaliarTarefasPendentes(); 
        
        if (count > 0) {
            const msg = `ATENÇÃO: Existem ${count} tarefa(s) pendente(s) não concluídas no Painel da Balança.\n\nTem certeza de que deseja ${acaoDesejada} mesmo assim?`;
            return confirm(msg);
        }
        return true;
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
        executarGuardrailDeTarefas, 
        sincronizarTopicos: sincronizarContextoDossie 
    };
})();