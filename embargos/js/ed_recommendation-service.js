/* ================================================
   ed_recommendation-service.js (Módulo Embargos)
   Orquestra a chamada de IA para mapear o Acervo
   ================================================ */

window.AIRecommendationManager = (function() {
    const STORAGE_KEY = 'juris_notes_groq_api_key';
    const BASE_URL = `https://api.groq.com/openai/v1/chat/completions`;
    // NOVA LISTA DE MODELOS (Ordem de prioridade: Velocidade -> Suporte -> Capacidade Máxima)
    const GROQ_MODELS = [
        'openai/gpt-oss-20b',  // Prioridade 1: 1.000 t/s
        'qwen/qwen3.6-27b',    // Prioridade 2: 500 t/s (Ótimo fallback geral)
        'openai/gpt-oss-120b'  // Prioridade 3: 500 t/s (Raciocínio denso)
    ];

    function _obterChaveAPI() {
        const key = localStorage.getItem(STORAGE_KEY);
        if (!key) {
            const novaKey = prompt("Autenticação IA (Groq API):\n\nInsira sua chave de API fornecida pela Groq para ativar os superpoderes de classificação e IA do sistema:");
            if (novaKey && novaKey.trim() !== '') {
                localStorage.setItem(STORAGE_KEY, novaKey.trim());
                return novaKey.trim();
            }
            return null;
        }
        return key;
    }

    async function buscarModelosCompativeis(topicoId, textoVicio) {
        if (!textoVicio || textoVicio.trim() === '') return window.exibirToast?.('Redija o Vício Alegado primeiro.', 'aviso');
        
        const apiKey = _obterChaveAPI();
        if (!apiKey) return;

        if (typeof window.AcervoManager === 'undefined') return window.exibirToast?.('Módulo do Acervo não está carregado.', 'erro');

        const modelos = await AcervoManager.carregarModelos();
        if (modelos.length === 0) return window.exibirToast?.('Seu acervo está vazio.', 'aviso');

        // PAYLOAD OTIMIZADO: Apenas ID e Título
        const catalogoComprimido = modelos.map(m => `ID: ${m.id} | Título: ${m.nome}`).join("\n");

        const btnIcon = document.querySelector('.preamble-alegacao .ai-trigger-btn');
        if (btnIcon) btnIcon.classList.add('is-thinking');
        if (window.exibirToast) exibirToast('IA analisando afinidades no Acervo...', 'info');

        const fullPrompt = `Atue como um indexador jurídico. Analise a tese de Embargos de Declaração e encontre os modelos compatíveis.
VÍCIO ALEGADO: "${textoVicio}"

ACERVO DE MODELOS:
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
                if (window.exibirToast) exibirToast(`Redirecionando IA (Tentativa ${i+1}/${GROQ_MODELS.length})...`, 'info');
                // Pequena pausa estratégica de 1.5s
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
                        messages: [{ role: "user", content: fullPrompt }],
                        temperature: 0.1,
                        max_tokens: 800 // Evita truncamento do chain-of-thought
                    })
                });

                if (!response.ok) {
                    // Erro 401 ou 403 é fatal (Chave errada/expirada)
                    if (response.status === 401 || response.status === 403) {
                        localStorage.removeItem(STORAGE_KEY);
                        throw new Error("Chave de API inválida ou expirada. A chave foi limpa.");
                    }
                    // Outros erros (429, 503) disparam o erro para ir ao próximo modelo
                    throw new Error(`Erro ${response.status} no modelo ${currentModel}`);
                }

                const data = await response.json();
                respostaBruta = data?.choices?.[0]?.message?.content || "";
                
                // Sucesso absoluto! Interrompe o loop
                break; 

            } catch (error) {
                console.warn(`[Juris IA - ED] Falha na tentativa com ${currentModel}:`, error.message);
                erroFinal = error;
                
                // Se o erro for de chave inválida, quebra o loop inteiro imediatamente
                if (error.message.includes("inválida")) {
                    break;
                }
            }
        }

        // Se o loop terminou e não temos resposta, a IA falhou completamente
        if (!respostaBruta) {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
            if (window.exibirToast) exibirToast(`Falha na IA após várias tentativas: ${erroFinal ? erroFinal.message : 'Erro desconhecido'}`, 'erro');
            return;
        }

        // PIPELINE DE SANITIZAÇÃO ESTRUTURAL BLINDADO
        try {
            respostaBruta = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
            if (respostaBruta.includes('</think>')) {
                respostaBruta = respostaBruta.split('</think>').pop().trim();
            }
            respostaBruta = respostaBruta.replace(/^```(?:markdown|text|json)?\r?\n?([\s\S]*?)\r?\n?```[\s\S]*$/i, '$1').trim();

            if (respostaBruta.includes("NENHUM")) {
                if (window.exibirToast) exibirToast('Nenhum modelo de alta afinidade encontrado.', 'aviso');
                return; 
            }

            const idsExtraidos = respostaBruta.match(/mod-[a-zA-Z0-9_-]+/g);

            if (!idsExtraidos || idsExtraidos.length === 0) {
                if (window.exibirToast) exibirToast('A IA não retornou IDs válidos. Tente reformular o vício.', 'aviso');
                console.warn("[Juris IA - ED] Resposta da IA fora do padrão:", respostaBruta);
                return;
            }

            console.log("[Juris IA - ED] Recomendações (Groq):", idsExtraidos);

            if (typeof aplicarFiltroIAAcervo === 'function') {
                aplicarFiltroIAAcervo(idsExtraidos);
                if (window.exibirToast) exibirToast('Filtro de Inteligência Artificial aplicado ✨', 'sucesso');
            }
        } catch (error) {
            console.error("[Juris IA Error - ED]", error);
            if (window.exibirToast) exibirToast(`Erro ao processar resposta: ${error.message}`, 'erro');
        } finally {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
        }
    }

    return { buscarModelosCompativeis };
})();