/*
 * ed_juris-editor.js
 * JurisEditor — Motor de edição visual (WYSIWYG) e conversão bidirecional (Módulo Embargos)
 * Formato interno de armazenamento (o que vai para o banco/JSON):
 *   **negrito**, *itálico*, [[u]]sublinhado[[/u]], [[size:1]]...[[/size]], [[size:2]]...[[/size]]
 * Esse formato é 100% texto puro (sem "<" ou ">"), compatível com o
 * pipeline de sanitização já existente (JurisUtils.limparTextoPDF).
 */
window.JurisEditor = (function () {

    const editorEl = () => document.getElementById('edit-text-input');

    /* ---------- Ciclo de vida ---------- */

    function init() {
        const el = editorEl();
        if (!el) return;

        el.addEventListener('input', _atualizarEstadoVazio);
        el.addEventListener('paste', _interceptarColagem);
        el.addEventListener('keydown', _atalhosTeclado);

        _atualizarEstadoVazio(); // estado inicial
    }

    function _atualizarEstadoVazio() {
        const el = editorEl();
        if (!el) return;
        if (el.innerText.trim() === '') {
            el.innerHTML = ''; // remove <br> residual que o Chrome deixa após apagar tudo
            el.classList.add('is-empty');
        } else {
            el.classList.remove('is-empty');
        }
    }

    function _atalhosTeclado(e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); formatar('bold'); }
        if (k === 'i') { e.preventDefault(); formatar('italic'); }
        if (k === 'u') { e.preventDefault(); formatar('underline'); }
    }

    /* ---------- Formatação ---------- */

    function formatar(comando) {
        document.execCommand(comando, false, null);
        editorEl().focus();
        _atualizarEstadoVazio();
    }

    // Aplica tamanho de fonte via Selection/Range (não usa execCommand('fontSize'),
    // que gera <font size="N"> obsoleto e sem relação com nossas classes CSS).
    function aplicarTamanho(classeTamanho) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (range.collapsed) return;

        const span = document.createElement('span');
        span.className = classeTamanho;

        try {
            // Caminho rápido: funciona quando a seleção não cruza parcialmente outra tag
            range.surroundContents(span);
        } catch (err) {
            // Fallback seguro: extrai o conteúdo selecionado (mesmo que atravesse múltiplos nós)
            // e o reencaixa dentro do span, evitando o InvalidStateError do surroundContents.
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
        }

        sel.removeAllRanges();
        const novoRange = document.createRange();
        novoRange.selectNodeContents(span);
        sel.addRange(novoRange);

        editorEl().focus();
        _atualizarEstadoVazio();
    }

    /* ---------- Colagem externa (Markdown -> Visual) ---------- */

    function _interceptarColagem(e) {
        e.preventDefault();
        let texto = (e.originalEvent || e).clipboardData.getData('text/plain');
        texto = window.JurisUtils.limparEscapeMarkdown(texto);
        const htmlSeguro = markdownParaHtml(texto);
        document.execCommand('insertHTML', false, htmlSeguro);
        _atualizarEstadoVazio();
    }

    /* ---------- Normalização de DOM ---------- */
    // Navegadores diferentes podem gerar <span style="font-weight:bold"> em vez de <b>
    // (comum em Safari, ou após operações de paste). Esta função varre uma cópia do DOM
    // e converte esses spans em tags semânticas (<b>, <i>, <u>) ANTES do parser de Regex agir,
    // garantindo que a extração de Markdown não perca formatação silenciosamente.
    function _normalizarDOM(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;

        temp.querySelectorAll('span').forEach(span => {
            // Preserva os spans de tamanho de fonte — serão tratados pelo regex de tamanho
            if (span.classList.contains('txt-largo-1') || span.classList.contains('txt-largo-2')) {
                return;
            }

            const cs = span.style;
            const isBold = cs.fontWeight === 'bold' || cs.fontWeight === 'bolder' || parseInt(cs.fontWeight, 10) >= 600;
            const isItalic = cs.fontStyle === 'italic';
            const isUnderline = (cs.textDecorationLine || cs.textDecoration || '').includes('underline');

            if (isBold || isItalic || isUnderline) {
                // Constrói a cadeia de tags aninhadas em memória ANTES de tocar o DOM real,
                // evitando o bug de "substituir um nó já desconectado" (perda silenciosa de formatação).
                let node = document.createDocumentFragment();
                while (span.firstChild) node.appendChild(span.firstChild);

                if (isUnderline) { const u = document.createElement('u'); u.appendChild(node); node = u; }
                if (isItalic)    { const i = document.createElement('i'); i.appendChild(node); node = i; }
                if (isBold)      { const b = document.createElement('b'); b.appendChild(node); node = b; }

                span.replaceWith(node);
                return;
            }

            // Span "vazio" (sem estilo relevante, sem classe) — remove o wrapper, preserva conteúdo
            if (!span.className && !span.getAttribute('style')) {
                span.replaceWith(...span.childNodes);
            }
        });

        return temp.innerHTML;
    }

    /* ---------- Conversores: HTML visível <-> formato interno de armazenamento ---------- */

    function htmlParaMarkdown(html) {
        let md = _normalizarDOM(html);

        md = md.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '');
        md = md.replace(/<p>/gi, '\n').replace(/<\/p>/gi, '');
        md = md.replace(/<br\s*[\/]?>/gi, '\n');

        // Tamanho de fonte (reaproveita as mesmas classes já usadas na exibição dos cards)
        md = md.replace(/<span[^>]*class="[^"]*\btxt-largo-1\b[^"]*"[^>]*>/gi, '[[size:1]]');
        md = md.replace(/<span[^>]*class="[^"]*\btxt-largo-2\b[^"]*"[^>]*>/gi, '[[size:2]]');
        md = md.replace(/<\/span>/gi, '[[/size]]');

        // Negrito / Itálico / Sublinhado
        md = md.replace(/<(b|strong)[^>]*>/gi, '**').replace(/<\/(b|strong)>/gi, '**');
        md = md.replace(/<(i|em)[^>]*>/gi, '*').replace(/<\/(i|em)>/gi, '*');
        md = md.replace(/<u[^>]*>/gi, '[[u]]').replace(/<\/u>/gi, '[[/u]]');

        // Proteção final: remove qualquer tag HTML residual não convertida
        md = md.replace(/<[^>]*>/gm, '');

        return md.trim();
    }

    function markdownParaHtml(md) {
        if (!md) return '';

        let mdLimpo = window.JurisUtils.limparEscapeMarkdown(md);

        // Escapa caracteres HTML perigosos ANTES de reinserir nossas próprias tags.
        // Sem isso, um "<" ou ">" literal no texto salvo (ex: citação de lei, comparação
        // numérica) seria interpretado como HTML ao ser injetado via innerHTML.
        let html = mdLimpo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
        html = html.replace(/\*([\s\S]+?)\*/g, '<i>$1</i>');
        html = html.replace(/\[\[u\]\]([\s\S]*?)\[\[\/u\]\]/g, '<u>$1</u>');
        html = html.replace(/\[\[size:1\]\]([\s\S]*?)\[\[\/size\]\]/g, '<span class="txt-largo-1">$1</span>');
        html = html.replace(/\[\[size:2\]\]([\s\S]*?)\[\[\/size\]\]/g, '<span class="txt-largo-2">$1</span>');
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    // Converte o formato interno (banco) para Markdown "real", pronto para
    // colar em ChatGPT/Claude/NotebookLM ou no "Colar como Markdown" do Google Docs.
    function _bancoParaMarkdownExterno(bancoMd) {
        let md = bancoMd;
        md = md.replace(/\[\[u\]\]/g, '<u>').replace(/\[\[\/u\]\]/g, '</u>');
        md = md.replace(/\[\[size:\d\]\]/g, '').replace(/\[\[\/size\]\]/g, '');
        return md;
    }

    /* ---------- Cópia dupla ---------- */

    async function copiarComo(formato) {
        const el = editorEl();
        const conteudoHtml = el.innerHTML;

        if (formato === 'html') {
            const bancoMd = htmlParaMarkdown(conteudoHtml);
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([conteudoHtml], { type: 'text/html' }),
                        'text/plain': new Blob([_bancoParaMarkdownExterno(bancoMd)], { type: 'text/plain' })
                    })
                ]);
                exibirToast('Texto formatado copiado!', 'sucesso');
            } catch (e) {
                exibirToast('Não foi possível copiar o texto formatado.', 'erro');
            }
        } else {
            const md = _bancoParaMarkdownExterno(htmlParaMarkdown(conteudoHtml));
            navigator.clipboard.writeText(md).then(() => {
                exibirToast('Markdown copiado para IA!', 'sucesso');
            });
        }
    }

    return { init, formatar, aplicarTamanho, copiarComo, htmlParaMarkdown, markdownParaHtml };
})();

document.addEventListener('DOMContentLoaded', () => {
    if (window.JurisEditor) JurisEditor.init();
});