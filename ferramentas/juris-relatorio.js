window.JurisRelatorioManager = (function() {
    let isInitialized = false;

    // Novo Helper: Lê de forma confiável em qual painel estamos (via meta tag)
    function getCurrentModule() {
        const meta = document.querySelector('meta[name="juris-module"]');
        if (meta && meta.content) return meta.content.toLowerCase();
        
        if (document.body.dataset.module) return document.body.dataset.module.toLowerCase();
        
        return 'ro'; // Fallback de segurança
    }

    // Utilitários de acesso ao DOM
    const DOM = {
        v: (id) => document.getElementById(id)?.value.trim() || '____________________',
        sel: (id) => {
            const el = document.getElementById(id);
            return el && el.selectedIndex >= 0 && el.value !== "" 
                ? el.options[el.selectedIndex].text.replace(/\s\(\d\)$/, '') 
                : '____________________';
        },
        lbl: (id) => document.getElementById(id)?.textContent || '',
        val: (id) => document.getElementById(id)?.value || '0',
        show: (id, isVisible) => { 
            const el = document.getElementById(id);
            if (!el) return;
            el.style.display = isVisible ? 'block' : 'none';
            // Saneamento de Dados Estrutural: Evita strings fantasmas
            if (!isVisible) {
                el.querySelectorAll('input, select').forEach(child => {
                    if (child.tagName === 'SELECT') child.selectedIndex = 0;
                    else child.value = '';
                });
            }
        }
    };

    // Máquina de Estado Declarativa
    const CONFIG = {
        modulosPermitidos: {
            'ro': ['RO', 'AP'],
            'ed': ['ED'],
            'ai': ['AI']
        },
        modos: {
            RO: {
                avaliarCondicionais: () => {
                    DOM.show('jr-embargos-detalhes', DOM.val('jr-embargos') !== '0');
                    DOM.show('jr-contrarrazoes-detalhes', DOM.val('jr-contrarrazoes') !== '0');
                },
                gerarTexto: (isAP = false) => {
                    const val_E = isAP ? DOM.v('jr-resultado-ap') : DOM.v('jr-resultado');
                    let out = `[A] NOME DO(A) MAGISTRADO(A): ${DOM.v('jr-magistrado')}
[B] TITULARIDADE: ${DOM.sel('jr-titularidade')}
[C] VARA DE ORIGEM: ${DOM.v('jr-vara')}
${DOM.lbl('lbl-d')}: ${DOM.v('jr-sentenca')}
${DOM.lbl('lbl-e')}: ${val_E}
${DOM.lbl('lbl-f').replace('[F] ', '[F] ')}: ${DOM.sel('jr-recurso')}
${DOM.lbl('lbl-f1')}: ${DOM.v('jr-recurso-fls')}
[G] EMBARGOS DE DECLARAÇÃO: ${DOM.sel('jr-embargos')}`;

                    if (DOM.val('jr-embargos') !== '0') {
                        out += `
[G.1] Fls. de oposição: ${DOM.v('jr-embargos-fls')}
[G.2] Resultado: ${DOM.v('jr-embargos-resultado')}
${DOM.lbl('lbl-g3')}: ${DOM.v('jr-embargos-sentenca')}`;
                    }

                    out += `\n${DOM.lbl('lbl-h')}: ${DOM.sel('jr-contrarrazoes')}`;
                    if (DOM.val('jr-contrarrazoes') !== '0') {
                        out += `\n   ${DOM.lbl('lbl-h1')}: ${DOM.v('jr-contrarrazoes-fls')}`;
                    }
                    return out;
                }
            },
            AP: {
                avaliarCondicionais: () => CONFIG.modos.RO.avaliarCondicionais(),
                gerarTexto: () => CONFIG.modos.RO.gerarTexto(true)
            },
            ED: {
                avaliarCondicionais: () => {
                    const status = DOM.val('jr-ed-contraditorio');
                    DOM.show('jr-ed-contraditorio-detalhes', status !== '0');
                    DOM.show('jr-ed-manifestacao-container', status === '1'); 
                },
                gerarTexto: () => {
                    let out = `[A] EMBARGANTE: ${DOM.sel('jr-ed-embargante')}
[A.1] Fls. e Id dos Embargos: ${DOM.v('jr-ed-fls')}
[B] ACÓRDÃO EMBARGADO (Fls. e ID): ${DOM.v('jr-ed-acordao')}
[C] VÍCIOS ALEGADOS: ${DOM.v('jr-ed-vicios')}
[D] CONTRADITÓRIO / EFEITO MODIFICATIVO: ${DOM.sel('jr-ed-contraditorio')}`;

                    const statusD = DOM.val('jr-ed-contraditorio');
                    if (statusD !== '0') {
                        out += `\n   [D.1] Fls. e Id do Despacho de intimação: ${DOM.v('jr-ed-despacho-fls')}`;
                        if (statusD === '1') {
                            out += `\n   [D.2] Fls. e Id da Manifestação: ${DOM.v('jr-ed-manifestacao-fls')}`;
                        }
                    }
                    return out;
                }
            },
            AI: {
                avaliarCondicionais: () => {
                    DOM.show('jr-ai-contraminuta-detalhes', DOM.val('jr-ai-contraminuta') !== '0');
                    DOM.show('jr-ai-contrarraz-detalhes', DOM.val('jr-ai-contrarraz') !== '0');
                },
                gerarTexto: () => {
                    let out = `[A] AGRAVANTE (Quem teve o recurso trancado): ${DOM.sel('jr-ai-agravante')}
[A.1] Fls. e Id do(s) Agravo(s) de Instrumento: ${DOM.v('jr-ai-fls')}
[B] RECURSO DENEGADO: ${DOM.v('jr-ai-recurso')}
[C] DESPACHO DENEGATÓRIO (Fls. e ID): ${DOM.v('jr-ai-despacho')}
[D] CONTRAMINUTA AO AGRAVO (Fls. e ID): ${DOM.sel('jr-ai-contraminuta')}`;

                    if (DOM.val('jr-ai-contraminuta') !== '0') {
                        out += `\n   [D.1] Fls. e Id da Contraminuta: ${DOM.v('jr-ai-contraminuta-fls')}`;
                    }

                    out += `\n[E] CONTRARRAZÕES AO RECURSO PRINCIPAL: ${DOM.sel('jr-ai-contrarraz')}`;
                    if (DOM.val('jr-ai-contrarraz') !== '0') {
                        out += `\n   [E.1] Fls. e Id das Contrarrazões: ${DOM.v('jr-ai-contrarraz-fls')}`;
                    }
                    return out;
                }
            }
        }
    };

    function getNamespaceKey() {
        const moduloAtivo = getCurrentModule();
        return `juris_relatorio_draft_${moduloAtivo}`;
    }

    function initEvents() {
        if (isInitialized) return;

        const form = document.getElementById('jr-relatorio-form');
        if (!form) return;

        // Delegação de Eventos
        form.addEventListener('change', (e) => {
            if (e.target.name === 'jr_tipo') mudarModo();
            if (e.target.classList.contains('trigger-conditional')) processarCondicionais();
        });

        form.addEventListener('input', generatePreview);
        
        document.getElementById('backdrop-juris-relatorio').addEventListener('click', fecharModal);
        document.getElementById('jr-btn-fechar').addEventListener('click', fecharModal);
        document.getElementById('jr-btn-limpar')?.addEventListener('click', limparFormulario);
        document.getElementById('jr-btn-copiar').addEventListener('click', copiarTexto);

        isInitialized = true;
    }

    function blindarOpcoesPorModulo() {
        const moduloDOM = getCurrentModule(); 
        const moduloAtivo = CONFIG.modulosPermitidos[moduloDOM] ? moduloDOM : 'ro';
        const permitidos = CONFIG.modulosPermitidos[moduloAtivo];

        document.querySelectorAll('input[name="jr_tipo"]').forEach(radio => {
            const label = radio.closest('label');
            if (permitidos.includes(radio.value)) {
                radio.disabled = false;
                label.classList.remove('disabled-option');
            } else {
                radio.disabled = true; // Impede navegação indevida por teclado
                label.classList.add('disabled-option');
            }
        });
        return permitidos[0]; 
    }

    function mudarModo() {
        const form = document.getElementById('jr-relatorio-form');
        const modoSelecionado = document.querySelector('input[name="jr_tipo"]:checked')?.value || 'RO';
        
        form.setAttribute('data-active-mode', modoSelecionado);

        if (modoSelecionado === 'RO' || modoSelecionado === 'AP') {
            const attrSuffix = modoSelecionado.toLowerCase();
            document.querySelectorAll('.dyn-label, .dyn-opt').forEach(el => {
                const text = el.getAttribute(`data-text-${attrSuffix}`);
                if (text) el.textContent = text;
            });
        }

        processarCondicionais();
    }

    function processarCondicionais() {
        const modo = document.getElementById('jr-relatorio-form').getAttribute('data-active-mode');
        if (CONFIG.modos[modo]) {
            CONFIG.modos[modo].avaliarCondicionais();
        }
        generatePreview();
    }

    function generatePreview() {
        const modo = document.getElementById('jr-relatorio-form').getAttribute('data-active-mode');
        let output = '';
        if (CONFIG.modos[modo]) {
            output = CONFIG.modos[modo].gerarTexto();
        }
        document.getElementById('jr-preview-text').value = output;
    }

    function salvarDados() {
        try {
            const formInputs = document.querySelectorAll('#jr-relatorio-form input:not(:disabled), #jr-relatorio-form select:not(:disabled)');
            const data = {};
            formInputs.forEach(el => {
                if (el.type === 'radio') {
                    if (el.checked) data[el.name] = el.value;
                } else if (el.id) {
                    data[el.id] = el.value;
                }
            });
            localStorage.setItem(getNamespaceKey(), JSON.stringify(data));
        } catch (e) {
            console.warn("Juris Relatório: Erro ao salvar rascunho.", e);
        }
    }

    function carregarDados() {
        const defaultModo = blindarOpcoesPorModulo();
        const moduloAtivo = getCurrentModule();
        
        try {
            const draft = JSON.parse(localStorage.getItem(getNamespaceKey()));
            let tipoDesejado = defaultModo;
            
            if (draft) {
                const legacyMap = { 'jr-is-ro': 'RO', 'jr-is-ap': 'AP' };
                const savedType = legacyMap[draft['jr_tipo']] || draft['jr_tipo'];

                if (CONFIG.modulosPermitidos[moduloAtivo]?.includes(savedType)) {
                    tipoDesejado = savedType;
                }
            }

            const radio = document.querySelector(`input[name="jr_tipo"][value="${tipoDesejado}"]`);
            if (radio) radio.checked = true;
            mudarModo(); 

            // Hidratação de valores
            if (draft) {
                Object.keys(draft).forEach(id => {
                    if (id === 'jr_tipo') return;
                    const el = document.getElementById(id);
                    if (el) el.value = draft[id];
                });
            }
            
            // Reavalia a UI após a injeção dos dados
            processarCondicionais();

        } catch (e) {
            console.warn("Juris Relatório: Erro ao carregar rascunho.", e);
            mudarModo();
        }
    }

    function abrirModal() {
        initEvents();
        document.getElementById('backdrop-juris-relatorio').classList.add('active');
        document.getElementById('modal-juris-relatorio').style.display = 'block';
        carregarDados();
    }

    function fecharModal() {
        salvarDados();
        document.getElementById('backdrop-juris-relatorio').classList.remove('active');
        document.getElementById('modal-juris-relatorio').style.display = 'none';
    }

    function limparFormulario() {
        if(!confirm('Deseja descartar o rascunho atual e limpar todos os campos?')) return;
        
        const form = document.getElementById('jr-relatorio-form');
        if (!form) return;
        
        // Purga os dados salvos em memória
        localStorage.removeItem(getNamespaceKey());
        
        // Reset nativo e performático (limpa inputs, selects, textareas)
        form.reset();
        
        // Reidratação de Estado: Força o rádio correto baseado no módulo atual da página
        const defaultModo = blindarOpcoesPorModulo();
        const radio = document.querySelector(`input[name="jr_tipo"][value="${defaultModo}"]`);
        if (radio) radio.checked = true;
        
        // Sincroniza a interface (condicionais e preview) com o novo DOM vazio
        mudarModo(); 
        
        if (typeof window.exibirToast === 'function') window.exibirToast('Formulário limpo e reiniciado!', 'sucesso');
    }

    async function copiarTexto() {
        const text = document.getElementById("jr-preview-text").value;
        try {
            await navigator.clipboard.writeText(text);
            if (typeof window.exibirToast === 'function') window.exibirToast('Relatório copiado!', 'sucesso');
            else alert('Relatório copiado com sucesso!');
        } catch (err) { alert('Erro ao copiar relatório.'); }
    }

    return { abrirModal, fecharModal, mudarModo, copiarTexto };
})();