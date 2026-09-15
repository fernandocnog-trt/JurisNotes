/* ================================================
   ai_recommendation-service.js
   Serviço de Inteligência Artificial e LLM para o Acervo
   ================================================ */

window.AIRecommendationManager = (function () {
    'use strict';

    const STORAGE_KEY = 'juris_api_key_groq';
    const BASE_URL = `https://api.groq.com/openai/v1/chat/completions`;
    // NOVA LISTA DE MODELOS (Ordem de prioridade: Velocidade -> Suporte -> Capacidade Máxima)
    const GROQ_MODELS = [
        'openai/gpt-oss-20b',  // Prioridade 1: 1.000 t/s
        'qwen/qwen3.6-27b',    // Prioridade 2: 500 t/s (Ótimo fallback geral)
        'openai/gpt-oss-120b'  // Prioridade 3: 500 t/s (Raciocínio denso)
    ];

    // MODAL DINÂMICO E SEGURO: Substitui o 'prompt()' nativo
    function _solicitarChaveAPI() {
        return new Promise((resolve, reject) => {
            if (document.getElementById('juris-ai-modal-overlay')) return reject('Modal já aberto');

            const overlay = document.createElement('div');
            overlay.id = 'juris-ai-modal-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(2px);';
            
            const modal = document.createElement('div');
            modal.style.cssText = 'background:#ffffff;padding:28px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.2);width:90%;max-width:420px;font-family:system-ui, -apple-system, sans-serif;';
            modal.innerHTML = `
                <h3 style="margin-top:0;color:#1a1a1a;font-size:18px;">🔑 Configurações de IA (Groq Cloud)</h3>
                <p style="font-size:14px;color:#666;line-height:1.5;margin-bottom:20px;">
                    Insira sua API Key da Groq para habilitar a recomendação inteligente de modelos com fallback dinâmico. 
                    <strong>Sua chave é salva apenas localmente no seu navegador.</strong>
                </p>
                <input type="password" id="juris-ai-key-input" placeholder="gsk_..." autocomplete="off" style="width:100%;padding:12px;margin-bottom:20px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;transition:border 0.2s;">
                <div style="display:flex;justify-content:flex-end;gap:12px;">
                    <button id="juris-ai-cancel" style="padding:10px 18px;border:1px solid #ddd;background:white;color:#333;border-radius:6px;cursor:pointer;font-weight:500;">Cancelar</button>
                    <button id="juris-ai-save" style="padding:10px 18px;border:none;background:#2563eb;color:white;border-radius:6px;cursor:pointer;font-weight:500;box-shadow:0 2px 4px rgba(37,99,235,0.2);">Salvar e Analisar</button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            const input = document.getElementById('juris-ai-key-input');
            input.focus();
            
            document.getElementById('juris-ai-cancel').onclick = () => {
                overlay.remove();
                reject('Cancelado pelo usuário');
            };
            
            document.getElementById('juris-ai-save').onclick = () => {
                const key = input.value.trim();
                if (key.startsWith("gsk_") && key.length > 10) {
                    localStorage.setItem(STORAGE_KEY, key);
                    overlay.remove();
                    resolve(key);
                } else {
                    input.style.borderColor = '#ef4444';
                    window.exibirToast?.('A chave deve começar com "gsk_" e ser válida.', 'erro');
                }
            };
            
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') document.getElementById('juris-ai-save').click();
            });
        });
    }

    async function _obterChaveAPI() {
        let key = localStorage.getItem(STORAGE_KEY);
        if (!key) {
            try {
                key = await _solicitarChaveAPI();
            } catch (e) {
                return null;
            }
        }
        return key;
    }

    async function buscarModelosCompativeis(topicoId, textoAlegacoes) {
        if (!textoAlegacoes || textoAlegacoes.trim() === '') return window.exibirToast?.('Redija os Fundamentos do Agravo primeiro.', 'aviso');
        
        const apiKey = await _obterChaveAPI();
        if (!apiKey) return;

        if (typeof window.AcervoManager === 'undefined') {
            if (window.exibirToast) exibirToast('Módulo do Acervo não está carregado.', 'erro');
            return;
        }

        const modelos = await AcervoManager.carregarModelos();
        if (modelos.length === 0) return window.exibirToast?.('Seu acervo está vazio.', 'aviso');

        // PAYLOAD OTIMIZADO: Apenas ID e Título
        const catalogoComprimido = modelos.map(m => `ID: ${m.id} | Título: ${m.nome}`).join("\n");

        const btnIcon = document.querySelector('.preamble-alegacao .ai-trigger-btn');
        if (btnIcon) btnIcon.classList.add('is-thinking');
        if (window.exibirToast) exibirToast('IA analisando o Acervo...', 'info');

        try {
            const prompt = `Atue como um analista jurídico especializado em Admissibilidade Recursal e Agravo de Instrumento. 
Analise a tese/fundamento e encontre os modelos compatíveis no acervo.
TESE / FUNDAMENTOS DO AGRAVO: "${textoAlegacoes}"

ACERVO:
${catalogoComprimido}

REGRA ESTABELECIDA:
Se houver modelos compatíveis, responda OBRIGATORIAMENTE no formato exato: [IDs: mod-xxx, mod-yyy]
Se NÃO houver NENHUM modelo compatível com o tema, responda OBRIGATORIAMENTE: [IDs: NENHUM]`;

            let respostaBruta = null;
        let erroFinal = null;

        // Tenta cada modelo da lista na ordem
        for (let i = 0; i < GROQ_MODELS.length; i++) {
            const currentModel = GROQ_MODELS[i];
            
            if (i > 0) {
                window.exibirToast?.(`Redirecionando IA (Tentativa ${i+1}/${GROQ_MODELS.length})...`, 'info');
                // Pausa estratégica de 1.5s para não ativar proteção contra DDoS
                await new Promise(r => setTimeout(r, 1500));
            }

            try {
                const response = await fetch(BASE_URL, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: currentModel, 
                        messages: [{ role: "user", content: prompt }], // Utiliza o prompt de Agravo
                        temperature: 0.1,
                        max_tokens: 800
                    })
                });

                if (!response.ok) {
                    // Erro 401 ou 403 (Chave errada/expirada)
                    if (response.status === 401 || response.status === 403) {
                        localStorage.removeItem(STORAGE_KEY);
                        throw new Error("Sua API Key do Groq é inválida. A chave foi limpa.");
                    }
                    throw new Error(`Erro ${response.status} no modelo ${currentModel}`);
                }

                const data = await response.json();
                respostaBruta = data?.choices?.[0]?.message?.content || "";
                
                // Sucesso! Interrompe o loop
                break; 

            } catch (error) {
                console.warn(`[Juris IA] Falha na tentativa com ${currentModel}:`, error.message);
                erroFinal = error;
                
                if (error.message.includes("inválida")) break;
            }
        }

        // IA falhou em todas as tentativas
        if (!respostaBruta) {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
            window.exibirToast?.(`Falha na IA após várias tentativas: ${erroFinal ? erroFinal.message : 'Erro desconhecido'}`, 'erro');
            return;
        }

        // [NOVO] PIPELINE DE SANITIZAÇÃO ESTRUTURAL BLINDADO
        try {
            respostaBruta = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
            if (respostaBruta.includes('</think>')) {
                respostaBruta = respostaBruta.split('</think>').pop().trim();
            }
            respostaBruta = respostaBruta.replace(/^```(?:markdown|text|json)?\r?\n?([\s\S]*?)\r?\n?```[\s\S]*$/i, '$1').trim();

            if (respostaBruta.includes("NENHUM")) {
                window.exibirToast?.('Nenhum modelo de alta afinidade encontrado para este Agravo.', 'aviso');
                return; 
            }

            const idsExtraidos = respostaBruta.match(/mod-[a-zA-Z0-9_-]+/g);

            if (!idsExtraidos || idsExtraidos.length === 0) {
                window.exibirToast?.('A IA não retornou IDs válidos. Tente reformular os fundamentos.', 'aviso');
                console.warn("[Juris IA] Resposta da IA fora do padrão:", respostaBruta);
                return;
            }

            console.log("[Juris IA] Recomendações (Groq):", idsExtraidos);

            if (typeof aplicarFiltroIAAcervo === 'function') {
                aplicarFiltroIAAcervo(idsExtraidos);
                window.exibirToast?.('Filtro de Inteligência Artificial aplicado ✨', 'sucesso');
            }
        } catch (error) {
            console.error("[Juris IA Error]", error);
            window.exibirToast?.(`Erro ao processar resposta: ${error.message}`, 'erro');
        } finally {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
        }
    }

    return {
        buscarModelosCompativeis
    };
})();