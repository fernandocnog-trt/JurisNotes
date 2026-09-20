/* ================================================
   layout-telemetry.js — v1.0
   Sondas de diagnóstico de Layout Thrashing (opt-in).
   - Default OFF: custo zero em produção (GitHub Pages).
   - Ativação: ?layoutDebug=1 na URL  OU  localStorage.layoutDebug = '1'.
   - REGRA DE PRIVACIDADE: registra apenas ids estruturais e medidas;
     JAMAIS texto de cards, degravações ou dados do processo.
   ================================================ */
window.LayoutTelemetry = (function () {
    'use strict';

    /* ---------- Ativação (opt-in) ---------- */
    let _enabled = new URLSearchParams(location.search).has('layoutDebug') ||
                   localStorage.getItem('layoutDebug') === '1';

    /* ---------- Ring buffer (post-mortem) ---------- */
    const BUFFER_MAX = 1000;
    const _buffer = [];
    function _push(ev) {
        ev.t = Math.round(performance.now());
        _buffer.push(ev);
        if (_buffer.length > BUFFER_MAX) _buffer.shift();
    }

    /* ---------- Detector de loop (janela deslizante de deliveries) ---------- */
    const LOOP_JANELA_MS = 250;   // cobre o período real do pipeline (32ms debounce + rAF + guarda 50ms)
    const LOOP_LIMIAR   = 6;      // deliveries na janela
    const _janela = [];
    let _episodioAlertado = false;

    /* ---------- Token de passagem module-scoped (zero injeção de assinatura) ---------- */
    let _passAtual = null;

    /* ---------- Contadores (painel) ---------- */
    const _contadores = {
        'M1-RO': 0,       // entregas do RO processadas
        'M1b-RO-SW': 0,   // entregas engolidas pela guarda
        'M2-RENDER': 0,   // renderizarFichario
        'M3-POS': 0,      // passagens de posicionarNosDeIdeia
        'M4-SVG': 0,      // reescritas de desenharConexoes
        'M5-SCROLL': 0,   // scrollTo orquestrado por JS
        'M6-GUTTER': 0,   // flips de scrollbar
        'M9-LOOP': 0      // alertas de loop
    };
    function _cont(k) { _contadores[k] = (_contadores[k] || 0) + 1; }

    let _ultimoGutter = null;

    /* ---------- Helpers ---------- */
    function _gutter() {
        const hc = document.getElementById('history-container');
        return hc ? (hc.offsetWidth - hc.clientWidth) : -1;
    }
    function _rotulo(el) {
        if (!el) return '?';
        if (el.id) return '#' + el.id;
        const cls = String(el.className || '').split(' ')[0];
        return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
    }

    /* ================= API PÚBLICA ================= */
    function isEnabled() { return _enabled; }
    function enable()  { _enabled = true;  localStorage.setItem('layoutDebug', '1'); console.info('[LayoutTelemetry] ON'); }
    function disable() { _enabled = false; localStorage.removeItem('layoutDebug'); }

    /** Hook ANTES da guarda do ResizeObserver. Nunca deve lançar. */
    function noteDelivery(entries, swallowed) {
        if (!_enabled) return;
        try {
            const gutter = _gutter();
            if (_ultimoGutter !== null && gutter !== _ultimoGutter) {
                _cont('M6-GUTTER');
                _push({ tipo: 'GUTTER-FLIP', de: _ultimoGutter, para: gutter });
            }
            _ultimoGutter = gutter;

            if (swallowed) {
                _cont('M1b-RO-SW');
                _push({ tipo: 'RO-SWALLOWED', n: entries.length, gutter });
                return;
            }
            _cont('M1-RO');
            _push({
                tipo: 'RO', n: entries.length, gutter,
                alvos: entries.map(e => _rotulo(e.target)),
                pass: _passAtual ? _passAtual.rotulo : null
            });

            const agora = performance.now();
            _janela.push(agora);
            while (_janela.length && agora - _janela[0] > LOOP_JANELA_MS) _janela.shift();
            if (_janela.length > LOOP_LIMIAR) {
                _cont('M9-LOOP');
                if (!_episodioAlertado) {
                    _episodioAlertado = true;
                    console.error('🚨 [LayoutTelemetry] SUSPEITA DE LOOP: ' + _janela.length +
                        ' entregas em ' + LOOP_JANELA_MS + 'ms. Rode LayoutTelemetry.dump().');
                }
            } else if (_episodioAlertado && _janela.length <= 1) {
                _episodioAlertado = false;
            }
        } catch (e) { /* telemetria jamais pode quebrar o app */ }
    }

    function beginPass(rotulo) {
        if (!_enabled) return null;
        _passAtual = { rotulo: rotulo, mut: {} };
        return _passAtual;
    }
    function mark(chave, detalhe) {
        if (!_enabled || !_passAtual) return;
        _passAtual.mut[chave] = (_passAtual.mut[chave] || 0) + 1;
        if (detalhe !== undefined) _passAtual.mut[chave + '_detalhe'] = detalhe;
    }
    function endPass() {
        if (!_enabled || !_passAtual) return;
        _push({ tipo: 'PASS', rotulo: _passAtual.rotulo, mut: _passAtual.mut, gutter: _ultimoGutter });
        _passAtual = null;
    }

    /** Marca fora de passagem: scrollTo orquestrado (restaurarScroll/_reassertScroll). */
    function markScroll(origem, detalhe) {
        if (!_enabled) return;
        _cont('M5-SCROLL');
        const ev = { tipo: 'SCROLL', origem: origem, gutter: _ultimoGutter };
        if (detalhe) Object.assign(ev, detalhe);
        _push(ev);
    }

    function contRender() { if (_enabled) { _cont('M2-RENDER'); _push({ tipo: 'RENDER' }); } }
    function contPos()    { if (_enabled) { _cont('M3-POS'); } }
    function contSvg()    { if (_enabled) { _cont('M4-SVG'); } }

    function dump() {
        console.table(_buffer.slice(-200));
        console.info('[LayoutTelemetry] Contadores:', JSON.parse(JSON.stringify(_contadores)));
        console.info('[LayoutTelemetry] Assinaturas: H1 = RO 1–2 frames após PASS com minHeight Δ e gutter constante | H2 = Δ alternado + GUTTER-FLIP | H3 = SCROLL instant Δ>4px sem RO | H4 = rajada de PASS zen-sync ~350ms.');
        return _buffer;
    }
    function clear() { _buffer.length = 0; }

    /* ---------- Painel mínimo (opcional): LayoutTelemetry.painel() ---------- */
    let _painelTimer = null;
    function painel() {
        let div = document.getElementById('layout-telemetry-panel');
        if (!div) {
            div = document.createElement('div');
            div.id = 'layout-telemetry-panel';
            div.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:#101418ee;color:#0f0;' +
                'font:11px/1.5 monospace;padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre;';
            document.body.appendChild(div);
        }
        const antes = JSON.parse(JSON.stringify(_contadores));
        clearInterval(_painelTimer);
        _painelTimer = setInterval(() => {
            div.textContent = 'TELEMETRIA LAYOUT\n' + Object.keys(_contadores).map(k => {
                const delta = _contadores[k] - (antes[k] || 0);
                antes[k] = _contadores[k];
                return k.padEnd(10) + delta + '/s';
            }).join('\n');
        }, 1000);
    }

    return {
        isEnabled, enable, disable, noteDelivery, beginPass, mark, endPass,
        markScroll, contRender, contPos, contSvg, dump, clear, painel,
        get contadores() { return _contadores; }
    };
})();
